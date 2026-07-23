import { useEffect, useState } from "react";
import { socket } from "./socket";
import Home from "./pages/Home";
import Lobby from "./pages/Lobby";
import Game from "./pages/Game";
import "./App.css";

export default function App() {
  const [code, setCode] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    function onJoined({ code, playerId }) {
      setCode(code);
      setPlayerId(playerId);
      setError(null);
      window.history.replaceState(null, "", `/join/${code}`);
    }
    function onState(newState) {
      setState(newState);
    }
    function onError(message) {
      setError(message);
      setTimeout(() => setError((e) => (e === message ? null : e)), 4000);
    }

    socket.on("joined", onJoined);
    socket.on("state", onState);
    socket.on("errorMessage", onError);
    return () => {
      socket.off("joined", onJoined);
      socket.off("state", onState);
      socket.off("errorMessage", onError);
    };
  }, []);

  let content;
  if (!code || !state) {
    content = <Home />;
  } else if (state.status === "lobby") {
    content = <Lobby code={code} playerId={playerId} state={state} />;
  } else {
    content = <Game code={code} playerId={playerId} state={state} />;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>🔎 Cluedo Online</h1>
        {code && <span className="room-code-badge">Room: {code}</span>}
      </header>
      {error && <div className="error-banner">{error}</div>}
      <main>{content}</main>
    </div>
  );
}
