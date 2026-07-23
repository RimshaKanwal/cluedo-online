import {
  MIN_PLAYERS,
  MAX_PLAYERS,
  getCardSets,
  BOARD,
  REAL_CORRIDORS,
  SECRET_PASSAGES,
  CORRIDOR_LENGTH,
  getCorridorCells,
} from "./constants.js";

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
    this.turnState = { diceValue: null, hasMoved: false };
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
      player.position = { room: availableStartRooms[i % availableStartRooms.length], corridor: null, step: null };
      player.eliminated = false;
    });

    this.turnOrder = shuffle(this.players.map((p) => p.id));
    this.turnIndex = 0;
    this.status = "playing";
    this.log = [{ type: "system", message: "The game has begun. Good luck, detectives." }];
    this.winnerId = null;
    this.turnState = { diceValue: null, hasMoved: false };
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
    this.turnState = { diceValue: null, hasMoved: false };
  }

  // Finds the {row, col} of the square a player currently occupies, or null
  // if they're inside a room (rooms aren't individual squares).
  cellFor(player) {
    if (player.position.room) return null;
    const [from, to] = player.position.corridor;
    const cells = getCorridorCells(from, to);
    return cells[player.position.step - 1];
  }

  rollDice(playerId) {
    const player = this.assertTurn(playerId);
    if (this.turnState.diceValue != null) throw new Error("You've already rolled this turn");
    const value = 1 + Math.floor(Math.random() * 6);
    this.turnState.diceValue = value;
    this.log.push({ type: "system", message: `${player.name} rolled a ${value}.` });
    return value;
  }

  useSecretPassage(playerId) {
    const player = this.assertTurn(playerId);
    if (this.turnState.hasMoved) throw new Error("You've already moved this turn");
    const room = player.position.room;
    const destination = room && SECRET_PASSAGES[room];
    if (!destination) throw new Error("There's no secret passage here");
    player.position = { room: destination, corridor: null, step: null };
    this.turnState.hasMoved = true;
    this.log.push({ type: "move", message: `${player.name} slipped through the secret passage into the ${destination}.` });
    return player;
  }

  moveViaCorridor(playerId, targetRoom) {
    const player = this.assertTurn(playerId);
    if (this.turnState.diceValue == null) throw new Error("Roll the dice first");
    if (this.turnState.hasMoved) throw new Error("You've already moved this turn");

    let fromRoom, toRoom, startStep;
    if (player.position.room) {
      fromRoom = player.position.room;
      toRoom = targetRoom;
      if (!REAL_CORRIDORS[fromRoom]?.includes(toRoom)) {
        throw new Error(`There's no hallway from ${fromRoom} to ${toRoom}`);
      }
      startStep = 0;
    } else {
      [fromRoom, toRoom] = player.position.corridor;
      startStep = player.position.step;
    }

    const cells = getCorridorCells(fromRoom, toRoom);
    const desiredStep = Math.min(startStep + this.turnState.diceValue, CORRIDOR_LENGTH);

    let finalStep = startStep;
    for (let step = startStep + 1; step <= desiredStep; step++) {
      const cell = cells[step - 1];
      const occupied = this.players.some((p) => {
        if (p.id === playerId) return false;
        const pCell = this.cellFor(p);
        return pCell && pCell.row === cell.row && pCell.col === cell.col;
      });
      if (occupied) break;
      finalStep = step;
    }

    this.turnState.hasMoved = true;

    if (finalStep >= CORRIDOR_LENGTH) {
      player.position = { room: toRoom, corridor: null, step: null };
      this.log.push({ type: "move", message: `${player.name} walked into the ${toRoom}.` });
    } else if (finalStep === startStep) {
      this.log.push({ type: "move", message: `${player.name} tried to move but the way was blocked.` });
    } else {
      player.position = { room: null, corridor: [fromRoom, toRoom], step: finalStep };
      this.log.push({ type: "move", message: `${player.name} moved partway toward the ${toRoom}.` });
    }

    return player;
  }

  makeSuggestion(playerId, { suspect, weapon, room }) {
    const player = this.assertTurn(playerId);
    // Classic rule: the suggested room must be where the suggesting player
    // currently is, and the accused suspect's token is moved into that room.
    player.position = { room, corridor: null, step: null };
    const suspectPlayer = this.players.find((p) => p.character === suspect);
    if (suspectPlayer) suspectPlayer.position = { room, corridor: null, step: null };

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
      board: BOARD,
      realCorridors: REAL_CORRIDORS,
      turnState: this.status === "playing" ? this.turnState : null,
    };
  }
}
