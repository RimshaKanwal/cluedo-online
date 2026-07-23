import { MIN_PLAYERS, MAX_PLAYERS, getCardSets, ROOM_ADJACENCY } from "./constants.js";

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class GameRoom {
  constructor(code, maxPlayers) {
    this.code = code;
    this.maxPlayers = Math.min(Math.max(maxPlayers, MIN_PLAYERS), MAX_PLAYERS);
    this.players = []; // {id, socketId, name, character, cards, position, isHost, eliminated, connected}
    this.status = "lobby"; // lobby | playing | finished
    this.solution = null;
    this.turnIndex = 0;
    this.log = [];
    this.winnerId = null;
  }

  get playerCount() {
    return this.players.length;
  }

  addPlayer(socketId, name) {
    if (this.status !== "lobby") throw new Error("Game already started");
    if (this.players.length >= this.maxPlayers) throw new Error("Room is full");
    const id = `p${this.players.length + 1}_${Math.random().toString(36).slice(2, 8)}`;
    const player = {
      id,
      socketId,
      name: name?.trim() || `Player ${this.players.length + 1}`,
      character: null,
      cards: [],
      position: null,
      isHost: this.players.length === 0,
      eliminated: false,
      connected: true,
    };
    this.players.push(player);
    return player;
  }

  removePlayerBySocket(socketId) {
    const player = this.players.find((p) => p.socketId === socketId);
    if (!player) return null;
    if (this.status === "lobby") {
      this.players = this.players.filter((p) => p.socketId !== socketId);
      if (this.players.length > 0 && !this.players.some((p) => p.isHost)) {
        this.players[0].isHost = true;
      }
    } else {
      player.connected = false;
    }
    return player;
  }

  canStart() {
    return this.status === "lobby" && this.players.length >= MIN_PLAYERS;
  }

  start() {
    if (!this.canStart()) throw new Error("Not enough players to start");
    const { suspects, weapons, rooms } = getCardSets(this.players.length);

    const solutionSuspect = suspects[Math.floor(Math.random() * suspects.length)];
    const solutionWeapon = weapons[Math.floor(Math.random() * weapons.length)];
    const solutionRoom = rooms[Math.floor(Math.random() * rooms.length)];
    this.solution = { suspect: solutionSuspect, weapon: solutionWeapon, room: solutionRoom };

    const remainingCards = shuffle([
      ...suspects.filter((s) => s !== solutionSuspect).map((v) => ({ type: "suspect", value: v })),
      ...weapons.filter((w) => w !== solutionWeapon).map((v) => ({ type: "weapon", value: v })),
      ...rooms.filter((r) => r !== solutionRoom).map((v) => ({ type: "room", value: v })),
    ]);

    const shuffledPlayers = shuffle(this.players);
    shuffledPlayers.forEach((player, i) => {
      player.cards = [];
    });
    remainingCards.forEach((card, i) => {
      shuffledPlayers[i % shuffledPlayers.length].cards.push(card);
    });

    const availableCharacters = shuffle(suspects);
    const availableStartRooms = shuffle(rooms);
    this.players.forEach((player, i) => {
      player.character = availableCharacters[i % availableCharacters.length];
      player.position = availableStartRooms[i % availableStartRooms.length];
      player.eliminated = false;
    });

    this.turnOrder = shuffle(this.players.map((p) => p.id));
    this.turnIndex = 0;
    this.status = "playing";
    this.log = [{ type: "system", message: "The game has begun. Good luck, detectives." }];
    this.winnerId = null;
  }

  get currentPlayerId() {
    return this.turnOrder[this.turnIndex];
  }

  currentPlayer() {
    return this.players.find((p) => p.id === this.currentPlayerId);
  }

  assertTurn(playerId) {
    if (this.status !== "playing") throw new Error("Game is not in progress");
    if (this.currentPlayerId !== playerId) throw new Error("It is not your turn");
    const player = this.players.find((p) => p.id === playerId);
    if (!player) throw new Error("Unknown player");
    if (player.eliminated) throw new Error("You have been eliminated and can only respond to suggestions");
    return player;
  }

  advanceTurn() {
    const active = this.turnOrder.filter((id) => {
      const p = this.players.find((pl) => pl.id === id);
      return p && !p.eliminated;
    });
    if (active.length === 0) {
      this.status = "finished";
      this.log.push({ type: "system", message: "All detectives were wrong. The culprit escapes." });
      return;
    }
    for (let i = 0; i < this.turnOrder.length; i++) {
      this.turnIndex = (this.turnIndex + 1) % this.turnOrder.length;
      const p = this.players.find((pl) => pl.id === this.currentPlayerId);
      if (p && !p.eliminated) break;
    }
  }

  movePlayer(playerId, room) {
    const player = this.assertTurn(playerId);
    const validMoves = ROOM_ADJACENCY[player.position] || [];
    if (!validMoves.includes(room)) {
      throw new Error(`Cannot move from ${player.position} to ${room}`);
    }
    player.position = room;
    this.log.push({ type: "move", message: `${player.name} moved to the ${room}.` });
    return player;
  }

  makeSuggestion(playerId, { suspect, weapon, room }) {
    const player = this.assertTurn(playerId);
    // Classic rule: the suggested room must be where the suggesting player
    // currently is, and the accused suspect's token is moved into that room.
    player.position = room;
    const suspectPlayer = this.players.find((p) => p.character === suspect);
    if (suspectPlayer) suspectPlayer.position = room;

    const order = this.turnOrder;
    const startIdx = order.indexOf(playerId);
    let disprovingPlayer = null;
    let shownCard = null;

    for (let step = 1; step < order.length; step++) {
      const candidateId = order[(startIdx + step) % order.length];
      const candidate = this.players.find((p) => p.id === candidateId);
      if (!candidate || candidate.id === playerId) continue;
      const match = candidate.cards.find(
        (c) =>
          (c.type === "suspect" && c.value === suspect) ||
          (c.type === "weapon" && c.value === weapon) ||
          (c.type === "room" && c.value === room)
      );
      if (match) {
        disprovingPlayer = candidate;
        shownCard = match;
        break;
      }
    }

    this.log.push({
      type: "suggestion",
      message: `${player.name} suggested it was ${suspect}, with the ${weapon}, in the ${room}.`,
      by: playerId,
      suggestion: { suspect, weapon, room },
      disprovedBy: disprovingPlayer ? disprovingPlayer.name : null,
      disprovedById: disprovingPlayer ? disprovingPlayer.id : null,
    });

    return {
      suggestion: { suspect, weapon, room },
      disprovingPlayerId: disprovingPlayer ? disprovingPlayer.id : null,
      disprovingPlayerName: disprovingPlayer ? disprovingPlayer.name : null,
      shownCard: shownCard || null, // only ever sent privately to the suggester
    };
  }

  makeAccusation(playerId, { suspect, weapon, room }) {
    const player = this.assertTurn(playerId);
    const correct =
      this.solution.suspect === suspect &&
      this.solution.weapon === weapon &&
      this.solution.room === room;

    if (correct) {
      this.status = "finished";
      this.winnerId = playerId;
      this.log.push({
        type: "accusation",
        message: `${player.name} accused ${suspect} with the ${weapon} in the ${room} — and was RIGHT! Case closed.`,
      });
    } else {
      player.eliminated = true;
      this.log.push({
        type: "accusation",
        message: `${player.name} accused ${suspect} with the ${weapon} in the ${room} — and was WRONG. They're out of the running but must still disprove suggestions.`,
      });
      this.advanceTurn();
    }

    return { correct, solution: this.status === "finished" ? this.solution : null };
  }

  endTurn(playerId) {
    this.assertTurn(playerId);
    this.advanceTurn();
  }

  toClientState(forPlayerId) {
    return {
      code: this.code,
      status: this.status,
      maxPlayers: this.maxPlayers,
      minPlayers: MIN_PLAYERS,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        character: p.character,
        position: p.position,
        isHost: p.isHost,
        eliminated: p.eliminated,
        connected: p.connected,
        cardCount: p.cards.length,
        isSelf: p.id === forPlayerId,
        cards: p.id === forPlayerId ? p.cards : undefined,
      })),
      currentPlayerId: this.status === "playing" ? this.currentPlayerId : null,
      log: this.log.slice(-50),
      winnerId: this.winnerId,
      solution: this.status === "finished" ? this.solution : null,
      cardSets: this.status !== "lobby" ? getCardSets(this.players.length) : getCardSets(this.maxPlayers),
      roomAdjacency: ROOM_ADJACENCY,
    };
  }
}
