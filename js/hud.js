// In-race HUD: item slot, place, laps, timer, minimap, standings, overlays.
import { COUNTDOWN } from "./sim/race.js?v=3";
import { CHARACTERS } from "./data.js?v=3";

export const ITEM_SVG = {
  banana: `<svg viewBox="0 0 64 64"><path d="M14 12c6 2 7 8 8 14 2 12 10 22 26 24 3 0 4 3 1 5-18 5-36-6-38-25-1-7 0-13 3-18z" fill="#ffd83a" stroke="#8a5a10" stroke-width="3" stroke-linejoin="round"/><path d="M13 12l-3-5 5-1 2 6z" fill="#5a3a1a"/><path d="M18 22c1 10 7 19 18 24" fill="none" stroke="#fff3a0" stroke-width="3" stroke-linecap="round"/></svg>`,
  green: cocoSvg("#3ca83c", "#2a7a2a"),
  red: cocoSvg("#e23b3b", "#9a1f1f"),
  chili: chiliSvg(0, 0, 1),
  chili3: `<svg viewBox="0 0 64 64">${chiliPath(-10, 6, 0.7)}${chiliPath(10, 6, 0.7)}${chiliPath(0, -8, 0.75)}</svg>`,
  star: `<svg viewBox="0 0 64 64"><path d="M32 4l8 17 19 2-14 13 4 19-17-9-17 9 4-19L5 23l19-2z" fill="#ffd83a" stroke="#c87a00" stroke-width="3" stroke-linejoin="round"/><ellipse cx="26" cy="30" rx="2.5" ry="4.5" fill="#222"/><ellipse cx="38" cy="30" rx="2.5" ry="4.5" fill="#222"/></svg>`,
  bolt: `<svg viewBox="0 0 64 64"><path d="M38 4L12 36h16l-6 24 30-36H36z" fill="#ffe23a" stroke="#c87a00" stroke-width="3" stroke-linejoin="round"/></svg>`,
  splat: `<svg viewBox="0 0 64 64"><path d="M32 8c6 0 7 8 12 8s9-3 11 2-5 8-3 12 8 6 5 11-9 1-12 5-2 11-8 11-5-8-10-8-10 5-13 1 3-8 0-12-10-4-8-9 9-3 9-8-6-9-1-12 9 3 12 0 2-11 6-11z" fill="#b3122e" stroke="#5a0010" stroke-width="3" stroke-linejoin="round"/><circle cx="26" cy="28" r="4" fill="#ff6b8a"/><circle cx="38" cy="36" r="2.5" fill="#ff6b8a"/></svg>`,
};
function cocoSvg(fill, dark) {
  return `<svg viewBox="0 0 64 64"><ellipse cx="32" cy="38" rx="24" ry="8" fill="#f5f0dc" stroke="#8a7a50" stroke-width="3"/><path d="M8 38a24 22 0 0 1 48 0z" fill="${fill}" stroke="${dark}" stroke-width="3"/><circle cx="24" cy="24" r="3.5" fill="#3a2412"/><circle cx="36" cy="20" r="3.5" fill="#3a2412"/><circle cx="42" cy="30" r="3.5" fill="#3a2412"/></svg>`;
}
function chiliPath(dx, dy, s) {
  return `<g transform="translate(${32 + dx} ${32 + dy}) scale(${s}) translate(-32 -32)"><path d="M22 16c10-4 22 2 26 14 3 10 2 22-6 28-2 2-4 0-3-2 4-10-2-18-10-22-6-3-12-4-10-12z" fill="#e8322f" stroke="#7a1010" stroke-width="3" stroke-linejoin="round"/><path d="M22 16c-2-4 0-8 4-10 2 2 0 4 0 6" fill="#2f9a3a" stroke="#1a5a20" stroke-width="3" stroke-linejoin="round"/><path d="M30 20c6 0 12 6 13 12" fill="none" stroke="#ff9a8a" stroke-width="3" stroke-linecap="round"/></g>`;
}
function chiliSvg() {
  return `<svg viewBox="0 0 64 64">${chiliPath(0, 0, 1)}</svg>`;
}
const ROULETTE = ["banana", "green", "chili", "red", "star", "bolt", "splat", "chili3"];

export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function fmtTime(t) {
  if (t == null || !isFinite(t)) return "--:--.---";
  t = Math.max(0, t);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t * 1000) % 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

export class HUD {
  constructor(root) {
    this.root = root;
    const $ = (s) => root.querySelector(s);
    this.el = {
      item: $("#hud-item"),
      itemIcon: $("#hud-item-icon"),
      itemCount: $("#hud-item-count"),
      coins: $("#hud-coins-n"),
      time: $("#hud-time"),
      lap: $("#hud-lap"),
      place: $("#hud-place"),
      placeSuf: $("#hud-place-suf"),
      center: $("#hud-center"),
      sub: $("#hud-sub"),
      standings: $("#hud-standings"),
      minimap: $("#hud-minimap"),
      wrong: $("#hud-wrong"),
      speedlines: $("#hud-speedlines"),
      splat: $("#hud-splat"),
      flash: $("#hud-flash"),
      drift: $("#hud-drift"),
      splits: $("#hud-splits"),
    };
    this.cache = {};
    this.msgTimer = 0;
    this.lastCount = null;
    this.portraits = [];
    this.paintSplat();
  }

  // Chamoy splatter overlay: irregular blobs with drips and a glossy highlight.
  paintSplat() {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 576;
    const g = c.getContext("2d");
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const blobs = [[200, 150, 120], [700, 200, 160], [450, 420, 130], [880, 470, 90], [110, 460, 80], [560, 90, 70], [980, 120, 60]];
    for (const [x, y, rad] of blobs) {
      g.fillStyle = `rgb(${150 + r() * 40},${10 + r() * 15},${30 + r() * 20})`;
      g.beginPath();
      const n = 16;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const rr = rad * (0.75 + r() * 0.45);
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        i ? g.quadraticCurveTo(x + Math.cos(a - 0.2) * rad * 1.15, y + Math.sin(a - 0.2) * rad * 1.15, px, py) : g.moveTo(px, py);
      }
      g.fill();
      for (let d = 0; d < 5; d++) {
        const dx = x + (r() - 0.5) * rad * 1.4;
        const len = rad * (0.4 + r() * 0.9);
        g.fillRect(dx - 6, y, 12 + r() * 8, len + rad * 0.5);
        g.beginPath();
        g.arc(dx + 3, y + len + rad * 0.5, 10 + r() * 6, 0, Math.PI * 2);
        g.fill();
      }
      for (let d = 0; d < 8; d++) {
        const a = r() * Math.PI * 2, dist = rad * (1.2 + r() * 0.8);
        g.beginPath();
        g.arc(x + Math.cos(a) * dist, y + Math.sin(a) * dist, 4 + r() * 12, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = "rgba(255,160,180,0.35)";
      g.beginPath();
      g.ellipse(x - rad * 0.3, y - rad * 0.35, rad * 0.25, rad * 0.14, -0.6, 0, Math.PI * 2);
      g.fill();
    }
    this.el.splat.style.background = `url(${c.toDataURL()}) center / cover no-repeat`;
  }

  setup(sim, focusId, opts = {}) {
    this.sim = sim;
    this.focusId = focusId;
    this.opts = opts;
    this.cache = {};
    this.lastCount = null;
    this.lapTimes = [];
    this.lastLapStart = 0;
    this.el.splits.innerHTML = "";
    this.el.center.className = "";
    this.el.center.textContent = "";
    this.el.sub.textContent = "";
    this.el.item.classList.toggle("hidden", sim.mode === "tt" && false);
    this.el.flash.style.opacity = 0;
    this.el.splat.style.opacity = 0;
    // Minimap bake
    const t = sim.track;
    const cv = this.el.minimap;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = 190;
    cv.width = size * dpr;
    cv.height = size * dpr;
    const b = t.bounds;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + 40;
    this.map = {
      scale: (size * dpr) / span,
      ox: (b.minX + b.maxX) / 2,
      oz: (b.minZ + b.maxZ) / 2,
      half: (size * dpr) / 2,
      dpr,
    };
    const bg = document.createElement("canvas");
    bg.width = cv.width;
    bg.height = cv.height;
    const g = bg.getContext("2d");
    const P = (i) => this.mapPt(t.px[i], t.pz[i]);
    g.lineJoin = "round";
    g.lineCap = "round";
    const path = () => {
      g.beginPath();
      for (let i = 0; i <= t.N; i++) {
        const p = P(i % t.N);
        i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]);
      }
    };
    path();
    g.strokeStyle = "rgba(0,0,0,0.55)";
    g.lineWidth = 14 * dpr;
    g.stroke();
    path();
    g.strokeStyle = "rgba(255,255,255,0.92)";
    g.lineWidth = 8 * dpr;
    g.stroke();
    const s = P(0);
    const n = [t.tx[0], t.tz[0]];
    g.strokeStyle = "#111";
    g.lineWidth = 3 * dpr;
    g.beginPath();
    g.moveTo(s[0] - n[1] * 7 * dpr, s[1] + n[0] * 7 * dpr);
    g.lineTo(s[0] + n[1] * 7 * dpr, s[1] - n[0] * 7 * dpr);
    g.stroke();
    this.mapBg = bg;
    // Standings rows
    this.el.standings.innerHTML = "";
    this.el.standings.style.display = sim.mode === "tt" ? "none" : "";
    this.ghost = null;
    this.rows = new Map();
    for (const k of sim.karts) {
      const row = document.createElement("div");
      row.className = "st-row" + (k.id === focusId ? " me" : "");
      const img = document.createElement("img");
      img.src = this.portraits[k.char] || "";
      img.alt = "";
      const pos = document.createElement("span");
      pos.className = "st-pos";
      const name = document.createElement("span");
      name.className = "st-name";
      name.textContent = k.name;
      row.append(pos, img, name);
      this.el.standings.append(row);
      this.rows.set(k.id, { row, pos });
    }
  }

  removeKart(id) {
    const r = this.rows?.get(id);
    if (r) {
      r.row.remove();
      this.rows.delete(id);
    }
  }

  mapPt(x, z) {
    const m = this.map;
    // Screen-up is world -z, so flip horizontally to keep handedness natural
    return [m.half - (x - m.ox) * m.scale, m.half - (z - m.oz) * m.scale];
  }

  set(key, el, value, prop = "textContent") {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el[prop] = value;
  }

  message(text, cls = "", sub = "", dur = 1.6) {
    this.el.center.textContent = text;
    this.el.center.className = "show " + cls;
    this.el.sub.textContent = sub;
    this.msgTimer = dur;
  }

  flash(color = "#fff", strength = 0.8) {
    this.el.flash.style.background = color;
    this.el.flash.style.transition = "none";
    this.el.flash.style.opacity = strength;
    requestAnimationFrame(() => {
      this.el.flash.style.transition = "opacity 0.6s";
      this.el.flash.style.opacity = 0;
    });
  }

  lap(k, sim) {
    const t = sim.time;
    this.lapTimes.push(t - this.lastLapStart);
    this.lastLapStart = t;
    const d = document.createElement("div");
    d.textContent = `L${this.lapTimes.length} ${fmtTime(this.lapTimes[this.lapTimes.length - 1])}`;
    this.el.splits.append(d);
  }

  update(dt, sim, k, onCount) {
    if (!k) return;
    const el = this.el;
    // Countdown
    const t = sim.time;
    if (t < 1) {
      const c = t < -3 ? null : t < -2 ? "3" : t < -1 ? "2" : t < 0 ? "1" : "GO!";
      if (c !== this.lastCount) {
        this.lastCount = c;
        if (c) {
          el.center.textContent = c;
          el.center.className = "show count" + (c === "GO!" ? " go" : "");
          this.msgTimer = c === "GO!" ? 0.9 : 1.2;
          onCount?.(c);
        }
      }
    }
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) {
        el.center.className = "";
        el.sub.textContent = "";
      }
    }
    // Timer + lap
    this.set("time", el.time, fmtTime(k.finished ? k.finishTime : Math.max(0, t)));
    const lap = Math.min(sim.laps, Math.max(1, k.lap));
    this.set("lap", el.lap, `${lap}/${sim.laps}`);
    // Place
    const n = sim.karts.length;
    if (sim.mode !== "tt") {
      const p = k.place;
      this.set("place", el.place, String(p));
      this.set("placeSuf", el.placeSuf, ordinal(p).replace(/^\d+/, ""));
      const cls = "p" + Math.min(p, 5) + (p === n && n > 1 ? " last" : "");
      this.set("placeCls", el.place.parentElement, "hud-place " + cls, "className");
    } else {
      this.set("placeCls", el.place.parentElement, "hud-place hidden", "className");
    }
    // Item
    let icon = "";
    if (k.roulette > 0) {
      const idx = Math.floor(performance.now() / 70) % ROULETTE.length;
      icon = ITEM_SVG[ROULETTE[idx]];
    } else if (k.item) icon = ITEM_SVG[k.item];
    const iconKey = k.roulette > 0 ? "r" + Math.floor(performance.now() / 70) % ROULETTE.length : k.item || "";
    if (this.cache.icon !== iconKey) {
      this.cache.icon = iconKey;
      el.itemIcon.innerHTML = icon;
      el.item.classList.toggle("rolling", k.roulette > 0);
      el.item.classList.toggle("has", !!k.item && k.roulette <= 0);
    }
    this.set("icount", el.itemCount, k.item === "chili3" && k.itemCount > 1 ? "x" + k.itemCount : "");
    this.set("coins", el.coins, String(k.coins));
    // Drift charge meter
    const dl = k.drifting ? k.driftLevel : -1;
    this.set("drift", el.drift, dl < 0 ? "hud-drift" : "hud-drift on l" + dl, "className");
    // Wrong way
    this.set("wrong", el.wrong, k.wrongT > 1.0 && !k.finished ? "show" : "", "className");
    // Speed lines / splat
    const sl = k.boostT > 0 || k.starT > 0 ? 1 : 0;
    el.speedlines.style.opacity = sl;
    el.splat.style.opacity = Math.min(1, k.splatT / 1.5).toFixed(2);
    // Standings list
    if (sim.standings && this.rows) {
      const top = sim.standings;
      for (let i = 0; i < top.length; i++) {
        const r = this.rows.get(top[i].id);
        if (!r) continue;
        const y = i * 30;
        if (r.y !== y) {
          r.y = y;
          r.row.style.transform = `translateY(${y}px)`;
        }
        if (r.p !== i + 1) {
          r.p = i + 1;
          r.pos.textContent = i + 1;
        }
      }
    }
    this.drawMinimap(sim, k);
  }

  drawMinimap(sim, me) {
    const cv = this.el.minimap;
    const g = cv.getContext("2d");
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(this.mapBg, 0, 0);
    const dpr = this.map.dpr;
    for (const o of sim.items.objects) {
      const p = this.mapPt(o.x, o.z);
      g.fillStyle = o.type === "banana" ? "#ffd83a" : o.type === "red" ? "#e23b3b" : "#3ca83c";
      g.beginPath();
      g.arc(p[0], p[1], 2.5 * dpr, 0, Math.PI * 2);
      g.fill();
    }
    const karts = [...sim.karts].sort((a, b) => (a === me ? 1 : b === me ? -1 : 0));
    for (const k of karts) {
      const p = this.mapPt(k.x, k.z);
      const isMe = k === me;
      g.fillStyle = "#" + CHARACTERS[k.char].color.toString(16).padStart(6, "0");
      g.strokeStyle = isMe ? "#fff" : "#111";
      g.lineWidth = (isMe ? 3 : 1.5) * dpr;
      g.beginPath();
      g.arc(p[0], p[1], (isMe ? 6.5 : 4.5) * dpr, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    if (this.ghost) {
      const p = this.mapPt(this.ghost.x, this.ghost.z);
      g.fillStyle = "rgba(255,255,255,0.6)";
      g.beginPath();
      g.arc(p[0], p[1], 4 * dpr, 0, Math.PI * 2);
      g.fill();
    }
  }
}
