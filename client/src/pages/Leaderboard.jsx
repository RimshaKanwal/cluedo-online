import { useEffect, useState } from "react";
import { fetchLeaderboard } from "../auth";

export default function Leaderboard({ onBack }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchLeaderboard()
      .then(setRows)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="card leaderboard-card">
      <div className="leaderboard-header">
        <h2>🏆 Leaderboard</h2>
        <button className="secondary" onClick={onBack}>Back</button>
      </div>

      {error && <p className="hint" style={{ color: "#ff8a80" }}>{error}</p>}
      {!rows && !error && <p className="hint">Loading…</p>}
      {rows && rows.length === 0 && <p className="hint">No games finished yet — be the first!</p>}

      {rows && rows.length > 0 && (
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Wins</th>
              <th>Win %</th>
              <th>Games</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.username}>
                <td>{i + 1}</td>
                <td>{r.username}</td>
                <td>{r.wins}</td>
                <td>{Math.round(r.winRate * 100)}%</td>
                <td>{r.gamesPlayed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
