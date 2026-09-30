// Race highlights. ReplayRecorder keeps the whole race (every kart 20 times a second, the live
// items and the visual events) and notes the best moments as they happen. ReplayPlayer plays
// the top few back with TV-style cameras and slow motion before the results screen.
import * as THREE from "three";
import { packKart, applyFlags } from "./net.js?v=7";

const HZ = 20;
const MAX_CLIPS = 3; // plus the finish
export const VISUAL = new Set(["wall", "land", "hit:spin", "hit:tumble", "hit:squish", "zap", "trick", "finish", "fall", "rocket", "miniturbo3", "chili", "pad", "trickBoost", "chomp", "bullet", "bulletEnd", "boo", "blasted"]);
const SLOW = new Set(["hit", "fall", "finish"]);
const r2 = (v) => Math.round(v * 100) / 100;
const ordinal = (n) => n + ((n % 100) - (n % 10) === 10 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");

// Put karts where two packed snapshots (see net.js packKart) say they are, blended by u.
// Used by the replay and by live spectating: karts driven this way behave like remote ones.
export function poseKarts(sim, A_, B_, u) {
  const bById = new Map(B_.map((arr) => [arr[0], arr]));
  for (const A of A_) {
    const k = sim.kartById(A[0]);
    if (!k) continue;
    const B = bById.get(A[0]) || A;
    let dy = B[4] - A[4];
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    k.x = A[1] + (B[1] - A[1]) * u;
    k.y = A[2] + (B[2] - A[2]) * u;
    k.z = A[3] + (B[3] - A[3]) * u;
    k.yaw = A[4] + dy * u;
    k.fwdSpeed = A[5];
    k.vx = Math.sin(k.yaw) * A[5];
    k.vz = Math.cos(k.yaw) * A[5];
    k.dist = A[7] + (B[7] - A[7]) * u;
    k.lap = A[8];
    k.pitch = A[9] || 0;
    k.steerVis = A[10] || 0;
    applyFlags(k, A[6]);
    k.finished = !!(A[6] & 512);
    sim.track.query(k.x, k.z, k.hint, k.q);
    k.hint = k.q.idx;
  }
}

export class ReplayRecorder {
  constructor(sim, meId) {
    this.sim = sim;
    this.meId = meId;
    this.frames = [];
    this.events = [];
    this.moments = [];
    this.acc = 0;
    this.leader = null;
    this.myPlace = null;
    this.airFrom = new Map(); // kart id -> time it left the ground
    this.tricked = new Set();
    this.threwAt = -1e9; // when we last threw a coco (to credit the hit to us)
  }

  moment(kind, t, k, score, text) {
    if (k.id === this.meId) score *= 1.6;
    this.moments.push({ kind, t, id: k.id, score, text });
  }

  record(dt, events) {
    const sim = this.sim;
    const t = sim.time;
    if (t < 0) return;
    const me = sim.kartById(this.meId);
    for (const { kart: k, e } of events) {
      if (VISUAL.has(e)) this.events.push({ t, id: k.id, e });
      if (k.id === this.meId && ["use:green", "use:red", "use:bomb", "use:boomerang", "use:fire"].includes(e)) this.threwAt = t;
      if (e === "blasted") this.moment("hit", t, k, 4.5, `The Blue Shell gets ${k.name}!`);
      else if (e === "hit:tumble" && me && k.id !== this.meId && t - this.threwAt < 4) this.moment("hit", t, k, 6, `${me.name} nails ${k.name}!`);
      else if (e === "hit:tumble") this.moment("hit", t, k, 2.5, `${k.name} gets hit by a shell!`);
      else if (e === "hit:spin") this.moment("hit", t, k, 2, `${k.name} spins out!`);
      else if (e === "hit:squish") this.moment("hit", t, k, 3, `${k.name} gets flattened!`);
      else if (e === "fall") this.moment("fall", t, k, 2, `${k.name} takes a dive!`);
      else if (e === "use:bolt") this.moment("item", t, k, 2.5, `${k.name} strikes with Lightning!`);
      else if (e === "use:star") this.moment("item", t, k, 1.5, `${k.name} goes superstar!`);
      else if (e === "bullet") this.moment("item", t, k, 2.5, `${k.name} fires off as a Bullet Bill!`);
      else if (e === "use:horn") this.moment("item", t, k, 2, `${k.name} blasts the Super Horn!`);
      else if (e === "trick") this.tricked.add(k.id);
    }
    // Airtime: a moment when a long jump lands
    for (const k of sim.karts) {
      if (!k.grounded && k.respawnT <= 0) {
        if (!this.airFrom.has(k.id)) this.airFrom.set(k.id, t);
      } else if (this.airFrom.has(k.id)) {
        const from = this.airFrom.get(k.id);
        this.airFrom.delete(k.id);
        const air = t - from;
        const trick = this.tricked.delete(k.id);
        if (air > 1 && k.respawnT <= 0) this.moment("air", from + air * 0.5, k, 1 + air * 0.6 + (trick ? 1 : 0), trick ? `${k.name} pulls a trick!` : `Big air for ${k.name}!`);
      }
    }
    this.acc += dt;
    if (this.frames.length && this.acc < 1 / HZ) return;
    this.acc = 0;
    this.frames.push({
      t,
      k: sim.karts.map(packKart),
      o: sim.items.objects.map((o) => [o.id, o.type, r2(o.x), r2(o.y), r2(o.z), o.orbit ? 1 : o.trail ? 2 : 0]),
    });
    // Lead changes and our own overtakes
    if (t > 4) {
      const lead = sim.karts.find((k) => k.place === 1);
      if (lead && this.leader && lead.id !== this.leader && !lead.finished) this.moment("lead", t, lead, 3, `${lead.name} takes the lead!`);
      if (me && this.myPlace && me.place < this.myPlace && me.place > 1 && !me.finished) this.moment("pass", t, me, 1.5, `${me.name} moves up to ${ordinal(me.place)}!`);
    }
    this.leader = sim.karts.find((k) => k.place === 1)?.id ?? null;
    if (me) this.myPlace = me.place;
  }

  // The best few moments (not overlapping) in race order, then the winner crossing the line.
  clips() {
    const f = this.frames;
    if (f.length < HZ * 8) return [];
    const first = f[0].t, last = f[f.length - 1].t;
    const finishers = this.sim.karts.filter((k) => k.finished && k.finishTime <= last).sort((a, b) => a.finishTime - b.finishTime);
    const clips = [];
    let fin = null;
    if (finishers.length) {
      const w = finishers[0];
      const photo = finishers[1] && finishers[1].finishTime - w.finishTime < 0.35;
      fin = { kind: "finish", t: w.finishTime, id: w.id, text: photo ? `📸 Photo finish! ${w.name} wins by a nose!` : `🏁 ${w.name} wins!` };
    }
    const picked = [];
    for (const m of [...this.moments].sort((a, b) => b.score - a.score)) {
      if (picked.length >= MAX_CLIPS) break;
      if (m.t - 2.2 < first || m.t + 1.6 > last) continue;
      if ([...picked, fin].some((c) => c && Math.abs(c.t - m.t) < 4.5)) continue;
      if (picked.some((c) => c.kind === m.kind && c.id === m.id)) continue; // variety: not the same thing twice
      picked.push(m);
    }
    picked.sort((a, b) => a.t - b.t);
    if (fin) picked.push(fin);
    picked.forEach((m, i) => {
      clips.push({ ...m, from: Math.max(first, m.t - (m.kind === "finish" ? 3 : 2.2)), to: Math.min(last, m.t + (m.kind === "finish" ? 2.2 : 1.6)), cam: m.kind === "finish" ? "finish" : ["side", "chase", "orbit"][i % 3] });
    });
    return clips;
  }
}

export class ReplayPlayer {
  // ui: { clip(i, n, text), sound(e), done() }
  constructor(session, recorder, clips, ui) {
    this.s = session;
    this.rec = recorder;
    this.clips = clips;
    this.ui = ui;
    this.i = -1;
    this.t = 0;
    this.camPos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    const sim = session.sim;
    // Everything we overwrite gets put back when the replay ends.
    this.saved = sim.karts.map((k) => ({ k, s: { ...k }, q: { ...k.q } }));
    this.savedFocus = session.view.focusId;
    this.next();
  }

  next() {
    this.i++;
    const c = this.clips[this.i];
    if (!c) return this.finish();
    this.t = c.from;
    this.anchor = null;
    this.orbit = 0;
    this.ui.clip(this.i, this.clips.length, c.text);
  }

  finish() {
    if (this.done) return;
    this.done = true;
    for (const { k, s, q } of this.saved) {
      Object.assign(k, s);
      Object.assign(k.q, q);
    }
    const view = this.s.view;
    view.focusId = this.savedFocus;
    view.replayObjects = null;
    view.camYaw = null;
    this.ui.done();
  }

  frameAt(t) {
    const f = this.rec.frames;
    let lo = 0, hi = f.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (f[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    return [f[lo], f[Math.min(f.length - 1, lo + 1)]];
  }

  update(dt) {
    if (this.done) return;
    const c = this.clips[this.i];
    const slow = SLOW.has(c.kind) && this.t > c.t - 0.5 && this.t < c.t + 0.8;
    const prev = this.t;
    this.t += dt * (slow ? 0.4 : 1);
    if (this.t >= c.to) return this.next();
    const sim = this.s.sim;
    const [a, b] = this.frameAt(this.t);
    const u = b.t > a.t ? Math.max(0, Math.min(1, (this.t - a.t) / (b.t - a.t))) : 0;
    poseKarts(sim, a.k, b.k, u);
    const view = this.s.view;
    view.replayObjects = a.o.map(([id, type, x, y, z, hold]) => ({ id, type, x, y, z, age: this.t, orbit: hold === 1, trail: hold === 2, owner: null }));
    view.focusId = c.id;
    const evs = [];
    for (const e of this.rec.events) {
      if (e.t > prev && e.t <= this.t) {
        const k = sim.kartById(e.id);
        if (k) {
          evs.push({ kart: k, e: e.e });
          if (k.id === c.id) this.ui.sound(e.e, k);
        }
      }
    }
    view.update(dt, evs);
    this.camera(dt, c);
  }

  // TV-style shots: a trackside camera that zooms to follow, a low chase cam, a slow orbit,
  // and for the finish, a camera beside the line.
  camera(dt, c) {
    const k = this.s.sim.kartById(c.id);
    if (!k) return;
    const cam = this.s.view.camera;
    const fx = Math.sin(k.yaw), fz = Math.cos(k.yaw);
    let fov = 60;
    if (c.cam === "side" || c.cam === "finish") {
      if (!this.anchor) {
        // Planted beside the road where the kart will be at the key moment
        const [f] = this.frameAt(c.t);
        const K = f.k.find((arr) => arr[0] === c.id) || [0, k.x, k.y, k.z, k.yaw];
        const t = this.s.sim.track;
        let px = K[1], py = K[2], pz = K[3], yaw = K[4];
        if (c.cam === "finish") {
          px = t.px[0]; py = t.py[0]; pz = t.pz[0];
          yaw = Math.atan2(t.tx[0], t.tz[0]);
        }
        const ax = Math.sin(yaw), az = Math.cos(yaw);
        const side = c.cam === "finish" ? 1 : this.i % 2 ? 1 : -1;
        const lat = c.cam === "finish" ? t.hw[0] + 3 : 8;
        this.anchor = new THREE.Vector3(px - az * lat * side + ax * 7, py + (c.cam === "finish" ? 2.2 : 3), pz + ax * lat * side + az * 7);
      }
      cam.position.copy(this.anchor);
      this.look.set(k.x, k.y + 1, k.z);
      const d = this.anchor.distanceTo(this.look);
      fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(5 / Math.max(1, d))), 14, 60); // keep the kart framed
    } else if (c.cam === "chase") {
      cam.position.set(k.x - fx * 5.5, k.y + 1.5, k.z - fz * 5.5);
      this.look.set(k.x + fx * 4, k.y + 1, k.z + fz * 4);
      fov = 70;
    } else {
      this.orbit += dt * 0.7;
      const a = k.yaw + 0.8 + this.orbit;
      cam.position.set(k.x + Math.sin(a) * 8, k.y + 3, k.z + Math.cos(a) * 8);
      this.look.set(k.x, k.y + 1, k.z);
      fov = 55;
    }
    cam.lookAt(this.look);
    cam.fov = fov;
    cam.updateProjectionMatrix();
  }
}
