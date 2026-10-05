// A single race: glues simulation, rendering, HUD, audio, input and network.
import * as THREE from "three";
import { RaceSim, COUNTDOWN } from "./sim/race.js?v=22";
import { RaceView } from "./view/raceview.js?v=28";
import { buildKart } from "./view/models.js?v=25";
import { TRACKS, CHARACTERS, trackDef } from "./data.js?v=20";
import { audio } from "./audio.js?v=11";
import { input } from "./input.js?v=7";
import { packKart, applyFlags } from "./net.js?v=7";
import { onBoostPad } from "./sim/kart.js?v=21";
import { ordinal } from "./hud.js?v=25";
import { labelTexture } from "./view/textures.js?v=9";
import { Tutorial } from "./tutorial.js?v=5";
import { ReplayRecorder, ReplayPlayer } from "./replay.js?v=5";

const SEND_HZ = 20;
const INTERP_DELAY = 110;
const SPATIAL = new Set(["wall", "hit:spin", "hit:tumble", "hit:squish", "use:banana", "use:green", "use:red", "use:bomb", "use:boomerang", "use:fire", "boost", "bump", "land", "chomp", "bullet", "boo"]);
const SOUND_OF = { "use:fire": "fireball", "use:bomb": "throw", "use:boomerang": "throw" };

export class RaceSession {
  constructor(app, cfg) {
    this.app = app;
    this.cfg = cfg;
    this.net = cfg.net || null;
    this.online = cfg.mode === "online";
    let introTime = 3.4;
    if (this.online) introTime = Math.max(0.3, (cfg.startAt - this.net.serverNow()) / 1000 - COUNTDOWN);
    if (cfg.mode === "attract") introTime = 0;
    if (cfg.quickStart) introTime = 0.4; // straight back into the countdown (beta retries)
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
    // D is a special move for some cars: the CX-9 opens its doors, Bumblebee transforms.
    this.specialCar = this.me && cfg.mode !== "attract" ? CHARACTERS[this.me.char]?.car : null;
    this.hasSpecial = this.specialCar === "cx9" || this.specialCar === "transformer";
    if (this.hasSpecial) input.specialKey = true;
    this.remote = new Map();
    this.sendAcc = 0;
    this.finishShownAt = null;
    this.ended = false;
    this.paused = false;
    this.lastLap = 1;
    this.finalLapPlayed = false;
    this.def = trackDef(cfg.track);
    if (cfg.mode !== "attract") {
      app.hud.setup(this.sim, cfg.localId, { mode: cfg.mode, records: cfg.mode === "tt" && !cfg.daily && !cfg.beta });
      audio.playSong(this.def.music);
      audio.engine("me", true);
    }
    this.tutorial = cfg.mode === "tutorial" ? new Tutorial(this, () => app.onTutorialDone(this)) : null;
    // Highlights replay after races against other racers
    this.recorder = ["gp", "vs", "online"].includes(cfg.mode) && this.me ? new ReplayRecorder(this.sim, this.me.id) : null;
    this.replay = null;
    // Time trial ghosts: your best run and/or the board record holder's
    this.ghostFrames = [];
    this.ghostAcc = 0;
    this.ghosts = [];
    if (cfg.mode === "tt") {
      if (cfg.ghost) this.setupGhost(cfg.ghost);
      if (cfg.recordGhost) this.setupGhost(cfg.recordGhost, cfg.recordGhost.label || `#${cfg.recordGhost.rank} ${cfg.recordGhost.name}`);
    }
  }

  setupGhost(g, label) {
    const model = buildKart(g.char, g.kart, g.look);
    model.traverse((o) => {
      if (o.isMesh) {
        const ghost = (m) => Object.assign(m.clone(), { transparent: true, opacity: 0.4, depthWrite: false });
        o.material = Array.isArray(o.material) ? o.material.map(ghost) : ghost(o.material);
        o.castShadow = false;
      }
    });
    if (label) {
      // The record holder's ghost carries a name tag, in gold
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(label, "#ffd23f"), depthWrite: false, transparent: true, opacity: 0.85 }));
      tag.scale.set(4, 1, 1);
      tag.position.y = 2.9;
      model.add(tag);
    }
    this.view.scene.add(model);
    this.ghosts.push({ g, model, record: !!label });
  }

  updateGhost() {
    const t = Math.max(0, this.sim.time) * 20;
    this.app.hud.ghosts = [];
    for (const { g, model, record } of this.ghosts) {
      const f = g.frames;
      const i = Math.min(f.length - 2, Math.floor(t));
      if (i < 0 || f.length < 2) continue;
      const a = f[i], b = f[i + 1];
      const u = Math.min(1, t - i);
      let dy = b[3] - a[3];
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      model.position.set(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u);
      model.rotation.y = a[3] + dy * u;
      model.visible = this.sim.time >= 0 && t < f.length;
      this.app.hud.ghosts.push({ x: model.position.x, z: model.position.z, record });
    }
  }

  // Safari Run: a sign on the HUD when animals cross just ahead (blinking while they're on the road)
  crossingWarning() {
    const el = this.app.hud.el.warn;
    const me = this.me;
    const next = this.sim.crossings.next(me.q.idx ?? 0);
    const ahead = next && next.d * this.sim.track.spacing;
    let text = "";
    let live = false;
    if (next && ahead < 110 && !me.finished && !me.crashed) {
      text = `⚠️ ${next.c.kind.toUpperCase()} CROSSING`;
      live = this.sim.crossings.animals.some((a) => this.sim.crossings.list[a.c] === next.c && Math.abs(a.lat) < this.sim.track.hw[next.c.i] + 3);
    }
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle("live", live);
  }

  // Play the race's highlights; calls ui.done() when they end (or right away if there are none).
  playHighlights(ui) {
    const clips = this.recorder?.clips() || [];
    if (!clips.length) return ui.done(), false;
    this.replay = new ReplayPlayer(this, this.recorder, clips, {
      ...ui,
      done: () => {
        this.replay = null;
        ui.done();
      },
    });
    return true;
  }

  skipReplay() {
    this.replay?.finish();
  }

  toggleSpecial() {
    if (!this.hasSpecial || this.paused) return false;
    const on = (this.me.special = !this.me.special);
    if (this.specialCar === "transformer") {
      audio.play(on ? "transform" : "transformBack");
      return true;
    }
    audio.play(on ? "doorOpen" : "doorClose");
    audio.say("Mashamiiiiii", { pitch: 1.15, rate: 0.85 });
    return true;
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
    if ((e.type === "bolt" || e.type === "splat" || e.type === "horn" || e.type === "steal") && !owns(e.from)) return;
    if (e.type === "gone" && !owns(this.sim.items.objects.find((o) => o.id === e.id)?.owner)) return;
    this.sim.items.applyRemote(e);
    if (e.type === "bolt") {
      audio.play("bolt");
      this.app.hud.flash("#bfe4ff", 0.85);
    }
    if (e.type === "spawn" && e.o?.type === "blue") audio.play("blueShell", 0.6);
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
      // Other players' karts don't run physics here, so spot them rolling onto a speed booster
      const pad = k.grounded && onBoostPad(t, k.q);
      if (pad && !k.remotePad) k.events.push("pad");
      k.remotePad = pad;
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
      if (mine && e.startsWith("crash:") && !this.crashAt) {
        const kind = e.slice(6);
        audio.play("shellHit");
        audio.play("spin", 0.8);
        hud.flash("#ff4040", 0.6);
        hud.message(`💥 You hit ${kind === "elephant" ? "an" : "a"} ${kind}!`, "final", "Back to the start…", 2.4);
        this.crashAt = performance.now();
        continue;
      }
      if (e === "pad" && CHARACTERS[k.char]?.style === "tabby") {
        // Dorito's meow: loud if it's you, fainter from a Dorito nearby
        const d = mine || !me ? 0 : Math.hypot(k.x - me.x, k.z - me.z);
        if (d < 60) audio.play("meow", mine ? 1 : (1 - d / 60) * 0.6);
      }
      if (!mine) {
        if (e === "use:blue") audio.play("blueShell", 0.5); // heard from anywhere: it could be coming for you
        if (!me || !SPATIAL.has(e)) continue;
        const d = Math.hypot(k.x - me.x, k.z - me.z);
        if (d > 50) continue;
        const v = (1 - d / 50) * 0.5;
        const name = e.startsWith("hit") ? "spin" : SOUND_OF[e] || (e.startsWith("use") ? "throw" : e);
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
        case "use:banana": case "use:green": case "use:red": case "use:bomb": case "use:boomerang": audio.play("throw"); break;
        case "use:fire": audio.play("fireball"); break;
        case "use:blue": audio.play("blueShell"); hud.message("Blue Shell!", "info", "It's going after the leader", 1.4); break;
        case "use:horn": audio.play("horn"); hud.flash("#fff6c0", 0.5); break;
        case "use:coin": audio.play("coin"); break;
        case "bullet": audio.play("bullet"); break;
        case "piranha": audio.play("chomp"); break;
        case "chomp": audio.play("chomp", 0.8); break;
        case "boo": audio.play("boo"); break;
        case "stolen": audio.play("stolen"); hud.message("A Boo stole your item!", "info", "", 1.6); break;
        case "blasted": hud.flash("#9ad0ff", 0.7); break;
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
          if (this.tutorial) break; // laps don't count in the tutorial
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
      if ((f.type === "boom" || f.type === "bigBoom") && me) {
        const d = Math.hypot(f.x - me.x, f.z - me.z);
        if (d < 90) audio.play(f.type, Math.max(0.25, 1 - d / 90));
      }
      if (f.type === "horn" && me && f.from !== me.id && Math.hypot(f.x - me.x, f.z - me.z) < 60) audio.play("horn", 0.6);
    }
  }

  // ---------------------------------------------------------------- loop
  update(dt) {
    const sim = this.sim;
    const me = this.me;
    if (this.replay) {
      // The race is paused behind the replay (online state keeps buffering for afterwards)
      this.replay.update(dt);
      audio.updateEngine("me", 0, { vol: 0 });
      return;
    }
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
      if (me.crashed) Object.assign(me.ctl, { throttle: 0, brake: 0, steer: 0, drift: false, item: false }); // ran into an animal: game over
    }
    this.view.lookBack = ctl.lookBack && me && !me.finished;
    if (!this.paused || this.online) sim.update(dt);
    const events = sim.takeEvents();
    this.app.caster?.tap(this, events, sim.fx); // anyone watching sees them too
    if (!this.paused) this.tutorial?.update(dt, events);
    if (this.cfg.mode !== "attract") this.playEvents(events);
    this.recorder?.record(dt, events);
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
    if (sim.crossings && me) this.crossingWarning();
    // Beta: after hitting an animal, start over
    if (this.crashAt && !this.ended && performance.now() - this.crashAt > 2300) {
      this.ended = true;
      this.app.betaCrash(this);
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
      look: k.look,
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
    this.tutorial?.dispose();
    if (this.hasSpecial) input.specialKey = false;
    audio.engine("me", false);
    this.view.dispose();
  }
}
