// Static game data: characters, karts, items, speed classes and tracks.

export const CHARACTERS = [
  { name: "Chamo", color: 0xe23b3b, accent: 0xffffff, skin: 0xe2a36f, style: "cap", tag: "All-rounder",
    stats: { speed: 3, accel: 3, weight: 3, handling: 3 } },
  { name: "agenteintermediario", color: 0xf7f7f5, accent: 0x1a1a1a, skin: 0xd99a6c, style: "balmain", tag: "Quick off the line",
    stats: { speed: 3, accel: 4, weight: 2, handling: 3 } },
  { name: "Paco", color: 0x2fae5a, accent: 0xf4d35e, skin: 0xc98b5c, style: "sombrero", tag: "Steady and sturdy",
    stats: { speed: 3, accel: 2, weight: 4, handling: 3 } },
  { name: "Nena", color: 0xffc233, accent: 0x7b4dff, skin: 0xf0c09a, style: "pigtails", tag: "Nimble",
    stats: { speed: 2, accel: 4, weight: 2, handling: 4 } },
  { name: "El Toro", color: 0x8a4b2a, accent: 0xf2e8d5, skin: 0x6b3a22, style: "bull", tag: "Heavyweight",
    stats: { speed: 5, accel: 1, weight: 5, handling: 1 } },
  { name: "Pollito", color: 0xffe14d, accent: 0xff7a1a, skin: 0xffe14d, style: "chick", tag: "Featherweight",
    stats: { speed: 1, accel: 5, weight: 1, handling: 5 } },
  { name: "Luchador", color: 0x2f5bd9, accent: 0xffd23f, skin: 0xc98b5c, style: "mask", tag: "Top speed brawler",
    stats: { speed: 4, accel: 2, weight: 4, handling: 2 } },
  { name: "Calavera", color: 0x8e44ad, accent: 0x38e0c8, skin: 0xf5f1e6, style: "skull", tag: "Fast and tricky",
    stats: { speed: 4, accel: 3, weight: 3, handling: 2 } },
];

export const KARTS = [
  { name: "Clásico", tag: "Balanced standard kart", mods: { speed: 0, accel: 0, weight: 0, handling: 0 }, offroad: 0.52 },
  { name: "Bala", tag: "Built for top speed", mods: { speed: 1, accel: -1, weight: 1, handling: -1 }, offroad: 0.48 },
  { name: "Burro", tag: "Grippy off-road buggy", mods: { speed: -1, accel: 1, weight: 0, handling: 1 }, offroad: 0.68 },
];

export const CC = { 50: 27, 100: 32, 150: 37, 200: 43 };
export const AI_SKILL = { 50: 0.88, 100: 0.94, 150: 0.972, 200: 1.0 };
export const POINTS = [15, 12, 10, 8, 6, 4, 2, 1];

export const ITEMS = {
  banana: { name: "Banana" },
  green: { name: "Green Coco" },
  red: { name: "Red Coco" },
  chili: { name: "Chile" },
  chili3: { name: "Triple Chile" },
  star: { name: "Estrella" },
  bolt: { name: "Rayo" },
  splat: { name: "Chamoy" },
};

// Item odds by race position bucket.
const ODDS = [
  // leader
  { banana: 38, green: 30, red: 8, chili: 10, splat: 14 },
  // front of the pack
  { banana: 18, green: 22, red: 26, chili: 16, chili3: 4, splat: 12, star: 2 },
  // middle
  { banana: 8, green: 14, red: 24, chili: 15, chili3: 16, star: 9, splat: 8, bolt: 6 },
  // back
  { banana: 2, green: 5, red: 16, chili: 10, chili3: 30, star: 24, bolt: 13 },
];

export function rollItem(placeFrac, rnd = Math.random) {
  const b = placeFrac <= 0 ? 0 : placeFrac < 0.4 ? 1 : placeFrac < 0.75 ? 2 : 3;
  const table = ODDS[b];
  let total = 0;
  for (const k in table) total += table[k];
  let r = rnd() * total;
  for (const k in table) {
    r -= table[k];
    if (r <= 0) return k;
  }
  return "banana";
}

export function kartStats(charIndex, kartIndex, cc) {
  const c = CHARACTERS[charIndex].stats;
  const k = KARTS[kartIndex];
  const s = {
    speed: c.speed + k.mods.speed,
    accel: c.accel + k.mods.accel,
    weight: c.weight + k.mods.weight,
    handling: c.handling + k.mods.handling,
  };
  return {
    raw: s,
    maxSpeed: CC[cc] * (0.925 + 0.025 * s.speed),
    accel: 14 + 3.6 * Math.max(0, s.accel),
    turn: 1.7 + 0.1 * s.handling,
    weight: 0.7 + 0.15 * s.weight,
    offroad: k.offroad,
  };
}

// ---------------------------------------------------------------- tracks
// points: [x, z, height, roadWidth?]. Features use "at" = fraction of the lap.

export const TRACKS = [
  {
    name: "Chamo Circuit",
    sub: "Sunny meadows, gentle hills",
    theme: "meadow",
    boundary: "wall",
    width: 24,
    shoulder: 7,
    laps: 3,
    points: [
      [0, -150, 0], [0, -60, 0], [0, 40, 3], [12, 115, 6], [55, 160, 6], [115, 168, 4], [162, 138, 2],
      [170, 88, 0], [138, 40, 0], [148, -12, 1], [200, -42, 3], [222, -100, 5], [192, -160, 4],
      [130, -182, 2], [70, -200, 1], [22, -192, 0],
    ],
    boxes: [0.2, 0.52, 0.8],
    coins: [{ at: 0.08, lat: -0.5, n: 5 }, { at: 0.33, lat: 0.4, n: 5 }, { at: 0.64, lat: -0.3, n: 5 }, { at: 0.9, lat: 0.5, n: 4 }],
    boosts: [{ at: 0.43, lat: 0.35 }, { at: 0.72, lat: -0.35 }],
    ramps: [{ at: 0.845 }],
    gaps: [],
    music: { bpm: 142, root: 60, mode: "major", seed: 11 },
  },
  {
    name: "Cactus Canyon",
    sub: "Mind the gap, amigo",
    theme: "desert",
    boundary: "wall",
    width: 24,
    shoulder: 8,
    laps: 3,
    points: [
      [0, -200, 0], [0, -80, 0], [-10, 20, 0], [-60, 90, 2], [-140, 112, 6], [-200, 72, 8], [-212, 0, 8],
      [-172, -42, 6], [-112, -32, 4], [-78, -74, 2], [-106, -132, 0], [-122, -190, 0], [-82, -242, 0],
      [-30, -246, 0],
    ],
    boxes: [0.22, 0.5, 0.78],
    coins: [{ at: 0.3, lat: 0, n: 6 }, { at: 0.6, lat: 0.45, n: 5 }, { at: 0.88, lat: -0.4, n: 5 }],
    boosts: [{ at: 0.04, lat: 0 }, { at: 0.66, lat: -0.3 }],
    ramps: [],
    gaps: [{ at: 0.105, len: 11 }],
    music: { bpm: 128, root: 57, mode: "phrygian", seed: 23 },
  },
  {
    name: "Pico Nevado",
    sub: "Climb high, drift down",
    theme: "snow",
    boundary: "wall",
    width: 23,
    shoulder: 7,
    laps: 3,
    points: [
      [0, -160, 0], [0, -40, 4], [20, 60, 12], [70, 120, 20], [140, 132, 28], [192, 92, 34],
      [194, 22, 34], [160, -22, 30], [190, -72, 24], [202, -140, 16], [152, -202, 8], [82, -214, 3],
      [30, -202, 0],
    ],
    boxes: [0.18, 0.5, 0.82],
    coins: [{ at: 0.3, lat: -0.4, n: 5 }, { at: 0.58, lat: 0.3, n: 5 }, { at: 0.94, lat: 0, n: 5 }],
    boosts: [{ at: 0.1, lat: 0.3 }, { at: 0.36, lat: -0.3 }],
    ramps: [{ at: 0.87 }],
    gaps: [],
    music: { bpm: 150, root: 62, mode: "dorian", seed: 37 },
  },
  {
    name: "Playa Chamoy",
    sub: "Sand, surf and sunshine",
    theme: "beach",
    boundary: "void",
    width: 24,
    shoulder: 8,
    laps: 3,
    points: [
      [0, -170, 0], [0, -60, 0], [25, 30, 1], [80, 80, 2], [150, 72, 1], [192, 12, 0], [250, -10, 0],
      [290, -60, 1], [272, -130, 2], [210, -162, 1], [150, -132, 0], [100, -172, 0], [52, -222, 0],
      [10, -215, 0],
    ],
    boxes: [0.16, 0.46, 0.76],
    coins: [{ at: 0.3, lat: 0.4, n: 5 }, { at: 0.55, lat: -0.4, n: 5 }, { at: 0.9, lat: 0.2, n: 5 }],
    boosts: [{ at: 0.39, lat: 0 }, { at: 0.86, lat: -0.3 }],
    ramps: [{ at: 0.84 }],
    gaps: [],
    music: { bpm: 118, root: 65, mode: "mixolydian", seed: 41 },
  },
  {
    name: "Neon Nights",
    sub: "Don't look down",
    theme: "neon",
    boundary: "void",
    width: 21,
    shoulder: 0,
    laps: 3,
    points: [
      [0, -180, 10], [0, -80, 14], [-20, 10, 22], [-80, 62, 28], [-152, 52, 24], [-192, -10, 18],
      [-162, -72, 14], [-104, -92, 18], [-66, -142, 24], [-94, -202, 20], [-62, -262, 14], [10, -272, 10],
      [42, -232, 9], [22, -200, 9],
    ],
    boxes: [0.2, 0.47, 0.75],
    coins: [{ at: 0.1, lat: 0, n: 6 }, { at: 0.4, lat: 0.3, n: 5 }, { at: 0.62, lat: -0.3, n: 5 }],
    boosts: [{ at: 0.05, lat: 0 }, { at: 0.17, lat: 0.3 }, { at: 0.37, lat: -0.3 }, { at: 0.8, lat: 0 }],
    ramps: [{ at: 0.22 }],
    gaps: [{ at: 0.125, len: 10 }],
    music: { bpm: 160, root: 64, mode: "minor", seed: 53 },
  },
];

export const CUPS = [{ name: "Copa Chamo", tracks: [0, 1, 2, 3, 4] }];
