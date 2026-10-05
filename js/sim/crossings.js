// Animal crossings (beta: Safari Run). Herds walk across the road and back on a fixed timetable,
// so every attempt plays out the same way and can be learned. Positions are a pure function of
// the race clock: the view draws them, and the sim checks if a kart ran into one.
import { CURB } from "./track.js?v=4";

// Footprint radius, walking speed and spacing in the herd (all in track units)
export const ANIMALS = {
  zebra: { r: 1.4, speed: 6.5, gap: 3.4, size: 1.25 },
  elephant: { r: 2.6, speed: 4, gap: 6, size: 1.15 },
  lion: { r: 1.3, speed: 12, gap: 4, size: 1.3 },
  giraffe: { r: 1.5, speed: 5, gap: 4.5, size: 1.05 },
  hippo: { r: 2.1, speed: 4.5, gap: 5, size: 1.2 },
};
const STANDOFF = 4; // how far beyond the wall a herd waits for its turn

export class Crossings {
  // defs: [{ at (lap fraction), kind, n (herd size), period (s, there and back), phase (s) }]
  constructor(track, defs) {
    this.track = track;
    this.list = defs.map((d) => {
      const a = ANIMALS[d.kind];
      const i = track.wrap(Math.round(d.at * track.N));
      const half = track.hw[i] + CURB + track.shoulder + STANDOFF;
      const span = 2 * half + (d.n - 1) * a.gap; // the head walks from -half to the far side until the last one is off the road
      return { ...d, ...a, i, half, span, walk: span / a.speed };
    });
    this.animals = [];
    this.list.forEach((c, ci) => {
      for (let j = 0; j < c.n; j++) this.animals.push({ c: ci, j, kind: c.kind, r: c.r, x: 0, y: 0, z: 0, yaw: 0, moving: false, lat: 0 });
    });
  }

  update(time) {
    const t = this.track;
    for (const a of this.animals) {
      const c = this.list[a.c];
      const half = c.period / 2;
      const u = (((time + c.phase) % c.period) + c.period) % c.period;
      const back = u >= half; // second half of the cycle: walking back
      const p = Math.min(1, (back ? u - half : u) / c.walk); // 0 → 1 across
      // The herd is a line, j places behind its head. Going there (+lat) the head leads; coming
      // back the whole line walks the same path in reverse, so the last one in goes first.
      const head = -c.half + (back ? 1 - p : p) * c.span;
      a.lat = head - a.j * c.gap;
      a.moving = p > 0 && p < 1;
      // Walk a little apart along the road too, so a herd looks like a herd
      const along = ((a.j % 3) - 1) * 1.2;
      const pt = t.pointAt(c.i, a.lat);
      a.x = pt.x + t.tx[c.i] * along;
      a.z = pt.z + t.tz[c.i] * along;
      // Hop over the low fence on the way in and out
      const wall = t.hw[c.i] + CURB + t.shoulder;
      const over = Math.abs(Math.abs(a.lat) - wall - 0.4);
      a.y = t.py[c.i] + (over < 1.8 ? Math.cos((over / 1.8) * Math.PI / 2) * 1.6 : 0);
      // Facing the way they walk; waiting, they face the road
      const across = Math.atan2(-t.tz[c.i], t.tx[c.i]); // yaw pointing to +lat
      const dir = a.moving ? (back ? -1 : 1) : a.lat > 0 ? -1 : 1;
      a.yaw = across + (dir > 0 ? 0 : Math.PI);
    }
  }

  // The animal a kart ran into, if any
  hit(k) {
    for (const a of this.animals) {
      const d = (k.x - a.x) ** 2 + (k.z - a.z) ** 2;
      if (d < (a.r + 0.9) ** 2 && Math.abs(k.y - a.y) < 3) return a;
    }
    return null;
  }

  // Distance (in samples) from track sample idx to the next crossing ahead, and which
  next(idx) {
    let best = null, bd = Infinity;
    for (const c of this.list) {
      const d = (((c.i - idx) % this.track.N) + this.track.N) % this.track.N;
      if (d < bd) (bd = d), (best = c);
    }
    return best && { c: best, d: bd };
  }
}
