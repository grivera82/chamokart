// Daily challenge: one track, racer, kart and speed class a day, the same for everyone.
// Days are UTC dates ("2026-09-27"). The server imports this file too, to check that a
// submitted run is for today's challenge, so it must not import anything.
export const DAILY_LAPS = 3;
const CHAR_COUNT = 8;
const KART_COUNT = 3;
const CC_CHOICES = [100, 150, 150, 200];
const DAY_MS = 86400000;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const dailyId = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
export const msToNextDaily = (ms = Date.now()) => DAY_MS - (ms % DAY_MS);
function dayNumber(id) {
  return Math.floor(Date.parse(id + "T00:00:00Z") / DAY_MS);
}
export const isDailyId = (id) => typeof id === "string" && /^\d{4}-\d{2}-\d{2}$/.test(id) && dailyId(dayNumber(id) * DAY_MS) === id;

// Tracks come in shuffled blocks (one of each track), so every track shows up once per
// block and never two days running. Each new track starts a new era on the day after it
// ships; earlier days keep their own rotation so their boards stay valid. Never edit a
// past era: add a new one.
const ERAS = [
  { from: -Infinity, count: 5, seed: 101 },
  { from: dayNumber("2026-09-27"), count: 6, seed: 202 }, // + Mars Aliens
  { from: dayNumber("2026-09-28"), count: 8, seed: 303 }, // + Miami Vice and Zoo City (both shipped before it began)
];
function trackOrder(block, count, seed) {
  const r = rng(block * 7919 + seed);
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function trackFor(day) {
  let era = ERAS.length - 1;
  while (day < ERAS[era].from) era--;
  const { from, count, seed } = ERAS[era];
  const d = era === 0 ? day : day - from;
  const block = Math.floor(d / count);
  const order = trackOrder(block, count, seed);
  // The track that ends the previous block (for an era's first block, the day before the era).
  const prev = era > 0 && block === 0 ? trackFor(from - 1) : trackOrder(block - 1, count, seed)[count - 1];
  if (order[0] === prev) [order[0], order[1]] = [order[1], order[0]];
  return order[d - block * count];
}

export function dailyChallenge(id = dailyId()) {
  const day = dayNumber(id);
  const r = rng(Math.imul(day, 2654435761) ^ 0x5eed);
  return {
    id,
    track: trackFor(day),
    char: Math.floor(r() * CHAR_COUNT),
    kart: Math.floor(r() * KART_COUNT),
    cc: CC_CHOICES[Math.floor(r() * CC_CHOICES.length)],
    laps: DAILY_LAPS,
  };
}
