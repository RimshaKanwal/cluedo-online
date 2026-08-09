import { Fragment } from "react";
import { NOTEPAD_GLYPH } from "./Notepad";

// End-of-game reveal: everyone's personal deduction notepad, side by side,
// read-only. Keys mirror Notepad's own scheme so a submitted marks blob
// renders identically to how its owner saw it while playing.
export default function NotesReveal({ finalNotes, players, cardSets }) {
  const sections = [
    ["suspects", "Suspects"],
    ["weapons", "Weapons"],
    ["rooms", "Rooms"],
  ];
  const contributors = players.filter((p) => finalNotes[p.id]);

  if (contributors.length === 0) {
    return <p className="hint">Waiting for players' notes to come in…</p>;
  }

  return (
    <div className="notes-reveal">
      <h3>Everyone's Notes</h3>
      <div className="notes-reveal-grid">
        {contributors.map((owner) => {
          const marks = finalNotes[owner.id] || {};
          return (
            <div key={owner.id} className="notes-reveal-sheet">
              <div className="notes-reveal-owner">{owner.name}'s notes</div>
              <table className="notepad-table">
                <thead>
                  <tr>
                    <th className="notepad-rowhead" />
                    {players.map((p) => (
                      <th key={p.id} className="notepad-colhead" title={p.name}>
                        {p.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sections.map(([key, label]) => (
                    <Fragment key={key}>
                      <tr className="notepad-section-row">
                        <td className="notepad-section-label" colSpan={players.length + 1}>{label}</td>
                      </tr>
                      {cardSets[key].map((item) => {
                        const nameMark = marks[`name:${key}:${item}`];
                        return (
                          <tr key={item} className={nameMark === "x" ? "row-ruledout" : ""}>
                            <td className="notepad-rowhead">
                              <span className={`rowname-static rowname-${nameMark || "none"}`}>
                                {item}
                                {nameMark === "check" && " ⭐"}
                              </span>
                            </td>
                            {players.map((p) => {
                              const mark = marks[`${key}:${item}:${p.id}`];
                              return (
                                <td key={p.id} className="notepad-td">
                                  <span className={`notepad-cell mark-${mark || "none"}`}>
                                    {mark ? NOTEPAD_GLYPH[mark] : ""}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
