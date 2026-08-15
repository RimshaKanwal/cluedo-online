import http from "node:http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import { GameManager } from "./game/gameManager.js";
import { MIN_PLAYERS, MAX_PLAYERS } from "./game/constants.js";
import { initSchema } from "./db.js";
import { registerOrLogin, verifyToken, getUserById, getLeaderboard, getMenace, recordGameResult } from "./auth.js";

const REACTION_EMOJI = ["😏 Suspicious...", "🤔 Hmm", "😱 No way!", "😂 lol", "🎯 Got you!", "😤 Ugh"];

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());
app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/auth", async (req, res) => {
  try {
    const { token, user } = await registerOrLogin(req.body?.username, req.body?.pin);
    res.json({ token, ...user });
  } catch (err) {
    res.status(400).json({ error: err.message || "Sign-in failed" });
  }
});

app.get("/api/me", async (req, res) => {
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const decoded = verifyToken(token);
    const user = await getUserById(decoded.userId);
    res.json(user);
  } catch {
    res.status(401).json({ error: "Invalid or expired session" });
  }
});

app.get("/api/leaderboard", async (_req, res) => {
  try {
    res.json(await getLeaderboard());
  } catch (err) {
    res.status(500).json({ error: err.message || "Could not load leaderboard" });
  }
});

app.get("/api/menace", async (_req, res) => {
  try {
    res.json(await getMenace());
  } catch (err) {
    res.status(500).json({ error: err.message || "Could not load menace" });
  }
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CLIENT_ORIGIN } });

// Every socket connection must carry a valid account token (issued by
// POST /api/auth) — createGame/joinGame derive the player's display name
// from this instead of trusting free-typed client input, so wins/losses
// land on the right account regardless of what anyone types.
io.use((socket, next) => {
  try {
    const decoded = verifyToken(socket.handshake.auth?.token);
    socket.data.user = { userId: decoded.userId, username: decoded.username };
    next();
  } catch {
    next(new Error("unauthenticated"));
  }
});

const manager = new GameManager();

function broadcastState(code) {
  const room = manager.getRoom(code);
  if (!room) return;
  for (const player of room.players) {
    io.to(player.socketId).emit("state", room.toClientState(player.id));
  }
}

// When a suggestion is disproved (or no one can), privately tell the
// suggester which card — if any — was shown to them.
function deliverReveal(room, privateReveal) {
  if (!privateReveal) return;
  const suggester = room.players.find((p) => p.id === privateReveal.suggesterId);
  if (!suggester) return;
  io.to(suggester.socketId).emit("suggestionResult", {
    disprovingPlayerName: privateReveal.byName || null,
    shownCard: privateReveal.shownCard || null,
  });
}

function wrap(socket, fn) {
  try {
    fn();
  } catch (err) {
    socket.emit("errorMessage", err.message || "Something went wrong");
  }
}

// Detaches a socket from whatever room it was previously in — marks it
// disconnected there and stops relaying that room's broadcasts to it —
// so switching games (or explicitly leaving) can't leave a stale
// subscription that later overwrites the new game's state on the client.
function leavePreviousRoom(socket) {
  const prevCode = socket.data.code;
  if (!prevCode) return;
  socket.leave(prevCode);
  const prevRoom = manager.getRoom(prevCode);
  if (prevRoom) {
    prevRoom.removePlayerBySocket(socket.id);
    if (prevRoom.players.length === 0) manager.deleteRoom(prevCode);
    else broadcastState(prevCode);
  }
  socket.data.code = null;
  socket.data.playerId = null;
}

io.on("connection", (socket) => {
  socket.on("createGame", ({ maxPlayers, allowAnytimeAccusation }) => {
    wrap(socket, () => {
      leavePreviousRoom(socket);
      const room = manager.createRoom(maxPlayers, { allowAnytimeAccusation });
      const player = room.addPlayer(socket.id, socket.data.user.username, socket.data.user.userId);
      socket.join(room.code);
      socket.data.code = room.code;
      socket.data.playerId = player.id;
      socket.emit("joined", { code: room.code, playerId: player.id });
      broadcastState(room.code);
    });
  });

  socket.on("joinGame", ({ code }) => {
    wrap(socket, () => {
      const room = manager.getRoom(code);
      if (!room) throw new Error("Room not found. Check the code and try again.");
      const myUsername = socket.data.user.username.trim().toLowerCase();

      // If the game is already going, let a returning player reclaim their
      // seat by account (they left / got disconnected) instead of being
      // blocked — matched by account, not by whatever they type.
      if (room.status !== "lobby") {
        const seat = room.players.find(
          (p) => !p.connected && p.name.trim().toLowerCase() === myUsername
        );
        if (!seat) throw new Error("Game already in progress — ask them to finish, or sign back in as the account you played as.");
        leavePreviousRoom(socket);
        seat.socketId = socket.id;
        seat.connected = true;
        socket.join(room.code);
        socket.data.code = room.code;
        socket.data.playerId = seat.id;
        socket.emit("joined", { code: room.code, playerId: seat.id });
        room.log.push({ type: "system", message: `${seat.name} rejoined the game.` });
        broadcastState(room.code);
        return;
      }

      leavePreviousRoom(socket);
      const player = room.addPlayer(socket.id, socket.data.user.username, socket.data.user.userId);
      socket.join(room.code);
      socket.data.code = room.code;
      socket.data.playerId = player.id;
      socket.emit("joined", { code: room.code, playerId: player.id });
      broadcastState(room.code);
    });
  });

  // Silent reconnect (page reload / network blip): reattach by playerId.
  socket.on("rejoin", ({ code, playerId }) => {
    const room = manager.getRoom(code);
    const player = room?.players.find((p) => p.id === playerId);
    if (!room || !player) {
      socket.emit("sessionEnded");
      return;
    }
    if (socket.data.code && socket.data.code !== code) leavePreviousRoom(socket);
    const wasOffline = !player.connected;
    player.socketId = socket.id;
    player.connected = true;
    socket.join(room.code);
    socket.data.code = room.code;
    socket.data.playerId = player.id;
    socket.emit("joined", { code: room.code, playerId: player.id });
    if (wasOffline) room.log.push({ type: "system", message: `${player.name} reconnected.` });
    broadcastState(room.code);
  });

  // Explicit "leave" — e.g. clicking New Game from a finished board. Frees
  // the seat (and the room, if everyone's gone) instead of leaving a ghost
  // player sitting in a game nobody will return to.
  socket.on("leaveGame", () => {
    leavePreviousRoom(socket);
  });

  socket.on("startGame", ({ code, playerId }) => {
    wrap(socket, () => {
      const room = manager.getRoom(code);
      if (!room) throw new Error("Room not found");
      const player = room.players.find((p) => p.id === playerId);
      if (!player?.isHost) throw new Error("Only the host can start the game");
      room.start();
      broadcastState(room.code);
    });
  });

  socket.on("rollDice", ({ code, playerId }) => {
    wrap(socket, () => {
      const gameRoom = manager.getRoom(code);
      if (!gameRoom) throw new Error("Room not found");
      gameRoom.rollDice(playerId);
      broadcastState(code);
    });
  });

  socket.on("movePlayer", ({ code, playerId, target }) => {
    wrap(socket, () => {
      const gameRoom = manager.getRoom(code);
      if (!gameRoom) throw new Error("Room not found");
      gameRoom.moveTo(playerId, target);
      broadcastState(code);
    });
  });

  socket.on("useSecretPassage", ({ code, playerId }) => {
    wrap(socket, () => {
      const gameRoom = manager.getRoom(code);
      if (!gameRoom) throw new Error("Room not found");
      gameRoom.useSecretPassage(playerId);
      broadcastState(code);
    });
  });

  socket.on("makeSuggestion", ({ code, playerId, suggestion }) => {
    wrap(socket, () => {
      const gameRoom = manager.getRoom(code);
      if (!gameRoom) throw new Error("Room not found");
      const result = gameRoom.makeSuggestion(playerId, suggestion);
      deliverReveal(gameRoom, result?.privateReveal);
      broadcastState(code);
    });
  });

  socket.on("respondSuggestion", ({ code, playerId, action, cardValue }) => {
    wrap(socket, () => {
      const gameRoom = manager.getRoom(code);
      if (!gameRoom) throw new Error("Room not found");
      const result = gameRoom.respondToSuggestion(playerId, { action, cardValue });
      deliverReveal(gameRoom, result?.privateReveal);
      broadcastState(code);
    });
  });

  socket.on("makeAccusation", ({ code, playerId, accusation }) => {
    wrap(socket, () => {
      const gameRoom = manager.getRoom(code);
      if (!gameRoom) throw new Error("Room not found");
      const result = gameRoom.makeAccusation(playerId, accusation);
      broadcastState(code);
      socket.emit("accusationResult", result);

      // A wrong accusation can eliminate the last active player, ending the
      // game right here too — either way, record it exactly once.
      if (gameRoom.status === "finished" && !gameRoom.resultRecorded) {
        gameRoom.resultRecorded = true;
        const winnerPlayer = gameRoom.players.find((p) => p.id === gameRoom.winnerId);
        const participantUserIds = gameRoom.players.map((p) => p.userId).filter(Boolean);
        const wrongUserIds = gameRoom.wrongAccusers
          .map((playerId) => gameRoom.players.find((p) => p.id === playerId)?.userId)
          .filter(Boolean);
        recordGameResult(participantUserIds, wrongUserIds, winnerPlayer?.userId ?? null, result?.achievements || {}).catch(
          (err) => {
            console.error("Failed to record game result:", err.message);
          }
        );
      }
    });
  });

  socket.on("endTurn", ({ code, playerId }) => {
    wrap(socket, () => {
      const gameRoom = manager.getRoom(code);
      if (!gameRoom) throw new Error("Room not found");
      gameRoom.endTurn(playerId);
      broadcastState(code);
    });
  });

  // Purely transient — not stored in GameRoom state or persisted, just
  // relayed live to everyone currently in the room (sender included, so
  // one render code path handles showing your own bubble too).
  socket.on("sendReaction", ({ code, playerId, emoji }) => {
    wrap(socket, () => {
      const gameRoom = manager.getRoom(code);
      if (!gameRoom) throw new Error("Room not found");
      if (!REACTION_EMOJI.includes(emoji)) throw new Error("Not a valid reaction");
      const player = gameRoom.players.find((p) => p.id === playerId);
      if (!player) throw new Error("Unknown player");
      io.to(code).emit("reaction", { playerId, emoji });
    });
  });

  socket.on("submitFinalNotes", ({ code, playerId, marks }) => {
    wrap(socket, () => {
      const gameRoom = manager.getRoom(code);
      if (!gameRoom) throw new Error("Room not found");
      gameRoom.submitFinalNotes(playerId, marks);
      broadcastState(code);
    });
  });

  socket.on("disconnect", () => {
    const { code } = socket.data;
    if (!code) return;
    const room = manager.getRoom(code);
    if (!room) return;
    const player = room.players.find((p) => p.socketId === socket.id);
    if (!player) return;
    player.connected = false;
    broadcastState(code);

    // Grace period before actually freeing the seat: a page reload
    // disconnects then reconnects almost immediately, and without this an
    // in-progress rejoin can lose the race — fatally so for a lone player
    // in a lobby they just created, since removing them empties the room.
    const playerId = player.id;
    setTimeout(() => {
      const stillRoom = manager.getRoom(code);
      if (!stillRoom) return;
      const stillThere = stillRoom.players.find((p) => p.id === playerId);
      if (!stillThere || stillThere.connected) return; // reconnected in time
      stillRoom.removePlayerBySocket(socket.id);
      if (stillRoom.players.length === 0) manager.deleteRoom(code);
      else broadcastState(code);
    }, 8000);
  });
});

initSchema()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Cluedo server listening on port ${PORT}`);
      console.log(`Allowed player range: ${MIN_PLAYERS}-${MAX_PLAYERS}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database schema:", err.message);
    process.exit(1);
  });
