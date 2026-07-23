import { useEffect, useMemo, useState } from "react";
import { socket } from "../socket";
import Notepad from "../components/Notepad";

function getCorridorCells(board, from, to) {
  const key = [from, to].sort().join("|");
  const corridor = board.corridors[key];
  if (!corridor) return null;
  return corridor.rooms[0] === from ? corridor.cells : [...corridor.cells].reverse();
}

function cellForPlayer(board, player) {
  if (player.position.room) return null;
  const cells = getCorridorCells(board, ...player.position.corridor);
  return cells ? cells[player.position.step - 1] : null;
}

function useBoardDims(board) {
  return useMemo(() => {
    const roomCoords = Object.values(board.rooms);
    const maxCoord = Math.max(...roomCoords.flatMap((r) => [r.row, r.col]));
    const roomIndices = new Set(roomCoords.flatMap((r) => [r.row, r.col]));
    const track = (i) => (roomIndices.has(i) ? "88px" : "30px");
    const size = maxCoord + 1;
    const template = Array.from({ length: size }, (_, i) => track(i)).join(" ");
    return { columns: template, rows: template };
  }, [board]);
}

export default function Game({ code, playerId, state }) {
  const self = state.players.find((p) => p.id === playerId);
  const isMyTurn = state.currentPlayerId === playerId;
  const currentPlayer = state.players.find((p) => p.id === state.currentPlayerId);
  const turnState = state.turnState || { diceValue: null, hasMoved: false };
  const dims = useBoardDims(state.board);

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

  const exits = self?.position.room ? state.realCorridors[self.position.room] || [] : [];
  const passageTo = self?.position.room ? state.board.secretPassages[self.position.room] : null;

  function rollDice() {
    socket.emit("rollDice", { code, playerId });
  }

  function moveTo(targetRoom) {
    socket.emit("moveViaCorridor", { code, playerId, targetRoom });
  }

  function continueMove() {
    socket.emit("moveViaCorridor", { code, playerId, targetRoom: null });
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

        <div className="board-cells" style={{ gridTemplateColumns: dims.columns, gridTemplateRows: dims.rows }}>
          {Object.entries(state.board.rooms).map(([room, { row, col }]) => {
            const occupants = state.players.filter((p) => p.position.room === room);
            const isSelf = self?.position.room === room;
            return (
              <div
                key={room}
                className={`room-cell ${isSelf ? "room-self" : ""}`}
                style={{ gridRow: row + 1, gridColumn: col + 1 }}
              >
                <div className="room-name">{room}</div>
                <div className="occupant-row">
                  {occupants.map((o) => (
                    <div key={o.id} className="occupant-token" title={o.name}>
                      {o.character?.[0] ?? o.name[0]}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {Object.values(state.board.corridors).flatMap((corridor) =>
            corridor.cells.map((cell, idx) => {
              const occupants = state.players.filter((p) => {
                const pCell = cellForPlayer(state.board, p);
                return pCell && pCell.row === cell.row && pCell.col === cell.col;
              });
              return (
                <div
                  key={`${corridor.rooms.join("-")}-${idx}`}
                  className="corridor-cell"
                  style={{ gridRow: cell.row + 1, gridColumn: cell.col + 1 }}
                >
                  {occupants.map((o) => (
                    <div key={o.id} className="occupant-token small" title={o.name}>
                      {o.character?.[0] ?? o.name[0]}
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </div>

        {isMyTurn && !self.eliminated && (
          <div className="movement-panel">
            {turnState.diceValue == null && !turnState.hasMoved && (
              <button className="primary" onClick={rollDice}>🎲 Roll Dice</button>
            )}
            {turnState.diceValue != null && <span className="dice-value">Rolled: {turnState.diceValue}</span>}

            {!turnState.hasMoved && self.position.room && (
              <>
                {turnState.diceValue != null &&
                  exits.map((room) => (
                    <button key={room} onClick={() => moveTo(room)}>Move to {room}</button>
                  ))}
                {passageTo && (
                  <button className="secondary" onClick={usePassage}>🕳️ Secret passage to {passageTo}</button>
                )}
              </>
            )}
            {!turnState.hasMoved && !self.position.room && turnState.diceValue != null && (
              <button onClick={continueMove}>Continue down the hallway</button>
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
