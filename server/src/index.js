import http from "node:http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import { GameManager } from "./game/gameManager.js";
import { MIN_PLAYERS, MAX_PLAYERS } from "./game/constants.js";

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.get("/health", (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CLIENT_ORIGIN } });

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
  socket.on("createGame", ({ name, maxPlayers }) => {
    wrap(socket, () => {
      leavePreviousRoom(socket);
      const room = manager.createRoom(maxPlayers);
      const player = room.addPlayer(socket.id, name);
      socket.join(room.code);
      socket.data.code = room.code;
      socket.data.playerId = player.id;
      socket.emit("joined", { code: room.code, playerId: player.id });
      broadcastState(room.code);
    });
  });

  socket.on("joinGame", ({ code, name }) => {
    wrap(socket, () => {
      const room = manager.getRoom(code);
      if (!room) throw new Error("Room not found. Check the code and try again.");

      // If the game is already going, let a returning player reclaim their
      // seat by name (they left / got disconnected) instead of being blocked.
      if (room.status !== "lobby") {
        const seat = room.players.find(
          (p) => !p.connected && p.name.trim().toLowerCase() === (name || "").trim().toLowerCase()
        );
        if (!seat) throw new Error("Game already in progress — ask them to finish, or rejoin with the exact name you played as.");
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
      const player = room.addPlayer(socket.id, name);
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

server.listen(PORT, () => {
  console.log(`Cluedo server listening on port ${PORT}`);
  console.log(`Allowed player range: ${MIN_PLAYERS}-${MAX_PLAYERS}`);
});
