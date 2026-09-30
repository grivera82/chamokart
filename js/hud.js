// In-race HUD: item slot, place, laps, timer, minimap, standings, overlays.
import { COUNTDOWN } from "./sim/race.js?v=19";
import { CHARACTERS, racerColor, ITEMS, EIGHT } from "./data.js?v=17";

const BANANA = `<path d="M14 12c6 2 7 8 8 14 2 12 10 22 26 24 3 0 4 3 1 5-18 5-36-6-38-25-1-7 0-13 3-18z" fill="#ffd83a" stroke="#8a5a10" stroke-width="3" stroke-linejoin="round"/><path d="M13 12l-3-5 5-1 2 6z" fill="#5a3a1a"/><path d="M18 22c1 10 7 19 18 24" fill="none" stroke="#fff3a0" stroke-width="3" stroke-linecap="round"/>`;
const svg = (inner) => `<svg viewBox="0 0 64 64">${inner}</svg>`;
// Three of something, in a little pile
const triple = (inner) => svg([[-11, 8, 0.6], [11, 8, 0.6], [0, -9, 0.62]].map(([dx, dy, k]) => `<g transform="translate(${32 + dx} ${32 + dy}) scale(${k}) translate(-32 -32)">${inner}</g>`).join(""));
const cocoInner = (fill, dark) => `<ellipse cx="32" cy="38" rx="24" ry="8" fill="#f5f0dc" stroke="#8a7a50" stroke-width="3"/><path d="M8 38a24 22 0 0 1 48 0z" fill="${fill}" stroke="${dark}" stroke-width="3"/><circle cx="24" cy="24" r="3.5" fill="#3a2412"/><circle cx="36" cy="20" r="3.5" fill="#3a2412"/><circle cx="42" cy="30" r="3.5" fill="#3a2412"/>`;

export const ITEM_SVG = {
  banana: svg(BANANA),
  banana3: triple(BANANA),
  green: cocoSvg("#3ca83c", "#2a7a2a"),
  green3: triple(cocoInner("#3ca83c", "#2a7a2a")),
  red: cocoSvg("#e23b3b", "#9a1f1f"),
  red3: triple(cocoInner("#e23b3b", "#9a1f1f")),
  blue: svg(`<path d="M6 30c-4-6-2-12 2-14l10 10z" fill="#fff" stroke="#8a8aa0" stroke-width="2.5" stroke-linejoin="round"/><path d="M58 30c4-6 2-12-2-14L46 26z" fill="#fff" stroke="#8a8aa0" stroke-width="2.5" stroke-linejoin="round"/><ellipse cx="32" cy="42" rx="24" ry="8" fill="#f5f0dc" stroke="#8a7a50" stroke-width="3"/><path d="M8 42a24 22 0 0 1 48 0z" fill="#2f6ae8" stroke="#163a90" stroke-width="3"/><path d="M32 8l5 12h-10zM17 18l8 7-9 3zM47 18l-8 7 9 3z" fill="#fff" stroke="#8a8aa0" stroke-width="2" stroke-linejoin="round"/>`),
  chili: svg(mushroomInner("#e8322f", "#8a1010", "#fff")),
  chili3: triple(mushroomInner("#e8322f", "#8a1010", "#fff")),
  golden: svg(mushroomInner("#ffc81a", "#b07800", "#fff6c0") + `<path d="M44 12l3-4M50 17l4-2" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`),
  star: `<svg viewBox="0 0 64 64"><path d="M32 4l8 17 19 2-14 13 4 19-17-9-17 9 4-19L5 23l19-2z" fill="#ffd83a" stroke="#c87a00" stroke-width="3" stroke-linejoin="round"/><ellipse cx="26" cy="30" rx="2.5" ry="4.5" fill="#222"/><ellipse cx="38" cy="30" rx="2.5" ry="4.5" fill="#222"/></svg>`,
  bolt: `<svg viewBox="0 0 64 64"><path d="M38 4L12 36h16l-6 24 30-36H36z" fill="#ffe23a" stroke="#c87a00" stroke-width="3" stroke-linejoin="round"/></svg>`,
  bullet: svg(`<path d="M14 18h26c10 0 18 6 18 14s-8 14-18 14H14z" fill="#1c1c24" stroke="#000" stroke-width="3" stroke-linejoin="round"/><rect x="6" y="15" width="10" height="34" rx="3" fill="#8a8a96" stroke="#3a3a44" stroke-width="3"/><ellipse cx="42" cy="27" rx="5" ry="7" fill="#fff"/><circle cx="44" cy="28" r="2.6" fill="#111"/><path d="M34 19l14 3" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="26" cy="42" r="4" fill="#fff"/>`),
  bomb: svg(`<path d="M32 14c2-6 6-8 10-7" fill="none" stroke="#d9d2b0" stroke-width="4" stroke-linecap="round"/><circle cx="44" cy="7" r="4" fill="#ffb020"/><circle cx="32" cy="36" r="20" fill="#1c1c24" stroke="#000" stroke-width="3"/><rect x="28" y="12" width="8" height="6" rx="2" fill="#c9c9d2"/><ellipse cx="26" cy="32" rx="3.5" ry="6" fill="#fff"/><ellipse cx="38" cy="32" rx="3.5" ry="6" fill="#fff"/><path d="M52 36h6M58 30v12" stroke="#c9c9d2" stroke-width="4" stroke-linecap="round"/><ellipse cx="22" cy="57" rx="7" ry="4" fill="#f2a81d" stroke="#8a5a10" stroke-width="2"/><ellipse cx="42" cy="57" rx="7" ry="4" fill="#f2a81d" stroke="#8a5a10" stroke-width="2"/>`),
  fire: svg(`<path d="M32 40v20" stroke="#2f9a3a" stroke-width="5"/><path d="M32 52c-8-8-16-4-18 0 6 2 12 2 18 0zM32 52c8-8 16-4 18 0-6 2-12 2-18 0z" fill="#3cb44a" stroke="#1a5a20" stroke-width="2"/><circle cx="32" cy="24" r="19" fill="#ff7a1a" stroke="#b83a00" stroke-width="3"/><circle cx="32" cy="24" r="13" fill="#ffd83a"/><circle cx="32" cy="24" r="8" fill="#fff"/><ellipse cx="29" cy="23" rx="1.8" ry="3.2" fill="#222"/><ellipse cx="35" cy="23" rx="1.8" ry="3.2" fill="#222"/>`),
  boomerang: svg(`<path d="M10 50L28 10c2-4 8-4 9 1L22 44l32-2c5 0 6 6 1 8L14 56c-4 1-6-2-4-6z" fill="#3a7ad9" stroke="#163a90" stroke-width="3" stroke-linejoin="round"/><path d="M26 16l6 2M48 44l1 6" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`),
  piranha: svg(`<path d="M18 50h28l-3 12H21z" fill="#c8642a" stroke="#6a3010" stroke-width="3" stroke-linejoin="round"/><path d="M32 50V38" stroke="#2f9a3a" stroke-width="5"/><path d="M8 26a24 20 0 0 1 48 0z" fill="#e02828" stroke="#7a1010" stroke-width="3" stroke-linejoin="round"/><path d="M12 32a20 12 0 0 0 40 0z" fill="#e02828" stroke="#7a1010" stroke-width="3" stroke-linejoin="round"/><path d="M12 27h40v4H12z" fill="#fff4e0"/><path d="M16 27l3 4 3-4 3 4 3-4 3 4 3-4 3 4 3-4 3 4 3-4 3 4" fill="none" stroke="#fff" stroke-width="2"/><circle cx="22" cy="16" r="3.5" fill="#fff"/><circle cx="36" cy="12" r="3.5" fill="#fff"/><circle cx="46" cy="19" r="3" fill="#fff"/>`),
  horn: svg(`<path d="M10 26h10l18-14v40L20 38H10z" fill="#ffc81a" stroke="#b07800" stroke-width="3" stroke-linejoin="round"/><rect x="6" y="24" width="8" height="16" rx="2" fill="#e23b3b" stroke="#7a1010" stroke-width="3"/><path d="M46 22c4 4 4 16 0 20M52 16c7 7 7 25 0 32" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`),
  boo: svg(`<path d="M10 34C10 18 20 8 32 8s22 10 22 26c0 8-2 14-6 18l-4-5-4 6-5-6-4 6-4-6-5 5c-4-4-6-10-6-18z" fill="#fff" stroke="#8a8aa0" stroke-width="3" stroke-linejoin="round"/><ellipse cx="25" cy="24" rx="3" ry="5" fill="#111"/><ellipse cx="39" cy="24" rx="3" ry="5" fill="#111"/><path d="M22 33c3 7 17 7 20 0z" fill="#7a1020"/><path d="M29 36c1 5 6 5 7 0z" fill="#ff6f8a"/>`),
  coin: svg(`<circle cx="32" cy="32" r="24" fill="#ffcc22" stroke="#a87a00" stroke-width="3"/><circle cx="32" cy="32" r="17" fill="none" stroke="#fff0a0" stroke-width="3"/><rect x="28" y="20" width="8" height="24" rx="3" fill="#a87a00"/>`),
  eight: svg(`${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const a = (i / 8) * Math.PI * 2; return `<circle cx="${(32 + Math.sin(a) * 22).toFixed(1)}" cy="${(32 - Math.cos(a) * 22).toFixed(1)}" r="6" fill="${["#ffd83a", "#e8322f", "#ffcc22", "#ffd83a", "#3ca83c", "#e23b3b", "#1c1c24", "#ffffff"][i]}" stroke="#333" stroke-width="2"/>`; }).join("")}<text x="32" y="42" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="28" fill="#fff" stroke="#333" stroke-width="2">8</text>`),
  splat: svg(`<path d="M20 38c-2 8-8 12-12 18M27 40c0 8-3 13-5 18M37 40c0 8 3 13 5 18M44 38c2 8 8 12 12 18" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/><path d="M20 38c-2 8-8 12-12 18M27 40c0 8-3 13-5 18M37 40c0 8 3 13 5 18M44 38c2 8 8 12 12 18" fill="none" stroke="#8a8aa0" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/><path d="M32 4c11 8 16 20 15 30-1 5-7 8-15 8s-14-3-15-8c-1-10 4-22 15-30z" fill="#fff" stroke="#8a8aa0" stroke-width="3" stroke-linejoin="round"/><ellipse cx="26" cy="30" rx="4" ry="5.5" fill="#111"/><ellipse cx="38" cy="30" rx="4" ry="5.5" fill="#111"/><circle cx="27" cy="28" r="1.4" fill="#fff"/><circle cx="39" cy="28" r="1.4" fill="#fff"/><path d="M28 38q4 2 8 0" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round"/>`),
};
function cocoSvg(fill, dark) {
  return `<svg viewBox="0 0 64 64"><ellipse cx="32" cy="38" rx="24" ry="8" fill="#f5f0dc" stroke="#8a7a50" stroke-width="3"/><path d="M8 38a24 22 0 0 1 48 0z" fill="${fill}" stroke="${dark}" stroke-width="3"/><circle cx="24" cy="24" r="3.5" fill="#3a2412"/><circle cx="36" cy="20" r="3.5" fill="#3a2412"/><circle cx="42" cy="30" r="3.5" fill="#3a2412"/></svg>`;
}
function mushroomInner(cap, dark, spot) {
  return `<rect x="22" y="34" width="20" height="20" rx="7" fill="#fff4d6" stroke="#b08a3a" stroke-width="3"/><ellipse cx="28" cy="42" rx="2.5" ry="4" fill="#222"/><ellipse cx="36" cy="42" rx="2.5" ry="4" fill="#222"/><path d="M6 36C6 18 18 8 32 8s26 10 26 28z" fill="${cap}" stroke="${dark}" stroke-width="3" stroke-linejoin="round"/><circle cx="32" cy="19" r="6" fill="${spot}"/><circle cx="15" cy="29" r="4.5" fill="${spot}"/><circle cx="49" cy="29" r="4.5" fill="${spot}"/>`;
}
// Every item, shuffled once so the roulette doesn't just count through the list
const ROULETTE = Object.keys(ITEMS).map((k, i) => [k, (i * 7919) % 23]).sort((a, b) => a[1] - b[1]).map(([k]) => k);
// The minimap dot for each kind of thing on the road
const MAP_COLORS = { banana: "#ffd83a", green: "#3ca83c", red: "#e23b3b", blue: "#2f6ae8", bomb: "#111", fire: "#ff7a1a", boomerang: "#3a7ad9" };

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
      records: $("#hud-records"),
    };
    this.cache = {};
    this.msgTimer = 0;
    this.lastCount = null;
    this.portraits = [];
    this.paintSplat();
  }

  // Blooper ink overlay: irregular blobs with drips and a glossy highlight.
  paintSplat() {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 576;
    const g = c.getContext("2d");
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const blobs = [[200, 150, 120], [700, 200, 160], [450, 420, 130], [880, 470, 90], [110, 460, 80], [560, 90, 70], [980, 120, 60]];
    for (const [x, y, rad] of blobs) {
      g.fillStyle = `rgb(${12 + r() * 14},${12 + r() * 14},${22 + r() * 18})`;
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
      g.fillStyle = "rgba(190,190,220,0.3)";
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
    this.el.records.style.display = opts.records ? "" : "none"; // Time Trial's records to beat
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
    this.el.standings.style.display = sim.mode === "tt" || sim.mode === "tutorial" ? "none" : "";
    this.ghosts = [];
    this.rows = new Map();
    for (const k of sim.karts) {
      const row = document.createElement("div");
      row.className = "st-row" + (k.id === focusId ? " me" : "");
      const img = document.createElement("img");
      img.src = this.portraitOf?.(k.char, k.look) || this.portraits[k.char] || "";
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
    if (sim.mode !== "tt" && sim.mode !== "tutorial") {
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
    // The Crazy Eight shows what's up next
    const next = k.item === "eight" && k.itemCount > 0 ? EIGHT[EIGHT.length - k.itemCount] : null;
    if (next && k.roulette <= 0) icon = ITEM_SVG[next];
    const iconKey = k.roulette > 0 ? "r" + Math.floor(performance.now() / 70) % ROULETTE.length : (next || k.item || "");
    if (this.cache.icon !== iconKey) {
      this.cache.icon = iconKey;
      el.itemIcon.innerHTML = icon;
      el.item.classList.toggle("rolling", k.roulette > 0);
      el.item.classList.toggle("has", !!k.item && k.roulette <= 0);
    }
    this.set("icount", el.itemCount, k.item && k.itemCount > 1 && k.roulette <= 0 ? "x" + k.itemCount : "");
    // Golden Mushroom and Fire Flower: a bar that runs down once they're switched on
    const timed = k.itemT > 0 && k.roulette <= 0 ? (k.itemT / (k.item === "golden" ? 7.5 : 8)).toFixed(2) : "";
    if (this.cache.timed !== timed) {
      this.cache.timed = timed;
      el.item.classList.toggle("timed", !!timed);
      el.item.style.setProperty("--t", timed || 0);
    }
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
      g.fillStyle = MAP_COLORS[o.type] || "#fff";
      g.beginPath();
      g.arc(p[0], p[1], (o.type === "blue" ? 4 : 2.5) * dpr, 0, Math.PI * 2);
      g.fill();
    }
    const karts = [...sim.karts].sort((a, b) => (a === me ? 1 : b === me ? -1 : 0));
    for (const k of karts) {
      const p = this.mapPt(k.x, k.z);
      const isMe = k === me;
      g.fillStyle = "#" + racerColor(k.char, k.look).toString(16).padStart(6, "0");
      g.strokeStyle = isMe ? "#fff" : "#111";
      g.lineWidth = (isMe ? 3 : 1.5) * dpr;
      g.beginPath();
      g.arc(p[0], p[1], (isMe ? 6.5 : 4.5) * dpr, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    // The tutorial's "go here next" marker, pulsing
    if (this.tutTarget) {
      const p = this.mapPt(this.tutTarget.x, this.tutTarget.z);
      const r = (7 + Math.sin(performance.now() / 150) * 2.5) * dpr;
      g.strokeStyle = "#ff3b8a";
      g.lineWidth = 3 * dpr;
      g.beginPath();
      g.arc(p[0], p[1], r, 0, Math.PI * 2);
      g.stroke();
    }
    for (const gh of this.ghosts) {
      const p = this.mapPt(gh.x, gh.z);
      g.fillStyle = gh.record ? "rgba(255,210,63,0.8)" : "rgba(255,255,255,0.6)";
      g.beginPath();
      g.arc(p[0], p[1], 4 * dpr, 0, Math.PI * 2);
      g.fill();
    }
  }
}
