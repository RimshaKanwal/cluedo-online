import { useEffect, useMemo, useState } from "react";
import { socket } from "../socket";
import Notepad from "../components/Notepad";

const SECRET_PASSAGES = {
  Kitchen: "Study",
  Study: "Kitchen",
  Lounge: "Conservatory",
  Conservatory: "Lounge",
};

// Per-character identity — a colour + emoji used everywhere that character
// appears (board token, seat avatar, suspect card) so players are instantly
// recognisable instead of an ambiguous first initial.
const CHARACTERS = {
  "Miss Scarlett": { color: "#c0392b", emoji: "🌹" },
  "Colonel Mustard": { color: "#c99a1e", emoji: "🎖️" },
  "Mrs. White": { color: "#8a8f98", emoji: "🤍" },
  "Reverend Green": { color: "#2e8b57", emoji: "🍀" },
  "Mrs. Peacock": { color: "#2f6fb0", emoji: "🦚" },
  "Professor Plum": { color: "#7d4bb5", emoji: "🔮" },
  "Dr. Orchid": { color: "#d64f9b", emoji: "🌸" },
  "Monsieur Brunette": { color: "#6d4c3d", emoji: "🕵️" },
};
const charMeta = (name) => CHARACTERS[name] || { color: "#4f6df5", emoji: "❓" };

const ROOM_THEME = {
  Kitchen: { emoji: "🍳", c: "#b5462f" },
  Ballroom: { emoji: "🎭", c: "#6d3f9c" },
  Conservatory: { emoji: "🪴", c: "#2e8b57" },
  "Dining Room": { emoji: "🍽️", c: "#a9761b" },
  "Billiard Room": { emoji: "🎱", c: "#1f6b45" },
  Library: { emoji: "📚", c: "#7b4a1e" },
  Lounge: { emoji: "🛋️", c: "#b23a48" },
  Hall: { emoji: "🏛️", c: "#3a5169" },
  Study: { emoji: "📖", c: "#8a5a2b" },
  Cellar: { emoji: "🍷", c: "#5a2a6b" },
  "Trophy Room": { emoji: "🏆", c: "#b08d1e" },
};
const roomTheme = (name) => ROOM_THEME[name] || { emoji: "🚪", c: "#555" };

const WEAPON_EMOJI = {
  Candlestick: "🕯️", Knife: "🔪", "Lead Pipe": "🪈", Revolver: "🔫",
  Rope: "🪢", Wrench: "🔧", Poison: "☠️", "Bow and Arrow": "🏹",
};
function cardMeta(card) {
  if (card.type === "suspect") return { icon: charMeta(card.value).emoji, color: charMeta(card.value).color };
  if (card.type === "weapon") return { icon: WEAPON_EMOJI[card.value] || "🗡️", color: "#2b6b4f" };
  return { icon: roomTheme(card.value).emoji, color: "#34558b" };
}

export default function Game({ code, playerId, state }) {
  const self = state.players.find((p) => p.id === playerId);
  const isMyTurn = state.currentPlayerId === playerId;
  const currentPlayer = state.players.find((p) => p.id === state.currentPlayerId);
  const turnState = state.turnState || { diceValue: null, hasMoved: false, reachable: null };
  const board = state.board;

  const reachableCellSet = useMemo(() => {
    const s = new Set();
    for (const c of turnState.reachable?.cells || []) s.add(`${c.r},${c.c}`);
    return s;
  }, [turnState.reachable]);
  const reachableRoomSet = useMemo(
    () => new Set(turnState.reachable?.rooms || []),
    [turnState.reachable]
  );

  const [suggestOpen, setSuggestOpen] = useState(false);
  const [accuseOpen, setAccuseOpen] = useState(false);
  const [suggestion, setSuggestion] = useState({ suspect: "", weapon: "" });
  const [accusation, setAccusation] = useState({ suspect: "", weapon: "", room: "" });
  const [lastResult, setLastResult] = useState(null);
  const [tab, setTab] = useState("notes");

  useEffect(() => {
    function onSuggestionResult(result) {
      setLastResult(result);
    }
    function onAccusationResult(result) {
      setLastResult({ accusationResult: result });
    }
    socket.on("suggestionResult", onSuggestionResult);
    socket.on("accusationResult", onAccusationResult);
    return () => {
      socket.off("suggestionResult", onSuggestionResult);
      socket.off("accusationResult", onAccusationResult);
    };
  }, []);

  const passageTo = self?.position.room ? SECRET_PASSAGES[self.position.room] : null;
  const pending = state.pendingSuggestion;
  const canMove = isMyTurn && !self?.eliminated && !pending && turnState.diceValue != null && !turnState.hasMoved;
  const mustRespond = pending && pending.currentResponderId === playerId;

  function rollDice() {
    socket.emit("rollDice", { code, playerId });
  }
  function moveToCell(r, c) {
    if (!canMove || !reachableCellSet.has(`${r},${c}`)) return;
    socket.emit("movePlayer", { code, playerId, target: { cell: { r, c } } });
  }
  function moveToRoom(room) {
    if (!canMove || !reachableRoomSet.has(room)) return;
    socket.emit("movePlayer", { code, playerId, target: { room } });
  }
  function usePassage() {
    socket.emit("useSecretPassage", { code, playerId });
  }
  function respondSuggestion(action, cardValue) {
    socket.emit("respondSuggestion", { code, playerId, action, cardValue });
  }
  function submitSuggestion(e) {
    e.preventDefault();
    if (!suggestion.suspect || !suggestion.weapon || !self.position.room) return;
    socket.emit("makeSuggestion", {
      code,
      playerId,
      suggestion: { suspect: suggestion.suspect, weapon: suggestion.weapon, room: self.position.room },
    });
    setSuggestOpen(false);
  }
  function submitAccusation(e) {
    e.preventDefault();
    if (!accusation.suspect || !accusation.weapon || !accusation.room) return;
    socket.emit("makeAccusation", { code, playerId, accusation });
    setAccuseOpen(false);
  }
  function endTurn() {
    socket.emit("endTurn", { code, playerId });
  }

  if (state.status === "finished") {
    return (
      <div className="card finished-card">
        <h2>🔍 Case Closed</h2>
        {state.winnerId ? (
          <p className="finished-winner">
            🏆 <strong>{state.players.find((p) => p.id === state.winnerId)?.name}</strong> cracked the case!
          </p>
        ) : (
          <p>Everyone accused wrongly — the culprit got away.</p>
        )}
        {state.solution && (
          <p className="finished-solution">
            It was <strong>{state.solution.suspect}</strong> with the <strong>{state.solution.weapon}</strong> in the{" "}
            <strong>{state.solution.room}</strong>.
          </p>
        )}
        <GameLog log={state.log} />
      </div>
    );
  }

  const statusLine = pending ? (
    <span>
      <strong>{pending.byName}</strong> suggested {pending.suggestion.suspect} · {pending.suggestion.weapon} ·{" "}
      {pending.suggestion.room} —{" "}
      {pending.currentResponderId === playerId
        ? "your turn to answer"
        : `waiting for ${pending.currentResponderName}…`}
    </span>
  ) : lastResult && !lastResult.accusationResult ? (
    <span>
      {lastResult.disprovingPlayerName
        ? `${lastResult.disprovingPlayerName} showed you: ${lastResult.shownCard?.value}`
        : "No one could disprove that suggestion!"}
    </span>
  ) : lastResult?.accusationResult ? (
    <span>{lastResult.accusationResult.correct ? "Correct accusation! 🎉" : "Wrong accusation — out of the running."}</span>
  ) : isMyTurn ? (
    <span>Your turn{self?.position.room ? ` — you're in the ${self.position.room}` : ""}.</span>
  ) : (
    <span>
      Waiting for <strong>{currentPlayer?.name}</strong>…
    </span>
  );

  return (
    <div className="game-screen">
      <div className="table-area">
        <SeatedBoard
          board={board}
          players={state.players}
          turnOrder={state.turnOrder}
          currentId={state.currentPlayerId}
          selfId={playerId}
          canMove={canMove}
          reachableCellSet={reachableCellSet}
          reachableRoomSet={reachableRoomSet}
          onMoveCell={moveToCell}
          onMoveRoom={moveToRoom}
        />

        <div className="status-line">{statusLine}</div>

        {isMyTurn && !self.eliminated && (
          <div className="controls-bar">
            {turnState.diceValue == null && !turnState.hasMoved && !pending && (
              <button className="primary dice-btn" onClick={rollDice}>🎲 Roll Dice</button>
            )}
            {turnState.diceValue != null && <span className="dice-value">🎲 {turnState.diceValue}</span>}
            {canMove && (
              <span className="hint">
                {reachableRoomSet.size + reachableCellSet.size === 0
                  ? "Nowhere to go — end turn"
                  : "Click a highlighted square or room"}
              </span>
            )}
            {!turnState.hasMoved && !pending && passageTo && (
              <button className="secondary" onClick={usePassage}>🕳️ Passage → {passageTo}</button>
            )}
            {!pending && (
              <>
                <button onClick={() => setSuggestOpen(true)} disabled={!self.position.room} title={!self.position.room ? "Be in a room to suggest" : ""}>
                  🔍 Suggest
                </button>
                <button onClick={() => setAccuseOpen(true)} disabled={!self.position.room} title={!self.position.room ? "Be in a room to accuse" : ""}>
                  ⚖️ Accuse
                </button>
                <button onClick={endTurn} className="secondary">End Turn ⏭</button>
              </>
            )}
          </div>
        )}
      </div>

      <aside className="side-drawer">
        <div className="drawer-hand">
          <h4>Your Cards</h4>
          <div className="hand-cards">
            {self?.cards?.length ? (
              self.cards.map((c, i) => <PlayingCard key={i} card={c} />)
            ) : (
              <span className="hint">No cards.</span>
            )}
          </div>
        </div>

        <div className="drawer-tabs">
          <button className={tab === "notes" ? "tab active" : "tab"} onClick={() => setTab("notes")}>Notes</button>
          <button className={tab === "log" ? "tab active" : "tab"} onClick={() => setTab("log")}>Log</button>
        </div>
        <div className="drawer-body">
          {tab === "notes" ? (
            <Notepad cardSets={state.cardSets} players={state.players} selfId={playerId} />
          ) : (
            <GameLog log={state.log} />
          )}
        </div>
      </aside>

      {mustRespond && (
        <Modal title="Can you disprove this?" onClose={() => {}}>
          <p>
            <strong>{pending.byName}</strong> suggested <strong>{pending.suggestion.suspect}</strong> with the{" "}
            <strong>{pending.suggestion.weapon}</strong> in the <strong>{pending.suggestion.room}</strong>.
          </p>
          {pending.yourMatches?.length > 0 ? (
            <>
              <p className="hint">You hold one of these — show one (privately) to {pending.byName}:</p>
              <div className="hand-cards">
                {pending.yourMatches.map((card) => (
                  <button key={card} className="show-card-btn" onClick={() => respondSuggestion("show", card)}>
                    Show {card}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="hint">You don't hold any of these cards.</p>
              <button className="primary" onClick={() => respondSuggestion("pass")}>
                I don't have any of these
              </button>
            </>
          )}
        </Modal>
      )}

      {suggestOpen && (
        <Modal onClose={() => setSuggestOpen(false)} title={`Suggest (in the ${self.position.room})`}>
          <form onSubmit={submitSuggestion} className="form">
            <label>
              Suspect
              <select value={suggestion.suspect} onChange={(e) => setSuggestion({ ...suggestion, suspect: e.target.value })} required>
                <option value="" disabled>Choose...</option>
                {state.cardSets.suspects.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label>
              Weapon
              <select value={suggestion.weapon} onChange={(e) => setSuggestion({ ...suggestion, weapon: e.target.value })} required>
                <option value="" disabled>Choose...</option>
                {state.cardSets.weapons.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </label>
            <p className="hint">Room is fixed to your current location: {self.position.room}</p>
            <button type="submit" className="primary">Submit Suggestion</button>
          </form>
        </Modal>
      )}

      {accuseOpen && (
        <Modal onClose={() => setAccuseOpen(false)} title="Make Final Accusation">
          <form onSubmit={submitAccusation} className="form">
            <label>
              Suspect
              <select value={accusation.suspect} onChange={(e) => setAccusation({ ...accusation, suspect: e.target.value })} required>
                <option value="" disabled>Choose...</option>
                {state.cardSets.suspects.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label>
              Weapon
              <select value={accusation.weapon} onChange={(e) => setAccusation({ ...accusation, weapon: e.target.value })} required>
                <option value="" disabled>Choose...</option>
                {state.cardSets.weapons.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </label>
            <label>
              Room
              <select value={accusation.room} onChange={(e) => setAccusation({ ...accusation, room: e.target.value })} required>
                <option value="" disabled>Choose...</option>
                {state.cardSets.rooms.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <p className="hint">Warning: a wrong accusation eliminates you from winning.</p>
            <button type="submit" className="primary">Submit Accusation</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

// A seat position on a rectangular ring just outside the board, so avatars
// never crowd the corners. Walks the perimeter clockwise from bottom-centre.
function seatPos(i, n) {
  const Lx = 5, Rx = 95, Ty = 6, By = 94;
  const segs = [
    { len: Rx - 50, from: [50, By], to: [Rx, By] },
    { len: By - Ty, from: [Rx, By], to: [Rx, Ty] },
    { len: Rx - Lx, from: [Rx, Ty], to: [Lx, Ty] },
    { len: By - Ty, from: [Lx, Ty], to: [Lx, By] },
    { len: 50 - Lx, from: [Lx, By], to: [50, By] },
  ];
  const total = segs.reduce((s, x) => s + x.len, 0);
  let d = (i / n) * total;
  for (const s of segs) {
    if (d <= s.len) {
      const f = s.len ? d / s.len : 0;
      return { left: s.from[0] + (s.to[0] - s.from[0]) * f, top: s.from[1] + (s.to[1] - s.from[1]) * f };
    }
    d -= s.len;
  }
  return { left: 50, top: By };
}

// Board with players seated around its perimeter in turn order.
function SeatedBoard({ board, players, turnOrder, currentId, selfId, canMove, reachableCellSet, reachableRoomSet, onMoveCell, onMoveRoom }) {
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  const seated = (turnOrder || players.map((p) => p.id)).map((id) => byId[id]).filter(Boolean);
  const n = seated.length;

  return (
    <div className="board-table">
      {seated.map((p, i) => {
        const { left, top } = seatPos(i, n);
        const meta = charMeta(p.character);
        return (
          <div
            key={p.id}
            className={`seat-avatar ${p.id === currentId ? "current" : ""} ${p.eliminated ? "eliminated" : ""}`}
            style={{ left: `${left}%`, top: `${top}%`, "--pc": meta.color }}
          >
            <div className="seat-face">{meta.emoji}</div>
            <div className="seat-name">
              {p.name}
              {p.id === selfId && " (you)"}
            </div>
            <div className="seat-cardcount">🂠 {p.cardCount}</div>
          </div>
        );
      })}
      <Board
        board={board}
        players={players}
        canMove={canMove}
        reachableCellSet={reachableCellSet}
        reachableRoomSet={reachableRoomSet}
        onMoveCell={onMoveCell}
        onMoveRoom={onMoveRoom}
      />
    </div>
  );
}

const CELL = 17;

function Board({ board, players, canMove, reachableCellSet, reachableRoomSet, onMoveCell, onMoveRoom }) {
  const cellTokens = new Map();
  const roomTokens = new Map();
  for (const p of players) {
    if (p.position.room) {
      if (!roomTokens.has(p.position.room)) roomTokens.set(p.position.room, []);
      roomTokens.get(p.position.room).push(p);
    } else if (p.position.cell) {
      const key = `${p.position.cell.r},${p.position.cell.c}`;
      if (!cellTokens.has(key)) cellTokens.set(key, []);
      cellTokens.get(key).push(p);
    }
  }

  const gridStyle = {
    gridTemplateColumns: `repeat(${board.cols}, ${CELL}px)`,
    gridTemplateRows: `repeat(${board.rows}, ${CELL}px)`,
  };

  function token(p, small) {
    const meta = charMeta(p.character);
    return (
      <div
        key={p.id}
        className={`occupant-token ${small ? "small" : ""}`}
        style={{ background: meta.color }}
        title={`${p.name} (${p.character})`}
      >
        {meta.emoji}
      </div>
    );
  }

  return (
    <div className="board-wrap">
      <div className="board-cells" style={gridStyle}>
        {Object.entries(board.rooms).map(([name, room]) => {
          const { r0, r1, c0, c1 } = room.rect;
          const reachable = canMove && reachableRoomSet.has(name);
          const theme = roomTheme(name);
          return (
            <div
              key={name}
              className={`room-block ${reachable ? "reachable" : ""}`}
              style={{
                gridRow: `${r0 + 1} / ${r1 + 2}`,
                gridColumn: `${c0 + 1} / ${c1 + 2}`,
                "--rc": theme.c,
              }}
              onClick={() => reachable && onMoveRoom(name)}
            >
              <div className="room-emoji">{theme.emoji}</div>
              <div className="room-name">{name}</div>
              <div className="occupant-row">{(roomTokens.get(name) || []).map((p) => token(p, false))}</div>
            </div>
          );
        })}

        {board.cells.flatMap((row, r) =>
          row.map((cell, c) => {
            if (cell.type === "room" || cell.type === "blank") return null;
            const key = `${r},${c}`;
            const isDoor = cell.type === "door";
            const reachable = canMove && !isDoor && reachableCellSet.has(key);
            const occupants = cellTokens.get(key) || [];
            return (
              <div
                key={key}
                className={`grid-cell ${isDoor ? "door-cell" : "corridor-cell"} ${reachable ? "reachable" : ""}`}
                style={{ gridRow: r + 1, gridColumn: c + 1 }}
                onClick={() => reachable && onMoveCell(r, c)}
              >
                {occupants.map((p) => token(p, true))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function PlayingCard({ card }) {
  const meta = cardMeta(card);
  return (
    <div className="play-card" style={{ "--cc": meta.color }}>
      <div className="play-card-icon">{meta.icon}</div>
      <div className="play-card-name">{card.value}</div>
    </div>
  );
}

function GameLog({ log }) {
  return (
    <div className="game-log">
      <ul>
        {[...log].reverse().map((entry, i) => (
          <li key={i}>{entry.message}</li>
        ))}
      </ul>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          {onClose && <button className="close-btn" onClick={onClose}>×</button>}
        </div>
        {children}
      </div>
    </div>
  );
}
