// A single race: glues simulation, rendering, HUD, audio, input and network.
import * as THREE from "three";
import { RaceSim, COUNTDOWN } from "./sim/race.js?v=3";
import { RaceView } from "./view/raceview.js?v=3";
import { buildKart } from "./view/models.js?v=3";
import { TRACKS } from "./data.js?v=3";
import { audio } from "./audio.js?v=4";
import { input } from "./input.js?v=4";
import { packKart, applyFlags } from "./net.js?v=3";
import { ordinal } from "./hud.js?v=3";

const SEND_HZ = 20;
const INTERP_DELAY = 110;
const SPATIAL = new Set(["wall", "hit:spin", "hit:tumble", "hit:squish", "use:banana", "use:green", "use:red", "boost", "bump", "land"]);

export class RaceSession {
  constructor(app, cfg) {
    this.app = app;
    this.cfg = cfg;
    this.net = cfg.net || null;
    this.online = cfg.mode === "online";
    let introTime = 3.4;
    if (this.online) introTime = Math.max(0.3, (cfg.startAt - this.net.serverNow()) / 1000 - COUNTDOWN);
    if (cfg.mode === "attract") introTime = 0;
    this.sim = new RaceSim({
      track: cfg.track,
      laps: cfg.laps,
      cc: cfg.cc,
      mode: cfg.mode,
      items: cfg.items,
      seed: cfg.seed,
      grid: cfg.grid,
      netPrefix: (cfg.localId || "x") + ":",
      introTime,
    });
    if (this.online) this.sim.time = (this.net.serverNow() - cfg.startAt) / 1000;
    this.view = new RaceView(app.renderer, this.sim, {
      focusId: cfg.localId,
      quality: app.settings.quality,
      nameTags: this.online,
      mode: cfg.mode === "attract" ? "attract" : "race",
    });
    this.view.resize(app.width, app.height);
    this.me = this.sim.kartById(cfg.localId);
    this.remote = new Map();
    this.sendAcc = 0;
    this.finishShownAt = null;
    this.ended = false;
    this.paused = false;
    this.lastLap = 1;
    this.finalLapPlayed = false;
    this.def = TRACKS[cfg.track];
    if (cfg.mode !== "attract") {
      app.hud.setup(this.sim, cfg.localId, { mode: cfg.mode });
      audio.playSong(this.def.music);
      audio.engine("me", true);
    }
    // Time trial ghost
    this.ghostFrames = [];
    this.ghostAcc = 0;
    if (cfg.mode === "tt" && cfg.ghost) this.setupGhost(cfg.ghost);
  }

  setupGhost(g) {
    this.ghost = g;
    const model = buildKart(g.char, g.kart);
    model.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.transparent = true;
        o.material.opacity = 0.4;
        o.material.depthWrite = false;
        o.castShadow = false;
      }
    });
    this.ghostModel = model;
    this.view.scene.add(model);
  }

  updateGhost() {
    if (!this.ghost) return;
    const f = this.ghost.frames;
    const t = Math.max(0, this.sim.time) * 20;
    const i = Math.min(f.length - 2, Math.floor(t));
    if (i < 0 || f.length < 2) return;
    const a = f[i], b = f[i + 1];
    const u = Math.min(1, t - i);
    let dy = b[3] - a[3];
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.ghostModel.position.set(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u);
    this.ghostModel.rotation.y = a[3] + dy * u;
    this.ghostModel.visible = this.sim.time >= 0 && t < f.length;
    this.app.hud.ghost = { x: this.ghostModel.position.x, z: this.ghostModel.position.z };
  }

  // ---------------------------------------------------------------- network
  onState(msg) {
    for (const arr of msg.d) {
      const k = this.sim.kartById(arr[0]);
      if (!k || k.local) continue;
      let buf = this.remote.get(k.id);
      if (!buf) this.remote.set(k.id, (buf = []));
      buf.push({ ts: msg.ts, a: arr });
      if (buf.length > 30) buf.shift();
    }
  }

  onEvent(from, e) {
    // Only accept effects for karts the sender actually controls.
    const owns = (id) => this.sim.kartById(id)?.owner === from;
    if (e.type === "spawn" && !owns(e.o?.owner)) return;
    if ((e.type === "bolt" || e.type === "splat") && !owns(e.from)) return;
    this.sim.items.applyRemote(e);
    if (e.type === "bolt") {
      audio.play("bolt");
      this.app.hud.flash("#bfe4ff", 0.85);
    }
  }

  onFinish(id, time) {
    const k = this.sim.kartById(id);
    if (k && !k.local && !k.finished) {
      k.finished = true;
      k.finishTime = time;
    }
  }

  removeKarts(ids) {
    for (const id of ids) {
      if (id === this.cfg.localId) continue;
      this.sim.removeKart(id);
      this.view.removeKart(id);
      this.app.hud.removeKart(id);
      this.remote.delete(id);
    }
  }

  interpolateRemotes() {
    const renderT = this.net.serverNow() - INTERP_DELAY;
    const t = this.sim.track;
    for (const [id, buf] of this.remote) {
      const k = this.sim.kartById(id);
      if (!k || buf.length === 0) continue;
      let a = buf[0], b = null;
      for (let i = 0; i < buf.length; i++) {
        if (buf[i].ts <= renderT) a = buf[i];
        else {
          b = buf[i];
          break;
        }
      }
      while (buf.length > 2 && buf[1].ts <= renderT) buf.shift();
      const A = a.a;
      let x = A[1], y = A[2], z = A[3], yaw = A[4], dist = A[7];
      if (b && b.ts > a.ts) {
        const u = Math.max(0, Math.min(1, (renderT - a.ts) / (b.ts - a.ts)));
        const B = b.a;
        x += (B[1] - x) * u;
        y += (B[2] - y) * u;
        z += (B[3] - z) * u;
        let d = B[4] - yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        yaw += d * u;
        dist += (B[7] - dist) * u;
      } else {
        // Extrapolate briefly
        const ex = Math.min(0.2, (renderT - a.ts) / 1000);
        x += Math.sin(yaw) * A[5] * ex;
        z += Math.cos(yaw) * A[5] * ex;
      }
      k.x = x; k.y = y; k.z = z; k.yaw = yaw;
      k.fwdSpeed = A[5];
      k.vx = Math.sin(yaw) * A[5];
      k.vz = Math.cos(yaw) * A[5];
      k.dist = dist;
      k.lap = A[8];
      k.pitch = A[9] || 0;
      k.steerVis = A[10] || 0;
      applyFlags(k, A[6]);
      t.query(k.x, k.z, k.hint, k.q);
      k.hint = k.q.idx;
    }
  }

  sendState(dt) {
    this.sendAcc += dt;
    if (this.sendAcc < 1 / SEND_HZ) return;
    this.sendAcc = 0;
    const d = this.sim.karts.filter((k) => k.local).map(packKart);
    if (d.length) this.net.send({ t: "s", d });
  }

  flushOutbox() {
    for (const e of this.sim.outbox) {
      if (!this.online) continue;
      if (e.type === "fin") this.net.send({ t: "fin", id: e.id, time: e.time });
      else this.net.send({ t: "ev", e });
    }
    this.sim.outbox.length = 0;
  }

  // ---------------------------------------------------------------- audio
  playEvents(events) {
    const me = this.me;
    const hud = this.app.hud;
    for (const { kart: k, e } of events) {
      const mine = k === me;
      if (!mine) {
        if (!me || !SPATIAL.has(e)) continue;
        const d = Math.hypot(k.x - me.x, k.z - me.z);
        if (d > 50) continue;
        const v = (1 - d / 50) * 0.5;
        const name = e.startsWith("hit") ? "spin" : e.startsWith("use") ? "throw" : e;
        audio.play(name, v);
        continue;
      }
      switch (e) {
        case "hop": audio.play("hop"); break;
        case "driftLevel1": audio.play("drift1"); break;
        case "driftLevel2": audio.play("drift2"); break;
        case "driftLevel3": audio.play("drift3"); break;
        case "boost": audio.play("boost"); break;
        case "roulette": audio.play("roulette"); break;
        case "itemReady": audio.play("itemGet"); break;
        case "use:banana": case "use:green": case "use:red": audio.play("throw"); break;
        case "hit:spin": audio.play("spin"); break;
        case "hit:tumble": audio.play("shellHit"); audio.play("spin", 0.6); break;
        case "hit:squish": audio.play("splat"); break;
        case "wall": audio.play("wall"); break;
        case "bump": audio.play("bump", 0.6); break;
        case "coin": audio.play("coin"); break;
        case "star": audio.play("star"); break;
        case "zap": audio.play("bolt"); hud.flash("#bfe4ff", 0.85); break;
        case "splat": audio.play("splat"); break;
        case "fall": audio.play("fall"); break;
        case "land": audio.play("land", 0.7); break;
        case "trick": audio.play("trick"); break;
        case "burnout": audio.play("burnout"); hud.message("Too early!", "info", "", 1.2); break;
        case "rocket": hud.message("Rocket start!", "info", "", 1.0); break;
        case "use:bolt": audio.play("bolt"); hud.flash("#bfe4ff", 0.6); break;
        case "use:splat": audio.play("splat", 0.6); break;
        case "lap":
          hud.lap(k, this.sim);
          if (k.lap === this.sim.laps) {
            audio.play("finalLap");
            hud.message("FINAL LAP!", "final", "", 2);
            audio.tempoMul = 1.12;
          } else {
            audio.play("lap");
            hud.message(`LAP ${k.lap}`, "info", "", 1.2);
          }
          break;
        case "finish":
          audio.play("finish");
          audio.tempoMul = 1;
          hud.lap(k, this.sim);
          if (this.sim.mode === "tt") hud.message("FINISH!", "finish", this.app.fmtTime(k.finishTime), 3);
          else hud.message("FINISH!", "finish", `${ordinal(k.place)} place!`, 3);
          this.finishShownAt = performance.now();
          break;
      }
    }
    for (const f of this.sim.fx) {
      if (f.type === "boxBreak" && me && Math.hypot(f.x - me.x, f.z - me.z) < 8) audio.play("box", 0.7);
      if ((f.type === "shellHit" || f.type === "poof") && me && Math.hypot(f.x - me.x, f.z - me.z) < 40) audio.play("shellHit", 0.5);
    }
  }

  // ---------------------------------------------------------------- loop
  update(dt) {
    const sim = this.sim;
    const me = this.me;
    if (this.online) {
      const target = (this.net.serverNow() - this.cfg.startAt) / 1000;
      const diff = target - sim.time;
      if (sim.time < 0 || Math.abs(diff) > 1) sim.time += diff;
      else sim.time += diff * 0.05;
      this.interpolateRemotes();
    }
    const ctl = input.controls();
    if (me && !me.finished && this.cfg.mode !== "attract") {
      Object.assign(me.ctl, ctl);
      if (this.paused) me.ctl.throttle = me.ctl.drift = me.ctl.item = 0;
    }
    this.view.lookBack = ctl.lookBack && me && !me.finished;
    if (!this.paused || this.online) sim.update(dt);
    const events = sim.takeEvents();
    if (this.cfg.mode !== "attract") this.playEvents(events);
    this.view.update(dt, events);
    this.flushOutbox();
    if (this.online) this.sendState(dt);
    if (this.cfg.mode === "tt") {
      this.recordGhost(dt);
      this.updateGhost();
    }
    if (me && this.cfg.mode !== "attract") {
      this.app.hud.update(dt, sim, me, (c) => audio.play(c === "GO!" ? "go" : "count"));
      const maxS = me.stats.maxSpeed;
      audio.updateEngine("me", Math.abs(me.fwdSpeed) / maxS, {
        throttle: me.ctl.throttle,
        boost: me.boostT > 0,
        drift: me.drifting && me.grounded,
        air: !me.grounded,
        rev: me.revving && sim.time < 0,
        vol: me.respawnT > 0 ? 0.3 : 1,
      });
    }
    // End of race (single player modes)
    if (!this.online && !this.ended && this.finishShownAt && performance.now() - this.finishShownAt > 4200) {
      this.ended = true;
      this.app.onRaceEnd(this);
    }
  }

  recordGhost(dt) {
    const me = this.me;
    if (!me || this.sim.time < 0 || me.finished) return;
    this.ghostAcc += dt;
    while (this.ghostAcc >= 0.05) {
      this.ghostAcc -= 0.05;
      const r = (v) => Math.round(v * 100) / 100;
      this.ghostFrames.push([r(me.x), r(me.y), r(me.z), r(me.yaw)]);
    }
  }

  // Final ranking for single player modes (unfinished karts get estimated times).
  results() {
    const sim = this.sim;
    const rows = sim.karts.map((k) => ({
      id: k.id,
      name: k.name,
      char: k.char,
      human: k.human,
      time: k.finished ? k.finishTime : sim.estimateFinish(k),
      estimated: !k.finished,
    }));
    rows.sort((a, b) => a.time - b.time);
    return rows;
  }

  render() {
    this.view.render();
  }

  resize(w, h) {
    this.view.resize(w, h);
  }

  dispose() {
    audio.engine("me", false);
    this.view.dispose();
  }
}
