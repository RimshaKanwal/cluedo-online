import { useEffect, useMemo, useRef, useState } from "react";
import { socket } from "../socket";
import Notepad, { notepadStorageKey } from "../components/Notepad";
import NotesReveal from "../components/NotesReveal";
import { sfx, soundEnabled, toggleSound } from "../sound";

// Set to true after dropping real image files into client/public/art/…
// (see README). Files are looked up by slug, e.g.
//   public/art/suspects/miss-scarlett.png
//   public/art/weapons/candlestick.png
//   public/art/rooms/kitchen.png
// Any missing file falls back to the emoji, so a partial set is fine.
const USE_CUSTOM_ART = false;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function Art({ kind, name, emoji, className }) {
  const [failed, setFailed] = useState(false);
  if (USE_CUSTOM_ART && !failed) {
    return (
      <img
        className={`art-img ${className || ""}`}
        src={`/art/${kind}/${slug(name)}.png`}
        alt={name}
        onError={() => setFailed(true)}
      />
    );
  }
  return <span className={className}>{emoji}</span>;
}

const REACTIONS = ["😏 Suspicious...", "🤔 Hmm", "😱 No way!", "😂 lol", "🎯 Got you!", "😤 Ugh"];

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

// Sizes board cells to fill the available area (the board is nearly square,
// so height is usually the limit). Reserves room for the ringed avatars and
// the status/controls beneath the board.
function useFitCell(ref, rows, cols) {
  const [cell, setCell] = useState(22);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const availW = el.clientWidth - 28;
      const availH = el.clientHeight - 28;
      const c = Math.floor(Math.min(availW / cols, availH / rows));
      setCell(Math.max(15, Math.min(44, c)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, rows, cols]);
  return cell;
}

export default function Game({ code, playerId, state, onLeave }) {
  const self = state.players.find((p) => p.id === playerId);
  const isMyTurn = state.currentPlayerId === playerId;
  const currentPlayer = state.players.find((p) => p.id === state.currentPlayerId);
  const turnState = state.turnState || { diceValue: null, hasMoved: false, reachable: null };
  const board = state.board;

  // Single canonical player order (matches turn order) used everywhere a
  // player list is shown — the rail, notepad columns, notes reveal, and
  // suggestion-answer chips — so they never disagree with each other.
  const orderedPlayers = useMemo(() => {
    if (!state.turnOrder) return state.players;
    const byId = Object.fromEntries(state.players.map((p) => [p.id, p]));
    return state.turnOrder.map((id) => byId[id]).filter(Boolean);
  }, [state.players, state.turnOrder]);

  const tableRef = useRef(null);
  const cell = useFitCell(tableRef, board.rows, board.cols);

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

  // "Final answer" tension: lock the submit button for a 3-2-1 countdown
  // whenever the accusation modal opens, with a rising suspense sound.
  const [accuseCountdown, setAccuseCountdown] = useState(0);
  useEffect(() => {
    if (!accuseOpen) return;
    setAccuseCountdown(3);
    sfx.suspense();
    const timers = [
      setTimeout(() => setAccuseCountdown(2), 900),
      setTimeout(() => setAccuseCountdown(1), 1800),
      setTimeout(() => setAccuseCountdown(0), 2700),
    ];
    return () => timers.forEach(clearTimeout);
  }, [accuseOpen]);

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

  // Quick-chat: purely transient, not part of game state — a bubble pops
  // onto the sender's rail card for a couple seconds then clears itself.
  const [activeReactions, setActiveReactions] = useState({}); // playerId -> emoji
  const [reactionMenuOpen, setReactionMenuOpen] = useState(false);
  useEffect(() => {
    function onReaction({ playerId: fromId, emoji }) {
      setActiveReactions((prev) => ({ ...prev, [fromId]: emoji }));
      setTimeout(() => {
        setActiveReactions((prev) => {
          if (prev[fromId] !== emoji) return prev; // a newer one already replaced it
          const next = { ...prev };
          delete next[fromId];
          return next;
        });
      }, 2500);
    }
    socket.on("reaction", onReaction);
    return () => socket.off("reaction", onReaction);
  }, []);
  function sendReaction(emoji) {
    socket.emit("sendReaction", { code, playerId, emoji });
    setReactionMenuOpen(false);
  }

  // A card-reveal/accusation result stays up long enough to actually read —
  // and since suggesting no longer ends your turn, clearing it the instant
  // currentPlayerId changed used to wipe it the moment you clicked End Turn,
  // sometimes within a second of it appearing. Just use a generous timeout.
  useEffect(() => {
    if (!lastResult) return;
    const t = setTimeout(() => setLastResult(null), 20000);
    return () => clearTimeout(t);
  }, [lastResult]);

  // Clear it once a fresh suggestion starts, so a new round doesn't show a
  // stale reveal from the previous one.
  const pendingStartedRef = useRef(false);
  useEffect(() => {
    const justStarted = !!state.pendingSuggestion && !pendingStartedRef.current;
    pendingStartedRef.current = !!state.pendingSuggestion;
    if (justStarted) setLastResult(null);
  }, [state.pendingSuggestion]);

  const passageTo = self?.position.room ? SECRET_PASSAGES[self.position.room] : null;
  const pending = state.pendingSuggestion;
  const canMove = isMyTurn && !self?.eliminated && !pending && turnState.diceValue != null && !turnState.hasMoved;
  const mustRespond = pending && pending.currentResponderId === playerId;

  // Playful nag: only about the very start of a turn — if the current
  // player hasn't rolled the dice within 20s. Fires once per turn (not
  // repeatedly), stays off once they roll, and a dismiss silences it for
  // the rest of that turn instead of it popping back up again.
  const [showNag, setShowNag] = useState(false);
  const [nagDismissed, setNagDismissed] = useState(false);
  useEffect(() => {
    setShowNag(false);
    setNagDismissed(false);
  }, [state.currentPlayerId]);
  useEffect(() => {
    if (state.status !== "playing") return;
    if (pending || turnState.diceValue != null || nagDismissed) {
      setShowNag(false);
      return;
    }
    const t = setTimeout(() => {
      setShowNag(true);
      sfx.siren();
    }, 20000);
    return () => clearTimeout(t);
  }, [state.status, state.currentPlayerId, turnState.diceValue, pending, nagDismissed]);

  const [soundOn, setSoundOn] = useState(soundEnabled());

  // Play sound cues on the meaningful state transitions.
  // Log entries commonly repeat verbatim (e.g. "X moved down the hall."
  // fires every corridor step), so anchoring on message *text* is unreliable
  // — a duplicate could match an old entry and replay its sound. Anchor on
  // each entry's monotonic `seq` instead. Lazily seed from mount-time state
  // so a player present from the start doesn't get every log entry replayed
  // as "new" on the very first render, while someone rejoining mid-game
  // still treats already-existing entries as old news.
  const lastSeenLogSeq = useRef(state.log.length ? state.log[state.log.length - 1].seq : 0);
  const prev = useRef({ dice: null, turn: null, respCount: 0, finished: false });
  useEffect(() => {
    const p = prev.current;
    if (turnState.diceValue != null && p.dice == null) sfx.dice();
    if (state.currentPlayerId === playerId && p.turn !== playerId && !pending) sfx.turn();
    const responses = state.lastSuggestion?.responses || {};
    const values = Object.values(responses);
    if (values.length > p.respCount) {
      const latest = values[values.length - 1];
      if (latest === "show") sfx.show();
      else if (latest === "pass") sfx.pass();
    }
    // A wrong accusation is public (it's in everyone's log) — play a random
    // laugh clip for the whole table, not just whoever guessed wrong.
    const newEntries = state.log.filter((e) => e.seq > lastSeenLogSeq.current);
    if (newEntries.some((e) => e.type === "accusation" && /WRONG/.test(e.message))) {
      sfx.wrongAccusation();
    }
    if (state.log.length) lastSeenLogSeq.current = state.log[state.log.length - 1].seq;
    if (state.status === "finished" && !p.finished) sfx.win();
    prev.current = {
      dice: turnState.diceValue,
      turn: state.currentPlayerId,
      respCount: values.length,
      finished: state.status === "finished",
    };
  }, [turnState.diceValue, state.currentPlayerId, state.lastSuggestion, state.status, state.log, playerId, pending]);

  // Confetti / shake / camera-zoom on every accusation outcome, for
  // everyone at the table. `seq` (not object identity) is what marks a
  // genuinely new accusation — lastAccusation gets re-serialized into a
  // fresh object on every broadcast even when nothing about it changed.
  const [showConfetti, setShowConfetti] = useState(false);
  const [boardShaking, setBoardShaking] = useState(false);
  const [zoomRoom, setZoomRoom] = useState(null);
  // Lazily captures whatever lastAccusation already was at mount time (e.g.
  // rejoining mid-game after an accusation already happened) so that gets
  // correctly treated as "old news" — vs. a player present from the start,
  // for whom the very first accusation (seq 1) is genuinely new and must
  // still fire. A hardcoded `null` sentinel here would wrongly swallow that
  // first-ever accusation for everyone who started the game together.
  const seenAccusationSeq = useRef(state.lastAccusation?.seq ?? null);
  useEffect(() => {
    const acc = state.lastAccusation;
    if (!acc || acc.seq === seenAccusationSeq.current) return;
    seenAccusationSeq.current = acc.seq;

    setZoomRoom(acc.room);
    const zoomTimer = setTimeout(() => setZoomRoom(null), 1700);
    let effectTimer;
    if (acc.correct) {
      setShowConfetti(true);
      effectTimer = setTimeout(() => setShowConfetti(false), 2000);
    } else {
      setBoardShaking(true);
      effectTimer = setTimeout(() => setBoardShaking(false), 600);
    }
    return () => {
      clearTimeout(zoomTimer);
      clearTimeout(effectTimer);
    };
  }, [state.lastAccusation]);

  const zoomOrigin = useMemo(() => {
    if (!zoomRoom || !board.rooms[zoomRoom]) return null;
    const { r0, r1, c0, c1 } = board.rooms[zoomRoom].rect;
    const originX = (((c0 + c1 + 1) / 2) / board.cols) * 100;
    const originY = (((r0 + r1 + 1) / 2) / board.rows) * 100;
    return `${originX}% ${originY}%`;
  }, [zoomRoom, board]);

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
      <FinishedScreen code={code} playerId={playerId} state={state} onLeave={onLeave} />
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

  const myActive = isMyTurn && !self.eliminated;
  // House rule: with allowAnytimeAccusation on, anyone can accuse whenever
  // it's not blocked by other things (eliminated, mid-suggestion-answer,
  // game over) — not just on their own turn.
  const canAccuseAnytime = state.allowAnytimeAccusation && !self.eliminated && !pending && state.status === "playing";

  return (
    <div className="game-screen">
      {showNag && (
        <div className="nag-toast">
          <span className="nag-siren">🚨</span>
          <span className="nag-text">Hanan aap ke baari hai!</span>
          <button
            className="nag-close"
            onClick={() => {
              setShowNag(false);
              setNagDismissed(true);
            }}
            title="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <PlayersRail
        players={state.players}
        turnOrder={state.turnOrder}
        currentId={state.currentPlayerId}
        selfId={playerId}
        responses={state.lastSuggestion?.responses || {}}
        reactions={activeReactions}
      />

      <div className="center-col">
        <div className="board-stage" ref={tableRef}>
          <Board
            board={board}
            cell={cell}
            players={state.players}
            canMove={canMove}
            reachableCellSet={reachableCellSet}
            reachableRoomSet={reachableRoomSet}
            onMoveCell={moveToCell}
            onMoveRoom={moveToRoom}
            shaking={boardShaking}
            zooming={!!zoomRoom}
            zoomOrigin={zoomOrigin}
          />
          {showConfetti && <Confetti />}
          {boardShaking && <div className="wrong-flash" />}
        </div>

        <div className="controls-bar">
          <div className="cb-status">
            <span className={`turn-dot ${isMyTurn ? "on" : ""}`} />
            <span className="status-line">{statusLine}</span>
            <DiceDisplay diceValue={turnState.diceValue} rollerName={currentPlayer?.name} />
          </div>
          <div className="cb-actions">
            {myActive && turnState.diceValue == null && !turnState.hasMoved && !pending && (
              <button className="cb-btn dice" onClick={rollDice}><span className="cb-ico">🎲</span>Roll Dice</button>
            )}
            {myActive && !turnState.hasMoved && !pending && passageTo && (
              <button className="cb-btn passage" onClick={usePassage}><span className="cb-ico">🚪</span>Passage <small>→ {passageTo}</small></button>
            )}
            {myActive && !pending && (
              <button
                className="cb-btn suggest"
                onClick={() => setSuggestOpen(true)}
                disabled={!self.position.room || turnState.hasSuggested}
                title={turnState.hasSuggested ? "Already suggested this turn" : !self.position.room ? "Be in a room to suggest" : ""}
              >
                <span className="cb-ico">🔍</span>Suggest
              </button>
            )}
            {(myActive || canAccuseAnytime) && !pending && (
              <button
                className="cb-btn accuse"
                onClick={() => setAccuseOpen(true)}
                disabled={!self.position.room}
                title={
                  !self.position.room
                    ? "Be in a room to accuse"
                    : !myActive && canAccuseAnytime
                    ? "Anytime-accusation is on for this game — you don't need to wait for your turn"
                    : ""
                }
              >
                <span className="cb-ico">⚖️</span>Accuse{!myActive && canAccuseAnytime && <small> (anytime)</small>}
              </button>
            )}
            {myActive && !pending && (
              <button className="cb-btn end" onClick={endTurn}><span className="cb-ico">🏳️</span>End Turn</button>
            )}
            <div className="reaction-menu-wrap">
              <button
                className="sound-toggle"
                title="Send a reaction"
                onClick={() => setReactionMenuOpen((o) => !o)}
              >
                💬
              </button>
              {reactionMenuOpen && (
                <div className="reaction-popover">
                  {REACTIONS.map((r) => (
                    <button key={r} className="reaction-option" onClick={() => sendReaction(r)}>
                      {r}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="sound-toggle" title={soundOn ? "Mute sounds" : "Unmute sounds"} onClick={() => setSoundOn(toggleSound())}>
              {soundOn ? "🔊" : "🔇"}
            </button>
          </div>
        </div>
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

        {state.lastSuggestion && (
          <LastSuggestionRecap
            lastSuggestion={state.lastSuggestion}
            players={orderedPlayers}
            selfId={playerId}
            shownCard={state.lastSuggestion.by === playerId ? lastResult?.shownCard : null}
          />
        )}

        <div className="drawer-tabs">
          <button className={tab === "notes" ? "tab active" : "tab"} onClick={() => setTab("notes")}>Notes</button>
          <button className={tab === "log" ? "tab active" : "tab"} onClick={() => setTab("log")}>Log</button>
        </div>
        <div className="drawer-body">
          {tab === "notes" ? (
            <Notepad cardSets={state.cardSets} players={orderedPlayers} selfId={playerId} code={code} />
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
            <button type="submit" className={`primary ${accuseCountdown > 0 ? "locking-in" : ""}`} disabled={accuseCountdown > 0}>
              {accuseCountdown > 0 ? `Locking in… ${accuseCountdown}` : "Submit Accusation"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

// Left rail: players stacked in turn order, current one highlighted, with a
// ✓/✕ badge showing how they answered the latest suggestion.
function PlayersRail({ players, turnOrder, currentId, selfId, responses, reactions }) {
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  const ordered = (turnOrder || players.map((p) => p.id)).map((id) => byId[id]).filter(Boolean);

  return (
    <div className="players-rail">
      {ordered.map((p) => {
        const meta = charMeta(p.character);
        const resp = responses[p.id];
        const reaction = reactions?.[p.id];
        return (
          <div
            key={p.id}
            className={`prail-card ${p.id === currentId ? "current" : ""} ${p.eliminated ? "eliminated" : ""} ${!p.connected ? "offline" : ""}`}
            style={{ "--pc": meta.color }}
          >
            {reaction && <div className="reaction-bubble">{reaction}</div>}
            <div className="prail-avatar">
              <Art kind="suspects" name={p.character} emoji={meta.emoji} />
              {resp === "show" && <span className="resp-badge show" title="Showed a card">✓</span>}
              {resp === "pass" && <span className="resp-badge pass" title="Has none of these">✕</span>}
            </div>
            <div className="prail-info">
              <div className="prail-name">
                {p.isHost && <span className="host-crown" title="Host">👑</span>}
                {p.name}
                {p.id === selfId && <span className="prail-you">you</span>}
              </div>
              <div className="prail-meta">{p.character}</div>
              <div className="prail-cards">
                🂠 {p.cardCount} cards{!p.connected && <span className="prail-offline">· offline</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// How far apart (in cells) to spread multiple tokens sharing one room, in a
// small centered grid instead of stacking exactly on top of each other.
function clusterOffset(index, total) {
  if (total <= 1) return { dx: 0, dy: 0 };
  const cols = Math.ceil(Math.sqrt(total));
  const rows = Math.ceil(total / cols);
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { dx: col - (cols - 1) / 2, dy: row - (rows - 1) / 2 };
}

function Board({ board, cell, players, canMove, reachableCellSet, reachableRoomSet, onMoveCell, onMoveRoom, shaking, zoomOrigin, zooming }) {
  const roomTokens = new Map();
  for (const p of players) {
    if (p.position.room) {
      if (!roomTokens.has(p.position.room)) roomTokens.set(p.position.room, []);
      roomTokens.get(p.position.room).push(p);
    }
  }

  const gridStyle = {
    gridTemplateColumns: `repeat(${board.cols}, ${cell}px)`,
    gridTemplateRows: `repeat(${board.rows}, ${cell}px)`,
    transformOrigin: zoomOrigin || "50% 50%",
  };

  // The dead centre (classic games) gets a decorative "case file" crest.
  const hasCellar = !!board.rooms.Cellar;

  // A single absolutely-positioned layer so tokens can smoothly slide
  // between squares (and snap to a room's centre) instead of jumping —
  // rendering them as children of individual grid cells would force React
  // to unmount/remount into a different DOM parent on every move, which
  // CSS can't transition.
  const tokenPositions = players
    .map((p) => {
      const meta = charMeta(p.character);
      if (p.position.room) {
        const room = board.rooms[p.position.room];
        if (!room) return null;
        const { r0, r1, c0, c1 } = room.rect;
        const siblings = roomTokens.get(p.position.room) || [p];
        const { dx, dy } = clusterOffset(siblings.indexOf(p), siblings.length);
        const x = ((c0 + c1 + 1) / 2 + dx * 0.55) * cell;
        const y = ((r0 + r1 + 1) / 2 + dy * 0.55) * cell;
        return { id: p.id, x, y, meta, name: p.name, character: p.character, inRoom: true };
      }
      if (p.position.cell) {
        const x = (p.position.cell.c + 0.5) * cell;
        const y = (p.position.cell.r + 0.5) * cell;
        return { id: p.id, x, y, meta, name: p.name, character: p.character, inRoom: false };
      }
      return null;
    })
    .filter(Boolean);

  return (
    <div className={`board-wrap ${shaking ? "shaking" : ""}`}>
      <div className={`board-cells ${zooming ? "zooming" : ""}`} style={gridStyle}>
        {!hasCellar && (
          <div className="board-centerpiece" style={{ gridRow: "11 / 17", gridColumn: "10 / 16" }}>
            <div className="crest-envelope">✉</div>
            <div className="crest-title">CLUEDO</div>
            <div className="crest-sub">The Case File</div>
          </div>
        )}
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
              <div className="room-emoji"><Art kind="rooms" name={name} emoji={theme.emoji} /></div>
              <div className="room-name">{name}</div>
            </div>
          );
        })}

        {board.cells.flatMap((row, r) =>
          row.map((cellData, c) => {
            if (cellData.type === "room" || cellData.type === "blank") return null;
            const key = `${r},${c}`;
            const isDoor = cellData.type === "door";
            const reachable = canMove && !isDoor && reachableCellSet.has(key);
            return (
              <div
                key={key}
                className={`grid-cell ${isDoor ? "door-cell" : "corridor-cell"} ${reachable ? "reachable" : ""}`}
                style={{ gridRow: r + 1, gridColumn: c + 1 }}
                title={isDoor ? `Door — ${cellData.room}` : undefined}
                onClick={() => reachable && onMoveCell(r, c)}
              />
            );
          })
        )}

        <div className="board-token-layer" style={{ gridRow: `1 / ${board.rows + 1}`, gridColumn: `1 / ${board.cols + 1}` }}>
          {tokenPositions.map((t) => (
            <div
              key={t.id}
              className={`board-token ${t.inRoom ? "in-room" : ""}`}
              style={{ transform: `translate(${t.x}px, ${t.y}px)`, background: t.meta.color }}
              title={`${t.name} (${t.character})`}
            >
              {t.meta.emoji}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Always-visible recap of the latest suggestion and how the table answered
// it — lives above the Notes/Log tabs so you don't have to leave your notes
// to see who showed a card (and, if it was shown to you, what it was).
function LastSuggestionRecap({ lastSuggestion, players, selfId, shownCard }) {
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  const orderIndex = Object.fromEntries(players.map((p, i) => [p.id, i]));
  const { byName, suggestion, responses } = lastSuggestion;
  // Sort by the same canonical order as the rail/notes (not the order they
  // happened to answer in), so this list never disagrees with the rest of
  // the UI about who comes before whom.
  const answered = Object.entries(responses).sort(([a], [b]) => orderIndex[a] - orderIndex[b]);

  return (
    <div className="recap-card">
      <div className="recap-title">Last Suggestion</div>
      <div className="recap-line">
        <strong>{byName}</strong>: {suggestion.suspect} · {suggestion.weapon} · {suggestion.room}
      </div>
      {answered.length > 0 && (
        <div className="recap-answers">
          {answered.map(([pid, action]) => {
            const p = byId[pid];
            if (!p) return null;
            const icon = action === "show" ? "✓" : action === "pass" ? "✕" : "…";
            return (
              <span key={pid} className={`recap-chip recap-${action}`}>
                {icon} {p.name}
                {p.id === selfId && " (you)"}
              </span>
            );
          })}
        </div>
      )}
      {shownCard && (
        <div className="recap-shown">
          Shown to you: <strong>{shownCard.value}</strong>
        </div>
      )}
    </div>
  );
}

// Visible to every player (not just whoever rolled) — briefly rattles
// through random faces before landing on the real value, so a roll reads
// as an event everyone at the table notices, not just a number in the log.
const CONFETTI_COLORS = ["#d8b45c", "#c0392b", "#3ddc84", "#4f6df5", "#e07a3f", "#ffffff"];

// Hand-rolled burst (no npm dependency) — a couple dozen falling/rotating
// pieces, generated fresh each mount so every correct accusation looks a
// little different.
function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        duration: 1.1 + Math.random() * 0.9,
        delay: Math.random() * 0.3,
        rotate: Math.random() > 0.5,
      })),
    []
  );
  return (
    <div className="confetti-layer">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            background: p.color,
            borderRadius: p.rotate ? "50%" : "1px",
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

function DiceDisplay({ diceValue, rollerName }) {
  const [shown, setShown] = useState(diceValue);
  const [rolling, setRolling] = useState(false);
  const prevValue = useRef(diceValue);

  useEffect(() => {
    if (diceValue == null) {
      prevValue.current = null;
      setShown(null);
      setRolling(false);
      return;
    }
    if (prevValue.current === diceValue) return; // already showing this roll
    prevValue.current = diceValue;
    setRolling(true);
    let ticks = 0;
    const id = setInterval(() => {
      ticks += 1;
      if (ticks >= 8) {
        clearInterval(id);
        setShown(diceValue);
        setRolling(false);
      } else {
        setShown(1 + Math.floor(Math.random() * 12));
      }
    }, 60);
    return () => clearInterval(id);
  }, [diceValue]);

  if (shown == null) return null;
  return (
    <span className={`dice-display ${rolling ? "rolling" : "settled"}`}>
      <span className="dice-display-face">🎲</span>
      <span className="dice-display-num">{shown}</span>
      {rollerName && <span className="dice-display-roller">{rollerName}</span>}
    </span>
  );
}

function PlayingCard({ card }) {
  const meta = cardMeta(card);
  const kind = card.type === "suspect" ? "suspects" : card.type === "weapon" ? "weapons" : "rooms";
  return (
    <div className="play-card" style={{ "--cc": meta.color }}>
      <div className="play-card-icon"><Art kind={kind} name={card.value} emoji={meta.icon} /></div>
      <div className="play-card-name">{card.value}</div>
    </div>
  );
}

function FinishedScreen({ code, playerId, state, onLeave }) {
  // Same canonical turn-order sort used throughout the live game, so the
  // notes reveal lines up with how players were shown during play.
  const orderedPlayers = useMemo(() => {
    if (!state.turnOrder) return state.players;
    const byId = Object.fromEntries(state.players.map((p) => [p.id, p]));
    return state.turnOrder.map((id) => byId[id]).filter(Boolean);
  }, [state.players, state.turnOrder]);

  // Publish this browser's personal deduction notepad once, so the reveal
  // below can show everyone's notes side by side.
  const submittedRef = useRef(false);
  useEffect(() => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    let marks = {};
    try {
      marks = JSON.parse(localStorage.getItem(notepadStorageKey(code)) || "{}");
    } catch {
      marks = {};
    }
    socket.emit("submitFinalNotes", { code, playerId, marks });
  }, [code, playerId]);

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
      <NotesReveal finalNotes={state.finalNotes || {}} players={orderedPlayers} cardSets={state.cardSets} />
      <button className="primary" onClick={onLeave} style={{ marginTop: 16 }}>
        New Game
      </button>
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
