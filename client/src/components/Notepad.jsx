import { useEffect, useState } from "react";

const STORAGE_KEY = "cluedo-notepad";
const MARKS = [undefined, "x", "check", "?"]; // click cycles through these
const GLYPH = { x: "✕", check: "✓", "?": "?" };

// Detective sheet: rows are the cards (suspects, weapons, rooms), columns are
// the players. Mark each cell as you deduce who does or doesn't hold a card.
export default function Notepad({ cardSets, players, selfId }) {
  const [marks, setMarks] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(marks));
  }, [marks]);

  function cycle(key) {
    setMarks((prev) => {
      const next = MARKS[(MARKS.indexOf(prev[key]) + 1) % MARKS.length];
      const copy = { ...prev };
      if (next === undefined) delete copy[key];
      else copy[key] = next;
      return copy;
    });
  }

  const sections = [
    ["suspects", "Suspects"],
    ["weapons", "Weapons"],
    ["rooms", "Rooms"],
  ];

  return (
    <div>
      <h3>Detective Notes</h3>
      <p className="hint">Click a cell to cycle: blank → ✕ (doesn't have) → ✓ (has) → ? (maybe)</p>
      <div className="notepad-scroll">
        <table className="notepad-table">
          <thead>
            <tr>
              <th className="notepad-rowhead" />
              {players.map((p) => (
                <th key={p.id} className="notepad-colhead" title={p.name}>
                  {p.name}
                  {p.id === selfId && <span className="you-tag">YOU</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map(([key, label]) => (
              <FragmentSection
                key={key}
                label={label}
                items={cardSets[key]}
                players={players}
                marks={marks}
                onCycle={cycle}
                sectionKey={key}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentSection({ label, items, players, marks, onCycle, sectionKey }) {
  return (
    <>
      <tr className="notepad-section-row">
        <td className="notepad-section-label" colSpan={players.length + 1}>{label}</td>
      </tr>
      {items.map((item) => (
        <tr key={item}>
          <td className="notepad-rowhead">{item}</td>
          {players.map((p) => {
            const cellKey = `${sectionKey}:${item}:${p.id}`;
            const mark = marks[cellKey];
            return (
              <td key={p.id} className="notepad-td">
                <button className={`notepad-cell mark-${mark || "none"}`} onClick={() => onCycle(cellKey)}>
                  {mark ? GLYPH[mark] : ""}
                </button>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
