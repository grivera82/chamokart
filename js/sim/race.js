// Race simulation: karts, items, rules, standings. Rendering-agnostic.
import { TRACKS, AI_SKILL } from "../data.js?v=3";
import { Track } from "./track.js?v=3";
import { Kart } from "./kart.js?v=3";
import { AIDriver } from "./ai.js?v=3";
import { ItemSystem } from "./items.js?v=3";

export const STEP = 1 / 120;
export const COUNTDOWN = 3.2; // seconds of 3-2-1 before GO

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const trackCache = new Map();
export function getTrack(index) {
  if (!trackCache.has(index)) trackCache.set(index, new Track(TRACKS[index]));
  return trackCache.get(index);
}

export class RaceSim {
  /**
   * opts: { track, laps, cc, mode, items, seed, grid: [{id,name,char,kart,human,bot,local}], netPrefix, introTime }
   * Grid order = starting order (index 0 = pole position).
   */
  constructor(opts) {
    this.opts = opts;
    this.trackIndex = opts.track;
    this.track = getTrack(opts.track);
    this.laps = opts.laps;
    this.cc = opts.cc;
    this.mode = opts.mode;
    this.rng = mulberry32(opts.seed ?? 1234);
    this.itemsEnabled = opts.items !== false && opts.mode !== "tt";
    this.coinsEnabled = opts.mode !== "tt";
    this.netPrefix = opts.netPrefix || "";
    this.time = -(COUNTDOWN + (opts.introTime ?? 3));
    this.phase = "intro";
    this.outbox = [];
    this.fx = [];
    this.finishCount = 0;
    this.acc = 0;

    const t = this.track;
    const n = opts.grid.length;
    this.karts = opts.grid.map((g, slot) => {
      const k = new Kart({ ...g, cc: opts.cc, track: t });
      const behind = 5 + slot * 3.1; // in samples
      const lat = (slot % 2 === 0 ? -1 : 1) * t.hw[0] * 0.42;
      k.placeOnGrid(-behind, n === 1 ? 0 : lat);
      k.place = slot + 1;
      return k;
    });
    this.kartMap = new Map(this.karts.map((k) => [k.id, k]));
    this.items = new ItemSystem(this);

    this.ais = new Map();
    const baseSkill = AI_SKILL[opts.cc] ?? 0.95;
    for (const k of this.karts) {
      if (k.local && !k.human) {
        const r = this.rng();
        const ai = new AIDriver(k, this.rng, Math.min(1, baseSkill + (r - 0.5) * 0.08));
        ai.baseMul = baseSkill - 0.035 + r * 0.045;
        ai.rocket = this.rng() < 0.2 + baseSkill * 0.5;
        this.ais.set(k.id, ai);
      }
    }
    this.updatePlaces();
    if (this.mode === "tt") {
      for (const k of this.karts) {
        k.item = "chili3";
        k.itemCount = 3;
      }
    }
  }

  kartById(id) {
    return this.kartMap.get(id);
  }

  emit(e) {
    this.outbox.push(e);
  }

  removeKart(id) {
    const i = this.karts.findIndex((k) => k.id === id);
    if (i >= 0) this.karts.splice(i, 1);
    this.kartMap.delete(id);
    this.ais.delete(id);
  }

  // Advance simulation by a real-time delta.
  update(dt) {
    this.acc += Math.min(dt, 0.1);
    let steps = 0;
    while (this.acc >= STEP && steps < 16) {
      this.step(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps >= 16) this.acc = 0;
  }

  step(dt) {
    const prevTime = this.time;
    this.time += dt;
    if (this.time < -COUNTDOWN) this.phase = "intro";
    else if (this.time < 0) this.phase = "countdown";
    else if (this.phase !== "done") this.phase = "race";

    // AI brains (also drives karts that have finished)
    for (const [id, ai] of this.ais) {
      const k = ai.kart;
      ai.think(dt, this);
      if (!k.finished) k.speedMul = ai.baseMul * (1 + this.rubberBand(k));
      else k.speedMul = 0.88;
    }

    if (this.time < 0) {
      // Countdown: engines rev, rocket start timing
      for (const k of this.karts) {
        if (!k.local) continue;
        const ai = this.ais.get(k.id);
        // Auto-accelerate (touch / setting) never counts as a press: no rocket, no burnout.
        const pressing = ai ? ai.rocket && this.time > -1.0 : k.ctl.throttle > 0 && !k.ctl.auto;
        if (pressing) {
          if (k.pressT == null) k.pressT = Math.max(this.time, -COUNTDOWN);
        } else k.pressT = null;
        k.revving = pressing;
      }
      return;
    }
    if (prevTime < 0) {
      for (const k of this.karts) {
        if (!k.local || k.pressT == null) continue;
        if (k.pressT < -2.0) {
          k.spinT = 0.6;
          k.events.push("burnout");
        } else if (k.pressT >= -1.25 && k.pressT <= -0.3) {
          k.boost(1.25, 1.35);
          k.events.push("rocket");
        }
      }
    }

    for (const k of this.karts) if (k.local) k.step(dt, this);
    this.items.update(dt);
    this.collide();

    // Finish line
    for (const k of this.karts) {
      if (!k.local || k.finished) continue;
      if (k.dist >= this.laps * this.track.N) this.finishKart(k, this.time);
    }
    this.updatePlaces();
  }

  finishKart(k, time) {
    if (k.finished) return;
    k.finished = true;
    k.finishTime = time;
    k.item = null;
    k.roulette = 0;
    this.finishCount++;
    k.events.push("finish");
    if (k.local) this.emit({ type: "fin", id: k.id, time });
    if (k.human && k.local && !this.ais.has(k.id)) {
      // Autopilot takes the wheel after the finish.
      const ai = new AIDriver(k, this.rng, 0.8);
      ai.baseMul = 0.88;
      ai.useItems = () => {
        k.ctl.item = false;
      };
      this.ais.set(k.id, ai);
    }
  }

  rubberBand(k) {
    if (this.mode === "attract") return 0;
    let ref = -Infinity;
    for (const o of this.karts) if (o.human && !o.bot) ref = Math.max(ref, o.dist);
    if (ref === -Infinity) return 0;
    const gapUnits = (ref - k.dist) * this.track.spacing;
    const strength = { 50: 0.6, 100: 0.8, 150: 1, 200: 1 }[this.cc] ?? 1;
    return Math.max(-0.07, Math.min(0.11, gapUnits / 380)) * strength;
  }

  collide() {
    const ks = this.karts;
    for (let i = 0; i < ks.length; i++) {
      const a = ks[i];
      if (a.respawnT > 0) continue;
      for (let j = i + 1; j < ks.length; j++) {
        const b = ks[j];
        if (b.respawnT > 0 || (!a.local && !b.local)) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const r = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r || Math.abs(a.y - b.y) > 2) continue;
        const d = Math.sqrt(d2) || 0.01;
        const nx = dx / d, nz = dz / d;
        const overlap = r - d;
        // Star / size effects (victim decides, so only for local victims)
        const aBig = a.starT > 0 || (a.shrinkT <= 0 && b.shrinkT > 0);
        const bBig = b.starT > 0 || (b.shrinkT <= 0 && a.shrinkT > 0);
        if (a.starT > 0 && b.starT <= 0 && b.local) b.hit("tumble");
        else if (b.starT > 0 && a.starT <= 0 && a.local) a.hit("tumble");
        else if (aBig && b.shrinkT > 0 && b.local) b.hit("squish");
        else if (bBig && a.shrinkT > 0 && a.local) a.hit("squish");

        const wa = a.stats.weight * a.scale * (a.starT > 0 ? 3 : 1);
        const wb = b.stats.weight * b.scale * (b.starT > 0 ? 3 : 1);
        const fa = wb / (wa + wb), fb = wa / (wa + wb);
        if (a.local) {
          a.x -= nx * overlap * fa;
          a.z -= nz * overlap * fa;
        }
        if (b.local) {
          b.x += nx * overlap * fb;
          b.z += nz * overlap * fb;
        }
        const rvx = b.vx - a.vx, rvz = b.vz - a.vz;
        const vn = rvx * nx + rvz * nz;
        const bump = Math.max(0, -vn) + 5;
        if (a.local) {
          a.vx -= nx * bump * fa;
          a.vz -= nz * bump * fa;
          if (!a.bumpT) {
            a.events.push("bump");
            a.bumpT = 0.35;
          }
        }
        if (b.local) {
          b.vx += nx * bump * fb;
          b.vz += nz * bump * fb;
          if (!b.bumpT) {
            b.events.push("bump");
            b.bumpT = 0.35;
          }
        }
      }
    }
  }

  updatePlaces() {
    const sorted = [...this.karts].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.dist - a.dist;
    });
    sorted.forEach((k, i) => (k.place = i + 1));
    this.standings = sorted;
  }

  // Estimated finishing time for karts still racing (used when the race is cut short).
  estimateFinish(k) {
    if (k.finished) return k.finishTime;
    const remaining = Math.max(0, this.laps * this.track.N - k.dist) * this.track.spacing;
    return this.time + remaining / (k.stats.maxSpeed * 0.86);
  }

  allHumansFinished() {
    const humans = this.karts.filter((k) => k.human);
    return humans.length > 0 && humans.every((k) => k.finished);
  }

  takeEvents() {
    const ev = [];
    for (const k of this.karts) {
      for (const e of k.events) ev.push({ kart: k, e });
      k.events.length = 0;
    }
    return ev;
  }
}
