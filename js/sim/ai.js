// CPU driver: follows a racing line, drifts through corners, dodges hazards
// and uses items with a little personality.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class AIDriver {
  constructor(kart, rng, skill = 1) {
    this.kart = kart;
    this.rng = rng;
    this.skill = skill;
    this.bias = (rng() - 0.5) * 0.5;
    this.biasTarget = this.bias;
    this.biasTimer = 0;
    this.itemTimer = 1 + rng() * 3;
    this.stuckT = 0;
    this.reverseT = 0;
    this.reverseSteer = 1;
    this.driftHold = 0;
    this.chiliGap = 0;
    this.aggression = 0.4 + rng() * 0.6;
    this.wantDrift = 0;
    this.driftCooldown = 0;
    this.p = {};
  }

  think(dt, race) {
    const k = this.kart;
    const t = k.track;
    const c = k.ctl;
    const q = k.q;
    const N = t.N;
    const vf = k.fwdSpeed;

    // Wander our preferred lane a bit so the pack spreads out.
    this.biasTimer -= dt;
    if (this.biasTimer <= 0) {
      this.biasTimer = 2 + this.rng() * 4;
      this.biasTarget = (this.rng() - 0.5) * 0.7;
    }
    this.bias += (this.biasTarget - this.bias) * Math.min(1, dt * 0.8);

    // Look-ahead target on the racing line
    const lookUnits = 9 + Math.max(0, vf) * 0.36;
    const ahead = Math.round(lookUnits / t.spacing);
    const ti = (q.idx + ahead) % N;
    const hw = t.hw[ti];
    const margin = t.boundary === "void" ? 3.5 : 2;
    let lat = t.line[ti] * (0.55 + 0.45 * this.skill) + this.bias * hw;

    // Dodge hazards and karts directly ahead
    const fx = Math.sin(k.yaw), fz = Math.cos(k.yaw);
    let dodge = 0;
    for (const o of race.items.objects) {
      if (o.type !== "banana" && !(o.type === "green" && o.owner !== k.id)) continue;
      const dx = o.x - k.x, dz = o.z - k.z;
      const fwd = dx * fx + dz * fz;
      if (fwd < 2 || fwd > 32) continue;
      const side = dx * -fz + dz * fx;
      if (Math.abs(side) < 3.2) dodge += (side >= 0 ? -1 : 1) * (3.5 - Math.abs(side)) * (this.skill * 1.2);
    }
    for (const o of race.karts) {
      if (o === k || o.respawnT > 0) continue;
      const dx = o.x - k.x, dz = o.z - k.z;
      const fwd = dx * fx + dz * fz;
      if (fwd < 1 || fwd > 12) continue;
      const side = dx * -fz + dz * fx;
      if (Math.abs(side) < 2.6 && o.fwdSpeed < vf - 2) dodge += (side >= 0 ? -1 : 1) * 1.5;
    }
    lat += dodge;
    // Grab item boxes when we have nothing
    if (!k.item && !k.roulette) {
      for (const b of race.items.boxes) {
        if (!b.active) continue;
        const d = t.delta(q.idx, b.i);
        if (d > 3 && d < ahead + 14) {
          lat += (b.lat - lat) * 0.5;
          break;
        }
      }
    }
    lat = clamp(lat, -hw + margin, hw - margin);

    const p = t.pointAt(ti, lat, this.p);
    const dx = p.x - k.x, dz = p.z - k.z;
    const dl = Math.hypot(dx, dz) || 1;
    const right = (dx * -fz + dz * fx) / dl;
    const fwd = (dx * fx + dz * fz) / dl;
    const angle = Math.atan2(right, fwd);
    let steer = clamp(angle * 2.4, -1, 1);

    // Drifting through sharp corners
    const turn = t.turnAhead(q.idx, 2, 22);
    this.driftCooldown -= dt;
    const sharp = Math.abs(turn) > 0.55;
    let drift = false;
    if (k.drifting) {
      const remaining = t.turnAhead(q.idx, 0, 10);
      this.driftHold += dt;
      const turnDone = Math.abs(remaining) < 0.18 || Math.sign(remaining) !== k.driftDir;
      drift = !(turnDone && this.driftHold > 0.4) && !(k.driftLevel >= 2 && Math.abs(remaining) < 0.3);
      if (Math.abs(angle) > 0.9) drift = false;
      // Over-rotating into the inside of the corner: bail out.
      if (angle * k.driftDir < -0.35 && this.driftHold > 0.25) drift = false;
      if (q.lateral * k.driftDir > hw - margin - 1) drift = false;
      if (!drift) {
        this.wantDrift = 0;
        this.driftCooldown = 0.7;
      }
      // steer within the drift: keep the line
      steer = clamp(angle * 3 * k.driftDir, -1, 1) * k.driftDir;
    } else if (this.wantDrift > 0) {
      this.wantDrift -= dt;
      drift = true;
      steer = Math.sign(turn) || steer;
    } else if (sharp && vf > 20 && this.skill > 0.5 && k.grounded && this.driftCooldown <= 0 && this.rng() < 0.2 + this.skill * 0.5) {
      drift = true;
      this.wantDrift = 0.45;
      this.driftHold = 0;
      steer = Math.sign(turn) || steer;
    }

    // Stuck / reversed recovery
    if (vf < 2.5 && race.time > 1.5 && !k.disabled) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt);
    if (this.stuckT > 1.2 && this.reverseT <= 0) {
      this.reverseT = 0.9;
      this.reverseSteer = -Math.sign(angle || 1);
      this.stuckT = 0;
    }
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      c.throttle = 0;
      c.brake = 1;
      c.steer = this.reverseSteer;
      c.drift = false;
      c.item = false;
      return;
    }

    // Corner speed: don't carry more speed than we can turn with.
    let maxC = 0;
    const span = Math.round((12 + vf * 0.9) / t.spacing);
    for (let j = 2; j < span; j++) maxC = Math.max(maxC, Math.abs(t.curv[(q.idx + j) % N]));
    const cap = k.stats.turn * 0.78 * (this.skill > 0.6 ? 1.3 : 1.05) * (t.boundary === "void" ? 0.92 : 1);
    const vMax = maxC > 1e-4 ? cap / maxC : 999;
    c.throttle = vf > vMax * 1.05 ? 0 : 1;
    c.brake = (Math.abs(angle) > 1.3 && vf > 15) || vf > vMax * 1.3 ? 1 : 0;
    if (c.brake) c.throttle = 0;
    c.steer = steer;
    c.drift = drift;

    this.useItems(dt, race);
  }

  useItems(dt, race) {
    const k = this.kart;
    const c = k.ctl;
    c.item = false;
    c.itemBack = false;
    if (!k.item || k.roulette > 0 || race.phase !== "race") return;
    this.itemTimer -= dt;
    this.chiliGap -= dt;
    const t = k.track;
    const fx = Math.sin(k.yaw), fz = Math.cos(k.yaw);
    const behindClose = race.karts.some((o) => {
      if (o === k) return false;
      const dx = o.x - k.x, dz = o.z - k.z;
      const f = dx * fx + dz * fz;
      return f < -2 && f > -16 && Math.abs(dx * -fz + dz * fx) < 4;
    });
    const targetAhead = race.karts.some((o) => {
      if (o === k) return false;
      const dx = o.x - k.x, dz = o.z - k.z;
      const f = dx * fx + dz * fz;
      return f > 4 && f < 45 && Math.abs(dx * -fz + dz * fx) < f * 0.18 + 1;
    });
    const straight = Math.abs(t.turnAhead(k.q.idx, 0, 25)) < 0.35;
    let use = false, back = false;
    switch (k.item) {
      case "banana":
        if (behindClose && this.rng() < dt * 3) use = true;
        else if (this.itemTimer < -4) use = true;
        break;
      case "green":
        if (targetAhead && this.rng() < dt * 2 * this.aggression) use = true;
        else if (behindClose && this.rng() < dt * 1.5) { use = true; back = true; }
        else if (this.itemTimer < -8) use = true;
        break;
      case "red":
        if (k.place > 1 && this.itemTimer < 0) use = true;
        else if (k.place === 1 && behindClose) { use = true; back = true; }
        else if (this.itemTimer < -10) use = true;
        break;
      case "chili":
      case "chili3":
        if (this.chiliGap <= 0 && (straight || k.offroad) && this.itemTimer < 0) use = true;
        break;
      case "star":
        use = this.itemTimer < 1;
        break;
      case "bolt":
      case "splat":
        use = this.itemTimer < 0;
        break;
    }
    if (use) {
      c.item = true;
      c.itemBack = back;
      this.itemTimer = 0.5 + this.rng() * 3;
      this.chiliGap = 1.1;
    }
  }
}
