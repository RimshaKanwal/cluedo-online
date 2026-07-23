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

// Adjacency graph for click-to-move (hallway connections + diagonal
// secret passages between opposite corner rooms).
export const ROOM_ADJACENCY = {
  Study: ["Hall", "Library", "Kitchen"], // Kitchen via secret passage
  Hall: ["Study", "Lounge", "Billiard Room"],
  Lounge: ["Hall", "Dining Room", "Conservatory"], // Conservatory via secret passage
  Library: ["Study", "Billiard Room", "Conservatory"],
  "Billiard Room": ["Hall", "Library", "Dining Room", "Ballroom"],
  "Dining Room": ["Lounge", "Billiard Room", "Kitchen"],
  Conservatory: ["Library", "Ballroom", "Lounge"],
  Ballroom: ["Billiard Room", "Conservatory", "Kitchen"],
  Kitchen: ["Dining Room", "Ballroom", "Study"],
};

export function getCardSets(playerCount) {
  const useExpanded = playerCount > 6;
  return {
    suspects: useExpanded ? EXPANDED_SUSPECTS : CLASSIC_SUSPECTS,
    weapons: useExpanded ? EXPANDED_WEAPONS : CLASSIC_WEAPONS,
    rooms: ROOMS,
  };
}
