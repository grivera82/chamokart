// Item boxes, coins and live item objects (bananas, cocos).
import { rollItem } from "../data.js?v=3";
import { GRAVITY } from "./kart.js?v=3";

const BOX_RESPAWN = 2.4;
const COIN_RESPAWN = 12;
const MAX_BANANAS = 40;

export class ItemSystem {
  constructor(race) {
    this.race = race;
    this.track = race.track;
    this.boxes = [];
    this.coins = [];
    this.objects = [];
    this.counter = 0;
    this.q = {};
    if (race.itemsEnabled) this.placeBoxes();
    if (race.coinsEnabled) this.placeCoins();
  }

  placeBoxes() {
    const t = this.track;
    for (const at of t.def.boxes || []) {
      const i = Math.round(at * t.N) % t.N;
      const hw = t.hw[i];
      const n = hw > 11 ? 5 : 4;
      for (let j = 0; j < n; j++) {
        const lat = (-0.72 + (1.44 * j) / (n - 1)) * hw;
        const p = t.pointAt(i, lat);
        this.boxes.push({ id: this.boxes.length, i, lat, x: p.x, y: p.y + 1.3, z: p.z, active: true, t: 0 });
      }
    }
  }

  placeCoins() {
    const t = this.track;
    for (const row of t.def.coins || []) {
      const i0 = Math.round(row.at * t.N);
      for (let j = 0; j < row.n; j++) {
        const i = t.wrap(i0 + j * 3);
        const p = t.pointAt(i, row.lat * t.hw[i]);
        this.coins.push({ id: this.coins.length, x: p.x, y: p.y + 0.9, z: p.z, active: true, t: 0 });
      }
    }
  }

  newId() {
    return `${this.race.netPrefix}${++this.counter}`;
  }

  update(dt) {
    const race = this.race;
    for (const b of this.boxes) {
      if (!b.active) {
        b.t -= dt;
        if (b.t <= 0) b.active = true;
      }
    }
    for (const c of this.coins) {
      if (!c.active) {
        c.t -= dt;
        if (c.t <= 0) c.active = true;
      }
    }

    for (const k of race.karts) {
      if (!k.local) continue;
      // Roulette
      if (k.roulette > 0) {
        k.roulette -= dt;
        if (k.roulette <= 0) {
          k.roulette = 0;
          k.item = k.pendingItem;
          k.itemCount = k.item === "chili3" ? 3 : 1;
          k.pendingItem = null;
          k.events.push("itemReady");
        }
      }
      if (k.respawnT > 0) continue;
      // Pickups
      for (const b of this.boxes) {
        if (!b.active) continue;
        const dx = b.x - k.x, dy = b.y - k.y, dz = b.z - k.z;
        if (dx * dx + dz * dz < (1.9 + k.radius) ** 2 && Math.abs(dy) < 3) {
          b.active = false;
          b.t = BOX_RESPAWN;
          race.emit({ type: "box", i: b.id });
          race.fx.push({ type: "boxBreak", x: b.x, y: b.y, z: b.z });
          if (!k.item && k.roulette <= 0 && !k.finished) {
            const n = race.karts.length;
            const frac = n > 1 ? (k.place - 1) / (n - 1) : 0.5;
            k.pendingItem = rollItem(frac, race.rng);
            k.roulette = k.human ? 1.3 : 0.9;
            k.events.push("roulette");
          }
        }
      }
      for (const c of this.coins) {
        if (!c.active) continue;
        const dx = c.x - k.x, dz = c.z - k.z;
        if (dx * dx + dz * dz < (1.2 + k.radius) ** 2 && Math.abs(c.y - k.y) < 3) {
          c.active = false;
          c.t = COIN_RESPAWN;
          if (k.coins < 10) k.coins++;
          k.events.push("coin");
          if (k.boostT < 0.2) k.boost(0.2, 1.08, true);
        }
      }
      // Use item
      const pressed = k.ctl.item && !k.prevItem;
      k.prevItem = k.ctl.item;
      if (pressed && k.item && k.roulette <= 0 && !k.disabled && race.phase === "race") this.useItem(k, k.ctl.itemBack);
    }

    this.updateObjects(dt);
  }

  useItem(k, back) {
    const race = this.race;
    const fx = Math.sin(k.yaw), fz = Math.cos(k.yaw);
    const item = k.item;
    k.itemCount--;
    if (k.itemCount <= 0) {
      k.item = null;
      k.itemCount = 0;
    }
    k.events.push("use:" + item);
    switch (item) {
      case "banana": {
        const o = this.spawn({ type: "banana", x: k.x - fx * 2.6, y: k.y + 0.6, z: k.z - fz * 2.6, vx: 0, vz: 0, vy: 2, owner: k.id });
        this.emitSpawn(o);
        break;
      }
      case "green":
      case "red": {
        const vf = Math.max(0, k.fwdSpeed);
        const dir = back ? -1 : 1;
        const speed = back ? 50 : Math.max(60, vf + 24);
        let target = null;
        if (item === "red" && !back) {
          const ahead = race.karts.find((o) => o.place === k.place - 1);
          target = ahead ? ahead.id : null;
        }
        const o = this.spawn({
          type: item === "red" && !back ? "red" : "green",
          x: k.x + fx * 2.6 * dir,
          y: k.y + 0.5,
          z: k.z + fz * 2.6 * dir,
          vx: fx * speed * dir,
          vz: fz * speed * dir,
          vy: 0,
          owner: k.id,
          target,
        });
        this.emitSpawn(o);
        break;
      }
      case "chili":
      case "chili3":
        k.boost(1.4, 1.42);
        k.events.push("chili");
        break;
      case "star":
        k.starT = 8;
        k.events.push("star");
        break;
      case "bolt":
        this.applyBolt(k.id);
        race.emit({ type: "bolt", from: k.id });
        break;
      case "splat":
        this.applySplat(k.id, k.dist);
        race.emit({ type: "splat", from: k.id, dist: k.dist });
        break;
    }
  }

  applyBolt(fromId) {
    const race = this.race;
    const n = race.karts.length;
    for (const o of race.karts) {
      if (o.id === fromId || !o.local) continue;
      const frac = n > 1 ? (o.place - 1) / (n - 1) : 0;
      o.zap(3.2 + 3.5 * (1 - frac));
    }
    race.fx.push({ type: "bolt" });
  }

  applySplat(fromId, dist) {
    const race = this.race;
    for (const o of race.karts) {
      if (o.id === fromId || !o.local) continue;
      if (o.dist > dist && o.starT <= 0) {
        o.splatT = 5;
        o.events.push("splat");
      }
    }
    race.fx.push({ type: "splatThrow", from: fromId });
  }

  spawn(o) {
    o.id = o.id || this.newId();
    o.age = 0;
    o.life = o.type === "banana" ? 1e9 : o.type === "red" ? 14 : 10;
    o.bounces = 0;
    o.hint = -1;
    o.grounded = o.type !== "banana";
    o.dead = false;
    this.objects.push(o);
    const bananas = this.objects.filter((b) => b.type === "banana");
    if (bananas.length > MAX_BANANAS) this.remove(bananas[0].id);
    return o;
  }

  emitSpawn(o) {
    this.race.emit({
      type: "spawn",
      o: { id: o.id, type: o.type, x: +o.x.toFixed(2), y: +o.y.toFixed(2), z: +o.z.toFixed(2), vx: +o.vx.toFixed(2), vz: +o.vz.toFixed(2), vy: o.vy, owner: o.owner, target: o.target ?? null },
    });
  }

  remove(id) {
    const i = this.objects.findIndex((o) => o.id === id);
    if (i >= 0) this.objects.splice(i, 1);
  }

  updateObjects(dt) {
    const race = this.race;
    const t = this.track;
    const q = this.q;
    for (const o of this.objects) {
      o.age += dt;
      o.life -= dt;
      if (o.life <= 0) {
        o.dead = true;
        continue;
      }
      if (o.type === "banana") {
        if (!o.grounded) {
          o.vy -= GRAVITY * dt;
          o.x += o.vx * dt;
          o.z += o.vz * dt;
          o.y += o.vy * dt;
          t.query(o.x, o.z, o.hint, q);
          o.hint = q.idx;
          if (q.ground && o.y <= q.height + 0.35) {
            o.y = q.height + 0.35;
            o.grounded = true;
          } else if (!q.ground && o.y < q.baseY - 12) o.dead = true;
        }
        continue;
      }
      if (o.type === "red") {
        const tgt = o.target ? race.kartById(o.target) : null;
        t.query(o.x, o.z, o.hint, q);
        let ax, az;
        const dx = tgt ? tgt.x - o.x : 0, dz = tgt ? tgt.z - o.z : 0;
        const close = tgt && !tgt.finished && tgt.respawnT <= 0 && dx * dx + dz * dz < 28 * 28;
        if (close) {
          ax = dx; az = dz;
        } else {
          const p = t.pointAt(q.idx + 7, 0);
          ax = p.x - o.x; az = p.z - o.z;
        }
        const speed = 58;
        const cur = Math.atan2(o.vx, o.vz);
        const want = Math.atan2(ax, az);
        let d = want - cur;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        const turn = Math.max(-7 * dt, Math.min(7 * dt, d));
        o.vx = Math.sin(cur + turn) * speed;
        o.vz = Math.cos(cur + turn) * speed;
      }
      o.x += o.vx * dt;
      o.z += o.vz * dt;
      t.query(o.x, o.z, o.hint, q);
      o.hint = q.idx;
      if (t.boundary === "wall") {
        const wall = q.wall - 0.7;
        if (Math.abs(q.lateral) > wall) {
          const side = Math.sign(q.lateral);
          const nx = q.rx * side, nz = q.rz * side;
          const ex = Math.abs(q.lateral) - wall;
          o.x -= nx * ex;
          o.z -= nz * ex;
          const vn = o.vx * nx + o.vz * nz;
          if (vn > 0) {
            o.vx -= 2 * vn * nx;
            o.vz -= 2 * vn * nz;
            if (o.type === "green") o.bounces++;
          }
          if (o.bounces > 7) o.dead = true;
        }
      } else if (o.type === "red" && Math.abs(q.lateral) > q.hw) {
        // Red cocos hug the road on void tracks
        const side = Math.sign(q.lateral);
        o.x -= q.rx * side * (Math.abs(q.lateral) - q.hw);
        o.z -= q.rz * side * (Math.abs(q.lateral) - q.hw);
      }
      if (q.ground && o.grounded) {
        o.y = q.height + 0.55;
      } else {
        o.grounded = false;
        o.vy -= GRAVITY * dt;
        o.y += o.vy * dt;
        if (q.ground && o.y <= q.height + 0.55) {
          o.y = q.height + 0.55;
          o.vy = 0;
          o.grounded = true;
        } else if (o.y < q.baseY - 12) o.dead = true;
      }
    }

    // Object vs object
    const objs = this.objects;
    for (let i = 0; i < objs.length; i++) {
      const a = objs[i];
      if (a.dead || a.type === "banana") continue;
      for (let j = 0; j < objs.length; j++) {
        if (i === j) continue;
        const b = objs[j];
        if (b.dead || (b.type !== "banana" && j < i)) continue;
        if (a.age < 0.15 && b.owner === a.owner) continue;
        const dx = a.x - b.x, dz = a.z - b.z;
        if (dx * dx + dz * dz < 1.8 * 1.8 && Math.abs(a.y - b.y) < 2) {
          a.dead = true;
          b.dead = true;
          race.fx.push({ type: "poof", x: a.x, y: a.y, z: a.z });
        }
      }
    }

    // Object vs local karts
    for (const o of objs) {
      if (o.dead) continue;
      for (const k of race.karts) {
        if (!k.local || k.respawnT > 0) continue;
        if (o.owner === k.id && o.age < 0.5) continue;
        const dx = o.x - k.x, dz = o.z - k.z;
        const r = k.radius + (o.type === "banana" ? 0.9 : 1.0);
        if (dx * dx + dz * dz > r * r || Math.abs(o.y - k.y) > 2.2) continue;
        if (k.starT > 0) {
          o.dead = true;
        } else if (k.invulnT > 0) {
          continue;
        } else {
          k.hit(o.type === "banana" ? "spin" : "tumble");
          o.dead = true;
        }
        race.fx.push({ type: o.type === "banana" ? "bananaHit" : "shellHit", x: o.x, y: o.y, z: o.z, kart: k.id });
        race.emit({ type: "hit", id: o.id, victim: k.id, kind: o.type });
        break;
      }
    }
    for (let i = objs.length - 1; i >= 0; i--) if (objs[i].dead) objs.splice(i, 1);
  }

  // ---------------------------------------------------------------- net
  applyRemote(e) {
    switch (e.type) {
      case "spawn": {
        const o = e.o || {};
        const num = (v, lim) => Number.isFinite(v) && Math.abs(v) < lim;
        if (!["banana", "green", "red"].includes(o.type) || typeof o.id !== "string" || this.objects.length > 120) break;
        if (!num(o.x, 1e4) || !num(o.y, 1e4) || !num(o.z, 1e4) || !num(o.vx, 200) || !num(o.vz, 200) || !num(o.vy ?? 0, 200)) break;
        if (!this.objects.some((x) => x.id === o.id)) {
          this.spawn({ id: o.id, type: o.type, x: o.x, y: o.y, z: o.z, vx: o.vx, vz: o.vz, vy: o.vy ?? 0, owner: o.owner, target: typeof o.target === "string" ? o.target : null });
        }
        break;
      }
      case "hit": {
        const o = this.objects.find((x) => x.id === e.id);
        if (o) {
          this.race.fx.push({ type: e.kind === "banana" ? "bananaHit" : "shellHit", x: o.x, y: o.y, z: o.z, kart: e.victim });
          this.remove(e.id);
        }
        break;
      }
      case "box": {
        const b = this.boxes[e.i];
        if (b && b.active) {
          b.active = false;
          b.t = BOX_RESPAWN;
          this.race.fx.push({ type: "boxBreak", x: b.x, y: b.y, z: b.z });
        }
        break;
      }
      case "bolt":
        this.applyBolt(e.from);
        break;
      case "splat":
        this.applySplat(e.from, e.dist);
        break;
    }
  }
}
