// Chamo Kart: app shell, menus, game flow.
import * as THREE from "three";
import { CHARACTERS, KARTS, TRACKS, CUPS, POINTS, ITEMS, botName } from "./data.js?v=17";
import { CUSTOM, DEFAULT_LOOK, LOOK_OPTIONS, STAT_KEYS, STAT_POINTS, STAT_MIN, STAT_MAX, cleanLook, lookKey, randomLook } from "./look.js?v=3";
import { getTrack } from "./sim/race.js?v=19";
import { RaceSession } from "./game.js?v=30";
import { HUD, ITEM_SVG, fmtTime, ordinal } from "./hud.js?v=22";
import { audio } from "./audio.js?v=11";
import { input } from "./input.js?v=6";
import { Net } from "./net.js?v=7";
import { Voice } from "./voice.js?v=5";
import { Showroom, renderPortraits, renderPortrait } from "./view/showroom.js?v=20";
import { setAnisotropy } from "./view/textures.js?v=8";
import { serverRequest } from "./records.js?v=10";
import { dailyChallenge, dailyId, msToNextDaily } from "./daily.js?v=4";
import { Presence } from "./presence.js?v=3";
import { drawShareCard } from "./sharecard.js?v=2";
import { Broadcaster, SpectateSession } from "./spectate.js?v=12";

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
// "Chrome · Android" etc., for the stats page.
function browserName() {
  const ua = navigator.userAgent;
  const b = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Other";
  const os = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux|CrOS/.test(ua) ? "Linux" : "";
  return os ? `${b} · ${os}` : b;
}
// The editor's colour swatches (any other colour is one tap away on the colour wheel)
const PALETTE = [0xe23b3b, 0xff7a1a, 0xffd23f, 0x7ad04a, 0x1f9d55, 0x38e0c8, 0x6ac8ff, 0x2f5bd9, 0x8e44ad, 0xff4f9a, 0xffffff, 0xb8bcc8, 0x4a4a55, 0x15151c, 0x8a5a2b];
const SKINS = [0xf3d3b6, 0xe2a36f, 0xc98b5c, 0x8d5a3b, 0x5a3a24, 0xf5f1e6, 0x7ad04a, 0x6ac8ff, 0xff9fb0, 0xff8a1a, 0xb8bcc8, 0x8e44ad];
const HAIR = [0x15151c, 0x3a2412, 0x6a4020, 0xc98b3c, 0xf2d27a, 0xe8e4dc, 0xe23b3b, 0xff4f9a, 0x2f5bd9, 0x7ad04a, 0x8e44ad];
const MODE_NAMES = { gp: "Grand Prix", vs: "Versus", tt: "Time Trial", daily: "Daily Challenge", online: "Online race", tutorial: "Tutorial" };
const TITLE_SONG = { bpm: 132, root: 62, mode: "major", seed: 7 };
const LOBBY_SONG = { bpm: 112, root: 60, mode: "mixolydian", seed: 91 };

class App {
  constructor() {
    this.settings = Object.assign(
      { name: "", char: 0, kart: 0, cc: 150, music: 0.55, sfx: 0.8, voice: 1, quality: isTouch ? "medium" : "high", autoAccel: false, touch: isTouch, steer: "pad", fps: false, laps: 3, items: true, ttGhost: "both" },
      store.get("settings", {})
    );
    this.profileSnap = JSON.stringify(this.profileNow(false)); // to spot profile changes in save()
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
    // Anonymous id that ties this browser to its entries on the fastest-lap boards.
    this.pid = store.get("pid", null);
    if (!this.pid) {
      this.pid = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
      store.set("pid", this.pid);
    }
    this.records = null; // Time Trial boards per track: fastest laps ...
    this.runs = null; // ... and fastest full races
    this.recTrack = 0;
    this.recBoard = "laps";
    this.recordGhosts = {}; // track -> { g, at }: the board's record ghost, fetched on demand
    this.players = []; // everyone else playing right now (from the presence connection)
    this.playersSeen = null;
    this.incoming = null; // a challenge waiting for an answer
    this.daily = null; // the server's latest daily board
    this.caster = null; // streams our race to anyone watching
    this.watch = null; // { uid, name, char, state }: the player we're watching
    this.spectate = null; // their race, as we see it
  }

  save() {
    // Name, racer, kart or Custom look changed: note when, and tell the player's other devices
    const snap = JSON.stringify(this.profileNow(false));
    if (snap !== this.profileSnap) {
      if (this.profileSnap !== undefined) this.settings.profileAt = Date.now();
      this.profileSnap = snap;
      if (store.get("acct", false)) {
        clearTimeout(this.syncTimer);
        this.syncTimer = setTimeout(() => this.syncAccount(), 1500);
      }
    }
    store.set("settings", this.settings);
  }

  // ------------------------------------------------------------------ player code
  // The profile that follows a player (with a code) to their other devices
  profileNow(withAt = true) {
    const s = this.settings;
    const p = { name: s.name, char: s.char, kart: s.kart, look: s.look ?? null };
    return withAt ? { ...p, at: s.profileAt || 0 } : p;
  }

  applyProfile(p) {
    const s = this.settings;
    if (p.name) s.name = p.name;
    if (Number.isInteger(p.char)) s.char = p.char;
    if (Number.isInteger(p.kart)) s.kart = p.kart;
    if (p.look) s.look = p.look;
    s.profileAt = p.at || Date.now();
    this.profileSnap = JSON.stringify(this.profileNow(false));
    store.set("settings", s);
    for (const el of [$("#name-input"), $("#set-name"), ...$$(".board-name")]) if (el) el.value = s.name;
  }

  // On start (and after profile changes): the id this device should use (it may have been
  // merged into another), and the newest profile from the player's other devices.
  syncAccount() {
    return serverRequest({ t: "acct-sync", pid: this.pid, profile: store.get("acct", false) ? this.profileNow() : undefined })
      .then((m) => {
        if (!m.ok) return;
        if (m.pid && m.pid !== this.pid) {
          this.pid = m.pid;
          store.set("pid", m.pid);
        }
        if (m.code) {
          store.set("acct", true);
          this.myCode = m.code;
        }
        if (m.profile && m.profile.at > (this.settings.profileAt || 0)) {
          this.applyProfile(m.profile);
          if (this.screen === "title" || this.screen === "menu") this.refreshSelect?.();
        }
      })
      .catch(() => {});
  }

  fmtCode = (c) => (c || "").replace(/(.{4})(?=.)/g, "$1-");
  codeLink = (c) => `${location.origin}${location.pathname}#player=${c}`;

  openSettings() {
    $("#set-name").value = this.settings.name;
    $("#player-code").textContent = this.myCode ? this.fmtCode(this.myCode) : "····-····-····";
    // Asking for the code makes one the first time, and keeps our profile on the server
    serverRequest({ t: "acct-code", pid: this.pid, profile: this.profileNow() })
      .then((m) => {
        if (!m.ok) return;
        this.myCode = m.code;
        store.set("acct", true);
        $("#player-code").textContent = this.fmtCode(m.code);
      })
      .catch(() => ($("#player-code").textContent = "Offline, try again later"));
  }

  codeAction(what) {
    const code = this.myCode;
    if (what === "use") return this.openLink("");
    if (!code) return this.toast("Can't reach the server right now. Try again in a bit.", true);
    const link = this.codeLink(code);
    if (what === "copy")
      navigator.clipboard?.writeText(link).then(
        () => this.toast("🔗 Link copied! Open it on your other phone or computer."),
        () => this.toast(link, false, 8000)
      ) ?? this.toast(link, false, 8000);
    else if (what === "wa") this.openWhatsApp(`🔑 My Chamo Kart player (open this on my other phone or computer, don't share it): ${link}`);
    else if (what === "reset") {
      if (!confirm("Make a new player code? Your old code and link stop working. Devices you already linked stay linked.")) return;
      serverRequest({ t: "acct-reset", pid: this.pid })
        .then((m) => {
          if (!m.ok) throw 0;
          this.myCode = m.code;
          $("#player-code").textContent = this.fmtCode(m.code);
          this.toast("🔄 New code ready. The old one doesn't work anymore.");
        })
        .catch(() => this.toast("Can't reach the server right now. Try again in a bit.", true));
    }
  }

  // ------------------------------------------------------------------ feedback
  openFeedback() {
    this.feedbackFrom = this.screen; // what they were looking at, for the note's context
    this.overlayFrom = this.screen;
    $("#feedback-send").disabled = false;
    this.show("feedback", false);
    setTimeout(() => $("#feedback-text").focus(), 50);
  }

  sendFeedback() {
    const text = $("#feedback-text").value.trim();
    if (!text) return this.toast("Write something first!", true);
    const s = this.settings;
    const cfg = this.session?.cfg;
    const ctx = $("#feedback-ctx").checked
      ? {
          where: this.feedbackFrom === "pause" && cfg ? "race" : this.feedbackFrom || "",
          mode: cfg ? (cfg.daily ? "daily" : cfg.mode) : "",
          track: cfg ? TRACKS[cfg.track]?.name : "",
          device: isTouch ? (Math.min(screen.width, screen.height) >= 700 ? "tablet" : "phone") : "desktop",
          browser: browserName(),
          version: new URL(import.meta.url).searchParams.get("v") || "",
        }
      : null;
    $("#feedback-send").disabled = true;
    serverRequest({ t: "feedback", pid: this.pid, name: s.name || CHARACTERS[s.char].name, char: s.char, look: this.lookFor(s.char), text, ctx })
      .then((m) => {
        if (!m.ok) throw new Error(m.error || "no");
        $("#feedback-text").value = "";
        this.back();
        this.toast("💬 Thanks! Your feedback was sent.");
      })
      .catch((e) => {
        $("#feedback-send").disabled = false;
        this.toast(e.message === "slow" ? "That's a lot of feedback! Try again in a little while." : "Couldn't send it right now. Try again in a bit.", true);
      });
  }

  // The "use a player code" screen: enter it, see whose it is, then confirm.
  openLink(code) {
    $("#link").classList.remove("confirm");
    $("#link-code").value = code ? this.fmtCode(code) : "";
    $("#link-error").textContent = "";
    if (this.screen !== "link") this.overlayFrom = this.screen;
    this.show("link", false);
    if (code) this.checkLink();
    else setTimeout(() => $("#link-code").focus(), 50);
  }

  checkLink() {
    const code = $("#link-code").value.toUpperCase().replace(/[^0-9A-Z]/g, "");
    if (code.length !== 12) return ($("#link-error").textContent = "A player code has 12 letters and numbers.");
    $("#link-error").textContent = "Checking…";
    serverRequest({ t: "acct-check", pid: this.pid, code })
      .then((m) => {
        if (!m.ok) {
          $("#link-error").textContent = m.error === "slow" ? "Too many tries. Wait a few minutes and try again." : "That code doesn't exist. Check it and try again.";
          return;
        }
        if (m.same) {
          $("#link-error").textContent = "";
          this.back();
          return this.toast(`✅ This device is already ${m.name}.`);
        }
        this.linkCode = code;
        $("#link-portrait").src = this.portraitFor(m.char, m.look);
        $("#link-text").innerHTML = "";
        const b = document.createElement("b");
        b.textContent = m.name;
        $("#link-text").append("Play as ", b, " on this device? Anything you've raced here gets added to their times and stats.");
        $("#link-yes").textContent = `Yes, I'm ${m.name}`;
        $("#link").classList.add("confirm");
      })
      .catch(() => ($("#link-error").textContent = "Can't reach the server right now. Try again in a bit."));
  }

  confirmLink() {
    $("#link-yes").disabled = true;
    serverRequest({ t: "acct-link", pid: this.pid, code: this.linkCode })
      .then((m) => {
        if (!m.ok) throw 0;
        store.set("pid", m.pid);
        store.set("acct", true);
        this.applyProfile(m.profile);
        this.toast(`✅ You're ${m.profile.name} on this device now!`);
        setTimeout(() => location.replace(location.pathname + location.search), 900); // start fresh as that player
      })
      .catch(() => {
        $("#link-yes").disabled = false;
        $("#link").classList.remove("confirm");
        $("#link-error").textContent = "Couldn't link right now. Try again in a bit.";
      });
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
    // changelog.json is fetched fresh (Cloudflare doesn't cache .json) so editing it needs no ?v= bump.
    const changelogReq = fetch("changelog.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => (Array.isArray(d) ? d : []))
      .catch(() => []);
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
    this.hud.portraitOf = (char, look) => this.portraitFor(char, look);
    await step(40, "Building the tracks…");
    for (let i = 0; i < TRACKS.length; i++) getTrack(i);
    await step(65, "Waking up the racers…");
    this.showroom = new Showroom(this.renderer);
    this.startAttract();
    await step(90, "Tuning the mariachis…");
    this.buildStaticUI();
    this.changelog = await changelogReq;
    const seenChangelog = store.get("seenChangelog", null);
    this.newPlayer = !seenChangelog; // first visit: offer the tutorial before their first race
    this.buildWhatsNew(seenChangelog);
    this.bindUI();
    input.bindTouch($("#hud"));
    document.body.classList.toggle("touch-on", this.settings.touch);
    input.touchMode = this.settings.touch;
    input.autoAccel = this.settings.autoAccel;
    document.body.classList.toggle("tilt-on", this.settings.steer === "tilt");
    // iOS asks for motion access on a tap (see bindUI); elsewhere tilt can start right away.
    if (this.settings.steer === "tilt" && typeof window.DeviceOrientationEvent?.requestPermission !== "function") this.setSteer("tilt", true);
    audio.setVolumes(this.settings.music, this.settings.sfx);
    await step(100, "Let's go!");
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    // Show the changelog once per new entry. It's marked seen as soon as it's shown,
    // so closing the tab without tapping "Let's race!" doesn't bring it back.
    const latest = this.changelog[0]?.id;
    if (latest && seenChangelog !== latest) {
      this.show("whatsnew", false);
      store.set("seenChangelog", latest);
    } else this.show("title");
    const m = location.hash.match(/room=([A-Za-z]{4})/);
    if (m) this.pendingJoin = m[1].toUpperCase();
    // A player-code link from the player's other device
    const pc = location.hash.match(/player=([0-9A-Za-z-]{12,16})/);
    if (pc) {
      history.replaceState(null, "", location.pathname + location.search);
      this.openLink(pc[1].replace(/-/g, "").toUpperCase());
    }
    this.syncAccount();
    this.startPresence();
    this.report({ t: "hello", device: isTouch ? (Math.min(screen.width, screen.height) >= 700 ? "tablet" : "phone") : "desktop", browser: browserName() });
  }

  // ------------------------------------------------------------------ the Custom racer
  // Our creation (always complete and valid)
  myLook() {
    return cleanLook(this.settings.look) || structuredClone(DEFAULT_LOOK);
  }

  // The look to race with as `char` (only the Custom racer has one)
  lookFor(char) {
    return char === CUSTOM ? this.myLook() : undefined;
  }

  // A racer's portrait. Every Custom look gets its own, rendered the first time it's needed.
  portraitFor(char, look) {
    if (!CHARACTERS[char]?.custom) return this.portraits[char] || "";
    const key = lookKey(cleanLook(look) || DEFAULT_LOOK);
    this.lookPortraits ||= new Map();
    let url = this.lookPortraits.get(key);
    if (!url) {
      url = renderPortrait(this.renderer, char, look);
      if (this.lookPortraits.size > 60) this.lookPortraits.clear();
      this.lookPortraits.set(key, url);
    }
    return url;
  }

  // Player stats for the stats page; failures are ignored.
  report(msg) {
    const s = this.settings;
    serverRequest({ pid: this.pid, name: s.name || CHARACTERS[s.char].name, char: s.char, kart: s.kart, ...msg }).catch(() => {});
  }

  // Entries newer than the one this player last saw get a NEW tag. First-time players
  // (nothing seen yet) get none; if their last-seen entry was removed, everything is new.
  buildWhatsNew(seen) {
    const log = this.changelog;
    const idx = log.findIndex((e) => e.id === seen);
    const newCount = seen == null ? 0 : idx < 0 ? log.length : idx;
    const list = $("#whatsnew-list");
    $('[data-action="whatsnew"]').hidden = !log.length;
    log.forEach((entry, i) => {
      const card = document.createElement("div");
      card.className = "card wn-entry" + (i < newCount ? " new" : "");
      const h = document.createElement("h3");
      h.textContent = entry.title;
      const ymd = String(entry.id).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (ymd) {
        const date = document.createElement("small");
        date.className = "muted wn-date";
        date.textContent = new Date(+ymd[1], ymd[2] - 1, +ymd[3]).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
        h.append(" ", date);
      }
      const ul = document.createElement("ul");
      ul.className = "tips";
      for (const item of entry.items || []) {
        const li = document.createElement("li");
        li.textContent = item;
        ul.append(li);
      }
      card.append(h, ul);
      list.append(card);
    });
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
    this.spectate?.resize(this.width, this.height);
    this.attract?.resize(this.width, this.height);
    this.showroom?.resize(this.width, this.height);
  }

  startAttract() {
    if (this.attract) return;
    const track = Math.floor(Math.random() * TRACKS.length);
    const grid = CHARACTERS.map((c, i) => ({ id: "a" + i, name: botName(i), char: i, kart: i % 3, human: false, bot: true, local: true }));
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
    } else if (this.spectate) {
      this.spectate.update(dt);
      this.spectate.render();
    } else if (this.screen === "select" || this.screen === "custom") {
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
    this.caster?.tick(dt, this.session);
    if (this.watch) this.renderWatch();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------------ screens
  show(id, push = true) {
    if (this.screen && push && this.screen !== id && !$("#" + this.screen).classList.contains("overlay")) this.history.push(this.screen);
    for (const s of $$(".screen")) s.classList.toggle("active", s.id === id);
    this.screen = id;
    if (this.showroom) {
      this.showroom.editing = id === "custom";
      if (id !== "custom") (this.showroom.zoom = 0), (this.showroom.spinRate = 0.7);
      if (id === "select" || id === "custom") this.showroom.resize(this.width, this.height);
      if (id === "select") this.refreshSelect(); // back from the editor: show the saved look again
    }
    if (id === "menu") this.refreshDailyButton();
    const first = $(`#${id} .btn.primary, #${id} .btn.pulse, #${id} .btn`);
    if (first && !isTouch) setTimeout(() => first.focus({ preventScroll: true }), 30);
  }

  hideScreens() {
    for (const s of $$(".screen")) s.classList.remove("active");
    this.screen = null;
  }

  back() {
    audio.play("back");
    if ((this.screen === "records" || this.screen === "daily") && this.recordsFrom) {
      const from = this.recordsFrom;
      this.recordsFrom = null;
      return this.show(from, false);
    }
    if (this.screen === "lobby") return this.leaveRoom();
    if (this.screen === "pause") return this.resume();
    // The feedback and player-code boxes go back to wherever they were opened from
    if ((this.screen === "feedback" || this.screen === "link") && this.overlayFrom) {
      const from = this.overlayFrom;
      this.overlayFrom = null;
      return this.show(from, false);
    }
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
      img.src = this.portraitFor(i, this.lookFor(i));
      img.alt = c.name;
      const s = document.createElement("span");
      s.textContent = c.name;
      b.append(img, s);
      b.addEventListener("click", () => {
        this.settings.char = i;
        audio.play("menu");
        this.refreshSelect();
        if (c.custom && !this.settings.look) this.openCustom(); // first time: build your racer
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
    this.seg($("#ghost-choices"), [["mine", "Yours"], ["record", "#1"], ["both", "Both"]], () => this.settings.ttGhost, (v) => {
      this.settings.ttGhost = v;
      this.save();
    });
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
      banana: "Hold the item button to drag it behind you as a shield, let go to drop it. Anyone who hits it spins out.",
      banana3: "Three bananas to drop one at a time. Hold the button to drag one behind you.",
      green: "Circles you as a shield until you fire it, then flies straight and bounces off walls.",
      green3: "Three green shells circle you as a shield. Fire them one at a time.",
      red: "Homes in on the racer ahead of you. Hold the item button to keep it behind you as a shield first.",
      red3: "Three red shells circle you as a shield. Each one homes in on the racer ahead.",
      blue: "Flies high up the track to whoever's in first and explodes on them. Anyone next to them gets caught too.",
      chili: "A burst of speed.",
      chili3: "Three boosts!",
      golden: "Unlimited boosts for 7 seconds after the first one: keep pressing the item button!",
      star: "Invincible and faster. Ram everyone!",
      bullet: "Turns you into a Bullet Bill that drives itself, rockets up the track and knocks over anyone in the way.",
      bolt: "Shrinks every rival and makes them drop items.",
      splat: "Squirts ink on the screens of everyone ahead.",
      bomb: "Throw it ahead (or drop it behind). It explodes after a moment, or when someone touches it. Watch out, the blast hits you too!",
      fire: "For 8 seconds, every press throws a bouncing fireball that spins out whoever it hits.",
      boomerang: "Throw it up to three times. It flies out, hits everyone in its path and comes back to you.",
      piranha: "Rides on your bumper for 8 seconds, chomping karts and items in front of you, with a little lunge each time.",
      horn: "A shockwave that knocks over everyone close to you and destroys the items around you, even a Blue Shell!",
      boo: "Turns you invisible for 5 seconds (nothing can hit you) and steals another racer's item.",
      coin: "Two coins: a little more top speed.",
      eight: "Eight items at once! Each press uses the next one: Star, Mushroom, Coin, Banana, Green Shell, Red Shell, Bob-omb and Blooper.",
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
    // Best times: fastest lap or full race, one tab per track, and the name shown on the boards
    this.seg($("#records-board"), [["laps", "⏱️ Fastest lap"], ["runs", "🏁 Full race"]], () => this.recBoard, (v) => {
      this.recBoard = v;
      this.renderRecords();
    });
    this.seg($("#records-tracks"), TRACKS.map((t, i) => [i, t.name]), () => this.recTrack, (v) => {
      this.recTrack = v;
      this.renderRecords();
    });
    // The name field on the Best times and Daily Challenge screens.
    for (const field of $$(".board-name"))
      field.addEventListener("change", () => {
        const name = field.value.trim().slice(0, 14);
        if (name === this.settings.name) return;
        this.settings.name = name;
        $("#name-input").value = name;
        this.save();
        this.sendProfile();
        serverRequest({ t: "recname", pid: this.pid, name: name || CHARACTERS[this.settings.char].name })
          .then((m) => {
            this.gotRecords(m);
            this.renderRecords();
            if (this.screen === "daily") this.fetchDaily();
          })
          .catch(() => {});
      });
    // Keep the daily countdown ticking, and roll over to the new challenge at midnight.
    setInterval(() => {
      if (this.screen === "daily") this.renderDaily();
    }, 30000);
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
    $("#set-name").addEventListener("change", () => {
      const name = $("#set-name").value.trim().slice(0, 14);
      if (name === this.settings.name) return;
      this.settings.name = name;
      for (const el of [$("#name-input"), ...$$(".board-name")]) el.value = name;
      this.save();
      this.sendProfile();
      serverRequest({ t: "recname", pid: this.pid, name: name || CHARACTERS[this.settings.char].name }).then((m) => this.gotRecords(m)).catch(() => {});
    });
    $("#feedback-text").addEventListener("keydown", (e) => e.stopPropagation()); // typing isn't driving
    $("#link-code").addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") this.checkLink();
    });
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
    const look = this.lookFor(s.char);
    $("#sel-name").textContent = c.name;
    $("#sel-tag").textContent = c.custom && !s.look ? "Build your own racer and car!" : c.tag;
    $("#sel-edit").hidden = !c.custom;
    const stats = look?.stats || c.stats;
    const k = KARTS[s.kart];
    const st = $("#sel-stats");
    st.innerHTML = "";
    for (const key of ["speed", "accel", "weight", "handling"]) {
      const v = Math.max(0, Math.min(6, stats[key] + k.mods[key]));
      const lab = document.createElement("span");
      lab.textContent = { speed: "Speed", accel: "Acceleration", weight: "Weight", handling: "Handling" }[key];
      const bar = document.createElement("div");
      bar.className = "bar";
      bar.innerHTML = `<i style="width:${(v / 6) * 100}%"></i>`;
      st.append(lab, bar);
    }
    this.showroom.setKart(s.char, s.kart, look);
    $("#cc-choices").refresh();
    this.save();
  }

  drawTrackThumb(canvas, index) {
    const t = getTrack(index);
    const def = TRACKS[index];
    const w = (canvas.width = 260), h = (canvas.height = 200);
    const g = canvas.getContext("2d");
    const bgs = { meadow: ["#7ccf5a", "#3f9a3a"], desert: ["#f2c27a", "#c9854e"], snow: ["#eef4ff", "#a8c0e0"], beach: ["#5fd3f0", "#1f9be8"], neon: ["#2a0a4a", "#05010f"], mars: ["#e0875a", "#9a3a1c"], miami: ["#ff5fa8", "#1a1646"], zoo: ["#b6e36a", "#3f9a3a"] };
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
        const run = document.createElement("small");
        run.className = "best";
        const lap = document.createElement("small");
        lap.className = "best";
        const mine = document.createElement("small");
        mine.className = "best mine";
        info.append(run, lap, mine);
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
    if (mode === "tt") {
      // Each track's record from the full-race board, and your own best under it
      this.fillTrackBests();
      serverRequest({ t: "records", pid: this.pid })
        .then((m) => {
          this.gotRecords(m);
          this.fillTrackBests();
        })
        .catch(() => {});
    }
    $("#laps-row").style.display = mode === "vs" ? "" : "none";
    $("#items-row").style.display = mode === "vs" ? "" : "none";
    $("#ghost-row").style.display = mode === "tt" ? "" : "none";
    $("#ghost-choices").refresh();
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
    if (this.session?.replay && !this.screen) {
      if (code === "Escape" || code === "Enter" || code === "Space" || code === "confirm" || code === "cancel" || input.isKey("pause", code)) this.session.skipReplay();
      return;
    }
    if (this.session && !this.screen) {
      if (input.isKey("pause", code)) this.pause();
      else if (this.session.online && (code === "Enter" || code === "NumpadEnter" || code === "KeyT")) setTimeout(() => this.openRaceChat(), 0);
      else if (this.session.online && code === "KeyV") this.action("hud-mic");
      else if (code === "KeyD") this.session.toggleSpecial();
      return;
    }
    if (this.watch && !this.screen) {
      if (code === "Escape" || code === "cancel" || input.isKey("pause", code)) this.stopWatching();
      else if (code === "ArrowRight" || code === "ArrowLeft") this.watchNext(code === "ArrowLeft" ? -1 : 1);
      return;
    }
    if (!this.screen) return;
    if ((code === "Escape" && !inField) || code === "cancel") {
      if (this.screen === "results" || this.screen === "podium" || this.screen === "title") return;
      if (this.screen === "menu") return;
      if (this.screen === "whatsnew") return this.action("whatsnew-close");
      if (this.screen === "challenge") return this.answerChallenge(false);
      if (this.screen === "sharecard") return this.action("share-close");
      if (this.screen === "tutorial-done") return this.action("tut-practice");
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
        if (this.newPlayer && !store.get("tutorialOffered", false)) {
          // Brand new here: offer the tutorial once before the first race
          store.set("tutorialOffered", true);
          this.offerMode = el.dataset.mode;
          return this.show("tutorial-offer");
        }
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
      case "race-record-ghost":
        audio.play("select");
        this.flow = "tt";
        this.startTimeTrial(this.recTrack, "both");
        break;
      case "back":
        this.back();
        break;
      case "settings":
        audio.play("select");
        this.openSettings();
        this.show("settings", !this.session);
        break;
      case "code-copy":
      case "code-wa":
      case "code-use":
      case "code-reset":
        audio.play("select");
        this.codeAction(a.slice(5));
        break;
      case "feedback":
        audio.play("select");
        this.openFeedback();
        break;
      case "feedback-send":
        this.sendFeedback();
        break;
      case "link-check":
        this.checkLink();
        break;
      case "link-yes":
        this.confirmLink();
        break;
      case "link-cancel":
        audio.play("back");
        this.back();
        break;
      case "howto":
        audio.play("select");
        this.show("howto");
        break;
      case "tutorial":
        this.startTutorial();
        break;
      case "tut-skip":
        this.session?.tutorial?.skip();
        break;
      case "tut-exit":
        audio.play("back");
        this.quitRace();
        break;
      case "tut-practice":
        // Keep driving the tutorial lap as long as they like
        audio.play("select");
        this.resume();
        break;
      case "tut-race":
        this.quitRace();
        this.action("mode", { dataset: { mode: "vs" } });
        break;
      case "tut-no": {
        // They know how to play: carry on to the mode they picked
        this.history = ["menu"];
        this.action("mode", { dataset: { mode: this.offerMode || "vs" } });
        break;
      }
      case "records":
        audio.play("select");
        this.openRecords(el?.dataset.track != null ? Number(el.dataset.track) : this.recTrack, el?.dataset.board);
        break;
      case "daily":
        audio.play("select");
        this.openDaily();
        break;
      case "daily-go":
        this.startDaily();
        break;
      case "replay-skip":
        audio.play("back");
        this.session?.skipReplay();
        break;
      case "players":
        audio.play("select");
        this.show("players");
        this.renderPlayers();
        break;
      case "challenge":
        this.challengePlayer(el.dataset.uid);
        break;
      case "watch":
        this.watchPlayer(el.dataset.uid);
        break;
      case "custom-edit":
        this.openCustom();
        break;
      case "custom-random":
        audio.play("roulette");
        this.draft = { ...randomLook(), stats: this.draft.stats };
        this.previewCustom();
        break;
      case "custom-save":
        this.saveCustom();
        break;
      case "watch-stop":
        this.stopWatching();
        break;
      case "watch-next":
        this.watchNext(1);
        break;
      case "challenge-yes":
        this.answerChallenge(true);
        break;
      case "challenge-no":
        this.answerChallenge(false);
        break;
      case "notify-toggle":
        this.toggleNotify();
        break;
      case "whatsnew":
        audio.play("select");
        this.show("whatsnew");
        break;
      case "whatsnew-close":
        // Opened on load there's no history: land on the title screen.
        audio.play("select");
        if (this.history.length) this.back();
        else this.show("title", false);
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
      case "invite-whatsapp": {
        const code = this.room?.code;
        if (!code) break;
        const url = `${location.origin}${location.pathname}#room=${code}`;
        this.openWhatsApp(`🏁 Let's race! Join my Chamo Kart room ${code}: ${url}`);
        break;
      }
      case "share":
        this.openShare();
        break;
      case "share-go":
        this.shareCard();
        break;
      case "share-save":
        this.saveCard();
        break;
      case "share-wa":
        this.openWhatsApp(this.shareText());
        break;
      case "share-close":
        audio.play("back");
        this.show(this.shareFrom || "results", false);
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
    this.racers = [{ id: "you", name: s.name || CHARACTERS[s.char].name, char: s.char, kart: s.kart, look: this.lookFor(s.char), human: true, bot: false, local: true }];
    others.forEach((c, i) => this.racers.push({ id: "cpu" + i, name: botName(c), char: c, kart: Math.floor(Math.random() * 3), human: false, bot: true, local: true }));
  }

  raceGo() {
    audio.play("select");
    if (this.flow === "tt") return this.startTimeTrial(this.selTrack);
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

  // Time Trial against your own best run ("mine"), the board's record ghost ("record"), or both.
  async startTimeTrial(track, mode = this.settings.ttGhost) {
    if (this.startingTT) return; // a double-click mustn't start two races
    this.startingTT = true;
    let recordGhost = null;
    if (mode !== "mine") {
      recordGhost = await this.fetchRecordGhost(track);
      if (!recordGhost) this.toast("No record ghost on this track yet. Set the fastest lap and it's yours!", false, 3000);
    }
    this.startingTT = false;
    const s = this.settings;
    const ownGhost = mode !== "record" || !recordGhost;
    this.showTTRecords(track);
    this.startRace({
      mode: "tt",
      track,
      laps: 3,
      cc: 150,
      items: false,
      grid: [{ id: "you", name: s.name || CHARACTERS[s.char].name, char: s.char, kart: s.kart, look: this.lookFor(s.char), human: true, local: true }],
      ghost: ownGhost ? store.get("ghost_" + track, null) : null,
      ownGhost,
      recordGhost,
    });
  }

  // Time Trial: the track's lap record and full-race record, under the timer during the race.
  showTTRecords(track) {
    this.ttTrack = track;
    const fill = () => {
      const el = $("#hud-records");
      el.innerHTML = "";
      if (this.ttTrack !== track) return;
      for (const [label, e] of [["LAP RECORD", this.records?.[track]?.[0]], ["TRACK RECORD", this.runs?.[track]?.[0]]]) {
        if (!e) continue;
        const row = document.createElement("div");
        const l = document.createElement("small");
        l.textContent = label + " ";
        const t = document.createElement("b");
        t.textContent = fmtTime(e.time);
        const n = document.createElement("small");
        n.textContent = " " + e.name;
        row.append(l, t, n);
        el.append(row);
      }
    };
    fill();
    serverRequest({ t: "records", pid: this.pid })
      .then((m) => {
        this.gotRecords(m);
        if (this.session?.cfg.mode === "tt" && !this.session.cfg.daily) fill();
      })
      .catch(() => {});
  }

  // The best-ranked ghost on a track's fastest-lap board, cached for a minute.
  fetchRecordGhost(track) {
    const hit = this.recordGhosts[track];
    if (hit && Date.now() - hit.at < 60000) return Promise.resolve(hit.g);
    this.toast("👻 Fetching the record ghost…", false, 1500);
    return serverRequest({ t: "ghost", track }, 8000)
      .then((m) => {
        const g = !m.none && Array.isArray(m.frames) && m.frames.length > 1 ? m : null;
        this.recordGhosts[track] = { g, at: Date.now() };
        return g;
      })
      .catch(() => null);
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
    this.stopWatching(null);
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
    if (cfg.mode !== "tt" || cfg.daily) {
      this.ttTrack = null;
      $("#hud-records").innerHTML = "";
    }
    this.renderVoice();
    input.racing = true;
    document.activeElement?.blur?.(); // Space/Enter must not re-click a menu button mid-race
    this.session = new RaceSession(this, cfg);
    this.session.resize(this.width, this.height);
    this.presence?.update(); // tell the others what we're racing right away
  }

  restartRace() {
    if (!this.lastRaceCfg || this.lastRaceCfg.mode === "online") return;
    const cfg = { ...this.lastRaceCfg, seed: undefined };
    if (cfg.daily) {
      // Past midnight the old challenge is closed: show the new one instead.
      if (cfg.daily !== dailyId()) {
        this.quitRace();
        this.toast("📅 A new daily challenge is up!");
        return this.openDaily();
      }
      cfg.ghost = this.dailyGhost(cfg.daily);
    } else if (cfg.mode === "tt") cfg.ghost = cfg.ownGhost ? store.get("ghost_" + cfg.track, null) : null; // the record ghost carries over
    this.startRace(cfg);
  }

  endSession() {
    document.body.classList.remove("replaying");
    if (this.session) {
      this.session.dispose();
      this.session = null;
    }
    $("#hud").classList.remove("active");
    $("#hud-social").classList.remove("on");
    this.closeRaceChat();
    input.racing = false;
    audio.stopEngines();
    this.presence?.update();
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
    if (["gp", "vs", "tt"].includes(cfg.mode)) {
      const me = session.me;
      const place = cfg.mode === "tt" ? null : rows.findIndex((r) => r.id === me.id) + 1 || null;
      this.report({ t: "race", mode: cfg.daily ? "daily" : cfg.mode, track: cfg.track, char: me.char, kart: me.kartType, place, time: me.finished ? me.finishTime : null, laps: [...this.hud.lapTimes] });
    }
    if (cfg.daily) {
      const me = session.me;
      const saved = store.get("daily", null);
      const prev = saved?.id === cfg.daily ? saved.best : null;
      const isBest = prev == null || me.finishTime < prev;
      if (isBest) {
        store.set("daily", { id: cfg.daily, best: me.finishTime });
        store.set("ghost_daily", { id: cfg.daily, time: me.finishTime, char: me.char, kart: me.kartType, look: me.look, frames: session.ghostFrames });
      }
      $("#results-title").textContent = isBest ? "New daily best!" : "Daily Challenge";
      this.shareInfo = { title: isBest ? "NEW DAILY BEST!" : "DAILY CHALLENGE", big: fmtTime(me.finishTime), sub: `${def.name} · Daily Challenge · ${cfg.cc}cc`, char: me.char, track: cfg.track };
      $("#results-sub").textContent = `${def.name} · ${cfg.cc}cc · ${fmtTime(me.finishTime)}${prev ? ` · best today ${fmtTime(Math.min(prev, me.finishTime))}` : ""}`;
      this.hud.lapTimes.forEach((t, i) => this.resultRow(table, { pos: "L" + (i + 1), char: me.char, look: me.look, name: `Lap ${i + 1}`, time: fmtTime(t), me: true }, i));
      btn("Main menu", "menu");
      const boardBtn = btn("📅 Today's board", "daily");
      btn("📸 Share", "share");
      btn("Try again", "retry", true);
      this.submitDaily(cfg, me, [...this.hud.lapTimes], boardBtn, isBest);
    } else if (cfg.mode === "tt") {
      const me = session.me;
      const bests = store.get("best", {});
      const prev = bests[cfg.track];
      const isBest = !prev || me.finishTime < prev;
      if (isBest) {
        bests[cfg.track] = me.finishTime;
        store.set("best", bests);
        store.set("ghost_" + cfg.track, { time: me.finishTime, char: me.char, kart: me.kartType, look: me.look, frames: session.ghostFrames });
      }
      $("#results-title").textContent = isBest ? "New record!" : "Time Trial";
      this.shareInfo = { title: isBest ? "NEW RECORD!" : "TIME TRIAL", big: fmtTime(me.finishTime), sub: `${def.name} · best lap ${fmtTime(Math.min(...this.hud.lapTimes))}`, char: me.char, track: cfg.track };
      const rg = cfg.recordGhost;
      $("#results-sub").textContent = `${def.name} · ${fmtTime(me.finishTime)}${prev ? ` · best ${fmtTime(Math.min(prev, me.finishTime))}` : ""}${rg ? ` · #${rg.rank} ghost ${fmtTime(rg.time)}` : ""}`;
      if (rg && me.finishTime < rg.time) this.toast(`👻 You beat ${rg.name}'s ghost!`, false, 4000);
      this.hud.lapTimes.forEach((t, i) => this.resultRow(table, { pos: "L" + (i + 1), char: me.char, look: me.look, name: `Lap ${i + 1}`, time: fmtTime(t), me: true }, i));
      btn("Main menu", "menu");
      const recBtn = btn("🏆 Best times", "records");
      btn("📸 Share", "share");
      recBtn.dataset.track = cfg.track;
      btn("Try again", "retry", true);
      this.submitLaps(cfg, me, [...this.hud.lapTimes], recBtn, { time: me.finishTime, frames: session.ghostFrames });
    } else if (cfg.mode === "gp") {
      const gp = this.gp;
      rows.forEach((r, i) => gp.points.set(r.id, gp.points.get(r.id) + (POINTS[i] || 0)));
      $("#results-title").textContent = `Race ${gp.index + 1}/${gp.cup.tracks.length}: ${def.name}`;
      const myPlace = rows.findIndex((r) => r.human) + 1;
      $("#results-sub").textContent = `You finished ${ordinal(myPlace)}!`;
      this.shareInfo = { title: myPlace === 1 ? "YOU WIN!" : "CHAMO CUP", big: ordinal(myPlace), sub: `${def.name} · race ${gp.index + 1}/${gp.cup.tracks.length} · ${gp.cc}cc`, char: rows[myPlace - 1].char, track: cfg.track, place: myPlace };
      rows.forEach((r, i) =>
        this.resultRow(table, { pos: i + 1, char: r.char, look: r.look, name: r.name, time: (r.estimated ? "~" : "") + fmtTime(r.time), pts: `+${POINTS[i] || 0} · ${gp.points.get(r.id)}`, me: r.human }, i)
      );
      btn("Quit", "menu");
      btn("📸 Share", "share");
      btn(gp.index + 1 >= gp.cup.tracks.length ? "Final standings" : "Next race", "next-race", true);
    } else {
      const myPlace = rows.findIndex((r) => r.human) + 1;
      $("#results-title").textContent = myPlace === 1 ? "You win!" : `You finished ${ordinal(myPlace)}`;
      $("#results-sub").textContent = `${def.name} · ${cfg.cc}cc · ${cfg.laps} laps`;
      this.shareInfo = { title: myPlace === 1 ? "YOU WIN!" : "VERSUS RACE", big: ordinal(myPlace), sub: `${def.name} · ${cfg.cc}cc · ${cfg.laps} ${cfg.laps === 1 ? "lap" : "laps"}`, char: rows[myPlace - 1].char, track: cfg.track, place: myPlace };
      rows.forEach((r, i) => this.resultRow(table, { pos: i + 1, char: r.char, look: r.look, name: r.name, time: (r.estimated ? "~" : "") + fmtTime(r.time), pts: POINTS[i] ? `+${POINTS[i]}` : "", me: r.human }, i));
      btn("Main menu", "menu");
      btn("📸 Share", "share");
      btn("Change track", "change-track");
      btn("Race again", "retry", true);
    }
    audio.playSong({ bpm: 100, root: 65, mode: "major", seed: 5 });
    this.withHighlights(session, () => this.show("results", false));
  }

  // Show the race's best moments first (skippable), then carry on to `done`.
  withHighlights(session, done) {
    this.hideScreens();
    document.activeElement?.blur?.();
    const played = session.playHighlights({
      clip: (i, n, text) => {
        $("#replay-count").textContent = `${i + 1}/${n}`;
        const cap = $("#replay-caption");
        cap.textContent = text;
        cap.style.animation = "none";
        void cap.offsetWidth; // restart the caption animation for each clip
        cap.style.animation = "";
      },
      sound: (e, k) => {
        if (e === "pad" && CHARACTERS[k?.char]?.style === "tabby") audio.play("meow", 0.8);
        else if (e.startsWith("hit:")) audio.play("shellHit", 0.7);
        else if (e === "fall") audio.play("fall", 0.7);
        else if (e === "trick") audio.play("trick", 0.7);
        else if (e === "finish") audio.play("finish", 0.7);
      },
      done: () => {
        document.body.classList.remove("replaying");
        if (this.session === session) done();
      },
    });
    if (played) document.body.classList.add("replaying");
  }

  resultRow(table, r, i) {
    const row = document.createElement("div");
    row.className = `rr p${r.pos}` + (r.me ? " me" : "");
    row.style.animationDelay = i * 0.06 + "s";
    const pos = document.createElement("span");
    pos.className = "pos";
    pos.textContent = r.pos;
    const img = document.createElement("img");
    img.src = this.portraitFor(r.char, r.look);
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

  // Best times screen. From an overlay (race results) Back returns to it.
  openRecords(track, board = this.recBoard) {
    this.recTrack = track;
    this.recBoard = board;
    $("#records-board").refresh();
    $("#records-tracks").refresh();
    $("#records-name").value = this.settings.name;
    $("#records-name").placeholder = CHARACTERS[this.settings.char].name;
    const from = this.screen;
    const overlay = from && $("#" + from).classList.contains("overlay");
    this.recordsFrom = overlay ? from : null;
    this.show("records", !overlay);
    this.renderRecords();
    if (!this.records) $("#records-status").textContent = "Loading the boards…";
    serverRequest({ t: "records", pid: this.pid })
      .then((m) => {
        this.gotRecords(m);
        this.renderRecords();
      })
      .catch(() => {
        if (!this.records) $("#records-status").textContent = "Can't reach the server right now. Try again in a bit.";
      });
  }

  fillTrackBests() {
    const bests = store.get("best", {});
    $$("#track-grid .track-card").forEach((card, i) => {
      const [run, lap, mine] = card.querySelectorAll(".best");
      if (!run) return;
      const board = this.runs?.[i] || [];
      const top = board[0], topLap = this.records?.[i]?.[0];
      const own = [bests[i], board.find((e) => e.mine)?.time].filter((t) => t > 0);
      run.textContent = top ? `🏆 Track ${fmtTime(top.time)} ${top.name}` : this.runs ? "No record yet" : "";
      lap.textContent = topLap ? `⏱️ Lap ${fmtTime(topLap.time)} ${topLap.name}` : "";
      mine.textContent = own.length ? `You: ${fmtTime(Math.min(...own))}` : "";
    });
  }

  gotRecords(m) {
    this.records = m.laps;
    this.runs = m.runs || this.runs;
  }

  renderRecords() {
    const table = $("#records-table");
    table.innerHTML = "";
    $("#records-ghost").style.display = "none";
    const runs = this.recBoard === "runs";
    $("#records-note").textContent = runs
      ? "Each racer's best 3-lap Time Trial. Finish one to get on the board!"
      : "Each racer's best lap in Time Trial. Set a lap there to get on the board!";
    const boards = runs ? this.runs : this.records;
    if (!boards) return;
    const list = boards[this.recTrack] || [];
    $("#records-status").textContent = list.length ? "" : `No ${runs ? "races" : "laps"} yet on this track. Be the first!`;
    const top = runs ? -1 : list.findIndex((e) => e.ghost); // ghosts belong to the lap board
    $("#records-ghost").style.display = top >= 0 ? "" : "none";
    $("#records-ghost").textContent = `👻 Race #${top + 1}'s ghost`;
    list.forEach((e, i) => {
      const date = new Date(e.at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      this.resultRow(table, { pos: i + 1, char: e.char, look: e.look, name: e.name + (e.ghost ? " 👻" : ""), time: `${KARTS[e.kart]?.name ?? ""} · ${date}`, pts: fmtTime(e.time), me: e.mine }, i);
    });
  }

  // Post a finished Time Trial's laps to the global boards.
  // The run's ghost goes along whenever its best lap could improve our board entry.
  submitLaps(cfg, me, laps, button, ghost) {
    const s = this.settings;
    const mine = this.records?.[cfg.track]?.find((e) => e.mine);
    const sendGhost = !mine || Math.min(...laps) < mine.time;
    if (sendGhost) delete this.recordGhosts[cfg.track]; // we may be the new record holder
    serverRequest({ t: "laps", pid: this.pid, track: cfg.track, laps, name: s.name || CHARACTERS[me.char].name, char: me.char, kart: me.kartType, look: me.look || undefined, ghost: sendGhost ? ghost : undefined })
      .then((m) => {
        this.gotRecords(m);
        if (this.screen === "records") this.renderRecords();
        if (!m.rank && !m.runRank) return;
        // Lead with the full race, the time this run was about.
        const board = m.runRank ? "runs" : "laps";
        const rank = m.runRank || m.rank;
        button.textContent = `🏆 You're #${rank}!`;
        button.dataset.board = board;
        if (this.shareInfo) this.shareInfo.badge = m.runRank ? `#${rank} full race` : `#${rank} fastest lap`;
        const where = TRACKS[cfg.track].name;
        const msg = m.runRank && m.rank ? `Your best race is #${m.runRank} and your best lap #${m.rank} on ${where}!` : m.runRank ? `Your best race is #${m.runRank} on ${where}!` : `Your best lap is #${m.rank} on ${where}!`;
        this.toast(`🏆 ${msg}`, false, 4000);
      })
      .catch(() => {});
  }

  // ------------------------------------------------------------------ daily challenge
  dailyGhost(id) {
    const g = store.get("ghost_daily", null);
    return g?.id === id ? g : null;
  }

  refreshDailyButton() {
    const ch = dailyChallenge();
    const saved = store.get("daily", null);
    const played = saved?.id === ch.id;
    $(".btn.mode.daily").classList.toggle("fresh", !played);
    $("#daily-menu-sub").textContent = played ? `Your best today: ${fmtTime(saved.best)}` : `Today: ${TRACKS[ch.track].name} at ${ch.cc}cc`;
  }

  // Like Best times, Back returns to the race results when opened from there.
  openDaily() {
    $("#daily-name").value = this.settings.name;
    $("#daily-name").placeholder = CHARACTERS[this.settings.char].name;
    const from = this.screen;
    if (from !== "daily") {
      const overlay = from && $("#" + from).classList.contains("overlay");
      this.recordsFrom = overlay ? from : null;
      this.show("daily", !overlay);
    }
    this.renderDaily();
    this.fetchDaily();
  }

  fetchDaily() {
    serverRequest({ t: "daily", pid: this.pid })
      .then((m) => {
        this.daily = m;
        if (this.screen === "daily") this.renderDaily();
      })
      .catch(() => {
        if (this.daily?.day !== dailyId()) $("#daily-status").textContent = "Can't reach the server right now. Try again in a bit.";
      });
  }

  renderDaily() {
    const ch = dailyChallenge();
    if (this.dailyShown !== ch.id) {
      // First render, or midnight passed while this screen was open.
      if (this.dailyShown && this.screen === "daily") this.fetchDaily();
      this.dailyShown = ch.id;
      this.drawTrackThumb($("#daily-thumb"), ch.track);
      $("#daily-track").textContent = TRACKS[ch.track].name;
      $("#daily-portrait").src = this.portraitFor(ch.char, this.lookFor(ch.char));
      $("#daily-char").textContent = CHARACTERS[ch.char].name;
      $("#daily-kart").textContent = `${KARTS[ch.kart].name} · ${ch.cc}cc · ${ch.laps} laps`;
    }
    const left = msToNextDaily();
    const h = Math.floor(left / 3600000);
    const m = Math.ceil((left % 3600000) / 60000);
    const date = new Date(ch.id + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
    $("#daily-when").textContent = `${date} · new challenge in ${h ? `${h}h ` : ""}${m}m`;
    const saved = store.get("daily", null);
    $("#daily-best").textContent = saved?.id === ch.id ? `Your best: ${fmtTime(saved.best)}` : "";
    const table = $("#daily-table");
    table.innerHTML = "";
    const d = this.daily?.day === ch.id ? this.daily : null;
    if (!d) {
      $("#daily-status").textContent = "Loading the board…";
      $("#daily-prev").textContent = "";
      return;
    }
    $("#daily-status").textContent = d.count ? `${d.count} ${d.count === 1 ? "racer" : "racers"} so far today.` : "Nobody has raced today's challenge yet. Be the first!";
    const lead = d.top[0]?.time;
    const row = (e, pos, i) => this.resultRow(table, { pos, char: ch.char, look: e.look, name: e.name, time: pos === 1 ? "" : "+" + (e.time - lead).toFixed(3), pts: fmtTime(e.time), me: e.mine }, i);
    d.top.forEach((e, i) => row(e, i + 1, i));
    if (d.me && d.me.rank > d.top.length) {
      const gap = document.createElement("div");
      gap.className = "rr gap";
      gap.textContent = "⋯";
      table.append(gap);
      row({ name: this.settings.name || CHARACTERS[this.settings.char].name, time: d.me.time, mine: true, look: this.lookFor(ch.char) }, d.me.rank, d.top.length);
    }
    const p = d.prev;
    $("#daily-prev").textContent = p ? `Yesterday's podium: ${p.top.map((e, i) => `${["🥇", "🥈", "🥉"][i]} ${e.name} ${fmtTime(e.time)}`).join("  ")}` : "";
  }

  startDaily() {
    audio.play("select");
    const ch = dailyChallenge();
    const s = this.settings;
    this.startRace({
      mode: "tt",
      daily: ch.id,
      track: ch.track,
      laps: ch.laps,
      cc: ch.cc,
      items: false,
      // A Custom daily racer wears your look, with the default stats so everyone's on equal terms
      grid: [{ id: "you", name: s.name || CHARACTERS[s.char].name, char: ch.char, kart: ch.kart, look: ch.char === CUSTOM ? { ...this.myLook(), stats: { ...DEFAULT_LOOK.stats } } : undefined, human: true, local: true }],
      ghost: this.dailyGhost(ch.id),
    });
  }

  // Post a finished daily run. The server keeps each racer's best of the day.
  submitDaily(cfg, me, laps, button, isBest) {
    const s = this.settings;
    serverRequest({ t: "dailyrun", pid: this.pid, day: cfg.daily, time: me.finishTime, laps, name: s.name || CHARACTERS[s.char].name, look: me.look || undefined })
      .then((m) => {
        this.daily = m;
        if (this.screen === "daily") this.renderDaily();
        if (!m.me || m.day !== cfg.daily) return;
        button.textContent = `📅 You're #${m.me.rank} today!`;
        if (this.shareInfo) this.shareInfo.badge = `#${m.me.rank} of ${m.count} today`;
        if (isBest) this.toast(`📅 You're #${m.me.rank} of ${m.count} in today's challenge!`, false, 4000);
      })
      .catch(() => {});
  }

  showPodium() {
    const gp = this.gp;
    const ranked = [...this.racers].sort((a, b) => gp.points.get(b.id) - gp.points.get(a.id));
    this.report({ t: "cup", place: ranked.findIndex((r) => r.human) + 1 });
    const stage = $("#podium-stage");
    stage.innerHTML = "";
    for (const idx of [1, 0, 2]) {
      const r = ranked[idx];
      const d = document.createElement("div");
      d.className = "pod p" + (idx + 1);
      const img = document.createElement("img");
      img.src = this.portraitFor(r.char, r.look);
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
      myRank === 1 ? "🏆 Champion! You won the gold cup!" : myRank === 2 ? "🥈 Silver cup! So close!" : myRank === 3 ? "🥉 Bronze cup! Nice racing!" : `You placed ${ordinal(myRank)}. Try harder next time!`;
    const table = $("#podium-table");
    table.innerHTML = "";
    ranked.forEach((r, i) => this.resultRow(table, { pos: i + 1, char: r.char, look: r.look, name: r.name, pts: gp.points.get(r.id) + " pts", me: r.human }, i));
    const trophies = store.get("trophies", {});
    const key = gp.cc + "cc";
    if (myRank <= 3 && (!trophies[key] || trophies[key] > myRank)) {
      trophies[key] = myRank;
      store.set("trophies", trophies);
    }
    if (myRank <= 3) audio.play("finish");
    const me = ranked[myRank - 1];
    this.shareInfo = {
      title: myRank === 1 ? "CHAMPION!" : "CHAMO CUP",
      big: ["GOLD CUP", "SILVER CUP", "BRONZE CUP"][myRank - 1] || ordinal(myRank),
      sub: `Chamo Cup · ${gp.cc}cc · ${gp.points.get(me.id)} points`,
      char: me.char,
      track: gp.cup.tracks[gp.cup.tracks.length - 1],
      place: myRank,
    };
    this.show("podium", false);
  }

  // ------------------------------------------------------------------ sharing
  openWhatsApp(text) {
    audio.play("select");
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }

  shareText() {
    const i = this.shareInfo || {};
    return `${i.title} ${i.big} · ${i.sub}${i.badge ? ` · ${i.badge}` : ""}. Can you beat me? 🏁 ${location.origin}${location.pathname}`;
  }

  // Draw the card for the last result and show it, ready to share or save.
  async openShare() {
    const info = this.shareInfo;
    if (!info) return;
    audio.play("select");
    const from = (this.shareFrom = this.screen);
    // The race behind the results: render a fresh frame and grab it before it's cleared
    let shot = null;
    if (this.session) {
      this.session.render();
      shot = this.renderer.domElement.toDataURL("image/jpeg", 0.85);
    }
    const map = document.createElement("canvas");
    this.drawTrackThumb(map, info.track ?? 0);
    const accent = ["#ffd23f", "#e6ebf2", "#e0a070"][(info.place || 1) - 1] || "#ffd23f";
    const s = this.settings;
    const blob = await drawShareCard({ ...info, shot, map, accent, portrait: this.portraitFor(info.char ?? s.char, this.lookFor(info.char ?? s.char)), name: s.name || CHARACTERS[info.char ?? s.char].name });
    if (!blob) return this.toast("Couldn't make the picture on this device.", true);
    if (this.screen !== from) return; // they moved on while it was drawing
    this.shareFile = new File([blob], "chamo-kart.png", { type: "image/png" });
    if (this.shareUrl) URL.revokeObjectURL(this.shareUrl);
    this.shareUrl = URL.createObjectURL(blob);
    $("#share-img").src = this.shareUrl;
    $("#share-go").style.display = navigator.canShare?.({ files: [this.shareFile] }) ? "" : "none";
    this.show("sharecard", false);
  }

  // The phone's share sheet, with the picture (WhatsApp, Instagram, …)
  shareCard() {
    if (!this.shareFile) return;
    navigator.share({ files: [this.shareFile], text: this.shareText() }).catch(() => {});
  }

  saveCard() {
    if (!this.shareUrl) return;
    audio.play("select");
    const a = document.createElement("a");
    a.href = this.shareUrl;
    a.download = "chamo-kart.png";
    a.click();
    this.toast("⬇️ Picture saved!");
  }

  // ------------------------------------------------------------------ who's playing
  startPresence() {
    this.presence = new Presence({ hello: () => this.presenceHello(), on: (t, m) => this.onPresence(t, m) });
    this.caster = new Broadcaster((m) => this.presence.send(m));
    this.presence.start();
    setInterval(() => {
      this.presence.update();
      this.checkChallenge();
    }, 3000);
    // A tapped challenge notification lands here with #room=CODE while the game is open.
    window.addEventListener("hashchange", () => {
      const m = location.hash.match(/room=([A-Za-z]{4})/);
      if (m) this.joinRoomCode(m[1].toUpperCase());
      const pc = location.hash.match(/player=([0-9A-Za-z-]{12,16})/);
      if (pc && !this.session) {
        history.replaceState(null, "", location.pathname + location.search);
        this.openLink(pc[1].replace(/-/g, "").toUpperCase());
      }
    });
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js?v=1").catch(() => {});
  }

  presenceHello() {
    const s = this.settings;
    const cfg = this.session?.cfg;
    let status = { where: "menu" };
    if (this.watch) status = { where: "watch" };
    else if (this.room) status = { where: this.session?.online ? "online" : "lobby" };
    else if (cfg) status = { where: "race", mode: cfg.daily ? "daily" : cfg.mode, track: cfg.track };
    return { pid: this.pid, name: s.name || CHARACTERS[s.char].name, char: s.char, look: this.lookFor(s.char), status };
  }

  onPresence(t, m) {
    if (t === "players") {
      const uid = this.presence.uid;
      const others = m.list.filter((p) => p.uid !== uid);
      // A heads-up when someone new starts playing (not for everyone already here when we arrive)
      const fresh = this.playersSeen && uid ? others.filter((p) => !this.playersSeen.has(p.uid)) : [];
      if (fresh.length && Date.now() - (this.lastJoinToast || 0) > 15000) {
        this.lastJoinToast = Date.now();
        this.toast(`🟢 ${fresh[0].name} is playing! Challenge them from 👥 Players.`, false, 5000);
        audio.play("itemGet", 0.6);
      }
      if (uid) this.playersSeen = new Set(others.map((p) => p.uid));
      this.players = others;
      this.renderPlayersChip();
      if (this.screen === "players") this.renderPlayers();
    } else if (t === "welcome") {
      this.setWatchers([], false); // a new connection starts with nobody watching
    } else if (t === "presence-ok") {
      // Notifications are per device: on only if this browser is subscribed too
      this.pushOn = false;
      if (m.push)
        navigator.serviceWorker
          ?.getRegistration()
          .then((reg) => reg?.pushManager.getSubscription())
          .then((sub) => {
            this.pushOn = !!sub;
            if (this.screen === "players") this.renderPlayers();
          })
          .catch(() => {});
      if (this.screen === "players") this.renderPlayers();
      if (this.watch) this.presence.send({ t: "watch", to: this.watch.uid }); // reconnected: keep watching
    } else if (t === "watchers") {
      this.setWatchers(m.names, m.fresh);
    } else if (t === "watch-ok") {
      if (this.watch?.uid === m.uid && !m.online) this.watch.state = "offline";
    } else if (t === "cast") {
      this.onCast(m);
    } else if (t === "challenge") {
      this.incoming = { id: m.id, from: m.from, code: m.code, at: Date.now(), shown: false };
      audio.play("itemGet");
      if (this.session && !this.screen) this.toast(`⚔️ ${m.from.name} challenges you! Answer after the race.`, false, 5000);
      this.checkChallenge();
    } else if (t === "challenge-sent") {
      const name = this.players.find((p) => p.uid === m.to)?.name || "They";
      if (m.delivered === "live") this.toast(`⚔️ Challenge sent! Waiting for ${name} to answer…`, false, 5000);
      else if (m.delivered === "push") this.toast(`📲 ${name} isn't in the game, so we sent a notification. Wait here for them!`, false, 6000);
      else this.toast(`${name} can't be reached right now.`, true);
    } else if (t === "challenge-reply") {
      if (m.accept) this.toast(`✅ ${m.name} accepted! They're joining your room.`, false, 5000);
      else this.toast(`${m.name} can't race right now.`, true, 4000);
    }
  }

  renderPlayersChip() {
    const n = this.players.length;
    $("#players-count").textContent = n ? `${n} playing` : "Players";
    $("#players-chip").classList.toggle("live", n > 0);
  }

  playerStatus(p) {
    const st = p.status || {};
    if (st.where === "lobby") return "In an online room";
    if (st.where === "online") return "Racing online";
    if (st.where === "watch") return st.of ? `Watching ${st.of} race` : "Watching a race";
    if (st.where === "race") {
      const mode = { gp: "Grand Prix", vs: "Racing", tt: "Time Trial", daily: "Daily Challenge", tutorial: "Learning to race" }[st.mode] || "Racing";
      return `${mode} · ${TRACKS[st.track]?.name ?? ""}`;
    }
    return "In the menus";
  }

  renderPlayers() {
    const list = $("#players-list");
    list.innerHTML = "";
    const connected = !!this.presence?.uid;
    $("#players-status").textContent = !connected
      ? "Connecting to the Chamo Kart server…"
      : this.players.length
        ? "Watch someone's race live, or challenge them in a private room."
        : "Nobody else is playing right now. Turn on notifications to hear when someone starts.";
    this.players.forEach((p, i) => {
      const row = document.createElement("div");
      row.className = "rr";
      row.style.animationDelay = i * 0.06 + "s";
      const img = document.createElement("img");
      img.src = this.portraitFor(p.char, p.look);
      img.alt = "";
      const name = document.createElement("span");
      name.className = "nm";
      name.textContent = p.name;
      const st = document.createElement("small");
      st.textContent = this.playerStatus(p);
      name.append(st);
      const b = document.createElement("button");
      b.className = "btn primary";
      b.dataset.action = "challenge";
      b.dataset.uid = p.uid;
      b.textContent = "⚔️ Challenge";
      b.disabled = p.status?.where === "online";
      const btns = document.createElement("div");
      btns.className = "pl-btns";
      if (["race", "online"].includes(p.status?.where)) {
        const w = document.createElement("button");
        w.className = "btn";
        w.dataset.action = "watch";
        w.dataset.uid = p.uid;
        w.textContent = "👀 Watch";
        btns.append(w);
      }
      btns.append(b);
      row.append(img, name, btns);
      list.append(row);
    });
    // Notifications
    const btn = $("#notify-btn");
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    btn.style.display = supported ? "" : "none";
    if (!supported)
      $("#notify-text").textContent = ios
        ? "On iPhone and iPad, tap Share → Add to Home Screen, then open Chamo Kart from your home screen to turn on notifications."
        : "This browser can't show notifications.";
    else if (Notification.permission === "denied") {
      $("#notify-text").textContent = "Notifications are blocked for this site. Allow them in your browser settings to turn them on.";
      btn.style.display = "none";
    } else if (this.pushOn && Notification.permission === "granted") {
      $("#notify-text").textContent = "You'll get a notification when someone starts playing or challenges you.";
      btn.textContent = "🔕 Turn off";
    } else {
      $("#notify-text").textContent = "Get a notification when someone starts playing Chamo Kart, or challenges you to a race.";
      btn.textContent = "🔔 Turn on";
    }
  }

  async toggleNotify() {
    const btn = $("#notify-btn");
    btn.disabled = true;
    try {
      const reg = await navigator.serviceWorker.register("sw.js?v=1");
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (this.pushOn) {
        const endpoint = sub?.endpoint;
        await sub?.unsubscribe();
        await serverRequest({ t: "push-unsub", pid: this.pid, endpoint });
        this.pushOn = false;
        this.toast("🔕 Notifications off.");
      } else {
        if ((await Notification.requestPermission()) !== "granted") {
          this.toast("Notifications are blocked. Allow them for this site in your browser settings.", true);
          return;
        }
        if (!sub) {
          const { key } = await serverRequest({ t: "push-key" });
          const raw = atob(key.replace(/-/g, "+").replace(/_/g, "/"));
          sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) });
        }
        const m = await serverRequest({ t: "push-sub", pid: this.pid, sub: sub.toJSON() });
        this.pushOn = !!m.ok;
        this.toast(m.ok ? "🔔 Notifications on! We'll tell you when someone's playing." : "Couldn't turn on notifications right now.", !m.ok);
      }
    } catch {
      this.toast("Couldn't turn on notifications on this device.", true);
    } finally {
      btn.disabled = false;
      this.renderPlayers();
    }
  }

  // Challenge a player: make a private room, then invite them to it.
  async challengePlayer(uid) {
    const p = this.players.find((x) => x.uid === uid);
    if (!p) return this.toast("They just left.", true);
    audio.play("select");
    if (!this.settings.name) {
      this.settings.name = CHARACTERS[this.settings.char].name;
      this.save();
    }
    await this.openOnline();
    if (!this.net?.connected) return;
    let code = this.room?.code;
    if (!code) {
      code = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          off();
          resolve(null);
        }, 6000);
        const off = this.net.on("room", (m) => {
          clearTimeout(timer);
          off();
          resolve(m.room.code);
        });
        this.withName(() => this.net.send({ t: "create", public: false }));
      });
    }
    if (!code) return this.toast("Couldn't make a room for the challenge. Try again.", true);
    this.presence.send({ t: "challenge", to: uid, code });
  }

  // Show a waiting challenge once we're not in the middle of a race; drop it after 2 minutes.
  checkChallenge() {
    const c = this.incoming;
    if (!c) return;
    if (Date.now() - c.at > 120000) {
      this.presence.send({ t: "challenge-reply", id: c.id, accept: false });
      this.incoming = null;
      if (this.screen === "challenge") this.afterChallenge();
      return;
    }
    if (c.shown || (this.session && !this.screen) || this.screen === "loading") return;
    c.shown = true;
    this.challengeFrom = this.screen && this.screen !== "challenge" ? this.screen : null;
    $("#challenge-portrait").src = this.portraitFor(c.from.char, c.from.look) || "";
    $("#challenge-text").textContent = `${c.from.name} challenges you to a race!`;
    this.show("challenge", false);
  }

  answerChallenge(accept) {
    const c = this.incoming;
    this.incoming = null;
    if (!c) return;
    audio.play(accept ? "select" : "back");
    this.presence.send({ t: "challenge-reply", id: c.id, accept });
    if (accept) this.joinRoomCode(c.code);
    else this.afterChallenge();
  }

  // Back to wherever the challenge popped up: a menu, or the race we were watching.
  afterChallenge() {
    if (this.challengeFrom) this.show(this.challengeFrom, false);
    else if (this.watch) this.hideScreens();
    else this.show("menu", false);
  }

  // Go straight into an online room (accepted challenge or notification link).
  joinRoomCode(code) {
    if (this.watch) {
      this.stopWatching(null);
      this.startAttract();
    }
    if (this.session) {
      this.endSession();
      this.startAttract();
    }
    if (!this.settings.name) {
      this.settings.name = CHARACTERS[this.settings.char].name;
      this.save();
    }
    audio.playSong(TITLE_SONG);
    this.pendingJoin = code;
    this.history = ["menu"];
    this.openOnline();
  }

  // ------------------------------------------------------------------ the tutorial
  startTutorial() {
    audio.play("select");
    const s = this.settings;
    this.flow = "tutorial";
    this.startRace({
      mode: "tutorial",
      track: 0,
      laps: 99,
      cc: 100, // a gentler speed for learning
      items: true,
      grid: [{ id: "you", name: s.name || CHARACTERS[s.char].name, char: s.char, kart: s.kart, look: this.lookFor(s.char), human: true, local: true }],
    });
  }

  onTutorialDone(session) {
    if (this.session !== session) return;
    store.set("tutorialDone", true);
    audio.play("finish");
    session.paused = true;
    this.show("tutorial-done", false);
  }

  // ------------------------------------------------------------------ the Custom racer's editor
  openCustom() {
    audio.play("select");
    this.draft = this.myLook();
    this.draftKart = this.settings.kart;
    this.customTab ||= "avatar";
    if (!this.customBound) this.bindCustom();
    this.show("custom");
    this.renderCustom();
  }

  bindCustom() {
    this.customBound = true;
    $("#custom-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("[data-tab]");
      if (!b) return;
      audio.play("menu");
      this.customTab = b.dataset.tab;
      this.renderCustom();
    });
    const body = $("#custom-body");
    body.addEventListener("click", (e) => {
      const b = e.target.closest("[data-k]");
      if (!b || b.tagName === "INPUT") return;
      audio.play("menu", 0.7);
      const { k, v } = b.dataset;
      if (k === "kart") this.draftKart = Number(v);
      else if (k.startsWith("stat+") || k.startsWith("stat-")) this.bumpStat(k.slice(5), k[4] === "+" ? 1 : -1);
      else this.draft[k] = b.classList.contains("cz-sw") ? Number(v) : v;
      this.previewCustom();
    });
    // The colour wheel previews while dragging, a few times a second
    body.addEventListener("input", (e) => {
      const el = e.target;
      if (el.type === "color") {
        this.draft[el.dataset.k] = parseInt(el.value.slice(1), 16);
        clearTimeout(this.colorTimer);
        this.colorTimer = setTimeout(() => this.previewCustom(), 200);
      } else if (el.type === "number") {
        const n = Math.round(Number(el.value));
        if (Number.isFinite(n)) this.draft.number = Math.max(0, Math.min(99, n));
        clearTimeout(this.colorTimer);
        this.colorTimer = setTimeout(() => this.previewCustom(false), 300);
      }
    });
  }

  bumpStat(key, d) {
    const st = this.draft.stats;
    const used = STAT_KEYS.reduce((a, k) => a + st[k], 0);
    const v = st[key] + d;
    if (v < STAT_MIN || v > STAT_MAX || (d > 0 && used >= STAT_POINTS)) return audio.play("back");
    st[key] = v;
  }

  // Show the draft on the turntable, and refresh the controls (keeping keyboard focus)
  previewCustom(rerender = true) {
    const stats = this.draft.stats; // mid-edit they may not add up yet, so keep them as they are
    this.draft = cleanLook(this.draft) || this.draft;
    this.draft.stats = stats;
    this.showroom.setKart(CUSTOM, this.draftKart, this.draft);
    if (!rerender) return;
    const f = document.activeElement;
    const key = f?.dataset?.k != null ? `[data-k="${f.dataset.k}"]${f.dataset.v != null ? `[data-v="${f.dataset.v}"]` : ""}` : null;
    this.renderCustom();
    if (key) $("#custom-body " + key)?.focus({ preventScroll: true });
  }

  renderCustom() {
    const d = this.draft;
    const tab = this.customTab;
    for (const b of $$("#custom-tabs button")) b.classList.toggle("on", b.dataset.tab === tab);
    this.showroom.zoom = tab === "avatar" ? 1 : 0;
    this.showroom.spinRate = tab === "avatar" ? 0.35 : 0.7;
    this.showroom.setKart(CUSTOM, this.draftKart, d);
    const body = $("#custom-body");
    const scroll = body.parentElement.scrollTop;
    body.innerHTML = "";
    const group = (label, ...parts) => {
      const g = document.createElement("div");
      g.className = "cz-group";
      const l = document.createElement("span");
      l.className = "cz-label";
      l.textContent = label;
      g.append(l, ...parts);
      body.append(g);
    };
    const chips = (key, options = LOOK_OPTIONS[key], current = d[key]) => {
      const wrap = document.createElement("div");
      wrap.className = "cz-chips";
      for (const [id, label] of options) {
        const b = document.createElement("button");
        b.className = "cz-chip" + (String(id) === String(current) ? " on" : "");
        b.dataset.k = key;
        b.dataset.v = id;
        b.textContent = label;
        wrap.append(b);
      }
      return wrap;
    };
    const colors = (key, palette = PALETTE, allowOff = false) => {
      const wrap = document.createElement("div");
      wrap.className = "cz-colors";
      const cur = d[key];
      if (allowOff) {
        const b = document.createElement("button");
        b.className = "cz-sw off" + (cur < 0 ? " on" : "");
        b.dataset.k = key;
        b.dataset.v = -1;
        b.title = "Off";
        wrap.append(b);
      }
      for (const c of palette) {
        const b = document.createElement("button");
        b.className = "cz-sw" + (c === cur ? " on" : "");
        b.style.background = "#" + c.toString(16).padStart(6, "0");
        b.dataset.k = key;
        b.dataset.v = c;
        b.setAttribute("aria-label", "#" + c.toString(16).padStart(6, "0"));
        wrap.append(b);
      }
      // Any colour at all
      const pick = document.createElement("label");
      pick.className = "cz-pick" + (cur >= 0 && !palette.includes(cur) ? " on" : "");
      pick.title = "Any colour";
      const input = document.createElement("input");
      input.type = "color";
      input.dataset.k = key;
      input.value = "#" + Math.max(0, cur).toString(16).padStart(6, "0");
      pick.append(input);
      wrap.append(pick);
      return wrap;
    };
    const number = () => {
      const n = document.createElement("input");
      n.type = "number";
      n.min = 0;
      n.max = 99;
      n.className = "cz-num";
      n.value = d.number;
      n.dataset.k = "number";
      n.setAttribute("aria-label", "Number");
      return n;
    };
    if (tab === "avatar") {
      group("Head", chips("head"));
      group(d.head === "robot" ? "Metal" : "Skin", colors("skin", SKINS));
      group("Eyes", chips("eyes"), colors("eyeColor"));
      group("Mouth", chips("mouth"));
      group("Hair", chips("hair"), colors("hairColor", HAIR));
      group("Hat", chips("hat"), colors("hatColor"));
      group("Outfit", chips("outfit"), colors("shirt"), colors("shirt2"));
      if (d.outfit === "jersey") group("Jersey number", number());
      group("Extra", chips("extra"), colors("extraColor"));
    } else if (tab === "car") {
      group("Body", chips("kart", KARTS.map((k, i) => [i, k.name]), this.draftKart));
      group("Paint", colors("paint"), chips("finish"));
      group("Trim", colors("trim"));
      group("Decals", chips("decal"), colors("decalColor"));
      if (d.decal === "number") group("Number", number());
      group("Rims", colors("rims"));
      group("Spoiler", chips("spoiler"));
      group("Flag", chips("flag"));
      group("Underglow", colors("glow", PALETTE, true));
      group("Boost flames", colors("boost"));
    } else {
      const st = d.stats;
      const left = STAT_POINTS - STAT_KEYS.reduce((a, k) => a + st[k], 0);
      const p = document.createElement("p");
      p.className = "muted";
      p.style.margin = "0";
      p.textContent = `Share ${STAT_POINTS} points between the four, like every racer. Your kart (${KARTS[this.draftKart].name}) adds its own bonus on top.`;
      body.append(p);
      const grid = document.createElement("div");
      grid.className = "cz-stats";
      const names = { speed: "Speed", accel: "Acceleration", weight: "Weight", handling: "Handling" };
      for (const k of STAT_KEYS) {
        const lab = document.createElement("span");
        lab.textContent = names[k];
        const minus = document.createElement("button");
        minus.className = "btn small";
        minus.textContent = "−";
        minus.dataset.k = "stat-" + k;
        minus.setAttribute("aria-label", "Less " + names[k]);
        const pips = document.createElement("div");
        pips.className = "cz-pips";
        for (let i = 1; i <= STAT_MAX; i++) {
          const pip = document.createElement("i");
          if (i <= st[k]) pip.className = "on";
          pips.append(pip);
        }
        const plus = document.createElement("button");
        plus.className = "btn small";
        plus.textContent = "+";
        plus.dataset.k = "stat+" + k;
        plus.setAttribute("aria-label", "More " + names[k]);
        grid.append(lab, minus, pips, plus);
      }
      body.append(grid);
      const l = document.createElement("span");
      l.className = "cz-left" + (left ? " bad" : "");
      l.textContent = left ? `${left} ${left === 1 ? "point" : "points"} left to give` : "All points in! ✓";
      body.append(l);
    }
    body.parentElement.scrollTop = scroll;
  }

  saveCustom() {
    const d = cleanLook(this.draft);
    const used = STAT_KEYS.reduce((a, k) => a + this.draft.stats[k], 0);
    if (!d || used !== STAT_POINTS) {
      this.customTab = "stats";
      this.renderCustom();
      return this.toast(`Give out all ${STAT_POINTS} stat points first.`, true);
    }
    audio.play("select");
    const s = this.settings;
    s.look = d;
    s.kart = this.draftKart;
    s.char = CUSTOM;
    this.save();
    const card = $(`.char-card[data-char="${CUSTOM}"] img`);
    if (card) card.src = this.portraitFor(CUSTOM, d);
    this.sendProfile();
    this.presence?.update();
    this.toast("✅ Saved! Everyone you race will see your creation.");
    this.back();
  }

  // ------------------------------------------------------------------ watching races live
  watchPlayer(uid) {
    const p = this.players.find((x) => x.uid === uid);
    if (!p) return this.toast("They just left.", true);
    if (!this.presence?.uid) return this.toast("Not connected to the server yet.", true);
    audio.play("select");
    this.watch = { uid, name: p.name, char: p.char, state: "connecting" };
    this.hideScreens();
    document.activeElement?.blur?.();
    document.body.classList.add("watching");
    $("#watch-portrait").src = this.portraitFor(p.char, p.look) || "";
    this.renderWatch();
    this.presence.send({ t: "watch", to: uid });
    this.presence.update();
  }

  // Stop watching and go to `to` (null: the caller takes it from here).
  stopWatching(to = "players") {
    if (!this.watch) return;
    this.presence?.send({ t: "watch", to: null });
    this.watch = null;
    this.endSpectate();
    document.body.classList.remove("watching");
    this.presence?.update();
    if (!to) return;
    audio.play("back");
    audio.playSong(TITLE_SONG);
    this.startAttract();
    this.history = ["menu"];
    this.show(to, false);
    if (to === "players") this.renderPlayers();
  }

  endSpectate() {
    if (!this.spectate) return;
    this.spectate.dispose();
    this.spectate = null;
    $("#hud").classList.remove("active", "spect-other");
    audio.stopEngines();
  }

  // Follow the next (or previous) racer in the watched race
  watchNext(dir) {
    const k = this.spectate?.cycleFocus(dir);
    if (k) audio.play("menu", 0.6);
  }

  // The watched player's stream
  onCast(m) {
    const w = this.watch;
    if (!w || m.from !== w.uid) return;
    if (m.k === "setup") {
      w.state = "live";
      if (this.spectate?.id === m.id) return; // the same race, resent for someone who just joined (or after a reconnect)
      this.endSpectate();
      this.stopAttract();
      this.spectate = new SpectateSession(this, m);
      $("#hud").classList.add("active");
    } else if (m.k === "f") {
      if (this.spectate && w.state === "live") this.spectate.push(m);
    } else if (m.k === "end") {
      if (this.spectate) this.spectate.over = true;
      w.state = m.quit ? "quit" : "over";
    } else if (m.k === "idle") {
      if (w.state !== "over" && w.state !== "quit") w.state = "idle";
    } else if (m.k === "gone") w.state = "gone";
  }

  renderWatch() {
    const w = this.watch;
    const s = this.spectate;
    let sub = "";
    if (s) {
      const f = s.focus;
      sub = f && f.id !== s.casterId ? `Following ${f.name} · ${s.def.name}` : `${MODE_NAMES[s.mode] || "Racing"} · ${s.def.name}`;
    }
    let msg = "";
    if (w.state === "connecting") msg = `Connecting to ${w.name}'s race…`;
    else if (w.state === "offline") msg = `${w.name} isn't playing right now.`;
    else if (w.state === "idle") msg = `${w.name} is between races. Their next one will show up here.`;
    else if (w.state === "over") msg = `🏁 Race over! Waiting for ${w.name}'s next race…`;
    else if (w.state === "quit") msg = `${w.name} left the race. Waiting for their next one…`;
    else if (w.state === "gone") msg = `${w.name} closed the game. If they come back, you'll see it here.`;
    else if (s?.paused) msg = `⏸ ${w.name} paused the race`;
    else if (s && s.stalled > 3) msg = `Waiting for ${w.name}…`;
    const set = (el, v) => el.textContent !== v && (el.textContent = v);
    set($("#watch-name"), w.name);
    set($("#watch-sub"), sub);
    set($("#watch-msg"), msg);
    $("#watch-next").hidden = !s || s.sim.karts.length < 2;
    $(".watch-bar").classList.toggle("off", w.state !== "live");
    $("#hud").classList.toggle("spect-other", !!s && s.focusId !== s.casterId);
  }

  // Our own race: who's watching it
  setWatchers(names, fresh) {
    const before = this.caster?.watchers || [];
    const added = names.filter((n) => !before.includes(n));
    this.caster?.setWatchers(names, fresh);
    if (added.length && Date.now() - (this.lastWatchToast || 0) > 8000) {
      this.lastWatchToast = Date.now();
      this.toast(`👀 ${added[0]}${added.length > 1 ? ` and ${added.length - 1} more` : ""} ${added.length > 1 ? "are" : "is"} watching you!`, false, 4000);
    }
    const el = $("#hud-watchers");
    el.textContent = names.length ? `👀 ${names.length} watching` : "";
    el.title = names.join(", ");
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
    this.net.send({ t: "profile", pid: this.pid, name: s.name || CHARACTERS[s.char].name, char: s.char, kart: s.kart, look: this.lookFor(s.char) });
  }

  leaveRoom() {
    this.voice?.leave(true);
    this.net?.send({ t: "leave" });
    this.room = null;
    this.history = ["menu"];
    this.show("online", false);
    this.presence?.update();
  }

  bindNet() {
    const net = this.net;
    net.on("rooms", (m) => this.renderRooms(m.list));
    net.on("room", (m) => {
      const first = !this.room || this.room.code !== m.room.code;
      if (first) this.voice.leave(true);
      this.room = m.room;
      this.voice.sync(m.room);
      this.presence?.update();
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
      img.src = this.portraitFor(p.char, p.look);
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
    const grid = m.grid.map((g) => ({ id: g.id, name: g.name, char: g.char, kart: g.kart, look: g.look, human: !g.bot, bot: g.bot, owner: g.owner, local: g.owner === me && (g.bot || g.id === me) }));
    this.startRace({ mode: "online", track: m.track, laps: m.laps, cc: m.cc, items: m.items, seed: m.seed, grid, localId: me, net: this.net, startAt: m.startAt });
  }

  onlineOver(results) {
    const session = this.session;
    if (!session?.online) {
      if (this.screen === "lobby") this.renderLobby();
      return;
    }
    session.ended = true;
    const table = $("#results-table");
    table.innerHTML = "";
    const me = this.net.id;
    const place = results.findIndex((r) => r.id === me) + 1;
    $("#results-title").textContent = place === 1 ? "You win!" : place ? `You finished ${ordinal(place)}` : "Race over";
    $("#results-sub").textContent = TRACKS[session.cfg.track].name;
    this.shareInfo = { title: place === 1 ? "YOU WIN!" : "ONLINE RACE", big: place ? ordinal(place) : "DNF", sub: `${TRACKS[session.cfg.track].name} · online · ${results.length} racers`, char: this.settings.char, track: session.cfg.track, place };
    results.forEach((r, i) => {
      // The room update with new totals arrives right after this message.
      const prev = this.room?.players.find((p) => p.id === r.id)?.points;
      const total = prev != null ? prev + r.pts : null;
      this.resultRow(
        table,
        {
          pos: i + 1,
          char: r.char,
          look: r.look,
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
    const sh = document.createElement("button");
    sh.className = "btn";
    sh.dataset.action = "share";
    sh.textContent = "📸 Share";
    actions.append(b, sh, re);
    this.renderRematch();
    this.withHighlights(session, () => {
      this.show("results", false);
      clearTimeout(this.lobbyTimer);
      this.lobbyTimer = setTimeout(() => {
        const me = this.room?.players.find((p) => p.id === this.net.id);
        if (this.screen === "results" && this.session?.online && !me?.rematch) this.action("to-lobby");
      }, 12000);
    });
  }
}

const app = new App();
window.chamo = app;
app.boot().catch((err) => {
  console.error(err);
  $("#load-msg").textContent = "Oops! Something went wrong starting the game: " + err.message;
});
