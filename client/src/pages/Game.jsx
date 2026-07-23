import { useEffect, useMemo, useState } from "react";
import { socket } from "../socket";
import Notepad from "../components/Notepad";

const SECRET_PASSAGES = {
  Kitchen: "Study",
  Study: "Kitchen",
  Lounge: "Conservatory",
  Conservatory: "Lounge",
};

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
  const canMove = isMyTurn && !self?.eliminated && turnState.diceValue != null && !turnState.hasMoved;

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
      <div className="card">
        <h2>Case Closed</h2>
        {state.winnerId ? (
          <p>
            🏆 <strong>{state.players.find((p) => p.id === state.winnerId)?.name}</strong> solved it!
          </p>
        ) : (
          <p>Everyone accused wrongly — the culprit got away.</p>
        )}
        {state.solution && (
          <p>
            It was <strong>{state.solution.suspect}</strong> with the <strong>{state.solution.weapon}</strong> in the{" "}
            <strong>{state.solution.room}</strong>.
          </p>
        )}
        <GameLog log={state.log} />
      </div>
    );
  }

  return (
    <div className="game-layout">
      <div className="card board-card">
        <h3>Turn: {currentPlayer?.name} {isMyTurn && "(You)"}</h3>

        <Board
          board={board}
          players={state.players}
          selfId={playerId}
          canMove={canMove}
          reachableCellSet={reachableCellSet}
          reachableRoomSet={reachableRoomSet}
          onMoveCell={moveToCell}
          onMoveRoom={moveToRoom}
        />

        {isMyTurn && !self.eliminated && (
          <div className="movement-panel">
            {turnState.diceValue == null && !turnState.hasMoved && (
              <button className="primary" onClick={rollDice}>🎲 Roll Dice</button>
            )}
            {turnState.diceValue != null && <span className="dice-value">Rolled: {turnState.diceValue}</span>}
            {canMove && (
              <span className="hint">
                Click a highlighted square or room to move
                {reachableRoomSet.size + reachableCellSet.size === 0 ? " (nowhere to go — end turn)" : ""}
              </span>
            )}
            {!turnState.hasMoved && passageTo && (
              <button className="secondary" onClick={usePassage}>🕳️ Secret passage to {passageTo}</button>
            )}
          </div>
        )}

        {isMyTurn && !self.eliminated && (
          <div className="action-row">
            <button onClick={() => setSuggestOpen(true)} disabled={!self.position.room} title={!self.position.room ? "You must be in a room to suggest" : ""}>
              Make Suggestion
            </button>
            <button onClick={() => setAccuseOpen(true)}>Make Accusation</button>
            <button onClick={endTurn} className="secondary">End Turn</button>
          </div>
        )}
        {isMyTurn && self.eliminated && (
          <p className="hint">You've been eliminated but the turn landed on you due to a stale state — ending turn.</p>
        )}

        {lastResult && !lastResult.accusationResult && (
          <div className="result-banner">
            {lastResult.disprovingPlayerName
              ? `${lastResult.disprovingPlayerName} showed you: ${lastResult.shownCard?.value}`
              : "No one could disprove that suggestion!"}
          </div>
        )}
        {lastResult?.accusationResult && (
          <div className="result-banner">
            {lastResult.accusationResult.correct ? "Correct accusation!" : "Wrong accusation — you're eliminated from winning."}
          </div>
        )}
      </div>

      <div className="card side-card">
        <h3>Your Hand</h3>
        <ul className="hand-list">
          {self?.cards?.map((c, i) => (
            <li key={i} className={`hand-card hand-card-${c.type}`}>{c.value}</li>
          ))}
        </ul>

        <h3>Players</h3>
        <ul className="player-list">
          {state.players.map((p) => (
            <li key={p.id} className={`player-row ${p.eliminated ? "eliminated" : ""}`}>
              {p.name} — {p.character} {p.eliminated && "(eliminated)"}
            </li>
          ))}
        </ul>

        <GameLog log={state.log} />
      </div>

      <div className="card notepad-card">
        <Notepad cardSets={state.cardSets} />
      </div>

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

function Board({ board, players, canMove, reachableCellSet, reachableRoomSet, onMoveCell, onMoveRoom }) {
  // Group player tokens by where they are for O(1) lookup while rendering.
  const cellTokens = new Map(); // "r,c" -> [players]
  const roomTokens = new Map(); // roomName -> [players]
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

  const CELL = 22;
  const gridStyle = {
    gridTemplateColumns: `repeat(${board.cols}, ${CELL}px)`,
    gridTemplateRows: `repeat(${board.rows}, ${CELL}px)`,
  };

  function token(p, small) {
    return (
      <div key={p.id} className={`occupant-token ${small ? "small" : ""}`} title={`${p.name} (${p.character})`}>
        {p.character?.[0] ?? p.name[0]}
      </div>
    );
  }

  return (
    <div className="board-wrap">
      <div className="board-cells" style={gridStyle}>
        {/* Room blocks span their rectangle */}
        {Object.entries(board.rooms).map(([name, room]) => {
          const { r0, r1, c0, c1 } = room.rect;
          const reachable = canMove && reachableRoomSet.has(name);
          return (
            <div
              key={name}
              className={`room-block ${reachable ? "reachable" : ""}`}
              style={{ gridRow: `${r0 + 1} / ${r1 + 2}`, gridColumn: `${c0 + 1} / ${c1 + 2}` }}
              onClick={() => reachable && onMoveRoom(name)}
            >
              <div className="room-name">{name}</div>
              <div className="occupant-row">{(roomTokens.get(name) || []).map((p) => token(p, false))}</div>
            </div>
          );
        })}

        {/* Individual corridor and door cells */}
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

function GameLog({ log }) {
  return (
    <div className="game-log">
      <h4>Log</h4>
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
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
