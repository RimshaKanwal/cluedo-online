import { useCallback, useEffect, useRef, useState } from "react";
import { socket } from "./socket";
import Home from "./pages/Home";
import Lobby from "./pages/Lobby";
import Game from "./pages/Game";
import "./App.css";

const SESSION_KEY = "cluedo-session";

// Only auto-rejoin when the URL itself points at a game (a shareable
// /join/<code> link, or the /join/<code> the app rewrites the address bar
// to while you're in one). Opening the bare site root is always treated as
// "start fresh" — otherwise a saved session kept dragging people back into
// a finished game every time they revisited the home URL.
function loadSession() {
  if (!/^\/join\//.test(window.location.pathname)) {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

export default function App() {
  const [code, setCode] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const session = useRef(loadSession()); // { code, playerId }

  const resetToHome = useCallback(() => {
    session.current = null;
    localStorage.removeItem(SESSION_KEY);
    setCode(null);
    setPlayerId(null);
    setState(null);
    window.history.replaceState(null, "", "/");
  }, []);

  // Deliberately leaving a finished game: tell the server so it can drop
  // this socket from the old room, then forget the session — otherwise a
  // reload (or the next auto-rejoin) would pull you right back into it.
  const leaveGame = useCallback(() => {
    socket.emit("leaveGame");
    resetToHome();
  }, [resetToHome]);

  useEffect(() => {
    function attemptRejoin() {
      if (session.current?.code && session.current?.playerId) {
        socket.emit("rejoin", session.current);
      }
    }

    function onJoined({ code, playerId }) {
      setCode(code);
      setPlayerId(playerId);
      setError(null);
      session.current = { code, playerId };
      localStorage.setItem(SESSION_KEY, JSON.stringify(session.current));
      window.history.replaceState(null, "", `/join/${code}`);
    }
    function onState(newState) {
      setState(newState);
    }
    function onSessionEnded() {
      resetToHome();
      setError("That game is no longer available — it may have ended or the server restarted. Start or join a new one.");
      setTimeout(() => setError(null), 6000);
    }
    function onError(message) {
      setError(message);
      setTimeout(() => setError((e) => (e === message ? null : e)), 5000);
      // A missing room means our saved session is dead — go back home.
      if (/room not found/i.test(message)) resetToHome();
    }

    socket.on("connect", attemptRejoin);
    socket.on("joined", onJoined);
    socket.on("state", onState);
    socket.on("sessionEnded", onSessionEnded);
    socket.on("errorMessage", onError);

    // If the socket is already connected on mount, try immediately.
    if (socket.connected) attemptRejoin();

    return () => {
      socket.off("connect", attemptRejoin);
      socket.off("joined", onJoined);
      socket.off("state", onState);
      socket.off("sessionEnded", onSessionEnded);
      socket.off("errorMessage", onError);
    };
  }, [resetToHome]);

  let content;
  if (!code || !state) {
    content = <Home />;
  } else if (state.status === "lobby") {
    content = <Lobby code={code} playerId={playerId} state={state} />;
  } else {
    content = <Game code={code} playerId={playerId} state={state} onLeave={leaveGame} />;
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
