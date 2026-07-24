import { useEffect, useState } from "react";

const STORAGE_KEY = "cluedo-notepad";
const MARKS = [undefined, "x", "check", "?"]; // click cycles through these
const GLYPH = { x: "✕", check: "✓", "?": "?" };

// Detective sheet: rows are the cards (suspects, weapons, rooms), columns are
// the players. Mark each cell as you deduce who holds a card, and click a card
// name to cross the whole card off (ruled out) or star it (in the envelope).
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
    <div className="notepad">
      <p className="notepad-legend">Tap a name to rule it out ✕ / star ✓ · tap cells for per-player notes</p>
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
      {items.map((item) => {
        const nameKey = `name:${sectionKey}:${item}`;
        const nameMark = marks[nameKey];
        return (
          <tr key={item} className={nameMark === "x" ? "row-ruledout" : ""}>
            <td className="notepad-rowhead">
              <button
                className={`rowname-btn rowname-${nameMark || "none"}`}
                onClick={() => onCycle(nameKey)}
                title="Rule out / star this card"
              >
                {item}
                {nameMark === "check" && " ⭐"}
              </button>
            </td>
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
        );
      })}
    </>
  );
}
