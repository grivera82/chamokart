// Chamo Kart: app shell, menus, game flow.
import * as THREE from "three";
import { CHARACTERS, KARTS, TRACKS, CUPS, POINTS, ITEMS } from "./data.js?v=3";
import { getTrack } from "./sim/race.js?v=3";
import { RaceSession } from "./game.js?v=5";
import { HUD, ITEM_SVG, fmtTime, ordinal } from "./hud.js?v=3";
import { audio } from "./audio.js?v=4";
import { input } from "./input.js?v=4";
import { Net } from "./net.js?v=3";
import { Voice } from "./voice.js?v=5";
import { Showroom, renderPortraits } from "./view/showroom.js?v=4";
import { setAnisotropy } from "./view/textures.js?v=3";

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem("ck_" + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem("ck_" + k, JSON.stringify(v));
    } catch {}
  },
};
const isTouch = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
const TITLE_SONG = { bpm: 132, root: 62, mode: "major", seed: 7 };
const LOBBY_SONG = { bpm: 112, root: 60, mode: "mixolydian", seed: 91 };

class App {
  constructor() {
    this.settings = Object.assign(
      { name: "", char: 0, kart: 0, cc: 150, music: 0.55, sfx: 0.8, voice: 1, quality: isTouch ? "medium" : "high", autoAccel: false, touch: isTouch, steer: "pad", fps: false, laps: 3, items: true },
      store.get("settings", {})
    );
    this.hud = new HUD($("#hud"));
    this.history = [];
    this.screen = null;
    this.session = null;
    this.attract = null;
    this.flow = null;
    this.net = null;
    this.voice = null;
    this.room = null;
    this.fmtTime = fmtTime;
  }

  save() {
    store.set("settings", this.settings);
  }

  // ------------------------------------------------------------------ boot
  async boot() {
    const canvas = $("#game");
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.settings.quality !== "low", alpha: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    setAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    this.applyQuality();
    window.addEventListener("resize", () => this.resize());
    // iOS can report the old size on the first resize after rotating.
    window.addEventListener("orientationchange", () => setTimeout(() => this.resize(), 300));
    this.resize();
    const bar = $("#loadbar-fill");
    const step = (p, msg) =>
      new Promise((r) => {
        bar.style.width = p + "%";
        $("#load-msg").textContent = msg;
        setTimeout(r, 30);
      });

    await step(15, "Painting the karts…");
    this.portraits = renderPortraits(this.renderer);
    this.hud.portraits = this.portraits;
    await step(40, "Building the tracks…");
    for (let i = 0; i < TRACKS.length; i++) getTrack(i);
    await step(65, "Waking up the racers…");
    this.showroom = new Showroom(this.renderer);
    this.startAttract();
    await step(90, "Tuning the mariachis…");
    this.buildStaticUI();
    this.bindUI();
    input.bindTouch($("#hud"));
    document.body.classList.toggle("touch-on", this.settings.touch);
    input.touchMode = this.settings.touch;
    input.autoAccel = this.settings.autoAccel;
    document.body.classList.toggle("tilt-on", this.settings.steer === "tilt");
    // iOS asks for motion access on a tap (see bindUI); elsewhere tilt can start right away.
    if (this.settings.steer === "tilt" && typeof window.DeviceOrientationEvent?.requestPermission !== "function") this.setSteer("tilt", true);
    audio.setVolumes(this.settings.music, this.settings.sfx);
    await step(100, "¡Vámonos!");
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    this.show("title");
    const m = location.hash.match(/room=([A-Za-z]{4})/);
    if (m) this.pendingJoin = m[1].toUpperCase();
  }

  applyQuality() {
    const q = this.settings.quality;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === "high" ? Math.min(dpr, 2) : q === "medium" ? Math.min(dpr, 1.4) : Math.min(dpr, 1));
    this.renderer.shadowMap.enabled = q !== "low";
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.setSize(this.width, this.height, false);
    this.session?.resize(this.width, this.height);
    this.attract?.resize(this.width, this.height);
    this.showroom?.resize(this.width, this.height);
  }

  startAttract() {
    if (this.attract) return;
    const track = Math.floor(Math.random() * TRACKS.length);
    const grid = CHARACTERS.map((c, i) => ({ id: "a" + i, name: c.name, char: i, kart: i % 3, human: false, bot: true, local: true }));
    this.attract = new RaceSession(this, { mode: "attract", track, laps: 99, cc: 150, items: true, seed: Math.floor(Math.random() * 1e9), grid, localId: "a0" });
    this.attract.sim.time = -0.5;
    this.attract.resize(this.width, this.height);
  }

  stopAttract() {
    if (!this.attract) return;
    this.attract.dispose();
    this.attract = null;
  }

  // ------------------------------------------------------------------ loop
  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    input.pollPad();
    if (this.session) {
      this.session.update(dt);
      this.session.render();
    } else if (this.screen === "select") {
      this.showroom.update(dt);
      this.showroom.render();
    } else if (this.attract) {
      this.attract.update(dt);
      this.attract.render();
    }
    if (this.settings.fps) {
      this.fpsAcc = (this.fpsAcc || 0) + dt;
      this.fpsN = (this.fpsN || 0) + 1;
      if (this.fpsAcc > 0.5) {
        $("#fps").textContent = Math.round(this.fpsN / this.fpsAcc) + " fps";
        this.fpsAcc = 0;
        this.fpsN = 0;
      }
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------------ screens
  show(id, push = true) {
    if (this.screen && push && this.screen !== id && !$("#" + this.screen).classList.contains("overlay")) this.history.push(this.screen);
    for (const s of $$(".screen")) s.classList.toggle("active", s.id === id);
    this.screen = id;
    if (id === "select") this.showroom.resize(this.width, this.height);
    const first = $(`#${id} .btn.primary, #${id} .btn.pulse, #${id} .btn`);
    if (first && !isTouch) setTimeout(() => first.focus({ preventScroll: true }), 30);
  }

  hideScreens() {
    for (const s of $$(".screen")) s.classList.remove("active");
    this.screen = null;
  }

  back() {
    audio.play("back");
    if (this.screen === "lobby") return this.leaveRoom();
    if (this.screen === "pause") return this.resume();
    if (this.screen === "settings" && this.session) return this.show("pause", false);
    const prev = this.history.pop();
    if (prev) this.show(prev, false);
  }

  toast(text, err = false, ms = 3000) {
    const t = document.createElement("div");
    t.className = "toast" + (err ? " err" : "");
    t.textContent = text;
    $("#toasts").append(t);
    setTimeout(() => t.remove(), ms);
  }

  // ------------------------------------------------------------------ UI build
  buildStaticUI() {
    // Character grid
    const cg = $("#char-grid");
    CHARACTERS.forEach((c, i) => {
      const b = document.createElement("button");
      b.className = "char-card";
      b.dataset.char = i;
      const img = document.createElement("img");
      img.src = this.portraits[i];
      img.alt = c.name;
      const s = document.createElement("span");
      s.textContent = c.name;
      b.append(img, s);
      b.addEventListener("click", () => {
        this.settings.char = i;
        audio.play("menu");
        this.refreshSelect();
      });
      cg.append(b);
    });
    const kg = $("#kart-grid");
    KARTS.forEach((k, i) => {
      const b = document.createElement("button");
      b.className = "kart-card";
      b.dataset.kart = i;
      b.innerHTML = `<b></b><small></small>`;
      b.querySelector("b").textContent = k.name;
      b.querySelector("small").textContent = k.tag;
      b.addEventListener("click", () => {
        this.settings.kart = i;
        audio.play("menu");
        this.refreshSelect();
      });
      kg.append(b);
    });
    this.seg($("#cc-choices"), [50, 100, 150, 200].map((v) => [v, v + "cc"]), () => this.settings.cc, (v) => (this.settings.cc = v));
    this.seg($("#laps-choices"), [1, 2, 3, 4, 5].map((v) => [v, String(v)]), () => this.settings.laps, (v) => (this.settings.laps = v));
    this.seg($("#items-choices"), [[true, "On"], [false, "Off"]], () => this.settings.items, (v) => (this.settings.items = v));
    this.seg($("#set-steer"), [["pad", "Touch pad"], ["tilt", "Tilt phone"]], () => this.settings.steer, (v) => this.setSteer(v));
    this.seg($("#set-quality"), [["low", "Low"], ["medium", "Medium"], ["high", "High"]], () => this.settings.quality, (v) => {
      this.settings.quality = v;
      this.applyQuality();
      this.resize();
      this.toast("Graphics updated. Shadows apply on the next race.");
    });
    // How-to items
    const hi = $("#howto-items");
    const desc = {
      banana: "Drop behind you. Anyone who hits it spins out.",
      green: "Fires straight, bounces off walls.",
      red: "Homes in on the racer ahead of you.",
      chili: "A spicy burst of speed.",
      chili3: "Three spicy boosts!",
      star: "Invincible and faster. Ram everyone!",
      bolt: "Shrinks every rival and makes them drop items.",
      splat: "Splatters chamoy on the screens of everyone ahead.",
    };
    for (const k of Object.keys(ITEMS)) {
      const d = document.createElement("div");
      d.className = "hi";
      d.innerHTML = ITEM_SVG[k];
      const t = document.createElement("span");
      t.innerHTML = `<b></b> `;
      t.querySelector("b").textContent = ITEMS[k].name + ":";
      t.append(desc[k]);
      d.append(t);
      hi.append(d);
    }
    // Settings controls
    // Volume sliders appear in Settings, the pause menu and the lobby; keep every copy in sync.
    const bindRange = (key, fn) => {
      const els = $$(`input[data-vol="${key}"]`);
      for (const el of els) {
        el.value = this.settings[key];
        el.addEventListener("input", () => {
          this.settings[key] = Number(el.value);
          for (const other of els) if (other !== el) other.value = el.value;
          fn?.();
          this.save();
        });
        // Up/down move between menu items instead of nudging the slider.
        el.addEventListener("keydown", (e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault();
        });
      }
    };
    bindRange("music", () => audio.setVolumes(this.settings.music, this.settings.sfx));
    let sfxPing = 0;
    bindRange("sfx", () => {
      audio.setVolumes(this.settings.music, this.settings.sfx);
      if (performance.now() - sfxPing > 120) {
        sfxPing = performance.now();
        audio.play("coin");
      }
    });
    bindRange("voice", () => this.voice?.setVolume(this.settings.voice));
    const bindCheck = (id, key, fn) => {
      const el = $(id);
      el.checked = !!this.settings[key];
      el.addEventListener("change", () => {
        this.settings[key] = el.checked;
        fn?.();
        this.save();
      });
    };
    bindCheck("#set-auto", "autoAccel", () => (input.autoAccel = this.settings.autoAccel));
    bindCheck("#set-touch", "touch", () => {
      document.body.classList.toggle("touch-on", this.settings.touch);
      input.touchMode = this.settings.touch;
    });
    bindCheck("#set-fps", "fps", () => ($("#fps").textContent = ""));
  }

  // Switch between the on-screen steering pad and tilting the phone.
  setSteer(v, quiet = false) {
    this.settings.steer = v;
    document.body.classList.toggle("tilt-on", v === "tilt");
    if (v !== "tilt") return input.enableTilt(false);
    this.tiltAsked = true;
    input.enableTilt(true).then((ok) => {
      if (ok) {
        if (!quiet) this.toast("Tilt steering on: hold your phone like a steering wheel.");
        return;
      }
      this.settings.steer = "pad";
      this.save();
      document.body.classList.remove("tilt-on");
      $("#set-steer").refresh();
      this.toast("Can't read the motion sensors: allow Motion & Orientation access to steer by tilting.", true, 5000);
    });
  }

  seg(el, options, get, set) {
    el.innerHTML = "";
    for (const [v, label] of options) {
      const b = document.createElement("button");
      b.textContent = label;
      b.addEventListener("click", () => {
        set(v);
        this.save();
        audio.play("menu");
        [...el.children].forEach((c, i) => c.classList.toggle("on", options[i][0] === get()));
      });
      b.classList.toggle("on", v === get());
      el.append(b);
    }
    el.refresh = () => [...el.children].forEach((c, i) => c.classList.toggle("on", options[i][0] === get()));
  }

  refreshSelect() {
    const s = this.settings;
    $$(".char-card").forEach((b) => b.classList.toggle("sel", Number(b.dataset.char) === s.char));
    $$(".kart-card").forEach((b) => b.classList.toggle("sel", Number(b.dataset.kart) === s.kart));
    const c = CHARACTERS[s.char];
    $("#sel-name").textContent = c.name;
    $("#sel-tag").textContent = c.tag;
    const k = KARTS[s.kart];
    const st = $("#sel-stats");
    st.innerHTML = "";
    for (const key of ["speed", "accel", "weight", "handling"]) {
      const v = Math.max(0, Math.min(6, c.stats[key] + k.mods[key]));
      const lab = document.createElement("span");
      lab.textContent = { speed: "Speed", accel: "Acceleration", weight: "Weight", handling: "Handling" }[key];
      const bar = document.createElement("div");
      bar.className = "bar";
      bar.innerHTML = `<i style="width:${(v / 6) * 100}%"></i>`;
      st.append(lab, bar);
    }
    this.showroom.setKart(s.char, s.kart);
    $("#cc-choices").refresh();
    this.save();
  }

  drawTrackThumb(canvas, index) {
    const t = getTrack(index);
    const def = TRACKS[index];
    const w = (canvas.width = 260), h = (canvas.height = 200);
    const g = canvas.getContext("2d");
    const bgs = { meadow: ["#7ccf5a", "#3f9a3a"], desert: ["#f2c27a", "#c9854e"], snow: ["#eef4ff", "#a8c0e0"], beach: ["#5fd3f0", "#1f9be8"], neon: ["#2a0a4a", "#05010f"] };
    const [a, b] = bgs[def.theme];
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, a);
    grad.addColorStop(1, b);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const bb = t.bounds;
    const span = Math.max(bb.maxX - bb.minX, (bb.maxZ - bb.minZ) * (w / h)) + 60;
    const sc = w / span;
    const P = (i) => [w / 2 - (t.px[i] - (bb.minX + bb.maxX) / 2) * sc, h / 2 - (t.pz[i] - (bb.minZ + bb.maxZ) / 2) * sc];
    g.lineJoin = g.lineCap = "round";
    const path = () => {
      g.beginPath();
      for (let i = 0; i <= t.N; i++) {
        const p = P(i % t.N);
        i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]);
      }
    };
    path();
    g.strokeStyle = "#1d1530";
    g.lineWidth = 13;
    g.stroke();
    path();
    g.strokeStyle = def.theme === "neon" ? "#ff5bd6" : "#fff";
    g.lineWidth = 7;
    g.stroke();
    const s = P(0);
    g.fillStyle = "#e23b3b";
    g.strokeStyle = "#1d1530";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(s[0], s[1], 7, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }

  buildTracks(mode) {
    const grid = $("#track-grid");
    grid.innerHTML = "";
    const bests = store.get("best", {});
    this.selTrack = this.selTrack ?? 0;
    TRACKS.forEach((def, i) => {
      const b = document.createElement("button");
      b.className = "track-card";
      const cv = document.createElement("canvas");
      this.drawTrackThumb(cv, i);
      const info = document.createElement("div");
      info.className = "tinfo";
      const nm = document.createElement("b");
      nm.textContent = def.name;
      const sub = document.createElement("small");
      sub.textContent = def.sub;
      info.append(nm, sub);
      if (mode === "tt") {
        const best = document.createElement("small");
        best.className = "best";
        best.textContent = bests[i] ? "Best " + fmtTime(bests[i]) : "No record yet";
        info.append(best);
      }
      b.append(cv, info);
      b.addEventListener("click", () => {
        this.selTrack = i;
        audio.play("menu");
        $$(".track-card").forEach((x, j) => x.classList.toggle("sel", j === i));
      });
      b.addEventListener("dblclick", () => this.raceGo());
      b.classList.toggle("sel", i === this.selTrack);
      grid.append(b);
    });
    $("#laps-row").style.display = mode === "vs" ? "" : "none";
    $("#items-row").style.display = mode === "vs" ? "" : "none";
    $("#tracks-title").textContent = mode === "tt" ? "Time Trial: pick a track" : "Pick a track";
    $("#laps-choices").refresh();
    $("#items-choices").refresh();
  }

  // ------------------------------------------------------------------ events
  bindUI() {
    document.addEventListener("click", (e) => {
      audio.unlock();
      if (this.settings.steer === "tilt" && !input.tilt.listening && !this.tiltAsked) {
        this.tiltAsked = true;
        this.setSteer("tilt", true);
      }
      const el = e.target.closest("[data-action]");
      if (!el) return;
      this.action(el.dataset.action, el);
    });
    document.addEventListener("pointerdown", () => audio.unlock(), { once: true });
    // iOS Safari ignores user-scalable=no: block pinch zoom and the long-press menu.
    for (const ev of ["gesturestart", "gesturechange"]) document.addEventListener(ev, (e) => e.preventDefault());
    $("#hud").addEventListener("contextmenu", (e) => e.preventDefault());
    if (isTouch && navigator.share) $('[data-action="copy-link"]').textContent = "🔗 Share invite link";
    // iOS only treats touchend/click as a gesture that can start audio.
    document.addEventListener("touchend", () => audio.unlock(), { passive: true });
    input.on((type, code) => this.onKey(type, code));
    $("#chat-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const inp = $("#chat-input");
      const text = inp.value.trim();
      if (text && this.net) this.net.send({ t: "chat", text });
      inp.value = "";
    });
    const rc = $("#race-chat-input");
    $("#race-chat").addEventListener("submit", (e) => {
      e.preventDefault();
      const text = rc.value.trim();
      if (text && this.net) this.net.send({ t: "chat", text });
      this.closeRaceChat();
    });
    rc.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") this.closeRaceChat();
    });
    rc.addEventListener("blur", () => this.closeRaceChat());
    $("#name-input").addEventListener("change", () => {
      this.settings.name = $("#name-input").value.trim().slice(0, 14);
      this.save();
      this.sendProfile();
    });
    $("#code-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.action("join");
    });
    $("#pause-btn").addEventListener("click", () => this.pause());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.session && !this.session.online && !this.session.paused && this.session.sim.phase !== "done") this.pause();
    });
  }

  onKey(type, code) {
    audio.unlock();
    if (this.screen === "title" && (type === "key" || code === "confirm")) {
      if (code !== "Escape") return this.action("start");
    }
    const onRange = document.activeElement?.type === "range";
    const inField = document.activeElement && ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName) && !onRange;
    if (this.session && !this.screen) {
      if (input.isKey("pause", code)) this.pause();
      else if (this.session.online && (code === "Enter" || code === "NumpadEnter" || code === "KeyT")) setTimeout(() => this.openRaceChat(), 0);
      else if (this.session.online && code === "KeyV") this.action("hud-mic");
      return;
    }
    if (!this.screen) return;
    if ((code === "Escape" && !inField) || code === "cancel") {
      if (this.screen === "results" || this.screen === "podium" || this.screen === "title") return;
      if (this.screen === "menu") return;
      return this.back();
    }
    if (code === "confirm") {
      document.activeElement?.click?.();
      return;
    }
    const dirs = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (onRange && (code === "ArrowLeft" || code === "ArrowRight")) {
      // Keyboard adjusts the slider natively; the gamepad needs a nudge.
      if (type === "pad") {
        const el = document.activeElement;
        code === "ArrowLeft" ? el.stepDown(2) : el.stepUp(2);
        el.dispatchEvent(new Event("input"));
      }
      return;
    }
    if (dirs[code] && !inField) this.moveFocus(...dirs[code]);
  }

  moveFocus(dx, dy) {
    const root = $("#" + this.screen);
    const els = $$("button, input, select", root).filter((e) => e.offsetParent !== null && !e.disabled);
    if (!els.length) return;
    const cur = document.activeElement;
    if (!els.includes(cur)) return els[0].focus();
    const r = cur.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let best = null, bd = Infinity;
    for (const e of els) {
      if (e === cur) continue;
      const q = e.getBoundingClientRect();
      const ex = q.left + q.width / 2 - cx, ey = q.top + q.height / 2 - cy;
      const along = ex * dx + ey * dy;
      if (along <= 4) continue;
      const perp = Math.abs(ex * dy - ey * dx);
      const d = along + perp * 2.5;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (best) {
      best.focus();
      audio.play("menu", 0.6);
    }
  }

  action(a, el) {
    switch (a) {
      case "start":
        audio.unlock();
        audio.play("select");
        audio.playSong(TITLE_SONG);
        this.history = [];
        this.show("menu", false);
        if (this.pendingJoin) this.action("online");
        break;
      case "mode":
        audio.play("select");
        this.flow = el.dataset.mode;
        $("#cc-row").style.display = this.flow === "tt" ? "none" : "";
        this.refreshSelect();
        this.show("select");
        break;
      case "select-ok":
        audio.play("select");
        this.save();
        if (this.flow === "gp") this.startGP();
        else if (this.flow === "vs" || this.flow === "tt") {
          this.buildTracks(this.flow);
          this.show("tracks");
        } else if (this.flow === "online") {
          this.sendProfile();
          this.back();
        }
        break;
      case "race-go":
        this.raceGo();
        break;
      case "back":
        this.back();
        break;
      case "settings":
        audio.play("select");
        this.show("settings", !this.session);
        break;
      case "howto":
        audio.play("select");
        this.show("howto");
        break;
      case "online":
        audio.play("select");
        this.openOnline();
        break;
      case "change-racer":
        this.flow = "online";
        $("#cc-row").style.display = "none";
        this.refreshSelect();
        this.show("select");
        break;
      case "quick":
        this.withName(() => this.net.send({ t: "quick" }));
        break;
      case "create-public":
        this.withName(() => this.net.send({ t: "create", public: true }));
        break;
      case "create-private":
        this.withName(() => this.net.send({ t: "create", public: false }));
        break;
      case "join": {
        const code = $("#code-input").value.trim().toUpperCase();
        if (code.length !== 4) return this.toast("Room codes have 4 letters.", true);
        this.withName(() => this.net.send({ t: "join", code }));
        break;
      }
      case "join-room":
        this.withName(() => this.net.send({ t: "join", code: el.dataset.code }));
        break;
      case "leave":
        this.leaveRoom();
        break;
      case "ready": {
        const me = this.room?.players.find((p) => p.id === this.net.id);
        this.net.send({ t: "ready", v: !me?.ready });
        audio.play("select");
        break;
      }
      case "start-race":
        this.net.send({ t: "start" });
        break;
      case "rematch": {
        const me = this.room?.players.find((p) => p.id === this.net.id);
        if (!me) break;
        audio.play("select");
        this.net.send({ t: "rematch", v: !me.rematch });
        if (!me.rematch) clearTimeout(this.lobbyTimer); // stay on the results while waiting
        break;
      }
      case "voice":
        if (this.voice?.active) this.voice.leave();
        else this.joinVoice();
        break;
      case "mute":
        this.voice?.toggleMute();
        break;
      case "voice-block":
        this.voice?.setBlocked(el.dataset.id, !this.voice.blocked.has(el.dataset.id));
        break;
      case "hud-mic":
        el?.blur(); // Space (drift) must not re-click it
        if (!this.voice?.active) this.joinVoice();
        else if (this.voice.stream) this.voice.toggleMute();
        else this.toast("You're listening only: no microphone.", true);
        break;
      case "hud-chat":
        this.openRaceChat();
        break;
      case "copy-link": {
        const url = `${location.origin}${location.pathname}#room=${this.room?.code}`;
        if (isTouch && navigator.share) {
          navigator.share({ title: "Chamo Kart", text: `Race me in Chamo Kart! Room ${this.room?.code}`, url }).catch(() => {});
          break;
        }
        navigator.clipboard?.writeText(url).then(
          () => this.toast("Invite link copied!"),
          () => this.toast(url)
        );
        break;
      }
      case "resume":
        this.resume();
        break;
      case "restart":
        this.restartRace();
        break;
      case "quit":
        this.quitRace();
        break;
      case "menu":
        this.quitRace();
        break;
      case "next-race":
        this.nextGPRace();
        break;
      case "retry":
        this.restartRace();
        break;
      case "change-track":
        this.endSession();
        this.startAttract();
        this.buildTracks(this.flow);
        this.history = ["menu", "select"];
        this.show("tracks", false);
        audio.playSong(TITLE_SONG);
        break;
      case "to-lobby":
        this.endSession();
        this.startAttract();
        this.showLobby();
        break;
    }
  }

  // ------------------------------------------------------------------ single player
  makeGrid(order) {
    // order: list of ids front-to-back
    return order.map((id) => this.racers.find((r) => r.id === id));
  }

  setupRacers() {
    const s = this.settings;
    const others = CHARACTERS.map((c, i) => i).filter((i) => i !== s.char);
    this.racers = [{ id: "you", name: s.name || CHARACTERS[s.char].name, char: s.char, kart: s.kart, human: true, bot: false, local: true }];
    others.forEach((c, i) => this.racers.push({ id: "cpu" + i, name: CHARACTERS[c].name, char: c, kart: Math.floor(Math.random() * 3), human: false, bot: true, local: true }));
  }

  raceGo() {
    audio.play("select");
    if (this.flow === "tt") {
      const s = this.settings;
      const ghost = store.get("ghost_" + this.selTrack, null);
      this.startRace({
        mode: "tt",
        track: this.selTrack,
        laps: 3,
        cc: 150,
        items: false,
        grid: [{ id: "you", name: s.name || CHARACTERS[s.char].name, char: s.char, kart: s.kart, human: true, local: true }],
        ghost,
      });
      return;
    }
    this.setupRacers();
    const cpus = this.racers.filter((r) => !r.human).map((r) => r.id).sort(() => Math.random() - 0.5);
    this.startRace({
      mode: "vs",
      track: this.selTrack,
      laps: this.settings.laps,
      cc: this.settings.cc,
      items: this.settings.items,
      grid: this.makeGrid([...cpus, "you"]),
    });
  }

  startGP() {
    this.setupRacers();
    this.gp = { cup: CUPS[0], index: 0, cc: this.settings.cc, points: new Map(this.racers.map((r) => [r.id, 0])) };
    const cpus = this.racers.filter((r) => !r.human).map((r) => r.id).sort(() => Math.random() - 0.5);
    this.startRace({ mode: "gp", track: this.gp.cup.tracks[0], laps: 3, cc: this.gp.cc, items: true, grid: this.makeGrid([...cpus, "you"]) });
  }

  nextGPRace() {
    const gp = this.gp;
    gp.index++;
    if (gp.index >= gp.cup.tracks.length) return this.showPodium();
    // Leaders start at the back.
    const order = [...this.racers].sort((a, b) => gp.points.get(a.id) - gp.points.get(b.id)).map((r) => r.id);
    this.startRace({ mode: "gp", track: gp.cup.tracks[gp.index], laps: 3, cc: gp.cc, items: true, grid: this.makeGrid(order) });
  }

  startRace(cfg) {
    this.endSession();
    this.stopAttract();
    this.lastRaceCfg = cfg;
    cfg.seed = cfg.seed ?? Math.floor(Math.random() * 1e9);
    cfg.localId = cfg.localId || "you";
    this.hideScreens();
    $("#hud").classList.add("active");
    $("#restart-btn").style.display = cfg.mode === "online" ? "none" : "";
    $("#hud-social").classList.toggle("on", cfg.mode === "online");
    $("#hud-feed").innerHTML = "";
    this.renderVoice();
    input.racing = true;
    document.activeElement?.blur?.(); // Space/Enter must not re-click a menu button mid-race
    this.session = new RaceSession(this, cfg);
    this.session.resize(this.width, this.height);
  }

  restartRace() {
    if (!this.lastRaceCfg || this.lastRaceCfg.mode === "online") return;
    const cfg = { ...this.lastRaceCfg, seed: undefined };
    if (cfg.mode === "tt") cfg.ghost = store.get("ghost_" + cfg.track, null);
    this.startRace(cfg);
  }

  endSession() {
    if (this.session) {
      this.session.dispose();
      this.session = null;
    }
    $("#hud").classList.remove("active");
    $("#hud-social").classList.remove("on");
    this.closeRaceChat();
    input.racing = false;
    audio.stopEngines();
  }

  quitRace() {
    const online = this.session?.online;
    this.endSession();
    this.startAttract();
    audio.playSong(TITLE_SONG);
    if (online && this.net) {
      this.voice?.leave(true);
      this.net.send({ t: "leave" });
      this.history = ["menu"];
      this.show("online", false);
      return;
    }
    this.history = [];
    this.show("menu", false);
  }

  pause() {
    if (!this.session || this.screen) return;
    if (!this.session.online) this.session.paused = true;
    $("#pause").classList.toggle("online", !!this.session.online);
    $("#pause-title").textContent = this.session.online ? "Menu" : "Paused";
    audio.play("back");
    this.show("pause", false);
  }

  resume() {
    if (!this.session) return;
    this.session.paused = false;
    this.hideScreens();
    document.activeElement?.blur?.();
  }

  onRaceEnd(session) {
    const cfg = session.cfg;
    const rows = session.results();
    const table = $("#results-table");
    table.innerHTML = "";
    const actions = $("#results-actions");
    actions.innerHTML = "";
    const btn = (label, action, primary) => {
      const b = document.createElement("button");
      b.className = "btn" + (primary ? " primary" : "");
      b.textContent = label;
      b.dataset.action = action;
      actions.append(b);
      return b;
    };
    const def = TRACKS[cfg.track];
    if (cfg.mode === "tt") {
      const me = session.me;
      const bests = store.get("best", {});
      const prev = bests[cfg.track];
      const isBest = !prev || me.finishTime < prev;
      if (isBest) {
        bests[cfg.track] = me.finishTime;
        store.set("best", bests);
        store.set("ghost_" + cfg.track, { time: me.finishTime, char: me.char, kart: me.kartType, frames: session.ghostFrames });
      }
      $("#results-title").textContent = isBest ? "New record!" : "Time Trial";
      $("#results-sub").textContent = `${def.name} · ${fmtTime(me.finishTime)}${prev ? ` · best ${fmtTime(Math.min(prev, me.finishTime))}` : ""}`;
      this.hud.lapTimes.forEach((t, i) => this.resultRow(table, { pos: "L" + (i + 1), char: me.char, name: `Lap ${i + 1}`, time: fmtTime(t), me: true }, i));
      btn("Main menu", "menu");
      btn("Try again", "retry", true);
    } else if (cfg.mode === "gp") {
      const gp = this.gp;
      rows.forEach((r, i) => gp.points.set(r.id, gp.points.get(r.id) + (POINTS[i] || 0)));
      $("#results-title").textContent = `Race ${gp.index + 1}/${gp.cup.tracks.length}: ${def.name}`;
      const myPlace = rows.findIndex((r) => r.human) + 1;
      $("#results-sub").textContent = `You finished ${ordinal(myPlace)}!`;
      rows.forEach((r, i) =>
        this.resultRow(table, { pos: i + 1, char: r.char, name: r.name, time: (r.estimated ? "~" : "") + fmtTime(r.time), pts: `+${POINTS[i] || 0} · ${gp.points.get(r.id)}`, me: r.human }, i)
      );
      btn("Quit", "menu");
      btn(gp.index + 1 >= gp.cup.tracks.length ? "Final standings" : "Next race", "next-race", true);
    } else {
      const myPlace = rows.findIndex((r) => r.human) + 1;
      $("#results-title").textContent = myPlace === 1 ? "¡Ganaste! You win!" : `You finished ${ordinal(myPlace)}`;
      $("#results-sub").textContent = `${def.name} · ${cfg.cc}cc · ${cfg.laps} laps`;
      rows.forEach((r, i) => this.resultRow(table, { pos: i + 1, char: r.char, name: r.name, time: (r.estimated ? "~" : "") + fmtTime(r.time), pts: POINTS[i] ? `+${POINTS[i]}` : "", me: r.human }, i));
      btn("Main menu", "menu");
      btn("Change track", "change-track");
      btn("Race again", "retry", true);
    }
    audio.playSong({ bpm: 100, root: 65, mode: "major", seed: 5 });
    this.show("results", false);
  }

  resultRow(table, r, i) {
    const row = document.createElement("div");
    row.className = `rr p${r.pos}` + (r.me ? " me" : "");
    row.style.animationDelay = i * 0.06 + "s";
    const pos = document.createElement("span");
    pos.className = "pos";
    pos.textContent = r.pos;
    const img = document.createElement("img");
    img.src = this.portraits[r.char];
    img.alt = "";
    const name = document.createElement("span");
    name.className = "nm";
    name.textContent = r.name;
    const time = document.createElement("span");
    time.className = "time";
    time.textContent = r.time ?? "";
    const pts = document.createElement("span");
    pts.className = "pts";
    pts.textContent = r.pts ?? "";
    row.append(pos, img, name, time, pts);
    table.append(row);
  }

  showPodium() {
    const gp = this.gp;
    const ranked = [...this.racers].sort((a, b) => gp.points.get(b.id) - gp.points.get(a.id));
    const stage = $("#podium-stage");
    stage.innerHTML = "";
    for (const idx of [1, 0, 2]) {
      const r = ranked[idx];
      const d = document.createElement("div");
      d.className = "pod p" + (idx + 1);
      const img = document.createElement("img");
      img.src = this.portraits[r.char];
      const nm = document.createElement("div");
      nm.className = "nm";
      nm.textContent = r.name;
      const blk = document.createElement("div");
      blk.className = "blk";
      blk.textContent = idx + 1;
      d.append(img, nm, blk);
      stage.append(d);
    }
    const myRank = ranked.findIndex((r) => r.human) + 1;
    $("#podium-msg").textContent =
      myRank === 1 ? "🏆 ¡Campeón! You won the gold cup!" : myRank === 2 ? "🥈 Silver cup! So close!" : myRank === 3 ? "🥉 Bronze cup! Nice racing!" : `You placed ${ordinal(myRank)}. ¡Échale ganas next time!`;
    const table = $("#podium-table");
    table.innerHTML = "";
    ranked.forEach((r, i) => this.resultRow(table, { pos: i + 1, char: r.char, name: r.name, pts: gp.points.get(r.id) + " pts", me: r.human }, i));
    const trophies = store.get("trophies", {});
    const key = gp.cc + "cc";
    if (myRank <= 3 && (!trophies[key] || trophies[key] > myRank)) {
      trophies[key] = myRank;
      store.set("trophies", trophies);
    }
    if (myRank <= 3) audio.play("finish");
    this.show("podium", false);
  }

  // ------------------------------------------------------------------ online
  async openOnline() {
    $("#name-input").value = this.settings.name;
    this.show("online");
    if (!this.net) {
      this.net = new Net();
      this.voice = new Voice(this.net, audio);
      this.voice.setVolume(this.settings.voice);
      this.voice.onChange = () => this.renderVoice();
      this.voice.onTalk = (ids) => this.renderTalk(ids);
      this.bindNet();
    }
    const status = $("#online-status");
    status.textContent = "Connecting to the Chamo Kart server…";
    try {
      await this.net.connect();
      status.textContent = "Connected! Pick a room or hit Quick Play.";
      this.sendProfile();
      this.net.send({ t: "list" });
      if (this.pendingJoin) {
        const code = this.pendingJoin;
        this.pendingJoin = null;
        history.replaceState(null, "", location.pathname);
        $("#code-input").value = code;
        this.withName(() => this.net.send({ t: "join", code }));
      }
    } catch {
      status.textContent = "Couldn't reach the server. Check your connection and try again.";
    }
  }

  withName(fn) {
    const name = $("#name-input").value.trim();
    if (!name) {
      this.toast("Enter your name first!", true);
      $("#name-input").focus();
      return;
    }
    if (!this.net?.connected) {
      this.toast("Not connected to the server yet.", true);
      return;
    }
    this.settings.name = name.slice(0, 14);
    this.save();
    this.sendProfile();
    fn();
  }

  sendProfile() {
    if (!this.net?.connected) return;
    const s = this.settings;
    this.net.send({ t: "profile", name: s.name || CHARACTERS[s.char].name, char: s.char, kart: s.kart });
  }

  leaveRoom() {
    this.voice?.leave(true);
    this.net?.send({ t: "leave" });
    this.room = null;
    this.history = ["menu"];
    this.show("online", false);
  }

  bindNet() {
    const net = this.net;
    net.on("rooms", (m) => this.renderRooms(m.list));
    net.on("room", (m) => {
      const first = !this.room || this.room.code !== m.room.code;
      if (first) this.voice.leave(true);
      this.room = m.room;
      this.voice.sync(m.room);
      if (first) $("#chat-log").innerHTML = "";
      if (!this.session && this.screen !== "results" && this.screen !== "select") this.showLobby();
      else this.renderLobby();
    });
    net.on("race", (m) => this.startOnlineRace(m));
    net.on("s", (m) => this.session?.online && this.session.onState(m));
    net.on("ev", (m) => this.session?.online && this.session.onEvent(m.from, m.e));
    net.on("fin", (m) => this.session?.online && this.session.onFinish(m.id, m.time));
    net.on("left", (m) => this.session?.online && this.session.removeKarts(m.ids));
    net.on("over", (m) => this.onlineOver(m.results));
    net.on("chat", (m) => this.chat(m));
    net.on("err", (m) => {
      if (m.notReady) {
        if (confirm("Not everyone is ready. Start anyway?")) this.net.send({ t: "start", force: true });
        return;
      }
      this.toast(m.msg, true);
    });
    net.on("wait", (m) => this.toast(m.msg));
    net.on("left_room", () => {
      this.room = null;
      this.voice.leave(true);
    });
    net.on("disconnect", () => {
      this.toast("Disconnected from the server.", true);
      this.room = null;
      this.voice.leave(true);
      if (this.session?.online) {
        this.endSession();
        this.startAttract();
      }
      if (["lobby", "online"].includes(this.screen) || !this.screen) {
        this.history = ["menu"];
        this.show("online", false);
        $("#online-status").textContent = "Disconnected. Reopen Online to reconnect.";
      }
    });
  }

  renderRooms(list) {
    const el = $("#room-list");
    el.innerHTML = "";
    if (!list.length) {
      el.innerHTML = `<p class="muted">No open rooms yet: create one!</p>`;
      return;
    }
    for (const r of list) {
      const d = document.createElement("div");
      d.className = "room";
      const code = document.createElement("span");
      code.className = "code";
      code.textContent = r.code;
      const info = document.createElement("span");
      info.className = "info";
      info.textContent = `${r.host}'s room · ${r.players}/8 · ${r.state === "racing" ? "racing" : "in lobby"}`;
      const b = document.createElement("button");
      b.className = "btn small";
      b.textContent = "Join";
      b.dataset.action = "join-room";
      b.dataset.code = r.code;
      b.disabled = r.players >= 8;
      d.append(code, info, b);
      el.append(d);
    }
  }

  showLobby() {
    if (!this.room) return this.show("online", false);
    this.history = ["menu", "online"];
    this.show("lobby", false);
    this.renderLobby();
    audio.playSong(LOBBY_SONG);
  }

  renderLobby() {
    const room = this.room;
    if (!room) return;
    const me = this.net.id;
    const isHost = room.host === me;
    $("#lobby-code").textContent = room.code;
    $("#lobby-sub").textContent = room.state === "racing" ? "A race is in progress. You'll join the next one." : room.public ? "Public room: anyone can join" : "Private room: share the code";
    $("#lobby-count").textContent = `${room.players.length}/8`;
    const pl = $("#lobby-players");
    pl.innerHTML = "";
    for (const p of room.players) {
      const d = document.createElement("div");
      d.className = "lp" + (p.id === me ? " me" : "");
      const img = document.createElement("img");
      img.src = this.portraits[p.char];
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = p.name;
      d.append(img, nm);
      if (p.id === room.host) {
        const t = document.createElement("span");
        t.className = "tag host";
        t.textContent = "HOST";
        d.append(t);
      }
      const t = document.createElement("span");
      t.className = "tag" + (p.ready ? " ready" : "");
      t.textContent = p.id === room.host ? "" : p.ready ? "READY" : "…";
      if (t.textContent) d.append(t);
      if (p.voice) {
        const self = p.id === me;
        const v = document.createElement("button");
        const blocked = this.voice.blocked.has(p.id);
        const state = self ? null : this.voice.active ? this.voice.peerState(p.id) : null;
        v.className = "vc" + (blocked || p.vmuted ? " off" : "") + (state === "connecting" ? " wait" : "");
        v.textContent = blocked ? "🚫" : p.vmuted ? "🔇" : state === "failed" ? "⚠️" : "🔊";
        v.title = self
          ? "You're in voice chat"
          : blocked
            ? "Muted by you: click to hear them again"
            : state === "failed"
              ? "Couldn't connect voice to this player (network)"
              : this.voice.active
                ? "Click to mute this player for you"
                : "In voice chat: join voice to hear them";
        if (self) v.disabled = true;
        else {
          v.dataset.action = "voice-block";
          v.dataset.id = p.id;
        }
        d.append(v);
      }
      d.dataset.id = p.id;
      const pts = document.createElement("span");
      pts.className = "pts";
      pts.textContent = p.points;
      d.append(pts);
      pl.append(d);
    }
    // Settings
    const s = room.settings;
    const box = $("#lobby-settings");
    box.innerHTML = "";
    $("#lobby-host-note").textContent = isHost ? "(you're the host)" : "(host decides)";
    const addSelect = (label, key, options, value) => {
      const row = document.createElement("div");
      row.className = "ls";
      const l = document.createElement("span");
      l.textContent = label;
      row.append(l);
      if (isHost && room.state === "lobby") {
        const sel = document.createElement("select");
        for (const [v, t] of options) {
          const o = document.createElement("option");
          o.value = JSON.stringify(v);
          o.textContent = t;
          if (v === value) o.selected = true;
          sel.append(o);
        }
        sel.addEventListener("change", () => this.net.send({ t: "settings", [key]: JSON.parse(sel.value) }));
        row.append(sel);
      } else {
        const v = document.createElement("b");
        v.textContent = options.find((o) => o[0] === value)?.[1] ?? "";
        row.append(v);
      }
      box.append(row);
    };
    addSelect("Track", "track", [[-1, "🎲 Random"], ...TRACKS.map((t, i) => [i, t.name])], s.track);
    addSelect("Laps", "laps", [1, 2, 3, 4, 5].map((v) => [v, String(v)]), s.laps);
    addSelect("Class", "cc", [50, 100, 150, 200].map((v) => [v, v + "cc"]), s.cc);
    addSelect("CPU racers", "cpu", [[true, "Fill to 8"], [false, "None"]], s.cpu);
    addSelect("Items", "items", [[true, "On"], [false, "Off"]], s.items);
    addSelect("Visibility", "public", [[true, "Public"], [false, "Private"]], room.public);
    const mine = room.players.find((p) => p.id === me);
    const ready = $("#ready-btn");
    ready.style.display = isHost ? "none" : "";
    ready.textContent = mine?.ready ? "✔ Ready!" : "Ready";
    ready.classList.toggle("on", !!mine?.ready);
    const start = $("#start-btn");
    start.style.display = isHost ? "" : "none";
    start.disabled = room.state !== "lobby";
    this.renderRematch();
    this.renderVoiceBar();
    this.renderTalk(this.voice.talking);
  }

  // ------------------------------------------------------------------ voice + race chat
  async joinVoice() {
    if (!this.voice || !this.room) return;
    if (!this.voice.supported) return this.toast("Voice chat isn't supported in this browser.", true);
    audio.unlock();
    const err = await this.voice.join();
    if (err) this.toast(err, true, 4500);
  }

  renderVoice() {
    if (this.screen === "lobby") this.renderLobby();
    else this.renderVoiceBar();
    const v = this.voice;
    const mic = $("#hud-mic");
    mic.classList.toggle("live", !!v?.active && !!v.stream && !v.muted);
    mic.classList.toggle("muted", !!v?.active && (!v.stream || v.muted));
    mic.textContent = !v?.active ? "🎙" : !v.stream ? "🎧" : v.muted ? "🔇" : "🎙";
    mic.title = !v?.active ? "Join voice chat (V)" : !v.stream ? "Listening only" : v.muted ? "Mic muted: click or V to unmute" : "Mic on: click or V to mute";
    $("#hud-social-hint").textContent = v?.active ? "Enter: chat · V: mute/unmute" : "Enter: chat · V: join voice";
  }

  renderVoiceBar() {
    const v = this.voice;
    if (!v) return;
    const bar = $(".voice-bar");
    bar.classList.toggle("voice-on", v.active && !!v.stream);
    const btn = $("#voice-btn");
    btn.disabled = v.joining;
    btn.textContent = v.joining ? "Connecting mic…" : v.active ? "Leave voice chat" : "🎙 Join voice chat";
    btn.classList.toggle("on", v.active);
    $("#mute-btn").textContent = v.muted ? "🔇 Unmute mic" : "Mute mic";
    $("#mute-btn").classList.toggle("on", v.muted);
    const others = (this.room?.players || []).filter((p) => p.voice && p.id !== this.net.id).length;
    $("#voice-hint").textContent = !v.supported
      ? "Voice chat isn't supported in this browser."
      : v.active
        ? v.stream
          ? `You're in voice chat${others ? ` with ${others} other${others > 1 ? "s" : ""}` : ""}. Press V to mute during races.`
          : "Listening only (no microphone)."
        : others
          ? `${others} player${others > 1 ? "s are" : " is"} in voice chat. Headphones recommended!`
          : "Talk with everyone in the room. Headphones recommended!";
  }

  renderTalk(ids) {
    for (const row of $$("#lobby-players .lp")) row.classList.toggle("talking", ids.has(row.dataset.id));
    $("#hud-mic").classList.toggle("talk", ids.has(this.net?.id));
    const names = [...ids].filter((id) => id !== this.net?.id).map((id) => this.room?.players.find((p) => p.id === id)?.name).filter(Boolean);
    $("#hud-talkers").textContent = names.length ? "🔊 " + names.join(", ") : "";
  }

  openRaceChat() {
    if (!this.session?.online || this.screen) return;
    const f = $("#race-chat");
    f.classList.add("open");
    $("#race-chat-input").focus({ preventScroll: true });
  }

  closeRaceChat() {
    const f = $("#race-chat");
    if (!f.classList.contains("open")) return;
    f.classList.remove("open");
    const inp = $("#race-chat-input");
    inp.value = "";
    if (document.activeElement === inp) inp.blur();
  }

  feed(m) {
    const feed = $("#hud-feed");
    const d = document.createElement("div");
    if (m.sys) {
      d.className = "sys";
      d.textContent = m.text;
    } else {
      const b = document.createElement("b");
      b.textContent = m.name + ": ";
      d.append(b, m.text);
    }
    feed.append(d);
    while (feed.children.length > 5) feed.firstChild.remove();
    setTimeout(() => d.classList.add("fade"), 8000);
    setTimeout(() => d.remove(), 8700);
  }

  chat(m) {
    const log = $("#chat-log");
    const d = document.createElement("div");
    if (m.sys) {
      d.className = "sys";
      d.textContent = m.text;
    } else {
      const b = document.createElement("b");
      b.textContent = m.name + ": ";
      d.append(b, m.text);
      if (!this.session && m.id !== this.net.id) audio.play("chat");
    }
    if (this.session?.online) {
      this.feed(m);
      if (!m.sys && m.id !== this.net.id) audio.play("chat", 0.6);
    }
    log.append(d);
    while (log.children.length > 100) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  }

  // Rematch buttons on the results screen and in the lobby: "🔁 Rematch 2/3".
  renderRematch() {
    const room = this.room;
    const me = room?.players.find((p) => p.id === this.net?.id);
    const votes = room ? room.players.filter((p) => p.rematch).length : 0;
    const total = room ? room.players.length : 0;
    for (const b of $$('[data-action="rematch"]')) {
      const lobby = b.id === "lobby-rematch-btn";
      b.style.display = room && room.raceNo > 0 && room.state === "lobby" ? "" : "none";
      b.classList.toggle("on", !!me?.rematch);
      b.textContent = me?.rematch
        ? `✔ Rematch ${votes}/${total}: waiting…`
        : votes && total > 1
          ? `🔁 Rematch ${votes}/${total}`
          : lobby ? "🔁 Rematch" : "🔁 Rematch!";
    }
  }

  startOnlineRace(m) {
    const me = this.net.id;
    if (!m.grid.some((g) => g.id === me)) return; // spectators wait
    const grid = m.grid.map((g) => ({ id: g.id, name: g.name, char: g.char, kart: g.kart, human: !g.bot, bot: g.bot, owner: g.owner, local: g.owner === me && (g.bot || g.id === me) }));
    this.startRace({ mode: "online", track: m.track, laps: m.laps, cc: m.cc, items: m.items, seed: m.seed, grid, localId: me, net: this.net, startAt: m.startAt });
  }

  onlineOver(results) {
    const session = this.session;
    if (!session?.online) {
      if (this.screen === "lobby") this.renderLobby();
      return;
    }
    const table = $("#results-table");
    table.innerHTML = "";
    const me = this.net.id;
    const place = results.findIndex((r) => r.id === me) + 1;
    $("#results-title").textContent = place === 1 ? "¡Ganaste! You win!" : place ? `You finished ${ordinal(place)}` : "Race over";
    $("#results-sub").textContent = TRACKS[session.cfg.track].name;
    results.forEach((r, i) => {
      // The room update with new totals arrives right after this message.
      const prev = this.room?.players.find((p) => p.id === r.id)?.points;
      const total = prev != null ? prev + r.pts : null;
      this.resultRow(
        table,
        {
          pos: i + 1,
          char: r.char,
          name: r.name + (r.bot ? " (CPU)" : ""),
          time: r.dnf ? "DNF" : r.time != null ? fmtTime(r.time) : "--",
          pts: `+${r.pts}` + (total != null ? ` · ${total}` : ""),
          me: r.id === me,
        },
        i
      );
    });
    const actions = $("#results-actions");
    actions.innerHTML = "";
    const b = document.createElement("button");
    b.className = "btn";
    b.dataset.action = "to-lobby";
    b.textContent = "Back to lobby";
    const re = document.createElement("button");
    re.className = "btn primary";
    re.dataset.action = "rematch";
    actions.append(b, re);
    this.renderRematch();
    this.show("results", false);
    clearTimeout(this.lobbyTimer);
    this.lobbyTimer = setTimeout(() => {
      const me = this.room?.players.find((p) => p.id === this.net.id);
      if (this.screen === "results" && this.session?.online && !me?.rematch) this.action("to-lobby");
    }, 12000);
  }
}

const app = new App();
window.chamo = app;
app.boot().catch((err) => {
  console.error(err);
  $("#load-msg").textContent = "Oops! Something went wrong starting the game: " + err.message;
});
