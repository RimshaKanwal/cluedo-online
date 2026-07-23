export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;

// Classic set used for 3-6 players. Expanded set (adds 2 suspects + 2
// weapons) kicks in for 7-8 players so there are enough cards to deal
// a reasonable hand to everyone alongside the 3 solution cards.
const CLASSIC_SUSPECTS = [
  "Miss Scarlett",
  "Colonel Mustard",
  "Mrs. White",
  "Reverend Green",
  "Mrs. Peacock",
  "Professor Plum",
];

const EXPANDED_SUSPECTS = [...CLASSIC_SUSPECTS, "Dr. Orchid", "Monsieur Brunette"];

const CLASSIC_WEAPONS = [
  "Candlestick",
  "Knife",
  "Lead Pipe",
  "Revolver",
  "Rope",
  "Wrench",
];

const EXPANDED_WEAPONS = [...CLASSIC_WEAPONS, "Poison", "Bow and Arrow"];

// Rooms stay fixed regardless of player count.
export const ROOMS = [
  "Study",
  "Hall",
  "Lounge",
  "Library",
  "Billiard Room",
  "Dining Room",
  "Conservatory",
  "Ballroom",
  "Kitchen",
];

// 3x3 room grid matching the physical board's layout & connectivity.
export const ROOM_LAYOUT = {
  Kitchen: { row: 0, col: 0 },
  Ballroom: { row: 0, col: 1 },
  Conservatory: { row: 0, col: 2 },
  "Dining Room": { row: 1, col: 0 },
  "Billiard Room": { row: 1, col: 1 },
  Library: { row: 1, col: 2 },
  Lounge: { row: 2, col: 0 },
  Hall: { row: 2, col: 1 },
  Study: { row: 2, col: 2 },
};

// Real walkable hallways (orthogonal room-pairs only).
export const REAL_CORRIDORS = {
  Study: ["Hall", "Library"],
  Hall: ["Study", "Lounge", "Billiard Room"],
  Lounge: ["Hall", "Dining Room"],
  Library: ["Study", "Billiard Room", "Conservatory"],
  "Billiard Room": ["Hall", "Library", "Dining Room", "Ballroom"],
  "Dining Room": ["Lounge", "Billiard Room", "Kitchen"],
  Conservatory: ["Library", "Ballroom"],
  Ballroom: ["Billiard Room", "Conservatory", "Kitchen"],
  Kitchen: ["Dining Room", "Ballroom"],
};

// Diagonal secret passages between opposite corner rooms — instant, no dice.
export const SECRET_PASSAGES = {
  Kitchen: "Study",
  Study: "Kitchen",
  Lounge: "Conservatory",
  Conservatory: "Lounge",
};

// Backwards-compatible full adjacency (corridors + secret passages), kept
// for any code that just needs "can I eventually reach this room".
export const ROOM_ADJACENCY = Object.fromEntries(
  ROOMS.map((room) => [
    room,
    [...(REAL_CORRIDORS[room] || []), ...(SECRET_PASSAGES[room] ? [SECRET_PASSAGES[room]] : [])],
  ])
);

export const CORRIDOR_LENGTH = 3; // walkable squares between two adjacent rooms' doors

// Builds the full board geometry: a grid coordinate for every room plus the
// intermediate corridor squares along each real hallway. Computed once and
// exported as a static object — the client renders directly from this.
function buildBoard() {
  const spacing = CORRIDOR_LENGTH + 1;
  const rooms = {};
  for (const [room, { row, col }] of Object.entries(ROOM_LAYOUT)) {
    rooms[room] = { row: row * spacing, col: col * spacing };
  }

  const corridors = {};
  const seen = new Set();
  for (const [room, neighbors] of Object.entries(REAL_CORRIDORS)) {
    for (const neighbor of neighbors) {
      const key = [room, neighbor].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);

      const a = rooms[room];
      const b = rooms[neighbor];
      const cells = [];
      for (let step = 1; step < spacing; step++) {
        const t = step / spacing;
        cells.push({
          row: Math.round(a.row + (b.row - a.row) * t),
          col: Math.round(a.col + (b.col - a.col) * t),
        });
      }
      // Cells are ordered walking from `room` toward `neighbor`.
      corridors[key] = { rooms: [room, neighbor], cells };
    }
  }

  return { rooms, corridors, corridorLength: CORRIDOR_LENGTH, secretPassages: SECRET_PASSAGES };
}

export const BOARD = buildBoard();

// Looks up the ordered corridor cells between two adjacent rooms, walking
// from `from` toward `to`. Returns null if they aren't directly connected.
export function getCorridorCells(from, to) {
  const key = [from, to].sort().join("|");
  const corridor = BOARD.corridors[key];
  if (!corridor) return null;
  const cells = corridor.rooms[0] === from ? corridor.cells : [...corridor.cells].reverse();
  return cells;
}

export function getCardSets(playerCount) {
  const useExpanded = playerCount > 6;
  return {
    suspects: useExpanded ? EXPANDED_SUSPECTS : CLASSIC_SUSPECTS,
    weapons: useExpanded ? EXPANDED_WEAPONS : CLASSIC_WEAPONS,
    rooms: ROOMS,
  };
}
