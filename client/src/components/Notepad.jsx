import { useEffect, useState } from "react";

const STORAGE_KEY = "cluedo-notepad";

export default function Notepad({ cardSets }) {
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
      const order = [undefined, "x", "?"];
      const current = order.indexOf(prev[key]);
      const next = order[(current + 1) % order.length];
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
      <h3>Notepad</h3>
      <p className="hint">Click to cycle: blank → ✕ (ruled out) → ? (maybe)</p>
      {sections.map(([key, label]) => (
        <div key={key} className="notepad-section">
          <h4>{label}</h4>
          <ul className="notepad-list">
            {cardSets[key].map((item) => (
              <li key={item}>
                <button className={`notepad-cell mark-${marks[`${key}:${item}`] || "none"}`} onClick={() => cycle(`${key}:${item}`)}>
                  {marks[`${key}:${item}`] === "x" ? "✕" : marks[`${key}:${item}`] === "?" ? "?" : ""}
                </button>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
