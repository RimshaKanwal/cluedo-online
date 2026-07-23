import { MIN_PLAYERS, MAX_PLAYERS, getCardSets, buildBoard, SECRET_PASSAGES } from "./constants.js";

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
    this.board = null;
    this.pendingSuggestion = null;
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

    this.board = buildBoard(this.players.length);

    const availableCharacters = shuffle(suspects);
    this.players.forEach((player, i) => {
      const character = availableCharacters[i % availableCharacters.length];
      player.character = character;
      const start = this.board.startPositions[character];
      player.position = { room: null, cell: { r: start.r, c: start.c } };
      player.eliminated = false;
    });

    this.turnOrder = shuffle(this.players.map((p) => p.id));
    this.turnIndex = 0;
    this.status = "playing";
    this.log = [{ type: "system", message: "The game has begun. Good luck, detectives." }];
    this.winnerId = null;
    this.turnState = { diceValue: null, hasMoved: false };
    this.pendingSuggestion = null;
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
    this.pendingSuggestion = null;
  }

  rollDice(playerId) {
    const player = this.assertTurn(playerId);
    if (this.turnState.diceValue != null) throw new Error("You've already rolled this turn");
    const value = 1 + Math.floor(Math.random() * 6);
    this.turnState.diceValue = value;
    this.log.push({ type: "system", message: `${player.name} rolled a ${value}.` });
    return value;
  }

  // Set of "r,c" corridor squares occupied by players other than `exceptId`.
  occupiedCorridorCells(exceptId) {
    const set = new Set();
    for (const p of this.players) {
      if (p.id === exceptId) continue;
      if (p.position.cell) set.add(`${p.position.cell.r},${p.position.cell.c}`);
    }
    return set;
  }

  // BFS over corridor squares from a player's position, up to `dice` steps.
  // Returns the reachable corridor cells and the rooms whose doorway can be
  // reached this turn. Corridor squares held by other players block passage.
  computeReachable(player, dice) {
    const board = this.board;
    const occupied = this.occupiedCorridorCells(player.id);
    const isCorridor = (r, c) =>
      r >= 0 && r < board.rows && c >= 0 && c < board.cols && board.cells[r][c].type === "corridor";

    const dist = new Map();
    const queue = [];
    if (player.position.room) {
      // Step out through any unblocked doorway (costs 1).
      for (const entry of board.rooms[player.position.room].entryCells) {
        const key = `${entry.r},${entry.c}`;
        if (occupied.has(key) || dist.has(key)) continue;
        dist.set(key, 1);
        queue.push({ r: entry.r, c: entry.c, d: 1 });
      }
    } else {
      const { r, c } = player.position.cell;
      dist.set(`${r},${c}`, 0);
      queue.push({ r, c, d: 0 });
    }

    while (queue.length) {
      const { r, c, d } = queue.shift();
      if (d >= dice) continue;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = r + dr;
        const nc = c + dc;
        const key = `${nr},${nc}`;
        if (!isCorridor(nr, nc) || occupied.has(key) || dist.has(key)) continue;
        dist.set(key, d + 1);
        queue.push({ r: nr, c: nc, d: d + 1 });
      }
    }

    const cells = [];
    for (const key of dist.keys()) {
      const [r, c] = key.split(",").map(Number);
      cells.push({ r, c });
    }

    const rooms = [];
    for (const [name, room] of Object.entries(board.rooms)) {
      if (name === player.position.room) continue;
      const reachable = room.entryCells.some((e) => dist.has(`${e.r},${e.c}`));
      if (reachable) rooms.push(name);
    }

    return { cells, rooms };
  }

  moveTo(playerId, target) {
    const player = this.assertTurn(playerId);
    if (this.turnState.diceValue == null) throw new Error("Roll the dice first");
    if (this.turnState.hasMoved) throw new Error("You've already moved this turn");

    const reachable = this.computeReachable(player, this.turnState.diceValue);

    if (target?.room) {
      if (!reachable.rooms.includes(target.room)) throw new Error(`You can't reach the ${target.room} this turn`);
      player.position = { room: target.room, cell: null };
      this.log.push({ type: "move", message: `${player.name} entered the ${target.room}.` });
    } else if (target?.cell) {
      const ok = reachable.cells.some((c) => c.r === target.cell.r && c.c === target.cell.c);
      if (!ok) throw new Error("You can't reach that square this turn");
      player.position = { room: null, cell: { r: target.cell.r, c: target.cell.c } };
      this.log.push({ type: "move", message: `${player.name} moved down the hall.` });
    } else {
      throw new Error("No destination given");
    }

    this.turnState.hasMoved = true;
    // Out in a corridor there's nothing else to do, so the turn ends here.
    // Landing in a room keeps the turn open to suggest or accuse.
    if (!player.position.room) this.advanceTurn();
    return player;
  }

  useSecretPassage(playerId) {
    const player = this.assertTurn(playerId);
    if (this.turnState.hasMoved) throw new Error("You've already moved this turn");
    const room = player.position.room;
    const destination = room && SECRET_PASSAGES[room];
    if (!destination) throw new Error("There's no secret passage here");
    player.position = { room: destination, cell: null };
    this.turnState.hasMoved = true;
    this.log.push({ type: "move", message: `${player.name} slipped through the secret passage into the ${destination}.` });
    return player;
  }

  // Cards a player holds that would disprove the given suggestion.
  cardsMatchingSuggestion(player, { suspect, weapon, room }) {
    return player.cards.filter(
      (c) =>
        (c.type === "suspect" && c.value === suspect) ||
        (c.type === "weapon" && c.value === weapon) ||
        (c.type === "room" && c.value === room)
    );
  }

  makeSuggestion(playerId, { suspect, weapon, room }) {
    const player = this.assertTurn(playerId);
    if (this.pendingSuggestion) throw new Error("A suggestion is already being answered");
    // Classic rule: the suggested room must be where the suggesting player
    // currently is, and the accused suspect's token is moved into that room.
    player.position = { room, cell: null };
    const suspectPlayer = this.players.find((p) => p.character === suspect);
    if (suspectPlayer) suspectPlayer.position = { room, cell: null };

    // Everyone else answers in turn order, starting to the suggester's left.
    const order = this.turnOrder;
    const startIdx = order.indexOf(playerId);
    const responderOrder = [];
    for (let step = 1; step < order.length; step++) {
      responderOrder.push(order[(startIdx + step) % order.length]);
    }

    this.pendingSuggestion = { by: playerId, suggestion: { suspect, weapon, room }, responderOrder, index: 0 };
    this.log.push({
      type: "suggestion",
      message: `${player.name} suggested it was ${suspect}, with the ${weapon}, in the ${room}. Going round the table...`,
    });

    // Skip past anyone who's disconnected (they can't show a card).
    return this.autoAdvanceSuggestion();
  }

  // Auto-skips disconnected responders; if the round runs out, closes it.
  // Returns { privateReveal } when the round resolves, else {}.
  autoAdvanceSuggestion() {
    const pending = this.pendingSuggestion;
    while (pending.index < pending.responderOrder.length) {
      const responder = this.players.find((p) => p.id === pending.responderOrder[pending.index]);
      if (responder && responder.connected) return {};
      this.log.push({ type: "system", message: `${responder?.name || "A player"} is away and was skipped.` });
      pending.index += 1;
    }
    // Nobody could disprove.
    const suggesterId = pending.by;
    this.log.push({ type: "system", message: "No one could disprove that suggestion!" });
    this.pendingSuggestion = null;
    this.advanceTurn(); // the suggestion was the suggester's action — end their turn
    return { privateReveal: { suggesterId, shownCard: null } };
  }

  // A responder answers the current suggestion. action is "pass" (I hold none)
  // or "show" with cardValue. Returns { privateReveal } when the round ends.
  respondToSuggestion(playerId, { action, cardValue }) {
    const pending = this.pendingSuggestion;
    if (!pending) throw new Error("There's no suggestion to answer");
    if (pending.responderOrder[pending.index] !== playerId) throw new Error("It's not your turn to answer");

    const responder = this.players.find((p) => p.id === playerId);
    const matches = this.cardsMatchingSuggestion(responder, pending.suggestion);

    if (action === "show") {
      const card = matches.find((c) => c.value === cardValue);
      if (!card) throw new Error("You don't hold that card");
      const suggester = this.players.find((p) => p.id === pending.by);
      this.log.push({ type: "system", message: `${responder.name} disproved the suggestion by showing a card to ${suggester.name}.` });
      const reveal = { suggesterId: pending.by, shownCard: { type: card.type, value: card.value }, byName: responder.name };
      this.pendingSuggestion = null;
      this.advanceTurn(); // suggestion resolved — end the suggester's turn
      return { privateReveal: reveal };
    }

    // action === "pass"
    if (matches.length > 0) throw new Error("You hold one of these cards — you must show one");
    this.log.push({ type: "system", message: `${responder.name} has none of those cards.` });
    pending.index += 1;
    return this.autoAdvanceSuggestion();
  }

  makeAccusation(playerId, { suspect, weapon, room }) {
    const player = this.assertTurn(playerId);
    if (this.pendingSuggestion) throw new Error("Finish answering the current suggestion first");
    if (!player.position.room) throw new Error("You must be in a room to make an accusation");
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
    if (this.pendingSuggestion) throw new Error("Wait for the table to answer your suggestion first");
    this.advanceTurn();
  }

  // Public + (for the current responder) private view of an in-flight
  // suggestion, so the client can prompt whoever needs to answer.
  pendingSuggestionFor(forPlayerId) {
    const pending = this.pendingSuggestion;
    if (!pending) return null;
    const currentResponderId = pending.responderOrder[pending.index];
    const responder = this.players.find((p) => p.id === currentResponderId);
    const suggester = this.players.find((p) => p.id === pending.by);
    const view = {
      by: pending.by,
      byName: suggester?.name,
      suggestion: pending.suggestion,
      currentResponderId,
      currentResponderName: responder?.name,
    };
    if (forPlayerId === currentResponderId && responder) {
      // Only you learn which of your own cards can disprove it.
      view.yourMatches = this.cardsMatchingSuggestion(responder, pending.suggestion).map((c) => c.value);
    }
    return view;
  }

  // Turn state sent to a client. The current player also gets the set of
  // squares/rooms they can legally reach with their roll, so the board can
  // highlight moves without re-implementing pathfinding.
  turnStateFor(forPlayerId) {
    const base = { diceValue: this.turnState.diceValue, hasMoved: this.turnState.hasMoved, reachable: null };
    if (forPlayerId === this.currentPlayerId && this.turnState.diceValue != null && !this.turnState.hasMoved) {
      const player = this.currentPlayer();
      if (player && !player.eliminated) base.reachable = this.computeReachable(player, this.turnState.diceValue);
    }
    return base;
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
      board: this.board || null,
      turnState: this.status === "playing" ? this.turnStateFor(forPlayerId) : null,
      pendingSuggestion: this.status === "playing" ? this.pendingSuggestionFor(forPlayerId) : null,
    };
  }
}
