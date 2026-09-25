// Renders a RaceSim: karts, items, particles, camera direction.
import * as THREE from "three";
import { buildWorld } from "./world.js?v=3";
import { buildKart, buildBanana, buildCoco, buildItemBox, buildCoin, WHEEL_POS, mat } from "./models.js?v=3";
import { Particles } from "./particles.js?v=3";
import { shadowTexture, labelTexture } from "./textures.js?v=3";
import { COUNTDOWN } from "../sim/race.js?v=3";

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
function angLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return a + d * t;
}
const DRIFT_COLORS = [new THREE.Color(0xfff2b0), new THREE.Color(0x4aa8ff), new THREE.Color(0xff8a1a), new THREE.Color(0xd060ff)];
const DUST = { meadow: 0x8a6a45, desert: 0xe0b27a, snow: 0xffffff, beach: 0xf2d9a2, neon: 0xb080ff };

// Continue a rotation until it lands on a whole turn, then stop.
function settle(angle, active, rate, dt) {
  if (active) return angle + rate * dt;
  if (angle === 0) return 0;
  const target = Math.ceil(angle / TAU - 1e-4) * TAU;
  const next = angle + rate * dt;
  return next >= target ? 0 : next;
}

class KartView {
  constructor(kart, scene, opts) {
    this.kart = kart;
    this.root = buildKart(kart.char, kart.kartType);
    this.ud = this.root.userData;
    scene.add(this.root);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 3.8),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.8 })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 2;
    scene.add(this.shadow);
    this.driftOff = 0;
    this.spin = 0;
    this.tumble = 0;
    this.trick = 0;
    this.wheelSpin = 0;
    this.scale = 1;
    this.squash = 1;
    this.emitAcc = 0;
    // Star aura
    this.aura = new THREE.Mesh(
      new THREE.SphereGeometry(1.9, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.aura.position.y = 0.9;
    this.aura.visible = false;
    this.root.add(this.aura);
    // Respawn drone
    this.drone = new THREE.Group();
    const saucer = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, 0.4, 16), mat(0xffffff, { rough: 0.3 }));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10, 0, TAU, 0, Math.PI / 2), mat(0x7ad0ff, { rough: 0.1, emissive: 0x3070a0, ei: 0.6 }));
    dome.position.y = 0.2;
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6), mat(0x333333));
    rope.position.y = -1.3;
    this.propeller = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.05, 0.2), mat(0x333333));
    this.propeller.position.y = 0.55;
    this.drone.add(saucer, dome, rope, this.propeller);
    this.drone.position.y = 3.9;
    this.drone.visible = false;
    this.root.add(this.drone);
    if (opts.nameTag) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(kart.name, opts.nameColor || "#fff"), depthWrite: false, transparent: true }));
      sp.scale.set(4, 1, 1);
      sp.position.y = 2.9;
      this.root.add(sp);
      this.tag = sp;
    }
  }

  update(dt, time) {
    const k = this.kart;
    const ud = this.ud;
    this.root.position.set(k.x, k.y, k.z);
    this.root.rotation.y = k.yaw;
    this.driftOff = lerp(this.driftOff, k.drifting ? -k.driftDir * 0.42 : 0, Math.min(1, dt * 10));
    this.spin = settle(this.spin, k.spinT > 0, 13, dt);
    this.tumble = settle(this.tumble, k.tumbleT > 0, 7, dt);
    this.trick = settle(this.trick, k.trickT > 0, 15, dt);
    const body = ud.body;
    body.rotation.order = "YXZ";
    body.rotation.y = this.driftOff + this.spin;
    body.rotation.x = -k.pitch - this.tumble;
    body.rotation.z = -k.steerVis * 0.06 * Math.min(1, Math.abs(k.fwdSpeed) / 20) + this.trick + (k.drifting ? k.driftDir * 0.08 : 0);
    // Size
    this.scale = lerp(this.scale, k.shrinkT > 0 ? 0.55 : 1, Math.min(1, dt * 6));
    this.squash = lerp(this.squash, k.squishT > 0 ? 0.25 : 1, Math.min(1, dt * 12));
    this.root.scale.set(this.scale, this.scale * this.squash, this.scale);
    // Wheels + steering
    this.wheelSpin += (k.fwdSpeed * dt) / ud.wheelR;
    for (const w of ud.wheels) w.rotation.x = this.wheelSpin;
    for (const p of ud.steerPivots) p.rotation.y = -k.steerVis * 0.45;
    ud.steeringWheel.rotation.z = k.steerVis * 1.2;
    ud.driver.rotation.z = k.steerVis * 0.12;
    ud.driver.userData.head.rotation.y = -k.steerVis * 0.35;
    // Boost flames
    const boosting = k.boostT > 0;
    for (const f of ud.exhausts) {
      f.visible = boosting;
      if (boosting) {
        const s = 0.8 + Math.random() * 0.5;
        f.scale.set(s, s * (k.boostPower > 1.3 ? 1.5 : 1.1), s);
        f.material.color.setHex(k.boostPower > 1.3 ? 0xff7a1a : 0x6ac8ff);
      }
    }
    // Star aura
    this.aura.visible = k.starT > 0;
    if (this.aura.visible) {
      this.aura.material.color.setHSL((time * 2) % 1, 1, 0.55);
      this.aura.scale.setScalar(1 + Math.sin(time * 20) * 0.06);
    }
    // Respawn + invulnerability blink
    const falling = k.respawnT > 0 && !k.respawnMoved;
    const carried = k.respawnT > 0 && k.respawnMoved;
    this.drone.visible = carried;
    if (carried) this.propeller.rotation.y += dt * 30;
    let visible = !(falling && k.respawnT < 1.4);
    if (k.invulnT > 0 && k.starT <= 0 && k.local && !carried) visible = visible && Math.floor(time * 16) % 2 === 0;
    ud.body.visible = visible;
    // Shadow
    const gy = k.q && k.q.ground ? k.q.height : k.y - 50;
    const alt = Math.max(0, k.y - gy);
    this.shadow.visible = alt < 12 && k.respawnT <= 0;
    this.shadow.position.set(k.x, gy + 0.12, k.z);
    this.shadow.rotation.z = k.yaw;
    const ss = this.scale * Math.max(0.3, 1 - alt * 0.08);
    this.shadow.scale.set(ss, ss, 1);
    this.shadow.material.opacity = 0.75 * Math.max(0, 1 - alt * 0.1);
  }

  wheelWorld(i, out) {
    const k = this.kart;
    const [lx, lz] = WHEEL_POS[i];
    const c = Math.cos(k.yaw + this.driftOff), s = Math.sin(k.yaw + this.driftOff);
    out.x = k.x + lx * c + lz * s;
    out.z = k.z - lx * s + lz * c;
    out.y = k.y + 0.15;
    return out;
  }

  dispose(scene) {
    scene.remove(this.root);
    scene.remove(this.shadow);
  }
}

export class RaceView {
  constructor(renderer, sim, opts = {}) {
    this.renderer = renderer;
    this.sim = sim;
    this.opts = opts;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(68, 1, 0.2, 4000);
    this.world = buildWorld(this.scene, sim.track, opts.quality || "high");
    this.sparks = new Particles(this.scene, 3000, true);
    this.smoke = new Particles(this.scene, 1500, false);
    this.focusId = opts.focusId ?? sim.karts[sim.karts.length - 1]?.id;
    this.kartViews = new Map();
    for (const k of sim.karts) this.addKart(k);
    this.boxViews = sim.items.boxes.map((b) => {
      const m = buildItemBox();
      m.position.set(b.x, b.y, b.z);
      this.scene.add(m);
      return { m, grow: 1 };
    });
    this.coinViews = sim.items.coins.map((c) => {
      const m = buildCoin();
      m.position.set(c.x, c.y, c.z);
      this.scene.add(m);
      return m;
    });
    this.objViews = new Map();
    this.camYaw = null;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.fov = 68;
    this.shake = 0;
    this.lookBack = false;
    this.mode = opts.mode || "race"; // race | attract | showroom
    this.attractT = 0;
    this.attractShot = 0;
    this.finishOrbit = 0;
    this.tmp = {};
    this.q = {};
  }

  addKart(k) {
    const own = k.id === this.focusId;
    const v = new KartView(k, this.scene, { nameTag: this.opts.nameTags && !own && !k.bot, nameColor: "#ffe066" });
    this.kartViews.set(k.id, v);
  }

  removeKart(id) {
    const v = this.kartViews.get(id);
    if (v) {
      v.dispose(this.scene);
      this.kartViews.delete(id);
    }
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const ps = h * 0.9;
    this.sparks.setScale(ps);
    this.smoke.setScale(ps);
  }

  get focus() {
    return this.sim.kartById(this.focusId) || this.sim.karts[0];
  }

  // Handle simulation events for visuals (audio is handled elsewhere).
  handleEvents(events) {
    for (const { kart: k, e } of events) {
      const v = this.kartViews.get(k.id);
      if (!v) continue;
      switch (e) {
        case "wall":
          this.sparks.burst(k.x, k.y + 0.5, k.z, 14, 10, 0xffe0a0, 0.25, 0.35, { gravity: 20 });
          if (k.id === this.focusId) this.shake = Math.max(this.shake, 0.25);
          break;
        case "land":
          this.smoke.burst(k.x, k.y + 0.2, k.z, 10, 4, DUST[this.sim.track.def.theme], 0.9, 0.6, { grow: 1.5, up: 0.3 });
          break;
        case "hit:spin":
        case "hit:tumble":
        case "hit:squish":
          this.sparks.burst(k.x, k.y + 1, k.z, 30, 9, 0xfff080, 0.45, 0.7, { gravity: 6 });
          if (k.id === this.focusId) this.shake = Math.max(this.shake, 0.6);
          break;
        case "zap":
          this.sparks.burst(k.x, k.y + 1, k.z, 20, 6, 0x9ad0ff, 0.5, 0.5);
          break;
        case "burnout":
          this.smoke.burst(k.x, k.y + 0.5, k.z, 30, 3, 0x333333, 1.4, 1.4, { grow: 2, lift: 2 });
          break;
        case "rocket":
        case "miniturbo3":
        case "miniturbo2":
        case "miniturbo1":
        case "trickBoost":
        case "pad":
        case "chili":
          this.sparks.burst(k.x, k.y + 0.6, k.z, 12, 5, e === "miniturbo3" ? 0xd060ff : e === "miniturbo2" ? 0xff8a1a : 0x6ac8ff, 0.4, 0.4);
          break;
        case "trick":
          this.sparks.burst(k.x, k.y + 1, k.z, 18, 6, 0xffffff, 0.35, 0.5, { rainbow: true });
          break;
        case "finish":
          if (k.id === this.focusId) {
            for (let i = 0; i < 4; i++) this.sparks.burst(k.x, k.y + 3, k.z, 60, 16, 0xffffff, 0.5, 2.2, { rainbow: true, gravity: 8, lift: 6 });
          }
          break;
        case "fall":
          if (this.sim.track.def.theme === "beach") this.smoke.burst(k.x, -1, k.z, 30, 8, 0xffffff, 1, 0.9, { gravity: 10, lift: 6 });
          break;
      }
    }
    for (const f of this.sim.fx) {
      switch (f.type) {
        case "boxBreak":
          this.sparks.burst(f.x, f.y, f.z, 26, 10, 0xffffff, 0.45, 0.6, { rainbow: true, gravity: 10 });
          break;
        case "bananaHit":
          this.smoke.burst(f.x, f.y, f.z, 10, 5, 0xffd83a, 0.6, 0.5, { gravity: 10 });
          break;
        case "shellHit":
        case "poof":
          this.sparks.burst(f.x, f.y, f.z, 24, 10, 0xfff080, 0.5, 0.5);
          this.smoke.burst(f.x, f.y, f.z, 12, 4, 0xdddddd, 1.2, 0.8, { grow: 1.5 });
          break;
      }
    }
    this.sim.fx.length = 0;
  }

  emitKartParticles(v, dt) {
    const k = v.kart;
    if (k.respawnT > 0) return;
    const p = this.tmp;
    const theme = this.sim.track.def.theme;
    const cam = this.camera.position;
    const far = (k.x - cam.x) ** 2 + (k.z - cam.z) ** 2 > 140 * 140;
    if (far) return;
    const speed = Math.abs(k.fwdSpeed);
    if (k.drifting && k.grounded) {
      const c = DRIFT_COLORS[k.driftLevel];
      const n = k.driftLevel > 0 ? 3 : 1;
      for (const wi of [2, 3]) {
        v.wheelWorld(wi, p);
        for (let j = 0; j < n; j++) {
          this.sparks.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 6 - k.vx * 0.1, 2 + Math.random() * 4, (Math.random() - 0.5) * 6 - k.vz * 0.1, c.r, c.g, c.b, k.driftLevel > 0 ? 0.32 : 0.18, 0.25, { gravity: 18 });
        }
      }
      if (Math.random() < 0.12) this.smoke.emit(p.x, p.y, p.z, 0, 0.8, 0, 0.9, 0.9, 0.9, 0.5, 0.5, { grow: 1.6 });
    }
    if (k.boostT > 0) {
      const fx = Math.sin(k.yaw), fz = Math.cos(k.yaw);
      const hot = k.boostPower > 1.3;
      for (let j = 0; j < 2; j++) {
        this.sparks.emit(k.x - fx * 1.9 + (Math.random() - 0.5) * 0.6, k.y + 0.7, k.z - fz * 1.9 + (Math.random() - 0.5) * 0.6, -fx * 6, 1, -fz * 6, hot ? 1 : 0.4, hot ? 0.5 : 0.8, hot ? 0.1 : 1, 0.5, 0.18);
      }
    }
    if (k.offroad && speed > 8 && k.grounded && k.boostT <= 0) {
      const c = new THREE.Color(DUST[theme]);
      for (const wi of [2, 3]) {
        if (Math.random() < 0.5) continue;
        v.wheelWorld(wi, p);
        this.smoke.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 2, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 2, c.r, c.g, c.b, 0.9, 0.7, { grow: 1.8, gravity: 1 });
      }
    }
    if (k.starT > 0 && Math.random() < 0.6) {
      const c = new THREE.Color().setHSL(Math.random(), 1, 0.6);
      this.sparks.emit(k.x + (Math.random() - 0.5) * 2.5, k.y + Math.random() * 2, k.z + (Math.random() - 0.5) * 2.5, 0, 2, 0, c.r, c.g, c.b, 0.35, 0.5);
    }
    if (k.revving && Math.random() < 0.3) {
      const fx = Math.sin(k.yaw), fz = Math.cos(k.yaw);
      this.smoke.emit(k.x - fx * 1.8, k.y + 0.6, k.z - fz * 1.8, -fx * 2, 1, -fz * 2, 0.6, 0.6, 0.6, 0.6, 0.6, { grow: 2 });
    }
  }

  syncItems(dt, time) {
    const items = this.sim.items;
    items.boxes.forEach((b, i) => {
      const v = this.boxViews[i];
      if (!b.active) {
        v.m.visible = false;
        v.grow = 0;
        return;
      }
      v.grow = Math.min(1, v.grow + dt * 3);
      v.m.visible = true;
      v.m.scale.setScalar(v.grow);
      v.m.rotation.set(time * 0.9 + i, time * 1.3 + i, 0);
      v.m.position.y = b.y + Math.sin(time * 2 + i) * 0.2;
    });
    items.coins.forEach((c, i) => {
      const m = this.coinViews[i];
      m.visible = c.active;
      if (c.active) m.rotation.y = time * 3 + i * 0.4;
    });
    const seen = new Set();
    for (const o of items.objects) {
      seen.add(o.id);
      let m = this.objViews.get(o.id);
      if (!m) {
        m = o.type === "banana" ? buildBanana() : buildCoco(o.type === "red");
        m.traverse((c) => (c.castShadow = true));
        this.scene.add(m);
        this.objViews.set(o.id, m);
      }
      m.position.set(o.x, o.y - (o.type === "banana" ? 0.3 : 0), o.z);
      if (o.type !== "banana") m.rotation.y += dt * 12;
      else m.rotation.y = (o.age * 0.2 + o.x) % TAU;
      if (o.type === "red" && Math.random() < 0.5) this.sparks.emit(o.x, o.y, o.z, 0, 0.5, 0, 1, 0.3, 0.2, 0.35, 0.3);
    }
    for (const [id, m] of this.objViews) {
      if (!seen.has(id)) {
        this.scene.remove(m);
        this.objViews.delete(id);
      }
    }
  }

  updateCamera(dt, time) {
    const sim = this.sim;
    const cam = this.camera;
    const k = this.focus;
    if (!k) return;
    let fovTarget = 68;
    const introEnd = -COUNTDOWN;
    if (this.mode === "attract") {
      this.attractCamera(dt, time);
      return;
    }
    if (sim.time < introEnd - 0.6) {
      // Intro flyover around the start area.
      const introLen = sim.opts.introTime ?? 3;
      const t = Math.max(0, Math.min(1, (sim.time - (introEnd - introLen)) / Math.max(0.5, introLen - 0.6)));
      const p = sim.track.pointAt(0, 0);
      const a = k.yaw + Math.PI * 0.9 - t * Math.PI * 0.9;
      const r = lerp(40, 14, t);
      this.camPos.set(p.x + Math.sin(a) * r, p.y + lerp(22, 5, t), p.z + Math.cos(a) * r);
      this.camLook.set(lerp(p.x, k.x, t), lerp(p.y + 3, k.y + 1, t), lerp(p.z, k.z, t));
      cam.position.copy(this.camPos);
      cam.lookAt(this.camLook);
      this.camYaw = null;
      this.fov = 60;
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
      return;
    }
    if (k.finished && this.mode === "race") {
      // Victory orbit
      this.finishOrbit += dt * 0.45;
      const a = k.yaw + Math.PI * 0.35 + this.finishOrbit;
      const target = new THREE.Vector3(k.x + Math.sin(a) * 7.5, k.y + 2.6, k.z + Math.cos(a) * 7.5);
      this.camPos.lerp(target, Math.min(1, dt * 3));
      cam.position.copy(this.camPos);
      this.camLook.set(k.x, k.y + 1, k.z);
      cam.lookAt(this.camLook);
      this.fov = lerp(this.fov, 55, dt * 2);
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
      return;
    }
    const desired = k.yaw + (this.lookBack ? Math.PI : 0);
    if (this.camYaw === null || this.lookBack !== this.prevLookBack) this.camYaw = desired;
    this.prevLookBack = this.lookBack;
    this.camYaw = angLerp(this.camYaw, desired, 1 - Math.exp(-dt * (k.drifting ? 4.5 : 6)));
    const speed = Math.max(0, k.fwdSpeed);
    // Tall/portrait screens: pull back and widen so the track stays readable.
    const pf = Math.max(0, Math.min(1, (1.45 - cam.aspect) / 0.9));
    const dist = 6.4 + Math.min(speed, 60) * 0.03 + pf * 3.2;
    const s = k.scale;
    const height = 2.5 + (1 - s) * -0.8 + pf * 1.3;
    const tx = k.x - Math.sin(this.camYaw) * dist;
    const tz = k.z - Math.cos(this.camYaw) * dist;
    let ty = k.y + height;
    this.sim.track.query(tx, tz, k.hint, this.q);
    if (this.q.ground || this.sim.track.boundary === "wall") ty = Math.max(ty, this.q.height + 1.2);
    if (this.camPos.lengthSq() === 0 || (this.camPos.x - tx) ** 2 + (this.camPos.z - tz) ** 2 > 400) this.camPos.set(tx, ty, tz);
    this.camPos.x = tx;
    this.camPos.z = tz;
    this.camPos.y = lerp(this.camPos.y, ty, 1 - Math.exp(-dt * 7));
    cam.position.copy(this.camPos);
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 1.5);
    }
    const lf = this.lookBack ? -1 : 1;
    this.camLook.set(k.x + Math.sin(this.camYaw) * 3 * lf * 0 + Math.sin(k.yaw) * 3 * lf, k.y + 1.2, k.z + Math.cos(k.yaw) * 3 * lf);
    cam.lookAt(this.camLook);
    const maxS = k.stats.maxSpeed;
    fovTarget = 66 + pf * 16 + Math.min(1, speed / (maxS * 1.2)) * 8 + (k.boostT > 0 ? 9 : 0);
    this.fov = lerp(this.fov, fovTarget, 1 - Math.exp(-dt * 4));
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
  }

  attractCamera(dt, time) {
    const sim = this.sim;
    this.attractT -= dt;
    if (this.attractT <= 0 || !this.focus) {
      this.attractT = 7;
      const pick = sim.karts[Math.floor(Math.random() * sim.karts.length)];
      this.focusId = pick.id;
      this.attractShot = (this.attractShot + 1) % 4;
      this.camYaw = null;
    }
    const k = this.focus;
    const cam = this.camera;
    if (this.camYaw === null) this.camYaw = k.yaw;
    this.camYaw = angLerp(this.camYaw, k.yaw, 1 - Math.exp(-dt * 3));
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    const rx = -fz, rz = fx;
    let px, py, pz;
    switch (this.attractShot) {
      case 0: // low chase
        px = k.x - fx * 7; py = k.y + 1.6; pz = k.z - fz * 7;
        break;
      case 1: // side tracking
        px = k.x + rx * 7 + fx * 1; py = k.y + 1.8; pz = k.z + rz * 7 + fz * 1;
        break;
      case 2: // front, looking back
        px = k.x + fx * 8 + rx * 1.5; py = k.y + 2; pz = k.z + fz * 8 + rz * 1.5;
        break;
      default: // high helicopter
        px = k.x - fx * 18 + rx * 10; py = k.y + 14; pz = k.z - fz * 18 + rz * 10;
    }
    cam.position.set(px, py, pz);
    cam.lookAt(k.x, k.y + 1, k.z);
    cam.fov = 55;
    cam.updateProjectionMatrix();
  }

  update(dt, events) {
    const time = performance.now() / 1000;
    this.handleEvents(events || []);
    for (const v of this.kartViews.values()) {
      v.update(dt, time);
      this.emitKartParticles(v, dt);
    }
    this.syncItems(dt, time);
    this.sparks.update(dt);
    this.smoke.update(dt);
    this.updateCamera(dt, time);
    const f = this.focus;
    this.world.update(dt, time, this.camera, f ? { x: f.x, y: f.y, z: f.z } : null);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.world.dispose();
    this.sparks.dispose();
    this.smoke.dispose();
    this.scene.traverse((o) => {
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) if (!m.userData?.shared) m.dispose();
    });
  }
}
