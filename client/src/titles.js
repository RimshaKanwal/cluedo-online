// Computed purely from win count — no server storage needed, just a ladder.
export function titleFor(wins) {
  if (wins >= 20) return "Legend";
  if (wins >= 10) return "Master Detective";
  if (wins >= 3) return "Detective";
  return "Rookie";
}
