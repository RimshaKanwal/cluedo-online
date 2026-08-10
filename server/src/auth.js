import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const USERNAME_RE = /^[a-zA-Z0-9 _-]{2,20}$/;

function toPublicUser(row) {
  return {
    userId: row.id,
    username: row.display_name,
    wins: row.wins,
    gamesPlayed: row.games_played,
  };
}

function issueToken(row) {
  return jwt.sign({ userId: row.id, username: row.display_name }, JWT_SECRET, { expiresIn: "180d" });
}

// Creates the account on first use, or verifies the PIN against an existing
// one. There's no separate signup step — the first person to use a name
// claims it with whatever PIN they typed.
export async function registerOrLogin(username, pin) {
  const trimmedName = (username || "").trim();
  const trimmedPin = (pin || "").trim();
  if (!USERNAME_RE.test(trimmedName)) {
    throw new Error("Username must be 2-20 characters (letters, numbers, spaces, - or _)");
  }
  if (!/^\d{4,6}$/.test(trimmedPin)) {
    throw new Error("PIN must be 4-6 digits");
  }
  const key = trimmedName.toLowerCase();

  const existing = await pool.query("SELECT * FROM users WHERE username = $1", [key]);
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    const ok = await bcrypt.compare(trimmedPin, row.pin_hash);
    if (!ok) throw new Error("Wrong PIN for that username");
    return { token: issueToken(row), user: toPublicUser(row) };
  }

  const pinHash = await bcrypt.hash(trimmedPin, 10);
  const inserted = await pool.query(
    "INSERT INTO users (username, display_name, pin_hash) VALUES ($1, $2, $3) RETURNING *",
    [key, trimmedName, pinHash]
  );
  const row = inserted.rows[0];
  return { token: issueToken(row), user: toPublicUser(row) };
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET); // throws if invalid/expired
}

export async function getUserById(userId) {
  const res = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
  if (res.rows.length === 0) throw new Error("Account no longer exists");
  return toPublicUser(res.rows[0]);
}

export async function getLeaderboard(limit = 50) {
  const res = await pool.query(
    `SELECT display_name, wins, games_played
     FROM users
     WHERE games_played > 0
     ORDER BY wins DESC, (wins::float / GREATEST(games_played, 1)) DESC
     LIMIT $1`,
    [limit]
  );
  return res.rows.map((r) => ({
    username: r.display_name,
    wins: r.wins,
    gamesPlayed: r.games_played,
    winRate: r.games_played > 0 ? r.wins / r.games_played : 0,
  }));
}

// Called once per finished game: winnerId (nullable) gets a win, everyone
// else (and the winner too) gets games_played incremented.
export async function recordGameResult(playerUserIds, winnerUserId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const userId of playerUserIds) {
      if (userId === winnerUserId) {
        await client.query("UPDATE users SET wins = wins + 1, games_played = games_played + 1 WHERE id = $1", [userId]);
      } else {
        await client.query("UPDATE users SET games_played = games_played + 1 WHERE id = $1", [userId]);
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
