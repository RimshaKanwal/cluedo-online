import { SERVER_URL } from "./socket";

const TOKEN_KEY = "cluedo-auth-token";

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function storeToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// Signs up (first use of a username) or logs in (verifies the PIN against
// an existing account) — the server treats both the same way.
export async function signIn(username, pin) {
  const res = await fetch(`${SERVER_URL}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, pin }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Sign-in failed");
  return data; // { token, userId, username, wins, gamesPlayed }
}

export async function fetchMe(token) {
  const res = await fetch(`${SERVER_URL}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Session expired");
  return res.json(); // { userId, username, wins, gamesPlayed }
}

export async function fetchLeaderboard() {
  const res = await fetch(`${SERVER_URL}/api/leaderboard`);
  if (!res.ok) throw new Error("Could not load leaderboard");
  return res.json();
}
