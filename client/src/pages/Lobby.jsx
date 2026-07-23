import { socket } from "../socket";

export default function Lobby({ code, playerId, state }) {
  const self = state.players.find((p) => p.id === playerId);
  const canStart = self?.isHost && state.players.length >= state.minPlayers;

  function handleStart() {
    socket.emit("startGame", { code, playerId });
  }

  function copyCode() {
    navigator.clipboard?.writeText(code);
  }

  return (
    <div className="card lobby-card">
      <h2>Waiting for players</h2>
      <div className="room-code-share">
        <span>Share this code:</span>
        <button className="code-chip" onClick={copyCode} title="Click to copy">{code}</button>
      </div>

      <p className="hint">
        {state.players.length} / {state.maxPlayers} joined (needs at least {state.minPlayers} to start)
      </p>

      <ul className="player-list">
        {state.players.map((p) => (
          <li key={p.id} className="player-row">
            <span className="player-name">
              {p.name} {p.isHost && <span className="host-tag">HOST</span>}
              {p.id === playerId && <span className="you-tag">YOU</span>}
            </span>
          </li>
        ))}
        {Array.from({ length: Math.max(0, state.maxPlayers - state.players.length) }).map((_, i) => (
          <li key={`empty-${i}`} className="player-row empty">Waiting for player...</li>
        ))}
      </ul>

      {self?.isHost ? (
        <button className="primary" disabled={!canStart} onClick={handleStart}>
          {canStart ? "Start Game" : `Need ${state.minPlayers - state.players.length} more player(s)`}
        </button>
      ) : (
        <p className="hint">Waiting for the host to start the game...</p>
      )}
    </div>
  );
}
