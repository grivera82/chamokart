// Live spectating. While someone watches, the racer's game (Broadcaster) streams a light copy
// of its race over the presence connection: the grid once, then every kart ten times a second,
// the items on the road and what just happened. The watcher's game (SpectateSession) builds the
// same track and plays the stream back a moment behind, like the online remote karts.
import { RaceSim } from "./sim/race.js?v=21";
import { RaceView } from "./view/raceview.js?v=27";
import { TRACKS, CHARACTERS } from "./data.js?v=19";
import { audio } from "./audio.js?v=11";
import { packKart } from "./net.js?v=7";
import { ordinal } from "./hud.js?v=24";
import { poseKarts, VISUAL } from "./replay.js?v=5";

const CAST_HZ = 10;
const DELAY = 0.3; // seconds the watcher stays behind the newest frame, to smooth out the network
// What the watcher gets to see and hear (the rest stays on the racer's side)
export const CAST_EVENTS = new Set([...VISUAL, "lap", "use:banana", "use:green", "use:red", "use:bolt", "use:star", "use:splat", "use:blue", "use:bomb", "use:fire", "use:boomerang", "use:horn", "use:coin", "boost", "coin", "itemReady", "stolen"]);
const r2 = (v) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------- the racer's side

export class Broadcaster {
  constructor(send) {
    this.send = send; // (msg) => bool, false when the presence connection is down
    this.watchers = []; // names
    this.sent = "off"; // the session we sent the grid for, or "off" once we've said there's no race
    this.acc = 0;
    this.events = [];
    this.fx = [];
    this.boxes = "";
    this.coins = "";
  }

  setWatchers(names, fresh) {
    this.watchers = names;
    if (fresh) this.sent = null; // somebody new: send the grid (or "no race") again
  }

  // RaceSession passes each update's events here before the view uses them up.
  tap(session, events, fx) {
    if (session !== this.sent) return;
    for (const { kart: k, e } of events) if (CAST_EVENTS.has(e) && this.events.length < 40) this.events.push([k.id, e]);
    for (const f of fx) if (this.fx.length < 20) this.fx.push([f.type, r2(f.x), r2(f.y), r2(f.z)]);
  }

  tick(dt, session) {
    if (!this.watchers.length) {
      this.sent = "off";
      return;
    }
    const live = session && session.cfg.mode !== "attract" && !session.ended && !session.replay ? session : null;
    if (!live) {
      // The race is over, they left it, or there isn't one: tell the watchers once
      const msg = !this.sent ? { t: "cast", k: "idle" } : { t: "cast", k: "end", quit: session !== this.sent ? 1 : 0 };
      if (this.sent !== "off" && this.send(msg)) this.sent = "off";
      return;
    }
    if (this.sent !== live) {
      if (!this.send(this.setup(live))) return;
      this.sent = live;
      this.acc = 1;
      this.events = [];
      this.fx = [];
      this.boxes = this.coins = "";
    }
    this.acc += dt;
    if (this.acc < 1 / CAST_HZ) return;
    this.acc = 0;
    this.send(this.frame(live));
    this.events = [];
    this.fx = [];
  }

  setup(session) {
    const { cfg, sim } = session;
    session.castId ||= Math.random().toString(36).slice(2, 10);
    return {
      t: "cast",
      k: "setup",
      id: session.castId,
      race: {
        track: cfg.track,
        laps: sim.laps,
        cc: sim.cc,
        mode: cfg.daily ? "daily" : cfg.mode,
        items: sim.itemsEnabled,
        intro: sim.opts.introTime ?? 3,
        grid: sim.karts.map((k) => ({ id: k.id, name: k.name, char: k.char, kart: k.kartType, human: !!k.human, look: k.look || undefined })),
      },
      focus: session.me?.id ?? null,
      tm: r2(sim.time),
    };
  }

  frame(session) {
    const sim = session.sim;
    const me = session.me;
    const f = {
      t: "cast",
      k: "f",
      tm: r2(sim.time),
      d: sim.karts.map(packKart),
      o: sim.items.objects.slice(0, 40).map((o) => [o.id, o.type, r2(o.x), r2(o.y), r2(o.z), o.orbit ? 1 : o.trail ? 2 : 0, o.trail || o.orbit ? o.owner : 0]),
      fin: sim.karts.filter((k) => k.finished).map((k) => [k.id, r2(k.finishTime)]),
      me: me ? [me.item || "", me.itemCount || 0, me.coins || 0, me.roulette > 0 ? 1 : 0] : null,
      p: session.paused ? 1 : 0,
    };
    if (this.events.length) f.e = this.events;
    if (this.fx.length) f.fx = this.fx;
    // Item boxes and coins only when they change, or every couple of seconds for newcomers
    const boxes = sim.items.boxes.flatMap((b, i) => (b.active ? [] : [i]));
    const coins = sim.items.coins.flatMap((c, i) => (c.active ? [] : [i]));
    const refresh = Math.random() < 0.05;
    if (refresh || boxes.join() !== this.boxes) f.bx = boxes;
    if (refresh || coins.join() !== this.coins) f.cn = coins;
    this.boxes = boxes.join();
    this.coins = coins.join();
    return f;
  }
}

// ---------------------------------------------------------------- the watcher's side

export class SpectateSession {
  constructor(app, setup) {
    this.app = app;
    this.id = setup.id;
    const r = setup.race;
    this.mode = r.mode;
    this.def = TRACKS[r.track];
    const grid = r.grid.map((g) => ({ ...g, bot: !g.human, local: false }));
    this.sim = new RaceSim({ track: r.track, laps: r.laps, cc: r.cc, mode: r.mode === "daily" ? "tt" : r.mode, items: r.items, seed: 1, grid, introTime: r.intro });
    this.sim.time = setup.tm;
    this.casterId = this.sim.kartById(setup.focus) ? setup.focus : this.sim.karts[0].id;
    this.focusId = this.casterId;
    this.view = new RaceView(app.renderer, this.sim, { focusId: this.focusId, quality: app.settings.quality, nameTags: true, mode: "race" });
    this.view.resize(app.width, app.height);
    this.frames = [];
    this.playT = null;
    this.over = false;
    this.lastFrameAt = performance.now();
    this.fromStart = setup.tm < 0; // lap splits only make sense if we saw the whole race
    app.hud.setup(this.sim, this.focusId, { mode: this.sim.mode });
    audio.playSong(this.def.music);
    audio.engine("me", true);
  }

  push(f) {
    const last = this.frames[this.frames.length - 1];
    if (last && f.tm < last.tm - 1) this.frames.length = 0; // the racer restarted: start over
    this.frames.push(f);
    if (this.frames.length > 80) this.frames.shift();
    this.lastFrameAt = performance.now();
  }

  get paused() {
    return !!this.frames[this.frames.length - 1]?.p;
  }

  // Seconds since the racer last sent anything (their game is in the background, or the network)
  get stalled() {
    return (performance.now() - this.lastFrameAt) / 1000;
  }

  // Follow another racer (dir ±1, in race order)
  cycleFocus(dir) {
    const order = this.sim.standings || this.sim.karts;
    if (order.length < 2) return;
    const i = order.findIndex((k) => k.id === this.focusId);
    const next = order[(i + dir + order.length) % order.length];
    this.hudRow(this.focusId, false);
    this.focusId = next.id;
    this.hudRow(this.focusId, true);
    this.view.focusId = next.id;
    this.view.camYaw = null;
    this.view.finishOrbit = 0;
    this.app.hud.cache = {};
    return next;
  }

  hudRow(id, on) {
    this.app.hud.rows?.get(id)?.row.classList.toggle("me", on);
  }

  get focus() {
    return this.sim.kartById(this.focusId);
  }

  update(dt) {
    const sim = this.sim;
    const F = this.frames;
    const hud = this.app.hud;
    const evs = [];
    if (F.length) {
      const newest = F[F.length - 1].tm;
      const target = newest - DELAY;
      const prev = this.playT;
      if (this.playT == null || Math.abs(target - this.playT) > 1.5) this.playT = target;
      else this.playT += dt + (target - this.playT) * Math.min(1, dt * 1.5);
      this.playT = Math.min(this.playT, newest);
      const t = this.playT;
      let i = F.length - 1;
      while (i > 0 && F[i].tm > t) i--;
      const a = F[i], b = F[Math.min(F.length - 1, i + 1)];
      const u = b.tm > a.tm ? Math.max(0, Math.min(1, (t - a.tm) / (b.tm - a.tm))) : 0;
      poseKarts(sim, a.d, b.d, u);
      for (const [id, ft] of a.fin || []) {
        const k = sim.kartById(id);
        if (k) k.finishTime = ft;
      }
      for (const k of sim.karts) if (k.finished && k.finishTime == null) k.finishTime = t;
      const me = sim.kartById(this.casterId);
      if (me && a.me) [me.item, me.itemCount, me.coins, me.roulette] = [a.me[0] || null, a.me[1], a.me[2], a.me[3]];
      // Items on the road, blended between frames
      const bObj = new Map(b.o.map((o) => [o[0], o]));
      this.view.replayObjects = a.o.map(([id, type, x, y, z, hold, owner]) => {
        const B = bObj.get(id);
        if (B) (x += (B[2] - x) * u), (y += (B[3] - y) * u), (z += (B[4] - z) * u);
        return { id, type, x, y, z, age: t, orbit: hold === 1, trail: hold === 2, owner: owner || null };
      });
      // What happened since the last update (skipped after a jump, so nothing piles up)
      const jumped = prev == null || t - prev > 1;
      for (const f of F) {
        if (f.tm <= (prev ?? -Infinity) || f.tm > t) continue;
        if (f.bx) sim.items.boxes.forEach((box, j) => (box.active = !f.bx.includes(j)));
        if (f.cn) sim.items.coins.forEach((c, j) => (c.active = !f.cn.includes(j)));
        if (jumped) continue;
        for (const [id, e] of f.e || []) {
          const k = sim.kartById(id);
          if (k) evs.push({ kart: k, e });
        }
        for (const [type, x, y, z] of f.fx || []) sim.fx.push({ type, x, y, z });
      }
      sim.time = t;
      sim.updatePlaces();
    }
    this.playEvents(evs);
    this.view.update(dt, evs);
    const k = this.focus;
    if (k) {
      hud.update(dt, sim, k, (c) => audio.play(c === "GO!" ? "go" : "count"));
      audio.updateEngine("me", Math.abs(k.fwdSpeed) / k.stats.maxSpeed, {
        throttle: k.fwdSpeed > 1 ? 1 : 0,
        boost: k.boostT > 0,
        drift: k.drifting && k.grounded,
        air: !k.grounded,
        vol: k.respawnT > 0 || this.paused ? 0.3 : 0.8,
      });
    }
  }

  // The followed kart's sounds and messages (a quieter version of the racer's)
  playEvents(events) {
    const hud = this.app.hud;
    for (const { kart: k, e } of events) {
      if (k.id !== this.focusId) continue;
      if (e === "pad" && CHARACTERS[k.char]?.style === "tabby") audio.play("meow", 0.8);
      switch (e) {
        case "use:banana": case "use:green": case "use:red": case "use:bomb": case "use:boomerang": audio.play("throw", 0.7); break;
        case "use:fire": audio.play("fireball", 0.7); break;
        case "use:blue": audio.play("blueShell", 0.7); break;
        case "use:horn": audio.play("horn", 0.7); break;
        case "bullet": audio.play("bullet", 0.7); break;
        case "chomp": audio.play("chomp", 0.6); break;
        case "boo": audio.play("boo", 0.7); break;
        case "stolen": audio.play("stolen", 0.7); break;
        case "hit:spin": audio.play("spin", 0.7); break;
        case "hit:tumble": audio.play("shellHit", 0.7); break;
        case "hit:squish": audio.play("splat", 0.7); break;
        case "wall": audio.play("wall", 0.6); break;
        case "boost": audio.play("boost", 0.6); break;
        case "coin": audio.play("coin", 0.5); break;
        case "itemReady": audio.play("itemGet", 0.6); break;
        case "zap": case "use:bolt": audio.play("bolt", 0.7); hud.flash("#bfe4ff", 0.6); break;
        case "fall": audio.play("fall", 0.7); break;
        case "trick": audio.play("trick", 0.7); break;
        case "lap":
          if (this.fromStart && k.id === this.casterId) hud.lap(k, this.sim);
          if (k.lap === this.sim.laps) {
            audio.play("finalLap", 0.8);
            hud.message("FINAL LAP!", "final", "", 2);
          } else {
            audio.play("lap", 0.8);
            hud.message(`LAP ${k.lap}`, "info", "", 1.2);
          }
          break;
        case "finish":
          audio.play("finish", 0.8);
          if (this.sim.mode === "tt") hud.message("FINISH!", "finish", this.app.fmtTime(k.finishTime), 3);
          else hud.message("FINISH!", "finish", `${k.name} is ${ordinal(k.place)}!`, 3);
          break;
      }
    }
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
