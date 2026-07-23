import { customAlphabet } from "nanoid";
import { GameRoom } from "./GameRoom.js";

const nanoid = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 5);

export class GameManager {
  constructor() {
    this.rooms = new Map(); // code -> GameRoom
  }

  createRoom(maxPlayers) {
    let code;
    do {
      code = nanoid();
    } while (this.rooms.has(code));
    const room = new GameRoom(code, maxPlayers);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    return this.rooms.get(code?.toUpperCase());
  }

  deleteRoom(code) {
    this.rooms.delete(code);
  }
}
