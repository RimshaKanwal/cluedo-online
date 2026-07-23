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

function wrap(socket, fn) {
  try {
    fn();
  } catch (err) {
    socket.emit("errorMessage", err.message || "Something went wrong");
  }
}

io.on("connection", (socket) => {
  socket.on("createGame", ({ name, maxPlayers }) => {
    wrap(socket, () => {
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
      const player = room.addPlayer(socket.id, name);
      socket.join(room.code);
      socket.data.code = room.code;
      socket.data.playerId = player.id;
      socket.emit("joined", { code: room.code, playerId: player.id });
      broadcastState(room.code);
    });
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

  socket.on("moveViaCorridor", ({ code, playerId, targetRoom }) => {
    wrap(socket, () => {
      const gameRoom = manager.getRoom(code);
      if (!gameRoom) throw new Error("Room not found");
      gameRoom.moveViaCorridor(playerId, targetRoom);
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
      broadcastState(code);
      socket.emit("suggestionResult", result);
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
    room.removePlayerBySocket(socket.id);
    if (room.players.length === 0) {
      manager.deleteRoom(code);
    } else {
      broadcastState(code);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Cluedo server listening on port ${PORT}`);
  console.log(`Allowed player range: ${MIN_PLAYERS}-${MAX_PLAYERS}`);
});
