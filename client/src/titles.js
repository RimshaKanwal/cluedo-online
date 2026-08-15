// Computed purely from win count — no server storage needed, just a ladder.
export const TITLE_LADDER = [
  { title: "Legend", minWins: 20 },
  { title: "Master Detective", minWins: 10 },
  { title: "Detective", minWins: 3 },
  { title: "Rookie", minWins: 0 },
];

export function titleFor(wins) {
  return TITLE_LADDER.find((t) => wins >= t.minWins).title;
}
