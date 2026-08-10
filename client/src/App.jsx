import { useCallback, useEffect, useRef, useState } from "react";
import { socket, setAuthToken } from "./socket";
import { getStoredToken, storeToken, clearToken, fetchMe } from "./auth";
import SignIn from "./pages/SignIn";
import Home from "./pages/Home";
import Lobby from "./pages/Lobby";
import Game from "./pages/Game";
import Leaderboard from "./pages/Leaderboard";
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
  const [account, setAccount] = useState(null); // { userId, username, wins, gamesPlayed }
  const [checkingSession, setCheckingSession] = useState(true);
  const [view, setView] = useState("game"); // "game" | "leaderboard"

  const [code, setCode] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const session = useRef(loadSession()); // { code, playerId }

  // Restore a signed-in session (if any) on first load.
  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setCheckingSession(false);
      return;
    }
    fetchMe(token)
      .then((me) => {
        setAccount(me);
        setAuthToken(token);
      })
      .catch(() => {
        clearToken();
      })
      .finally(() => setCheckingSession(false));
  }, []);

  function handleSignedIn(data) {
    storeToken(data.token);
    setAccount({ userId: data.userId, username: data.username, wins: data.wins, gamesPlayed: data.gamesPlayed });
    setAuthToken(data.token);
  }

  function handleSignOut() {
    clearToken();
    setAuthToken(null);
    setAccount(null);
    setCode(null);
    setPlayerId(null);
    setState(null);
    session.current = null;
    localStorage.removeItem(SESSION_KEY);
    window.history.replaceState(null, "", "/");
  }

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
  if (checkingSession) {
    content = null;
  } else if (!account) {
    content = <SignIn onSignedIn={handleSignedIn} />;
  } else if (view === "leaderboard") {
    content = <Leaderboard onBack={() => setView("game")} />;
  } else if (!code || !state) {
    content = <Home onShowLeaderboard={() => setView("leaderboard")} />;
  } else if (state.status === "lobby") {
    content = <Lobby code={code} playerId={playerId} state={state} />;
  } else {
    content = <Game code={code} playerId={playerId} state={state} onLeave={leaveGame} />;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>🔎 Cluedo Online</h1>
        <div className="header-right">
          {code && <span className="room-code-badge">Room: {code}</span>}
          {account && (
            <div className="account-chip">
              <span>{account.username} · {account.wins}🏆</span>
              <button className="account-signout" onClick={handleSignOut} title="Sign out">
                ×
              </button>
            </div>
          )}
        </div>
      </header>
      {error && <div className="error-banner">{error}</div>}
      <main>{content}</main>
    </div>
  );
}
