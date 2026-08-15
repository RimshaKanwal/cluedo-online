import { useEffect, useState } from "react";
import { fetchLeaderboard, fetchMenace } from "../auth";
import { titleFor } from "../titles";

export default function Leaderboard({ onBack }) {
  const [rows, setRows] = useState(null);
  const [menace, setMenace] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchLeaderboard()
      .then(setRows)
      .catch((err) => setError(err.message));
    fetchMenace()
      .then(setMenace)
      .catch(() => {}); // non-critical, just skip the callout if it fails
  }, []);

  return (
    <div className="card leaderboard-card">
      <div className="leaderboard-header">
        <h2>🏆 Leaderboard</h2>
        <button className="secondary" onClick={onBack}>Back</button>
      </div>

      {menace && (
        <div className="menace-callout" title={`${menace.username} has the most wrong accusations all-time`}>
          😈 <strong>Menace:</strong> {menace.username} ({menace.wrongAccusations} wrong guess{menace.wrongAccusations === 1 ? "" : "es"})
        </div>
      )}

      {error && <p className="hint" style={{ color: "#ff8a80" }}>{error}</p>}
      {!rows && !error && <p className="hint">Loading…</p>}
      {rows && rows.length === 0 && <p className="hint">No games finished yet — be the first!</p>}

      {rows && rows.length > 0 && (
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Title</th>
              <th>Wins</th>
              <th>Win %</th>
              <th>Games</th>
              <th>Streak</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.username}>
                <td>{i + 1}</td>
                <td>{r.username}</td>
                <td><span className="leaderboard-title">{titleFor(r.wins)}</span></td>
                <td>{r.wins}</td>
                <td>{Math.round(r.winRate * 100)}%</td>
                <td>{r.gamesPlayed}</td>
                <td>
                  {r.currentStreak > 1 ? `🔥${r.currentStreak}` : r.bestStreak > 1 ? <span className="hint">best {r.bestStreak}</span> : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
