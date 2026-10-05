// Static game data: characters, karts, items, speed classes and tracks.
import { cleanStats } from "./look.js?v=3";

export const CHARACTERS = [
  { name: "Chamo", color: 0xe23b3b, accent: 0xffffff, skin: 0xe2a36f, style: "cap", tag: "All-rounder",
    stats: { speed: 3, accel: 3, weight: 3, handling: 3 } },
  { name: "Momo", color: 0x34b86a, accent: 0xffd83a, skin: 0xf3cfa4, style: "monkey", tag: "Cheeky banana lover",
    stats: { speed: 3, accel: 4, weight: 2, handling: 3 } },
  { name: "Bao", color: 0xf48fb1, accent: 0x5cb85c, skin: 0xf7f5f0, style: "panda", tag: "Big, soft and hard to push around",
    stats: { speed: 3, accel: 2, weight: 4, handling: 3 } },
  { name: "Lucas", color: 0xf07a22, accent: 0xf4ecd6, skin: 0x5aa83c, style: "trex", car: "pickup", tag: "Tiny arms, big truck",
    stats: { speed: 2, accel: 4, weight: 2, handling: 4 } },
  { name: "Bumblebee", color: 0xffc814, accent: 0x16161a, skin: 0xffc814, style: "robot", car: "transformer", tag: "Robot in disguise (press D)",
    stats: { speed: 5, accel: 1, weight: 5, handling: 1 } },
  { name: "Chicky", color: 0xffe14d, accent: 0xff7a1a, skin: 0xffe14d, style: "chick", tag: "Featherweight",
    stats: { speed: 1, accel: 5, weight: 1, handling: 5 } },
  { name: "Dorito", color: 0xf28c1e, accent: 0xd42a1f, skin: 0xe8913a, style: "tabby", tag: "Nine lives, zero brakes",
    stats: { speed: 4, accel: 2, weight: 4, handling: 2 } },
  // Built by the player (js/look.js). A CPU in this slot is Skully, the default look.
  { name: "Custom", botName: "Skully", custom: true, color: 0x8e44ad, accent: 0x38e0c8, skin: 0xf5f1e6, style: "custom", tag: "Your own creation: tap ✏️ Edit",
    stats: { speed: 4, accel: 3, weight: 3, handling: 2 } },
];

export const KARTS = [
  { name: "Classic", tag: "Balanced standard kart", mods: { speed: 0, accel: 0, weight: 0, handling: 0 }, offroad: 0.52 },
  { name: "Bullet", tag: "Built for top speed", mods: { speed: 1, accel: -1, weight: 1, handling: -1 }, offroad: 0.48 },
  { name: "Buggy", tag: "Grippy off-road buggy", mods: { speed: -1, accel: 1, weight: 0, handling: 1 }, offroad: 0.68 },
];

export const CC = { 50: 27, 100: 32, 150: 37, 200: 43 };
export const AI_SKILL = { 50: 0.88, 100: 0.94, 150: 0.972, 200: 1.0 };
export const POINTS = [15, 12, 10, 8, 6, 4, 2, 1];

export const ITEMS = {
  banana: { name: "Banana" },
  banana3: { name: "Triple Bananas" },
  green: { name: "Green Shell" },
  green3: { name: "Triple Green Shells" },
  red: { name: "Red Shell" },
  red3: { name: "Triple Red Shells" },
  blue: { name: "Blue Shell" },
  chili: { name: "Mushroom" },
  chili3: { name: "Triple Mushrooms" },
  golden: { name: "Golden Mushroom" },
  star: { name: "Star" },
  bullet: { name: "Bullet Bill" },
  bolt: { name: "Lightning" },
  splat: { name: "Blooper" },
  bomb: { name: "Bob-omb" },
  fire: { name: "Fire Flower" },
  boomerang: { name: "Boomerang Flower" },
  piranha: { name: "Piranha Plant" },
  horn: { name: "Super Horn" },
  boo: { name: "Boo" },
  coin: { name: "Coin" },
  eight: { name: "Crazy Eight" },
};

// The Crazy Eight's items, used in this order
export const EIGHT = ["star", "chili", "coin", "banana", "green", "red", "bomb", "splat"];

// Item odds by race position bucket.
const ODDS = [
  // leader
  { banana: 22, banana3: 8, green: 20, green3: 4, red: 4, chili: 6, splat: 7, coin: 14, horn: 8, bomb: 3, fire: 2, boomerang: 2 },
  // front of the pack
  { banana: 9, banana3: 8, green: 12, green3: 6, red: 18, red3: 4, chili: 10, chili3: 3, splat: 7, bomb: 5, fire: 5, boomerang: 5, piranha: 4, horn: 4, boo: 3, coin: 5, eight: 1, star: 2 },
  // middle
  { banana: 3, banana3: 4, green: 5, green3: 7, red: 11, red3: 10, chili: 7, chili3: 12, star: 6, splat: 5, bolt: 3, bomb: 5, fire: 5, boomerang: 4, piranha: 5, blue: 4, golden: 4, boo: 3, eight: 3, bullet: 2, horn: 2 },
  // back
  { red: 5, red3: 8, chili: 4, chili3: 17, star: 13, bolt: 8, blue: 4, golden: 12, bullet: 13, eight: 7, piranha: 4, boo: 3, fire: 2 },
];

// banned: items that can't come up right now (only one Blue Shell on the road at a time)
export function rollItem(placeFrac, rnd = Math.random, banned = null) {
  const b = placeFrac <= 0 ? 0 : placeFrac < 0.4 ? 1 : placeFrac < 0.75 ? 2 : 3;
  const table = ODDS[b];
  let total = 0;
  for (const k in table) if (!banned?.has(k)) total += table[k];
  let r = rnd() * total;
  for (const k in table) {
    if (banned?.has(k)) continue;
    r -= table[k];
    if (r <= 0) return k;
  }
  return "banana";
}

// The name a CPU racer goes by
export const botName = (charIndex) => CHARACTERS[charIndex].botName || CHARACTERS[charIndex].name;

// A racer's main colour (minimap dots and such); the Custom racer's is their paint.
export const racerColor = (charIndex, look) => (CHARACTERS[charIndex].custom && Number.isInteger(look?.paint) ? look.paint : CHARACTERS[charIndex].color);

export function kartStats(charIndex, kartIndex, cc, look) {
  const custom = CHARACTERS[charIndex].custom && cleanStats(look?.stats);
  const c = custom || CHARACTERS[charIndex].stats;
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
    sub: "Mind the gap, buddy",
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
    name: "Snowy Peak",
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
    name: "Sunshine Beach",
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
  {
    name: "Mars Aliens",
    sub: "Low gravity, close encounters",
    theme: "mars",
    boundary: "wall",
    width: 24,
    shoulder: 8,
    laps: 3,
    gravity: 0.6, // floaty jumps: karts fall at 60% of the usual rate
    points: [
      [0, -150, 0], [0, -60, 0], [-8, 20, 2], [-45, 75, 5], [-110, 100, 8], [-175, 80, 10], [-215, 25, 10],
      [-205, -35, 8], [-160, -60, 6], [-110, -50, 5], [-80, -90, 3], [-100, -150, 2], [-80, -205, 1],
      [-30, -225, 0], [10, -205, 0],
    ],
    boxes: [0.2, 0.5, 0.8],
    coins: [{ at: 0.16, lat: 0.4, n: 5 }, { at: 0.42, lat: -0.3, n: 5 }, { at: 0.68, lat: 0, n: 5 }, { at: 0.88, lat: 0.4, n: 4 }],
    boosts: [{ at: 0.3, lat: 0 }, { at: 0.56, lat: 0.3 }, { at: 0.93, lat: -0.3 }],
    ramps: [{ at: 0.075 }],
    gaps: [{ at: 0.083, len: 13 }],
    music: { bpm: 136, root: 58, mode: "dorian", seed: 67 },
  },
  {
    name: "Miami Vice",
    sub: "Neon, storms and go-fast boats",
    theme: "miami",
    boundary: "wall",
    width: 24,
    shoulder: 7,
    laps: 3,
    scale: 1.08,
    // Ocean Drive, then out over the bay on two causeways (the second one's drawbridge is up)
    points: [
      [0, -160, 0], [0, -40, 0], [5, 60, 0], [30, 110, 1], [90, 125, 3], [170, 120, 7], [240, 110, 3],
      [285, 70, 1], [280, 10, 1], [245, -25, 1], [190, -40, 5], [120, -50, 2], [80, -90, 1], [90, -150, 0],
      [60, -205, 0], [15, -215, 0],
    ],
    boxes: [0.2, 0.5, 0.8],
    coins: [{ at: 0.1, lat: 0.4, n: 5 }, { at: 0.38, lat: -0.3, n: 5 }, { at: 0.7, lat: 0.3, n: 5 }, { at: 0.86, lat: 0, n: 4 }],
    boosts: [{ at: 0.3, lat: 0 }, { at: 0.53, lat: -0.3 }, { at: 0.92, lat: 0.3 }],
    ramps: [{ at: 0.628 }],
    gaps: [{ at: 0.636, len: 10 }],
    music: { bpm: 116, root: 57, mode: "minor", seed: 83 },
  },
  {
    name: "Zoo City",
    sub: "Wave at the animals",
    theme: "zoo",
    boundary: "wall",
    width: 24,
    shoulder: 7,
    laps: 3,
    scale: 1.15,
    points: [
      [0, -160, 0], [0, -60, 0], [-20, 30, 1], [-80, 70, 2], [-150, 60, 2], [-190, 0, 2], [-160, -50, 2],
      [-110, -40, 1], [-70, -80, 0], [-90, -140, 0], [-150, -150, 1], [-190, -190, 2], [-150, -240, 1],
      [-80, -250, 0], [-20, -225, 0],
    ],
    boxes: [0.2, 0.5, 0.8],
    coins: [{ at: 0.16, lat: -0.4, n: 5 }, { at: 0.42, lat: 0.3, n: 5 }, { at: 0.62, lat: 0, n: 5 }, { at: 0.9, lat: -0.3, n: 4 }],
    boosts: [{ at: 0.4, lat: 0 }, { at: 0.7, lat: 0.3 }, { at: 0.95, lat: -0.3 }],
    ramps: [{ at: 0.1 }],
    gaps: [],
    music: { bpm: 130, root: 62, mode: "mixolydian", seed: 97 },
  },
];

// ---------------------------------------------------------------- beta
// Experiments, played from the 🧪 Beta screen. Beta tracks aren't in TRACKS (so no boards,
// cups, daily challenges or online races): they're numbered from BETA_BASE.

export const BETA_BASE = 100;
export const BETA_TRACKS = [
  {
    name: "Safari Run",
    sub: "Mind the wildlife",
    theme: "savanna",
    boundary: "wall",
    width: 22,
    shoulder: 7,
    laps: 3,
    scale: 1.05,
    points: [
      [0, -170, 0], [0, -60, 0], [10, 40, 1], [50, 110, 2], [120, 140, 3], [190, 120, 3], [230, 60, 2],
      [220, -10, 1], [170, -40, 0], [150, -90, 0], [180, -150, 1], [170, -220, 2], [110, -250, 2],
      [50, -235, 1], [15, -205, 0],
    ],
    boxes: [],
    coins: [],
    boosts: [{ at: 0.3, lat: 0.3 }, { at: 0.62, lat: -0.3 }],
    ramps: [],
    gaps: [],
    // Herds that walk across the road and back (js/sim/crossings.js)
    crossings: [
      { at: 0.1, kind: "zebra", n: 4, period: 16, phase: 3 },
      { at: 0.22, kind: "elephant", n: 2, period: 22, phase: 9 },
      { at: 0.37, kind: "lion", n: 1, period: 7, phase: 2 },
      { at: 0.5, kind: "giraffe", n: 3, period: 18, phase: 12 },
      { at: 0.69, kind: "zebra", n: 5, period: 19, phase: 7 },
      { at: 0.82, kind: "hippo", n: 2, period: 17, phase: 5 },
      { at: 0.93, kind: "lion", n: 2, period: 9, phase: 6 },
    ],
    music: { bpm: 126, root: 57, mode: "dorian", seed: 211 },
  },
];

// Any track by number: the regular ones, or a beta one
export const trackDef = (i) => (i >= BETA_BASE ? BETA_TRACKS[i - BETA_BASE] : TRACKS[i]);

export const CUPS = [{ name: "Chamo Cup", tracks: [0, 1, 2, 3, 4] }];
