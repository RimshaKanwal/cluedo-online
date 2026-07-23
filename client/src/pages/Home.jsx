import { useState } from "react";
import { socket } from "../socket";

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;

function codeFromJoinLink() {
  const match = window.location.pathname.match(/\/join\/([A-Za-z0-9]+)/);
  return match ? match[1].toUpperCase() : "";
}

export default function Home() {
  const initialJoinCode = codeFromJoinLink();
  const [mode, setMode] = useState(initialJoinCode ? "join" : "create"); // create | join
  const [name, setName] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [joinCode, setJoinCode] = useState(initialJoinCode);

  function handleCreate(e) {
    e.preventDefault();
    if (!name.trim()) return;
    socket.emit("createGame", { name, maxPlayers });
  }

  function handleJoin(e) {
    e.preventDefault();
    if (!name.trim() || !joinCode.trim()) return;
    socket.emit("joinGame", { name, code: joinCode.trim().toUpperCase() });
  }

  return (
    <div className="card home-card">
      <div className="tabs">
        <button className={mode === "create" ? "tab active" : "tab"} onClick={() => setMode("create")}>
          Create Game
        </button>
        <button className={mode === "join" ? "tab active" : "tab"} onClick={() => setMode("join")}>
          Join Game
        </button>
      </div>

      {mode === "create" ? (
        <form onSubmit={handleCreate} className="form">
          <label>
            Your name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alex" maxLength={20} required />
          </label>

          <label>
            Number of players ({MIN_PLAYERS}-{MAX_PLAYERS})
            <div className="player-count-row">
              <input
                type="range"
                min={MIN_PLAYERS}
                max={MAX_PLAYERS}
                value={maxPlayers}
                onChange={(e) => setMaxPlayers(Number(e.target.value))}
              />
              <span className="player-count-value">{maxPlayers}</span>
            </div>
          </label>
          <p className="hint">
            {maxPlayers > 6
              ? "7-8 players uses an expanded set of suspects & weapons so everyone gets enough cards."
              : "Classic set: 6 suspects, 6 weapons, 9 rooms."}
          </p>

          <button type="submit" className="primary">Create Room</button>
        </form>
      ) : (
        <form onSubmit={handleJoin} className="form">
          <label>
            Your name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alex" maxLength={20} required />
          </label>
          <label>
            Room code
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="e.g. AB12C"
              maxLength={6}
              required
              style={{ textTransform: "uppercase" }}
            />
          </label>
          <button type="submit" className="primary">Join Room</button>
        </form>
      )}
    </div>
  );
}
