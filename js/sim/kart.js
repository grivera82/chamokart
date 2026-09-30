// Arcade kart physics. Pure JS (no rendering).
import { kartStats } from "../data.js?v=17";

export const KART_RADIUS = 1.25;
export const GRAVITY = 30;
export const DRIFT_LEVELS = [1.05, 2.1, 3.3];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TAU = Math.PI * 2;

// Is a kart at track query q on a speed booster? (also used for other players' karts online)
export function onBoostPad(t, q) {
  for (const b of t.boosts) {
    const d = t.delta(b.i, q.s);
    if (d >= -0.5 && d <= b.len + 0.5 && Math.abs(q.lateral - b.lat * q.hw) < b.half) return true;
  }
  return false;
}

export class Kart {
  constructor({ id, name, char, kart, cc, track, human = false, bot = false, local = true, owner = null, look = null }) {
    this.id = id;
    this.name = name;
    this.char = char;
    this.kartType = kart;
    this.cc = cc;
    this.track = track;
    this.human = human;
    this.bot = bot;
    this.local = local;
    this.owner = owner;
    this.look = look; // the Custom racer's creation (js/look.js), if that's who this is
    this.stats = kartStats(char, kart, cc, look);
    this.speedMul = 1; // AI skill / rubber band
    this.ctl = { throttle: 0, brake: 0, steer: 0, drift: false, item: false, itemBack: false };
    this.prevDrift = false;
    this.prevItem = false;
    this.special = false; // D-key toggle: CX-9 doors open, Bumblebee in robot mode
    this.events = [];
    this.q = {};
    this.reset();
  }

  reset() {
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.yaw = 0;
    this.grounded = true;
    this.airT = 0;
    this.drifting = false;
    this.driftDir = 0;
    this.driftCharge = 0;
    this.driftLevel = 0;
    this.driftArmed = false;
    this.boostT = 0;
    this.boostPower = 1;
    this.starT = 0;
    this.shrinkT = 0;
    this.squishT = 0;
    this.spinT = 0;
    this.tumbleT = 0;
    this.invulnT = 0;
    this.splatT = 0;
    this.bulletT = 0; // Bullet Bill autopilot
    this.booT = 0; // Boo: invisible, items and karts go right through
    this.piranhaT = 0; // a Piranha Plant on the bumper, chomping whatever's in front
    this.chompCd = 0;
    this.respawnT = 0;
    this.respawnTo = null;
    this.trickWindow = 0;
    this.trickT = 0;
    this.trickDone = false;
    this.item = null;
    this.itemCount = 0;
    this.itemT = 0; // time left on a Golden Mushroom or Fire Flower once it's switched on
    this.fireCd = 0;
    this.orbitIds = []; // the cocos circling this kart as a shield, while it holds green or triple ones
    this.trailId = null; // a banana or red coco held behind the kart as a shield
    this.trailItem = null;
    this.roulette = 0;
    this.pendingItem = null;
    this.pendingCount = 0;
    this.coins = 0;
    this.dist = 0;
    this.prevS = 0;
    this.lap = 1;
    this.finished = false;
    this.finishTime = 0;
    this.place = 1;
    this.lastSafe = 0;
    this.wrongT = 0;
    this.offroad = false;
    this.onBoostPad = false;
    this.fwdSpeed = 0;
    this.steerVis = 0;
    this.pitch = 0;
    this.wallHitT = 0;
    this.hint = -1;
  }

  // Put the kart on the grid at fractional sample s (may be negative) with lateral offset.
  placeOnGrid(s, lateral) {
    const t = this.track;
    const p = t.pointAtS(s, lateral);
    this.x = p.x; this.z = p.z;
    this.yaw = p.yaw;
    this.hint = t.wrap(Math.floor(s));
    t.query(this.x, this.z, this.hint, this.q);
    this.y = this.q.height;
    this.prevS = this.q.s;
    this.dist = t.delta(0, this.q.s);
    if (this.dist > 0) this.dist -= t.N;
    this.lastSafe = this.q.idx;
  }

  get scale() {
    return this.shrinkT > 0 ? 0.55 : 1;
  }

  get radius() {
    return KART_RADIUS * this.scale;
  }

  // Nothing can hurt a kart under a Star or inside a Bullet Bill
  get armored() {
    return this.starT > 0 || this.bulletT > 0;
  }

  get disabled() {
    return this.spinT > 0 || this.tumbleT > 0 || this.respawnT > 0;
  }

  forwardSpeed() {
    return this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw);
  }

  boost(time, power = 1.28, silent = false) {
    if (this.boostT <= 0 || power >= this.boostPower) this.boostPower = power;
    this.boostT = Math.max(this.boostT, time);
    if (!silent) this.events.push("boost");
  }

  endDrift(release) {
    if (!this.drifting) return;
    const lvl = this.driftLevel;
    this.drifting = false;
    this.driftDir = 0;
    this.driftCharge = 0;
    this.driftLevel = 0;
    if (release && lvl > 0) {
      this.boost([0, 0.6, 1.05, 1.6][lvl], 1.27);
      this.events.push("miniturbo" + lvl);
    }
  }

  // kind: 'spin' | 'tumble' | 'squish' | 'blast' (a Blue Shell: a bigger, longer tumble)
  hit(kind) {
    if (this.armored || this.booT > 0 || this.invulnT > 0 || this.respawnT > 0 || this.finished) return false;
    this.endDrift(false);
    this.boostT = 0;
    if (kind === "blast") {
      this.tumbleT = 2;
      this.vy = 15;
      this.grounded = false;
      this.vx *= 0.05; this.vz *= 0.05;
      this.invulnT = 3;
      this.events.push("blasted");
      kind = "tumble";
    } else if (kind === "tumble") {
      this.tumbleT = 1.25;
      this.vy = 9;
      this.grounded = false;
      this.vx *= 0.2; this.vz *= 0.2;
      this.invulnT = 2.2;
    } else if (kind === "squish") {
      this.squishT = 2.2;
      this.spinT = 0.7;
      this.vx *= 0.4; this.vz *= 0.4;
      this.invulnT = 1.5;
    } else {
      this.spinT = 1.05;
      this.vx *= 0.45; this.vz *= 0.45;
      this.invulnT = 1.7;
    }
    const lost = Math.min(this.coins, kind === "tumble" ? 3 : 2);
    this.coins -= lost;
    this.events.push("hit:" + kind);
    return true;
  }

  zap(duration) {
    if (this.armored || this.booT > 0 || this.respawnT > 0 || this.finished) return false;
    this.shrinkT = Math.max(this.shrinkT, duration);
    this.endDrift(false);
    this.spinT = Math.max(this.spinT, 0.8);
    this.item = null;
    this.itemCount = 0;
    this.itemT = 0;
    this.roulette = 0;
    this.pendingItem = null;
    this.vx *= 0.5; this.vz *= 0.5;
    this.events.push("zap");
    return true;
  }

  startRespawn() {
    if (this.respawnT > 0) return;
    const t = this.track;
    const g = t.gapAt(this.q.idx ?? this.lastSafe);
    let target;
    if (g) target = t.wrap(g.start + g.len + 4);
    else target = this.lastSafe;
    this.respawnTo = target;
    this.respawnT = 1.8;
    this.respawnMoved = false;
    this.endDrift(false);
    this.events.push("fall");
  }

  step(dt, race) {
    const t = this.track;
    const c = this.ctl;
    const st = this.stats;

    // Timers
    this.boostT = Math.max(0, this.boostT - dt);
    this.starT = Math.max(0, this.starT - dt);
    this.shrinkT = Math.max(0, this.shrinkT - dt);
    this.squishT = Math.max(0, this.squishT - dt);
    this.spinT = Math.max(0, this.spinT - dt);
    this.tumbleT = Math.max(0, this.tumbleT - dt);
    this.invulnT = Math.max(0, this.invulnT - dt);
    this.splatT = Math.max(0, this.splatT - dt);
    this.booT = Math.max(0, this.booT - dt);
    this.piranhaT = Math.max(0, this.piranhaT - dt);
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.trickWindow = Math.max(0, this.trickWindow - dt);
    this.trickT = Math.max(0, this.trickT - dt);
    this.wallHitT = Math.max(0, this.wallHitT - dt);
    this.bumpT = Math.max(0, (this.bumpT || 0) - dt);

    if (this.respawnT > 0) return this.stepRespawn(dt);
    if (this.bulletT > 0) return this.stepBullet(dt, race);

    const disabled = this.disabled;
    let throttle = disabled ? 0 : c.throttle;
    let brake = disabled ? 0 : c.brake;
    let steer = disabled ? 0 : clamp(c.steer, -1, 1);
    if (this.splatT > 0 && !this.human) steer += Math.sin(race.time * 5 + this.char) * 0.25;

    // ---------------------------------------------------------- drift / hop
    const driftPressed = c.drift && !this.prevDrift;
    this.prevDrift = c.drift;
    if (driftPressed && !disabled) {
      if (this.grounded) {
        this.vy = 5.2;
        this.grounded = false;
        this.driftArmed = true;
        this.events.push("hop");
      } else if (this.trickWindow > 0 && !this.trickDone) {
        this.trickDone = true;
        this.trickT = 0.45;
        this.driftArmed = true;
        this.events.push("trick");
      } else {
        this.driftArmed = true;
      }
    }
    if (!c.drift) {
      if (this.drifting) this.endDrift(true);
      this.driftArmed = false;
    }
    let vf = this.forwardSpeed();
    if (this.driftArmed && !this.drifting && Math.abs(steer) > 0.3 && vf > 11 && !disabled) {
      this.drifting = true;
      this.driftDir = Math.sign(steer);
      this.driftCharge = 0;
      this.driftLevel = 0;
      this.driftArmed = false;
      this.events.push("driftStart");
    }
    if (this.drifting && (vf < 7 || disabled)) this.endDrift(false);

    // ---------------------------------------------------------- steering
    const maxBase = st.maxSpeed * this.speedMul;
    const speedF = clamp(Math.abs(vf) / 7, 0, 1) * (1 - 0.2 * clamp(Math.abs(vf) / (maxBase * 1.2), 0, 1));
    let yawRate;
    if (this.drifting) {
      const k = st.turn * (0.92 + 0.56 * steer * this.driftDir);
      yawRate = this.driftDir * k * Math.max(0.65, speedF);
      if (this.grounded) {
        this.driftCharge += dt * (0.85 + 0.75 * Math.max(0, steer * this.driftDir));
        const lvl = this.driftCharge >= DRIFT_LEVELS[2] ? 3 : this.driftCharge >= DRIFT_LEVELS[1] ? 2 : this.driftCharge >= DRIFT_LEVELS[0] ? 1 : 0;
        if (lvl > this.driftLevel) {
          this.driftLevel = lvl;
          this.events.push("driftLevel" + lvl);
        }
      }
    } else {
      yawRate = steer * st.turn * speedF * (vf >= -0.5 ? 1 : -1);
    }
    if (this.spinT > 0) yawRate = 0;
    if (!this.grounded) yawRate *= 0.45;
    this.yaw -= yawRate * dt;
    this.steerVis += (steer - this.steerVis) * Math.min(1, dt * 10);

    // ---------------------------------------------------------- speed
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = -fz, rz = fx;
    vf = this.vx * fx + this.vz * fz;
    let vl = this.vx * rx + this.vz * rz;

    let maxS = maxBase * (1 + this.coins * 0.005);
    if (this.shrinkT > 0) maxS *= 0.72;
    if (this.squishT > 0) maxS *= 0.6;
    if (this.starT > 0) maxS *= 1.14;
    const boosting = this.boostT > 0;
    this.offroad = this.grounded && !this.q.onRoad;
    if (this.offroad && !boosting && this.starT <= 0) maxS *= st.offroad;
    if (boosting) maxS *= this.boostPower;

    if (this.grounded) {
      if (throttle > 0) {
        if (vf < 0) vf += 40 * dt * throttle;
        else if (vf < maxS) vf += st.accel * throttle * dt * Math.max(0.12, 1 - (vf / maxS) ** 2);
      }
      if (brake > 0) {
        if (vf > 0.5) vf -= 40 * dt * brake;
        else if (throttle <= 0) vf = Math.max(-11, vf - 18 * dt * brake);
      }
      if (throttle <= 0 && brake <= 0) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 7 * dt);
      if (vf > maxS) vf -= (vf - maxS) * (this.offroad ? 3.2 : 1.3) * dt;
      if (boosting) vf = Math.min(maxS, vf + 70 * dt);
      if (this.spinT > 0 || this.tumbleT > 0) vf -= vf * 2.2 * dt;
    } else {
      vf -= vf * 0.05 * dt;
    }

    let grip = this.drifting ? 2.4 : this.offroad ? 7 : 11;
    if (this.spinT > 0) grip = 2.5;
    if (!this.grounded) grip = 0.6;
    const keep = Math.exp(-grip * dt);
    const lost = Math.abs(vl) * (1 - keep);
    const total = Math.hypot(vf, vl);
    vl *= keep;
    // Redirect some sideways momentum forward (never gaining energy).
    if (this.grounded && vf > 0) vf = Math.min(Math.sqrt(Math.max(0, total * total - vl * vl)), vf + lost * (this.drifting ? 0.9 : 0.75));

    this.vx = fx * vf + rx * vl;
    this.vz = fz * vf + rz * vl;
    this.fwdSpeed = vf;

    // ---------------------------------------------------------- integrate
    const prevY = this.y;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    const q = t.query(this.x, this.z, this.hint, this.q);
    this.hint = q.idx;

    // Walls
    if (t.boundary === "wall") {
      const wall = q.wall - this.radius;
      const al = Math.abs(q.lateral);
      if (al > wall) {
        const side = Math.sign(q.lateral);
        const ex = al - wall;
        this.x -= q.rx * side * ex;
        this.z -= q.rz * side * ex;
        const nx = q.rx * side, nz = q.rz * side;
        const vn = this.vx * nx + this.vz * nz;
        if (vn > 0) {
          this.vx -= nx * vn * 1.45;
          this.vz -= nz * vn * 1.45;
          const loss = 1 - Math.min(0.4, vn / 45);
          this.vx *= loss;
          this.vz *= loss;
          if (vn > 5 && this.wallHitT <= 0) {
            this.events.push("wall");
            this.wallHitT = 0.25;
          }
        }
        q.lateral = side * wall;
      }
    }

    // Vertical
    if (this.grounded) {
      if (!q.ground) {
        this.grounded = false;
        this.vy = Math.min(this.vy, 0);
      } else if (t.lip[q.idx] && vf > 5) {
        // Ramp launch
        this.grounded = false;
        this.y = q.height;
        const minV = maxBase * 0.82;
        if (vf < minV) {
          const k = minV / Math.max(1, vf);
          this.vx *= k; this.vz *= k;
          vf = minV;
        }
        this.vy = 8.5 + vf * 0.1;
        this.trickWindow = 0.6;
        this.trickDone = false;
        this.events.push("launch");
      } else {
        const vyNew = (q.height - prevY) / dt;
        if (this.vy - vyNew > 6.5 && this.vy > 1.5) {
          this.grounded = false; // crest: catch some air
          this.vy -= GRAVITY * t.gravity * dt;
          this.y = prevY + this.vy * dt;
        } else {
          this.y = q.height;
          this.vy = clamp(vyNew, -30, 30);
        }
      }
    }
    if (!this.grounded) {
      this.airT += dt;
      this.vy -= GRAVITY * t.gravity * dt;
      this.y += this.vy * dt;
      if (q.ground && this.y <= q.height) {
        this.y = q.height;
        if (this.vy < -8) this.events.push("land");
        this.vy = 0;
        this.grounded = true;
        if (this.trickDone && this.trickT <= 0.45) {
          this.boost(0.75, 1.3);
          this.events.push("trickBoost");
        }
        this.trickDone = false;
        this.trickWindow = 0;
        this.airT = 0;
      } else if (!q.ground && this.y < q.baseY - 14) {
        this.startRespawn();
      }
    }

    // Pitch (visual)
    const along = fx * q.tx + fz * q.tz;
    const targetPitch = this.grounded ? Math.atan(q.slope * along) : clamp(Math.atan2(this.vy, Math.max(8, Math.abs(vf))) * 0.5, -0.5, 0.5);
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 12);

    // Surface features
    if (this.grounded) {
      if (q.onRoad && !q.gap) this.lastSafe = q.idx;
      this.onBoostPad = onBoostPad(t, q);
      if (this.onBoostPad && this.boostT < 0.9) {
        this.boost(1.0, 1.36);
        this.events.push("pad");
      }
    }

    this.progress(q, race);

    // Wrong way
    if (along < -0.3 && vf > 4 && this.grounded) this.wrongT += dt;
    else this.wrongT = Math.max(0, this.wrongT - dt * 2);
  }

  progress(q, race) {
    const t = this.track;
    const ds = t.delta(this.prevS, q.s);
    this.dist += ds;
    this.prevS = q.s;
    const lapNow = Math.floor(Math.max(0, this.dist) / t.N) + 1;
    if (lapNow > this.lap && !this.finished && lapNow <= race.laps) {
      this.lap = lapNow;
      this.events.push("lap");
    }
  }

  // Bullet Bill: an autopilot that rockets down the road far faster than anyone can drive,
  // hovering straight over any gap, and only lets go of the wheel above solid road.
  stepBullet(dt, race) {
    const t = this.track;
    this.bulletT -= dt;
    this.drifting = false;
    this.driftArmed = false;
    const ahead = t.wrap(this.q.idx + Math.round(16 / t.spacing));
    const p = t.pointAt(ahead, t.line[ahead] * 0.35);
    let d = Math.atan2(p.x - this.x, p.z - this.z) - this.yaw;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    this.yaw += clamp(d, -3.5 * dt, 3.5 * dt);
    this.steerVis += (clamp(-d * 2, -1, 1) - this.steerVis) * Math.min(1, dt * 10);
    const speed = this.stats.maxSpeed * 1.6;
    this.vx = Math.sin(this.yaw) * speed;
    this.vz = Math.cos(this.yaw) * speed;
    this.fwdSpeed = speed;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    const q = t.query(this.x, this.z, this.hint, this.q);
    this.hint = q.idx;
    const floor = (q.ground ? q.height : q.baseY) + 0.9;
    this.y += (floor - this.y) * Math.min(1, dt * 8);
    this.vy = 0;
    this.grounded = true;
    this.airT = 0;
    this.pitch += (0 - this.pitch) * Math.min(1, dt * 8);
    this.offroad = false;
    this.onBoostPad = false;
    this.wrongT = 0;
    if (q.onRoad && !q.gap) this.lastSafe = q.idx;
    this.progress(q, race);
    if (this.bulletT <= 0) {
      if (!q.ground || q.gap || !q.onRoad || t.gapAt(t.wrap(q.idx + 4))) this.bulletT = 0.05; // not over a hole
      else {
        this.bulletT = 0;
        this.invulnT = 1;
        this.boost(0.8, 1.3, true);
        this.events.push("bulletEnd");
      }
    }
  }

  stepRespawn(dt) {
    const t = this.track;
    this.respawnT -= dt;
    if (!this.respawnMoved) {
      // Keep falling for a moment
      this.vy -= GRAVITY * t.gravity * dt;
      this.y += this.vy * dt;
      this.x += this.vx * dt * 0.5;
      this.z += this.vz * dt * 0.5;
      if (this.respawnT <= 1.0) {
        this.respawnMoved = true;
        const p = t.pointAt(this.respawnTo, 0);
        this.x = p.x; this.z = p.z; this.yaw = p.yaw;
        this.vx = 0; this.vz = 0; this.vy = 0;
        this.hint = this.respawnTo;
        t.query(this.x, this.z, this.hint, this.q);
        const ds = t.delta(this.prevS, this.q.s);
        this.dist += ds;
        this.prevS = this.q.s;
        this.y = this.q.height + 6;
      }
    } else {
      const targetY = this.q.height;
      this.y = targetY + Math.max(0, this.respawnT) * 6;
    }
    if (this.respawnT <= 0) {
      this.respawnT = 0;
      this.y = this.q.height;
      this.grounded = true;
      this.invulnT = 1.5;
      this.lastSafe = this.q.idx;
    }
  }
}
