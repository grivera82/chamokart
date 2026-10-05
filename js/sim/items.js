// Item boxes, coins and live item objects (bananas, cocos, shells, bombs, fireballs...).
import { rollItem, EIGHT } from "../data.js?v=20";
import { GRAVITY } from "./kart.js?v=21";

const BOX_RESPAWN = 2.4;
const COIN_RESPAWN = 12;
const MAX_BANANAS = 40;
const TAU = Math.PI * 2;
// A held Green Coco (or triple green/red shells) circles its kart as a shield until fired.
const ORBIT_R = 2.4;
const ORBIT_SPEED = 4.5; // radians per second
const ORBIT = { green: "green", green3: "green", red3: "red" }; // item -> the coco that circles
// Bananas and Red Cocos can be dragged behind the kart as a shield while the item button is
// held, then dropped or fired on release (a quick tap works as before).
const TRAILABLE = new Set(["banana", "banana3", "red"]);
const TRAIL_DIST = { banana: 2.7, red: 2.9 };
// What a multi-use item shoots, and how many uses it comes with
const SHOT = { banana3: "banana", green3: "green", red3: "red", chili3: "chili" };
const COUNT = { banana3: 3, green3: 3, red3: 3, chili3: 3, boomerang: 3, eight: EIGHT.length };
// Switched on by the first press, then use it as often as you like until the time runs out
const TIMED = { golden: 7.5, fire: 8 };
const LIFE = { green: 10, red: 14, blue: 40, bomb: 3.2, fire: 2.2, boomerang: 4 };
const BLUE_SPEED = 95; // units a second along the road, far faster than any kart
const BOMB_R = 7; // blast radius
const BLUE_R = 8;
const HORN_R = 10;
const OBJECT_TYPES = new Set(["banana", "green", "red", "blue", "bomb", "fire", "boomerang"]);
const NO_BLUE = new Set(["blue"]);
const num = (v, lim) => Number.isFinite(v) && Math.abs(v) < lim;

export class ItemSystem {
  constructor(race) {
    this.race = race;
    this.track = race.track;
    this.boxes = [];
    this.coins = [];
    this.objects = [];
    this.counter = 0;
    this.q = {};
    this.p = {};
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
        this.coins.push({ id: this.coins.length, i, x: p.x, y: p.y + 0.9, z: p.z, active: true, t: 0 });
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
          k.itemCount = k.pendingCount || COUNT[k.item] || 1;
          k.itemT = 0;
          k.pendingItem = null;
          k.pendingCount = 0;
          k.events.push("itemReady");
        }
      }
      // A Golden Mushroom or Fire Flower that's switched on runs out
      if (k.itemT > 0) {
        k.itemT -= dt;
        if (k.itemT <= 0) {
          k.itemT = 0;
          if (TIMED[k.item]) {
            k.item = null;
            k.itemCount = 0;
          }
        }
      }
      this.updateOrbit(k);
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
            const blueOut = n < 2 || this.objects.some((o) => o.type === "blue");
            k.pendingItem = rollItem(frac, race.rng, blueOut ? NO_BLUE : null);
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
      // Use item: press to use, or for bananas and red cocos, hold to drag it behind you
      const pressed = k.ctl.item && !k.prevItem;
      const released = !k.ctl.item && k.prevItem;
      k.prevItem = k.ctl.item;
      this.updateTrail(k);
      if (k.trailId && released) this.releaseTrail(k, k.ctl.itemBack);
      else if (pressed && !k.trailId && k.item && k.roulette <= 0 && !k.disabled && race.phase === "race") {
        if (TRAILABLE.has(k.item)) this.startTrail(k);
        else if (TIMED[k.item]) this.useTimed(k, k.ctl.itemBack);
        else this.useItem(k, k.ctl.itemBack);
      }
    }
    for (const k of race.karts) if (k.piranhaT > 0) this.chomp(k, dt);

    this.updateObjects(dt);
  }

  // Keep a kart's orbiting cocos in step with the item it holds: one per use left, spawned when
  // a green (or triple shells) lands in the slot, dropped as they're fired, and each one that
  // breaks on something costs a use.
  updateOrbit(k) {
    const n = k.orbitIds.length;
    if (n) k.orbitIds = k.orbitIds.filter((id) => this.objects.some((x) => x.id === id));
    const broke = n - k.orbitIds.length;
    if (broke && ORBIT[k.item]) {
      k.itemCount -= broke;
      if (k.itemCount <= 0) {
        k.item = null;
        k.itemCount = 0;
      }
    }
    const knocked = k.respawnT > 0 || k.spinT > 0 || k.tumbleT > 0 || k.squishT > 0;
    if (knocked && k.orbitIds.length && ORBIT[k.item]) {
      k.item = null; // a hit knocks the shield loose
      k.itemCount = 0;
    }
    const want = ORBIT[k.item] && k.roulette <= 0 && !k.finished && !knocked ? Math.min(3, k.itemCount) : 0;
    while (k.orbitIds.length > want) this.dropOrbit(k);
    if (k.orbitIds.length < want) {
      const used = new Set(k.orbitIds.map((id) => this.objects.find((x) => x.id === id)?.slot));
      for (let slot = 0; slot < 3 && k.orbitIds.length < want; slot++) {
        if (used.has(slot)) continue;
        const o = this.spawn({ type: ORBIT[k.item], orbit: true, slot, x: k.x, y: k.y + 0.55, z: k.z, vx: 0, vz: 0, vy: 0, owner: k.id });
        k.orbitIds.push(o.id);
        this.emitSpawn(o);
      }
    }
  }

  // The last coco to join the circle leaves it (it's being fired, or the shield is gone)
  dropOrbit(k) {
    const id = k.orbitIds.pop();
    if (!id) return;
    this.remove(id);
    this.race.emit({ type: "gone", id });
  }

  // Take one of the kart's item out of the slot.
  takeItem(k) {
    const item = k.item;
    k.itemCount--;
    if (k.itemCount <= 0) {
      k.item = null;
      k.itemCount = 0;
    }
    return item;
  }

  startTrail(k) {
    const taken = this.takeItem(k);
    const item = SHOT[taken] || taken;
    const o = this.spawn({ type: item, trail: true, x: k.x, y: k.y + 0.5, z: k.z, vx: 0, vz: 0, vy: 0, owner: k.id });
    k.trailId = o.id;
    k.trailItem = item;
    this.emitSpawn(o);
  }

  // A held item that broke (or was knocked loose) is gone; the slot was emptied when it was taken.
  updateTrail(k) {
    if (!k.trailId) return;
    if (!this.objects.some((x) => x.id === k.trailId)) {
      k.trailId = null;
      return;
    }
    if (k.respawnT > 0 || k.spinT > 0 || k.tumbleT > 0 || k.squishT > 0 || k.finished) this.dropTrail(k);
  }

  dropTrail(k) {
    if (!k.trailId) return;
    this.remove(k.trailId);
    this.race.emit({ type: "gone", id: k.trailId });
    k.trailId = null;
  }

  // Letting go: the held item is dropped (banana) or fired (red coco, backwards with down held).
  releaseTrail(k, back) {
    const item = k.trailItem;
    this.dropTrail(k);
    k.events.push("use:" + item);
    this.fire(k, item, back);
  }

  useItem(k, back) {
    // The Crazy Eight hands out its items one at a time
    const item = k.item === "eight" ? EIGHT[EIGHT.length - k.itemCount] || "banana" : k.item;
    this.takeItem(k);
    k.events.push("use:" + (SHOT[item] || item));
    this.fire(k, item, back);
  }

  // Golden Mushroom and Fire Flower: the first press starts the clock, then press away
  useTimed(k, back) {
    const item = k.item;
    if (k.itemT <= 0) k.itemT = TIMED[item];
    if (item === "fire" && k.fireCd > 0) return;
    k.events.push("use:" + item);
    this.fire(k, item, back);
  }

  // The kart out in front: what a Blue Shell goes after
  leader() {
    let best = null;
    for (const k of this.race.karts) if (!k.finished && (!best || k.dist > best.dist)) best = k;
    return best;
  }

  fire(k, item, back) {
    const race = this.race;
    const fx = Math.sin(k.yaw), fz = Math.cos(k.yaw);
    const vf = Math.max(0, k.fwdSpeed);
    const dir = back ? -1 : 1;
    switch (item) {
      case "banana":
      case "banana3": {
        const o = this.spawn({ type: "banana", x: k.x - fx * 2.6, y: k.y + 0.6, z: k.z - fz * 2.6, vx: 0, vz: 0, vy: 2, owner: k.id });
        this.emitSpawn(o);
        break;
      }
      case "green":
      case "green3":
      case "red":
      case "red3": {
        if (ORBIT[item]) this.dropOrbit(k); // the shield becomes the shot
        const red = (item === "red" || item === "red3") && !back;
        const speed = back ? 50 : Math.max(60, vf + 24);
        let target = null;
        if (red) {
          const ahead = race.karts.find((o) => o.place === k.place - 1);
          target = ahead ? ahead.id : null;
        }
        const o = this.spawn({
          type: red ? "red" : "green",
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
      case "golden":
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
      case "blue": {
        // Flies up the road after whoever's in first
        const o = this.spawn({ type: "blue", x: k.x, y: k.y + 2, z: k.z, vx: 0, vz: 0, vy: 0, owner: k.id, target: this.leader()?.id ?? null, d: k.dist });
        this.emitSpawn(o);
        break;
      }
      case "bullet":
        k.endDrift(false);
        k.bulletT = 6.5;
        k.events.push("bullet");
        break;
      case "bomb": {
        // Lobbed ahead (or set down behind) and blows up after a short fuse, or when touched
        const o = back
          ? this.spawn({ type: "bomb", x: k.x - fx * 2.8, y: k.y + 0.6, z: k.z - fz * 2.8, vx: 0, vz: 0, vy: 2, owner: k.id })
          : this.spawn({ type: "bomb", x: k.x + fx * 2.8, y: k.y + 1.2, z: k.z + fz * 2.8, vx: fx * (vf + 20), vz: fz * (vf + 20), vy: 9, owner: k.id });
        this.emitSpawn(o);
        break;
      }
      case "fire": {
        k.fireCd = 0.22;
        const speed = back ? 45 : Math.max(55, vf + 20);
        const side = (Math.floor(k.itemT * 9) % 2 ? 0.5 : -0.5) * 0.15; // a little spread
        const ax = Math.sin(k.yaw + side), az = Math.cos(k.yaw + side);
        const o = this.spawn({ type: "fire", x: k.x + ax * 2.4 * dir, y: k.y + 0.5, z: k.z + az * 2.4 * dir, vx: ax * speed * dir, vz: az * speed * dir, vy: 0, owner: k.id });
        this.emitSpawn(o);
        break;
      }
      case "boomerang": {
        // Out in a straight line, then back to the thrower's hand
        const speed = Math.max(58, vf + 18);
        const o = this.spawn({ type: "boomerang", x: k.x + fx * 2.6 * dir, y: k.y + 0.8, z: k.z + fz * 2.6 * dir, vx: fx * speed * dir, vz: fz * speed * dir, vy: 0, owner: k.id });
        this.emitSpawn(o);
        break;
      }
      case "piranha":
        k.piranhaT = 8;
        k.chompCd = 0.4;
        k.events.push("piranha");
        break;
      case "horn":
        this.applyHorn(k.id, k.x, k.y, k.z);
        race.emit({ type: "horn", from: k.id, x: +k.x.toFixed(2), y: +k.y.toFixed(2), z: +k.z.toFixed(2) });
        break;
      case "boo":
        this.useBoo(k);
        break;
      case "coin":
        k.coins = Math.min(10, k.coins + 2);
        k.events.push("coin");
        k.boost(0.35, 1.12, true);
        break;
    }
  }

  // Boo: turn invisible for a while and steal someone's item. We can only take the item off a
  // kart this game runs; another player's game hears about it and empties their slot, and the
  // thief gets a fresh item from the Boo instead.
  useBoo(k) {
    const race = this.race;
    k.booT = 5;
    k.events.push("boo");
    const others = race.karts.filter((o) => o !== k && !o.finished);
    const full = others.filter((o) => o.local && o.item && o.roulette <= 0);
    const pool = full.length && race.rng() < 0.75 ? full : others;
    const victim = pool.length ? pool[Math.floor(race.rng() * pool.length)] : null;
    let item = null, count = 0;
    if (victim?.local && victim.item && victim.roulette <= 0) {
      item = victim.item;
      count = victim.itemCount;
      this.loseItem(victim);
    } else {
      item = rollItem(0.6, race.rng, new Set(["boo", "blue"]));
      if (victim && !victim.local) race.emit({ type: "steal", from: k.id, to: victim.id });
    }
    k.pendingItem = item;
    k.pendingCount = count;
    k.roulette = 1.1;
    k.events.push("roulette");
  }

  loseItem(k) {
    k.item = null;
    k.itemCount = 0;
    k.itemT = 0;
    k.events.push("stolen");
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
      if (o.dist > dist && !o.armored && o.booT <= 0) {
        o.splatT = 5;
        o.events.push("splat");
      }
    }
    race.fx.push({ type: "splatThrow", from: fromId });
  }

  // Super Horn: a shockwave that knocks over everyone close by and clears every item around,
  // Blue Shells included (just not the horn owner's own shields)
  applyHorn(fromId, x, y, z) {
    const race = this.race;
    race.fx.push({ type: "horn", x, y, z, from: fromId });
    for (const k of race.karts) {
      if (k.id === fromId || !k.local || k.respawnT > 0) continue;
      if ((k.x - x) ** 2 + (k.z - z) ** 2 < HORN_R * HORN_R && Math.abs(k.y - y) < 4) k.hit("tumble");
    }
    for (const o of this.objects) {
      if (o.dead || (o.owner === fromId && (o.orbit || o.trail))) continue;
      if ((o.x - x) ** 2 + (o.z - z) ** 2 < HORN_R * HORN_R && Math.abs(o.y - y) < 9) {
        o.dead = true;
        race.fx.push({ type: "poof", x: o.x, y: o.y, z: o.z });
      }
    }
  }

  // An explosion (Bob-omb or Blue Shell): knocks over every kart this game runs in range and
  // takes out the items around it; other bombs in range go off too.
  blast(x, y, z, r, kind) {
    const race = this.race;
    race.fx.push({ type: kind === "blast" ? "bigBoom" : "boom", x, y, z });
    for (const k of race.karts) {
      if (!k.local || k.respawnT > 0) continue;
      if ((k.x - x) ** 2 + (k.z - z) ** 2 < r * r && Math.abs(k.y - y) < 5) k.hit(kind);
    }
    for (const o of this.objects) {
      if (o.dead || o.type === "blue" || o.orbit || o.trail) continue;
      if ((o.x - x) ** 2 + (o.z - z) ** 2 < r * r && Math.abs(o.y - y) < 5) {
        o.dead = true;
        if (o.type === "bomb") this.blast(o.x, o.y, o.z, BOMB_R, "tumble");
      }
    }
  }

  // Piranha Plant: every so often it chomps a kart or an item just in front of its kart, and a
  // chomp gives the kart a little lunge forward. Runs for every kart that has one, so a player
  // here gets bitten by someone else's plant (the victim's game decides, like every hit).
  chomp(c, dt) {
    const race = this.race;
    c.chompCd = Math.max(0, c.chompCd - dt);
    if (c.chompCd > 0 || c.respawnT > 0 || c.finished) return;
    const mx = c.x + Math.sin(c.yaw) * 3, mz = c.z + Math.cos(c.yaw) * 3;
    const R2 = 3.4 * 3.4;
    let ate = false;
    for (const k of race.karts) {
      if (k === c || k.respawnT > 0 || k.booT > 0) continue;
      if ((k.x - mx) ** 2 + (k.z - mz) ** 2 > R2 || Math.abs(k.y - c.y) > 2.5) continue;
      ate = true;
      if (k.local) k.hit("spin");
    }
    if (c.local) {
      for (const o of this.objects) {
        if (o.dead || o.owner === c.id || o.type === "blue" || o.type === "boomerang") continue;
        if ((o.x - mx) ** 2 + (o.z - mz) ** 2 > R2 || Math.abs(o.y - c.y) > 3) continue;
        o.dead = true;
        ate = true;
        race.emit({ type: "hit", id: o.id, victim: c.id, kind: o.type });
      }
    }
    if (!ate) return;
    c.chompCd = 1.1;
    c.events.push("chomp");
    if (c.local) c.boost(0.5, 1.3, true);
  }

  spawn(o) {
    o.id = o.id || this.newId();
    o.age = 0;
    o.life = o.type === "banana" || o.orbit || o.trail ? 1e9 : LIFE[o.type] ?? 10;
    o.bounces = 0;
    o.hint = -1;
    o.grounded = o.type !== "banana" && o.type !== "bomb";
    o.dead = false;
    o.hitIds = [];
    this.objects.push(o);
    const bananas = this.objects.filter((b) => b.type === "banana");
    if (bananas.length > MAX_BANANAS) this.remove(bananas[0].id);
    return o;
  }

  emitSpawn(o) {
    this.race.emit({
      type: "spawn",
      o: { id: o.id, type: o.type, x: +o.x.toFixed(2), y: +o.y.toFixed(2), z: +o.z.toFixed(2), vx: +o.vx.toFixed(2), vz: +o.vz.toFixed(2), vy: o.vy, owner: o.owner, target: o.target ?? null, orbit: o.orbit || undefined, slot: o.orbit ? o.slot : undefined, trail: o.trail || undefined, d: o.type === "blue" ? +o.d.toFixed(2) : undefined },
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
        if (o.type === "bomb" && !o.dead) this.blast(o.x, o.y, o.z, BOMB_R, "tumble"); // the fuse ran out
        o.dead = true;
        continue;
      }
      if (o.dead) continue;
      if (o.orbit) {
        const k = race.kartById(o.owner);
        if (!k) {
          o.dead = true;
          continue;
        }
        const a = race.time * ORBIT_SPEED + ((o.slot || 0) * TAU) / 3;
        o.x = k.x + Math.sin(a) * ORBIT_R;
        o.z = k.z + Math.cos(a) * ORBIT_R;
        o.y = k.y + 0.55;
        continue;
      }
      if (o.trail) {
        // Dragged right behind the kart that holds it
        const k = race.kartById(o.owner);
        if (!k) {
          o.dead = true;
          continue;
        }
        const d = TRAIL_DIST[o.type] ?? 2.7;
        o.x = k.x - Math.sin(k.yaw) * d;
        o.z = k.z - Math.cos(k.yaw) * d;
        o.y = k.y + (o.type === "banana" ? 0.35 : 0.55);
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
      if (o.type === "blue") {
        this.moveBlue(o, dt);
        continue;
      }
      if (o.type === "boomerang" && o.age > 0.6) {
        // Coming back around to the thrower
        const k = race.kartById(o.owner);
        const dx = k ? k.x - o.x : 0, dz = k ? k.z - o.z : 0;
        if (!k || dx * dx + dz * dz < 2.6 * 2.6) {
          o.dead = true; // caught (or its thrower is gone)
          continue;
        }
        const cur = Math.atan2(o.vx, o.vz);
        let d = Math.atan2(dx, dz) - cur;
        while (d > Math.PI) d -= TAU;
        while (d < -Math.PI) d += TAU;
        const turn = Math.max(-9 * dt, Math.min(9 * dt, d));
        const speed = Math.max(62, k.fwdSpeed + 14);
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
            if (o.type === "green" || o.type === "fire") o.bounces++;
          }
          if (o.bounces > (o.type === "fire" ? 3 : 7)) o.dead = true;
        }
      } else if (o.type === "red" && Math.abs(q.lateral) > q.hw) {
        // Red cocos hug the road on void tracks
        const side = Math.sign(q.lateral);
        o.x -= q.rx * side * (Math.abs(q.lateral) - q.hw);
        o.z -= q.rz * side * (Math.abs(q.lateral) - q.hw);
      }
      if (q.ground && o.grounded) {
        o.y = q.height + 0.55;
        if (o.type === "bomb") {
          const f = Math.exp(-3 * dt); // skids to a stop
          o.vx *= f;
          o.vz *= f;
        }
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
      if (a.dead || a.type === "banana" || a.type === "blue" || a.type === "boomerang") continue;
      for (let j = 0; j < objs.length; j++) {
        if (i === j) continue;
        const b = objs[j];
        if (b.dead || (b.type !== "banana" && j < i) || b.type === "blue" || b.type === "boomerang") continue;
        if (a.age < 0.15 && b.owner === a.owner) continue;
        if ((a.orbit || b.orbit || a.trail || b.trail) && a.owner === b.owner) continue; // a shield doesn't pop its owner's own items
        if (a.type === "fire" && b.type === "fire") continue;
        const dx = a.x - b.x, dz = a.z - b.z;
        if (dx * dx + dz * dz < 1.8 * 1.8 && Math.abs(a.y - b.y) < 2) {
          a.dead = true;
          b.dead = true;
          const bomb = a.type === "bomb" ? a : b.type === "bomb" ? b : null;
          if (bomb) this.blast(bomb.x, bomb.y, bomb.z, BOMB_R, "tumble");
          else race.fx.push({ type: "poof", x: a.x, y: a.y, z: a.z });
          break;
        }
      }
    }

    // Object vs local karts
    for (const o of objs) {
      if (o.dead || o.type === "blue") continue; // a Blue Shell only hits by exploding
      for (const k of race.karts) {
        if (!k.local || k.respawnT > 0 || k.booT > 0) continue;
        if (o.owner === k.id && (o.age < 0.5 || o.orbit || o.trail || o.type === "boomerang")) continue;
        const dx = o.x - k.x, dz = o.z - k.z;
        const r = k.radius + (o.type === "banana" ? 0.9 : o.type === "bomb" ? 1.3 : 1.0);
        if (dx * dx + dz * dz > r * r || Math.abs(o.y - k.y) > 2.2) continue;
        if (o.type === "bomb") {
          // Touching a Bob-omb sets it off
          o.dead = true;
          this.blast(o.x, o.y, o.z, BOMB_R, "tumble");
          race.emit({ type: "boom", id: o.id, x: +o.x.toFixed(2), y: +o.y.toFixed(2), z: +o.z.toFixed(2) });
          break;
        }
        if (o.type === "boomerang") {
          // Cuts through everyone in its path, once each, and keeps going
          if (o.hitIds.includes(k.id)) continue;
          o.hitIds.push(k.id);
          if (k.hit("tumble")) race.fx.push({ type: "shellHit", x: o.x, y: o.y, z: o.z, kart: k.id });
          continue;
        }
        if (k.armored) {
          o.dead = true;
        } else if (k.invulnT > 0) {
          continue;
        } else {
          k.hit(o.type === "banana" || o.type === "fire" ? "spin" : "tumble");
          o.dead = true;
        }
        race.fx.push({ type: o.type === "banana" ? "bananaHit" : "shellHit", x: o.x, y: o.y, z: o.z, kart: k.id });
        race.emit({ type: "hit", id: o.id, victim: k.id, kind: o.type });
        break;
      }
    }
    for (let i = objs.length - 1; i >= 0; i--) if (objs[i].dead) objs.splice(i, 1);
  }

  // Blue Shell: races up the middle of the road, high over everyone, until it's close to the
  // leader, then dives on them and explodes. If the leader finishes, it goes after the next one.
  moveBlue(o, dt) {
    const race = this.race;
    const t = this.track;
    let tgt = o.target ? race.kartById(o.target) : null;
    if (!tgt || tgt.finished) {
      tgt = this.leader();
      o.target = tgt ? tgt.id : null;
    }
    if (!tgt) {
      o.dead = true;
      return;
    }
    if (!o.homing && (tgt.dist - o.d) * t.spacing > 24) {
      o.d += (BLUE_SPEED / t.spacing) * dt;
      const p = t.pointAtS(o.d, 0, this.p);
      o.vx = p.x - o.x;
      o.vz = p.z - o.z;
      o.x = p.x;
      o.z = p.z;
      o.y += (p.y + 5 - o.y) * Math.min(1, dt * 4);
      return;
    }
    o.homing = true;
    o.homeT = (o.homeT || 0) + dt;
    const dx = tgt.x - o.x, dy = tgt.y + 0.8 - o.y, dz = tgt.z - o.z;
    const d = Math.hypot(dx, dy, dz);
    const step = Math.max(70, tgt.fwdSpeed + 30) * dt;
    if (d <= step + 1 || o.homeT > 4) {
      o.dead = true;
      this.blast(tgt.x, tgt.y, tgt.z, BLUE_R, "blast");
      return;
    }
    o.vx = dx;
    o.vz = dz;
    o.x += (dx / d) * step;
    o.y += (dy / d) * step;
    o.z += (dz / d) * step;
  }

  // ---------------------------------------------------------------- net
  applyRemote(e) {
    switch (e.type) {
      case "spawn": {
        const o = e.o || {};
        if (!OBJECT_TYPES.has(o.type) || typeof o.id !== "string" || this.objects.length > 120) break;
        if (!num(o.x, 1e4) || !num(o.y, 1e4) || !num(o.z, 1e4) || !num(o.vx, 200) || !num(o.vz, 200) || !num(o.vy ?? 0, 200)) break;
        if (o.type === "blue" && !num(o.d, 1e6)) break;
        if (!this.objects.some((x) => x.id === o.id)) {
          const orbit = (o.type === "green" || o.type === "red") && o.orbit === true;
          this.spawn({ id: o.id, type: o.type, x: o.x, y: o.y, z: o.z, vx: o.vx, vz: o.vz, vy: o.vy ?? 0, owner: o.owner, target: typeof o.target === "string" ? o.target : null, orbit, slot: orbit ? Math.min(2, Math.max(0, o.slot | 0)) : undefined, trail: (o.type === "banana" || o.type === "red") && o.trail === true, d: o.d });
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
      case "gone": // an orbiting or held item was used or knocked loose: remove it quietly
        this.remove(e.id);
        break;
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
      case "horn":
        if (num(e.x, 1e4) && num(e.y, 1e4) && num(e.z, 1e4)) this.applyHorn(e.from, e.x, e.y, e.z);
        break;
      case "boom": {
        // Someone's kart set off a Bob-omb: it goes off here too (unless it already did)
        const o = this.objects.find((x) => x.id === e.id && x.type === "bomb" && !x.dead);
        if (o && num(e.x, 1e4) && num(e.y, 1e4) && num(e.z, 1e4)) {
          o.dead = true;
          this.blast(e.x, e.y, e.z, BOMB_R, "tumble");
          this.remove(o.id);
        }
        break;
      }
      case "steal": {
        // A Boo took the item of a kart this game runs
        const v = this.race.kartById(e.to);
        if (v?.local && v.item && v.roulette <= 0) this.loseItem(v);
        break;
      }
    }
  }
}
