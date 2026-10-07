// The dashboard's 📈 Analytics section: visitors, retention, when and how people play.
// Everything is computed in the browser from the stats the server keeps (/dashboard/data):
// one record per UTC day (visits, races, the players active that day, and since 2026-10-07
// hours, sessions, sources, countries, devices and key moments) plus one record per player.
// Charts are plain SVG: thin marks, hairline grids, one hover tooltip (#tip), a table view.

const $ = (s, root = document) => root.querySelector(s);
const NS = "http://www.w3.org/2000/svg";
const nf = new Intl.NumberFormat("en");
const pct = (x) => (x == null || !isFinite(x) ? "–" : Math.round(x * 100) + "%");
const sum = (a) => a.reduce((x, y) => x + y, 0);
const DAY = 86400000;

// Colours (validated with the dataviz skill's validate_palette.js against the panel, #fcfaf9):
// categorical slots 1-3 pass all-pairs; aqua is under 3:1, so its line is direct-labelled and
// every chart has a table view. The blue ramp is the sequential/ordinal scale.
const C = { blue: "#2a78d6", orange: "#eb6834", aqua: "#1baf7a", grid: "#e8e3ef", axis: "#c9c1d9", muted: "#6b6480", ink: "#1d1530", soft: "#86b6ef" };
const RAMP = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"];
const FUNNEL = ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#104281"];

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const svg = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

// ------------------------------------------------------------ dates (UTC days, like the server)
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const tOf = (d) => Date.parse(d + "T00:00:00Z");
const today = () => iso(Date.now());
const addDays = (d, n) => iso(tOf(d) + n * DAY);
const weekOf = (d) => addDays(d, -((new Date(tOf(d)).getUTCDay() + 6) % 7)); // Monday
const monthOf = (d) => d.slice(0, 7);
const fmtDay = (d) => new Date(tOf(d) + DAY / 2).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtMonth = (m) => new Date(Date.parse(m + "-15T00:00:00Z")).toLocaleDateString("en", { month: "short", year: "numeric", timeZone: "UTC" });
function fmtDur(sec) {
  if (!sec) return "0m";
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${Math.round(sec)}s`;
}
const compact = (n) => (n >= 10000 ? new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n) : nf.format(Math.round(n)));

// ------------------------------------------------------------ state
let data = null;
let range = localStorage.getItem("an-range") || "30";
let metric = "visitors";
let grain = "day";
const tables = new Set(); // charts showing their table view

// ------------------------------------------------------------ the numbers
function model() {
  const days = data.days || {};
  const keys = Object.keys(days).sort();
  const first = keys[0] || today();
  const end = today();
  const firstSeen = new Map(data.players.map((p) => [p.pid, iso(p.first)]));
  const byPid = new Map(data.players.map((p) => [p.pid, p]));
  const span = range === "all" ? Math.round((tOf(end) - tOf(first)) / DAY) + 1 : Number(range);
  // Nothing was kept before the first day, so a range never starts earlier than that
  const start = range === "all" ? first : [addDays(end, -(span - 1)), first].sort()[1];
  const list = (from, to) => {
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
    return out;
  };
  const inRange = list(start, end);
  const prev = range === "all" ? [] : list(addDays(start, -inRange.length), addDays(start, -1));
  const rec = (d) => days[d] || { visits: 0, races: 0, pids: [] };
  const tracked = keys.find((k) => days[k].hours) || null; // first day with the detailed fields
  return { days, keys, first, end, start, inRange, prev, rec, firstSeen, byPid, tracked };
}

// Totals over a list of days: unique players, new players, visits, races, play time…
function totals(M, list) {
  const uniq = new Set();
  let visits = 0, races = 0, playTime = 0, sessions = 0, peak = 0, detailed = 0;
  for (const d of list) {
    const r = M.rec(d);
    r.pids.forEach((p) => uniq.add(p));
    visits += r.visits;
    races += r.races;
    if (r.hours) {
      detailed++;
      playTime += r.playTime || 0;
      sessions += r.sessions || 0;
      peak = Math.max(peak, r.peak || 0);
    }
  }
  const set = new Set(list);
  const fresh = [...uniq].filter((p) => set.has(M.firstSeen.get(p))).length;
  return { visitors: uniq.size, fresh, returning: uniq.size - fresh, visits, races, playTime, sessions, peak, detailed, days: list.length, uniq };
}

// One bucket per day, week or month in the range
function buckets(M) {
  const map = new Map();
  for (const d of M.inRange) {
    const k = grain === "day" ? d : grain === "week" ? weekOf(d) : monthOf(d);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(d);
  }
  const keys = [...map.keys()];
  return keys.map((k, i) => {
    const t = totals(M, map.get(k));
    const label = grain === "day" ? fmtDay(k) : grain === "week" ? "Wk of " + fmtDay(k) : fmtMonth(k);
    // The current week or month isn't over yet
    const partial = i === keys.length - 1 && grain !== "day" && (grain === "week" ? addDays(k, 6) > M.end : true) && M.end !== lastDayOfMonth(k, grain);
    // …and the first one may start mid-week or mid-month, where the range begins
    const from = i === 0 && grain !== "day" && map.get(k)[0] !== (grain === "week" ? k : k + "-01") ? map.get(k)[0] : null;
    return { k, label, partial: partial || !!from, from, ...t };
  });
}
const lastDayOfMonth = (k, g) => (g === "month" ? iso(Date.UTC(+k.slice(0, 4), +k.slice(5, 7), 0)) : null);

// ------------------------------------------------------------ tooltip (shared with the page)
const tip = () => $("#tip");
function bindTip(node, text) {
  node.dataset.tip = text;
  node.setAttribute("tabindex", "0");
  node.setAttribute("aria-label", text.replace(/\n/g, ", "));
}
// Keyboard focus shows the same tooltip as hover
document.addEventListener("focusin", (e) => {
  const t = e.target.closest?.("[data-tip]");
  if (!t || !t.closest("#analytics")) return;
  const r = t.getBoundingClientRect();
  const T = tip();
  T.textContent = t.dataset.tip;
  T.classList.add("on");
  const w = T.getBoundingClientRect();
  T.style.left = Math.min(innerWidth - w.width - 8, r.left + r.width / 2) + "px";
  T.style.top = Math.max(8, r.top - w.height - 10) + "px";
});
document.addEventListener("focusout", () => tip()?.classList.remove("on"));

// ------------------------------------------------------------ chart pieces
// Top of the axis: four equal, round gridline steps (1, 2, 5, 10, 20…)
function niceMax(v) {
  const raw = Math.max(1, v) / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * p).find((x) => x >= raw);
  return Math.max(1, step) * 4;
}

function legend(items, kind = "rect") {
  const L = el("div", "an-legend");
  for (const it of items) {
    const k = el("span", "an-key");
    const sw = el("i", kind === "line" ? "line" : "rect");
    sw.style.background = it.color;
    k.append(sw, el("span", "", it.name));
    L.append(k);
  }
  return L;
}

// Columns over time, stacked when there are several series. Each column is its own hover target.
function columns(root, { rows, series, fmt = compact, height = 210, tipFor }) {
  const W = Math.max(280, root.clientWidth || 600);
  const padL = 40, padR = 8, padT = 10, padB = 26;
  const plotW = W - padL - padR, plotH = height - padT - padB;
  const totalsArr = rows.map((r) => sum(series.map((s) => s.value(r))));
  const max = niceMax(Math.max(1, ...totalsArr));
  const s = svg("svg", { width: W, height, viewBox: `0 0 ${W} ${height}`, class: "an-svg", role: "img" });
  // grid + y ticks
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, y = padT + plotH - (v / max) * plotH;
    s.append(svg("line", { x1: padL, x2: W - padR, y1: y, y2: y, stroke: i ? C.grid : C.axis, "stroke-width": 1 }));
    const t = svg("text", { x: padL - 6, y: y + 4, "text-anchor": "end", class: "an-tick" });
    t.textContent = fmt(v);
    s.append(t);
  }
  const band = plotW / rows.length;
  const bw = Math.min(24, Math.max(3, band - 2));
  const labelEvery = Math.ceil(rows.length / Math.max(2, Math.floor(plotW / 64)));
  rows.forEach((r, i) => {
    const cx = padL + band * i + band / 2;
    let y = padT + plotH;
    const g = svg("g", { class: "an-col" + (r.partial ? " partial" : "") });
    series.forEach((se, si) => {
      const v = se.value(r);
      if (!v) return;
      const h = (v / max) * plotH;
      const top = si === series.length - 1 || series.slice(si + 1).every((x) => !x.value(r));
      // 2px surface gap between stacked segments; 4px rounded data-end, square at the baseline
      const segH = Math.max(1, h - (si ? 2 : 0));
      const yTop = y - h;
      if (top) {
        const rr = Math.min(4, segH / 2, bw / 2);
        g.append(svg("path", { d: `M${cx - bw / 2},${y - (si ? 2 : 0)} V${yTop + rr} Q${cx - bw / 2},${yTop} ${cx - bw / 2 + rr},${yTop} H${cx + bw / 2 - rr} Q${cx + bw / 2},${yTop} ${cx + bw / 2},${yTop + rr} V${y - (si ? 2 : 0)} Z`, fill: se.color }));
      } else g.append(svg("rect", { x: cx - bw / 2, y: yTop, width: bw, height: segH, fill: se.color }));
      y -= h;
    });
    const hit = svg("rect", { x: padL + band * i, y: padT, width: band, height: plotH, fill: "transparent", class: "an-hit" });
    bindTip(hit, tipFor(r));
    g.append(hit);
    s.append(g);
    if (i % labelEvery === 0 || i === rows.length - 1) {
      if (i !== rows.length - 1 && rows.length - 1 - i < labelEvery * 0.6) return;
      const t = svg("text", { x: cx, y: height - 8, "text-anchor": "middle", class: "an-tick" });
      t.textContent = rows[i].short || rows[i].label;
      s.append(t);
    }
  });
  root.append(s);
}

// Lines over time with a crosshair that snaps to the nearest day.
function lines(root, { labels, series, fmt = compact, height = 210 }) {
  const W = Math.max(280, root.clientWidth || 600);
  const padL = 40, padR = 64, padT = 12, padB = 26;
  const plotW = W - padL - padR, plotH = height - padT - padB;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const n = labels.length;
  const X = (i) => padL + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1));
  const Y = (v) => padT + plotH - (v / max) * plotH;
  const s = svg("svg", { width: W, height, viewBox: `0 0 ${W} ${height}`, class: "an-svg", role: "img" });
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, y = Y(v);
    s.append(svg("line", { x1: padL, x2: W - padR, y1: y, y2: y, stroke: i ? C.grid : C.axis, "stroke-width": 1 }));
    const t = svg("text", { x: padL - 6, y: y + 4, "text-anchor": "end", class: "an-tick" });
    t.textContent = fmt(v);
    s.append(t);
  }
  const every = Math.ceil(n / Math.max(2, Math.floor(plotW / 70)));
  labels.forEach((l, i) => {
    if (i % every && i !== n - 1) return;
    if (i !== n - 1 && n - 1 - i < every * 0.6) return;
    const t = svg("text", { x: X(i), y: height - 8, "text-anchor": i === n - 1 ? "end" : "middle", class: "an-tick" });
    t.textContent = l;
    s.append(t);
  });
  for (const se of series) {
    const d = se.values.map((v, i) => `${i ? "L" : "M"}${X(i)},${Y(v)}`).join(" ");
    s.append(svg("path", { d, fill: "none", stroke: se.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    // End marker with a surface ring, and a direct label
    const last = se.values[n - 1];
    s.append(svg("circle", { cx: X(n - 1), cy: Y(last), r: 4, fill: se.color, stroke: "#fcfaf9", "stroke-width": 2 }));
  }
  // End labels, nudged apart only if they'd overlap
  const ends = series.map((se) => ({ se, y: Y(se.values[n - 1]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
  for (const e of ends) {
    const t = svg("text", { x: X(n - 1) + 8, y: e.y + 4, class: "an-endlbl" });
    t.textContent = `${e.se.short} ${fmt(e.se.values[n - 1])}`;
    s.append(t);
  }
  // Crosshair
  const cross = svg("line", { y1: padT, y2: padT + plotH, stroke: C.axis, "stroke-width": 1, visibility: "hidden" });
  s.append(cross);
  const dots = series.map((se) => {
    const c = svg("circle", { r: 4, fill: se.color, stroke: "#fcfaf9", "stroke-width": 2, visibility: "hidden" });
    s.append(c);
    return c;
  });
  const hit = svg("rect", { x: padL, y: padT, width: plotW, height: plotH, fill: "transparent" });
  s.append(hit);
  // The page's pointermove handler shows and positions #tip from data-tip
  const show = (i) => {
    cross.setAttribute("x1", X(i));
    cross.setAttribute("x2", X(i));
    cross.setAttribute("visibility", "visible");
    series.forEach((se, k) => {
      dots[k].setAttribute("cx", X(i));
      dots[k].setAttribute("cy", Y(se.values[i]));
      dots[k].setAttribute("visibility", "visible");
    });
    hit.dataset.tip = [labels[i], ...series.map((se) => `${fmt(se.values[i])}  ${se.name}`)].join("\n");
  };
  hit.addEventListener("pointermove", (e) => {
    const r = s.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((x - padL) / plotW) * (n - 1))));
    show(i);
  });
  hit.addEventListener("pointerleave", () => {
    cross.setAttribute("visibility", "hidden");
    dots.forEach((d) => d.setAttribute("visibility", "hidden"));
  });
  root.append(s);
}

// Horizontal bars: one series, value at the tip, share of the total in the tooltip
function hbars(root, rows, unit) {
  rows = rows.filter((r) => r.value > 0);
  if (!rows.length) return root.append(el("p", "st-empty", "Nothing yet in this period."));
  const max = Math.max(...rows.map((r) => r.value));
  const total = sum(rows.map((r) => r.value));
  const box = el("div", "st-bars");
  for (const r of rows) {
    const row = el("div", "st-bar");
    bindTip(row, `${nf.format(r.value)} ${unit} (${pct(r.value / total)})\n${r.label}`);
    const lbl = el("div", "lbl");
    if (r.icon) lbl.append(r.icon);
    lbl.append(el("span", "", r.label));
    const track = el("div", "track");
    const fill = el("div", "fill an-fill");
    fill.style.width = (r.value / max) * 100 + "%";
    track.append(fill);
    row.append(lbl, track, el("span", "val", nf.format(r.value)));
    box.append(row);
  }
  root.append(box);
}

function table(root, head, rows) {
  const wrap = el("div", "an-table-wrap");
  const t = el("table", "an-table");
  const tr = el("tr");
  head.forEach((h, i) => tr.append(el("th", i ? "num" : "", h)));
  t.append(tr);
  for (const r of rows) {
    const row = el("tr");
    r.forEach((c, i) => row.append(el("td", i ? "num" : "", c)));
    t.append(row);
  }
  wrap.append(t);
  root.append(wrap);
}

// A card: title, optional controls, a Chart/Table toggle, and the body
function card(id, title, sub, opts = {}) {
  const c = $("#" + id);
  c.innerHTML = "";
  const head = el("div", "an-card-head");
  const h = el("h2", "", title);
  if (sub) h.append(" ", el("small", "", sub));
  head.append(h);
  if (opts.controls) head.append(opts.controls);
  if (opts.table) {
    const b = el("button", "btn small an-tview", tables.has(id) ? "📊 Chart" : "📋 Table");
    b.addEventListener("click", () => {
      tables.has(id) ? tables.delete(id) : tables.add(id);
      render();
    });
    head.append(b);
  }
  c.append(head);
  const body = el("div", "an-body");
  c.append(body);
  return { body, asTable: tables.has(id) };
}

function seg(options, current, onPick) {
  const s = el("div", "seg an-seg");
  for (const [v, label] of options) {
    const b = el("button", v === current ? "on" : "", label);
    b.addEventListener("click", () => onPick(v));
    s.append(b);
  }
  return s;
}

function spark(values, color = C.blue) {
  const w = 96, h = 26;
  const s = svg("svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}`, class: "an-spark", "aria-hidden": "true" });
  if (values.length < 2) return s;
  const max = Math.max(1, ...values);
  const X = (i) => 2 + ((w - 4) * i) / (values.length - 1);
  const Y = (v) => h - 3 - (v / max) * (h - 6);
  s.append(svg("path", { d: values.map((v, i) => `${i ? "L" : "M"}${X(i)},${Y(v)}`).join(" "), fill: "none", stroke: "#b9b2c8", "stroke-width": 1.5, "stroke-linejoin": "round" }));
  s.append(svg("circle", { cx: X(values.length - 1), cy: Y(values[values.length - 1]), r: 2.5, fill: color }));
  return s;
}

// ------------------------------------------------------------ sections
const RANGES = [["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["all", "All time"]];

function renderFilters(M) {
  const root = $("#an-filters");
  root.innerHTML = "";
  root.append(
    seg(RANGES, range, (v) => {
      range = v;
      localStorage.setItem("an-range", v);
      if (v === "7" && grain === "month") grain = "day";
      render();
    })
  );
  const clipped = range !== "all" && M.inRange.length < Number(range);
  const note = el("span", "an-note", `${fmtDay(M.start)} – ${fmtDay(M.end)}${clipped ? " (stats start " + fmtDay(M.first) + ")" : ""} · days in UTC`);
  root.append(note);
}

function renderTiles(M) {
  const cur = totals(M, M.inRange);
  const prev = M.prev.length ? totals(M, M.prev) : null;
  const prevComplete = prev && M.prev.every((d) => d >= M.first);
  const series = (fn) => M.inRange.map((d) => fn(M.rec(d), d));
  const freshOn = (d) => M.rec(d).pids.filter((p) => M.firstSeen.get(p) === d).length;
  const tiles = [
    { label: "Visitors", value: nf.format(cur.visitors), now: cur.visitors, was: prev?.visitors, spark: series((r) => r.pids.length), hint: "different players who opened the game" },
    { label: "New players", value: nf.format(cur.fresh), now: cur.fresh, was: prev?.fresh, spark: series((r, d) => freshOn(d)), hint: "first visit ever in this period" },
    { label: "Returning", value: pct(cur.visitors ? cur.returning / cur.visitors : null), now: cur.visitors ? cur.returning / cur.visitors : null, was: prev?.visitors ? prev.returning / prev.visitors : null, ratio: true, hint: "visitors who had played before" },
    { label: "Visits", value: nf.format(cur.visits), now: cur.visits, was: prev?.visits, spark: series((r) => r.visits), hint: "times the game was opened" },
    { label: "Races", value: nf.format(cur.races), now: cur.races, was: prev?.races, spark: series((r) => r.races), hint: "races finished" },
    { label: "Play time", value: cur.detailed ? fmtDur(cur.playTime) : "–", now: cur.playTime, was: prev?.detailed === M.prev.length ? prev.playTime : null, spark: series((r) => (r.playTime || 0) / 60), hint: M.tracked ? `time with the game open (since ${fmtDay(M.tracked)})` : "collecting from now on" },
    { label: "Avg session", value: cur.sessions ? fmtDur(cur.playTime / cur.sessions) : "–", now: cur.sessions ? cur.playTime / cur.sessions : null, was: prev?.sessions && prev?.detailed === M.prev.length ? prev.playTime / prev.sessions : null, hint: "how long one visit lasts" },
    { label: "Most online", value: cur.detailed ? nf.format(cur.peak) : "–", now: cur.peak, hint: "most players in the game at once", nodelta: true },
  ];
  const root = $("#an-tiles");
  root.innerHTML = "";
  for (const t of tiles) {
    const tile = el("div", "st-tile an-tile");
    tile.title = t.hint;
    tile.append(el("span", "an-tl", t.label), el("b", "", t.value));
    const foot = el("div", "an-tile-foot");
    if (!t.nodelta && prevComplete && t.was != null && t.now != null && range !== "all") {
      const diff = t.ratio ? t.now - t.was : t.was ? (t.now - t.was) / t.was : null;
      if (diff != null && isFinite(diff)) {
        const up = diff > 0.005, down = diff < -0.005;
        const d = el("span", "an-delta" + (up ? " up" : down ? " down" : ""), `${up ? "▲" : down ? "▼" : "•"} ${t.ratio ? Math.abs(Math.round(diff * 100)) + " pts" : Math.abs(Math.round(diff * 100)) + "%"}`);
        d.title = "vs the previous " + (range === "7" ? "7" : range) + " days";
        foot.append(d);
      } else if (!t.was && t.now) foot.append(el("span", "an-delta up", "▲ new"));
    } else foot.append(el("span", "an-delta", " "));
    if (t.spark && M.inRange.length <= 120) foot.append(spark(t.spark));
    tile.append(foot);
    root.append(tile);
  }
}

function renderMain(M) {
  const metrics = [["visitors", "Visitors"], ["visits", "Visits"], ["races", "Races"], ["playTime", "Play time"]];
  const grains = [["day", "Day"], ["week", "Week"], ["month", "Month"]];
  const controls = el("div", "an-controls");
  controls.append(seg(metrics, metric, (v) => ((metric = v), render())), seg(grains, grain, (v) => ((grain = v), render())));
  const { body, asTable } = card("an-main", "Visitors over time", "", { controls, table: true });
  const rows = buckets(M).map((b) => ({ ...b, short: grain === "month" ? fmtMonth(b.k).split(" ")[0] : grain === "week" ? fmtDay(b.k) : b.label }));
  const so = (b) => (b.from ? ` (from ${fmtDay(b.from)})` : b.partial ? " (so far)" : "");
  if (metric === "visitors") {
    const series = [
      { name: "Returning", color: C.blue, value: (r) => r.returning },
      { name: "New", color: C.orange, value: (r) => r.fresh },
    ];
    if (asTable) return table(body, [grain === "day" ? "Day" : grain === "week" ? "Week" : "Month", "Visitors", "New", "Returning", "Visits", "Races"], rows.map((r) => [r.label + so(r), nf.format(r.visitors), nf.format(r.fresh), nf.format(r.returning), nf.format(r.visits), nf.format(r.races)]));
    body.append(legend(series.slice().reverse()));
    columns(body, { rows, series, tipFor: (r) => `${nf.format(r.visitors)} visitors${so(r)}\n${nf.format(r.fresh)} new · ${nf.format(r.returning)} returning\n${r.label}` });
  } else {
    const fmt = metric === "playTime" ? (v) => fmtDur(v) : compact;
    const unit = { visits: "visits", races: "races", playTime: "of play" }[metric];
    const value = (r) => r[metric];
    if (asTable) return table(body, [grain === "day" ? "Day" : grain === "week" ? "Week" : "Month", { visits: "Visits", races: "Races", playTime: "Play time" }[metric]], rows.map((r) => [r.label + so(r), fmt(value(r))]));
    if (metric === "playTime" && !M.tracked) return body.append(el("p", "st-empty", "Play time is collected from 2026-10-07 on."));
    columns(body, { rows, series: [{ name: unit, color: C.blue, value }], fmt, tipFor: (r) => `${fmt(value(r))} ${unit}${so(r)}\n${r.label}` });
    if (metric === "playTime") body.append(el("p", "an-foot", `Time with the game open, collected since ${fmtDay(M.tracked)}.`));
  }
}

// Daily, weekly and monthly active players (each over the 1, 7 and 30 days up to that day)
function renderActive(M) {
  const { body, asTable } = card("an-active", "Active players", "daily, weekly and monthly", { table: true });
  const pidsOn = (d) => M.rec(d).pids;
  const activeIn = (d, n) => {
    const s = new Set();
    for (let i = 0; i < n; i++) {
      const k = addDays(d, -i);
      if (k < M.first) break;
      pidsOn(k).forEach((p) => s.add(p));
    }
    return s.size;
  };
  const daysList = M.inRange;
  const dau = daysList.map((d) => pidsOn(d).length);
  const wau = daysList.map((d) => activeIn(d, 7));
  const mau = daysList.map((d) => activeIn(d, 30));
  const series = [
    { name: "Monthly active (30 days)", short: "MAU", color: C.aqua, values: mau },
    { name: "Weekly active (7 days)", short: "WAU", color: C.orange, values: wau },
    { name: "Daily active", short: "DAU", color: C.blue, values: dau },
  ];
  if (asTable) return table(body, ["Day", "Daily", "Weekly", "Monthly"], daysList.map((d, i) => [fmtDay(d), nf.format(dau[i]), nf.format(wau[i]), nf.format(mau[i])]).reverse());
  body.append(legend(series, "line"));
  lines(body, { labels: daysList.map(fmtDay), series });
  const n = daysList.length;
  const avgDau = sum(dau.slice(-7)) / Math.min(7, n);
  const stick = mau[n - 1] ? avgDau / mau[n - 1] : null;
  body.append(el("p", "an-foot", `Stickiness ${pct(stick)}: on an average day this week, ${pct(stick)} of the month's players played. Above 20% is good for a casual game.`));
}

// Weekly cohorts: of the players who first came in a week, how many played in later weeks
function renderRetention(M) {
  const { body, asTable } = card("an-retention", "Retention", "do new players come back?", { table: true });
  const activeDays = new Map(); // pid -> Set of days
  for (const k of M.keys) for (const p of M.rec(k).pids) {
    if (!activeDays.has(p)) activeDays.set(p, new Set());
    activeDays.get(p).add(k);
  }
  // D1 / D7 over everyone old enough to tell
  let d1n = 0, d1y = 0, d7n = 0, d7y = 0;
  for (const p of data.players) {
    const f = M.firstSeen.get(p.pid);
    if (!f || f < M.first) continue;
    const act = activeDays.get(p.pid) || new Set();
    if (addDays(f, 1) <= M.end) {
      d1n++;
      if (act.has(addDays(f, 1))) d1y++;
    }
    if (addDays(f, 7) <= M.end) {
      d7n++;
      for (let i = 1; i <= 7; i++) if (act.has(addDays(f, i))) {
        d7y++;
        break;
      }
    }
  }
  const kpis = el("div", "an-kpis");
  for (const [v, l, n] of [[d1n ? d1y / d1n : null, "came back the next day", d1n], [d7n ? d7y / d7n : null, "came back within a week", d7n]]) {
    const k = el("div", "an-kpi");
    k.append(el("b", "", pct(v)), el("span", "", `${l} (of ${nf.format(n)} new players)`));
    kpis.append(k);
  }
  body.append(kpis);
  // Cohorts by first week
  const cohorts = new Map();
  for (const p of data.players) {
    const f = M.firstSeen.get(p.pid);
    if (!f || f < M.first) continue;
    const w = weekOf(f);
    if (!cohorts.has(w)) cohorts.set(w, []);
    cohorts.get(w).push(p.pid);
  }
  const weeks = [...cohorts.keys()].sort().slice(-8);
  const thisWeek = weekOf(M.end);
  const maxK = weeks.length ? Math.round((tOf(thisWeek) - tOf(weeks[0])) / (7 * DAY)) : 0;
  const cols = Math.min(6, maxK);
  const rows = weeks.map((w) => {
    const pids = cohorts.get(w);
    const cells = [];
    for (let k = 1; k <= cols; k++) {
      const ws = addDays(w, 7 * k);
      if (ws > M.end) {
        cells.push(null);
        continue;
      }
      let n = 0;
      for (const p of pids) {
        const act = activeDays.get(p) || new Set();
        for (let i = 0; i < 7; i++) if (act.has(addDays(ws, i))) {
          n++;
          break;
        }
      }
      cells.push({ n, of: pids.length, partial: addDays(ws, 6) > M.end });
    }
    return { w, size: pids.length, cells };
  });
  if (!rows.length) return body.append(el("p", "st-empty", "No new players yet."));
  if (asTable) return table(body, ["First week", "Players", ...Array.from({ length: cols }, (_, i) => `Week ${i + 1}`)], rows.map((r) => [fmtDay(r.w), nf.format(r.size), ...r.cells.map((c) => (c ? `${pct(c.n / c.of)} (${c.n})` : ""))]));
  const g = el("div", "an-cohorts");
  g.style.gridTemplateColumns = `auto auto repeat(${cols}, minmax(44px, 1fr))`;
  g.append(el("span", "an-ch", "First week"), el("span", "an-ch num", "Players"));
  for (let k = 1; k <= cols; k++) g.append(el("span", "an-ch mid", `Wk ${k}`));
  for (const r of rows) {
    g.append(el("span", "an-cw", fmtDay(r.w)), el("span", "an-cw num", nf.format(r.size)));
    r.cells.forEach((c, k) => {
      if (!c) return g.append(el("span", "an-cell empty"));
      const v = c.n / c.of;
      const cell = el("span", "an-cell", pct(v));
      const step = Math.min(RAMP.length - 1, Math.round(v * (RAMP.length - 1)));
      cell.style.background = RAMP[step];
      cell.style.color = step >= 6 ? "#fff" : C.ink;
      if (c.partial) cell.classList.add("partial");
      bindTip(cell, `${pct(v)} came back in week ${k + 1}${c.partial ? " (so far)" : ""}\n${c.n} of ${c.of} who started the week of ${fmtDay(r.w)}`);
      g.append(cell);
    });
  }
  body.append(g);
  body.append(el("p", "an-foot", "Each row is the players whose first visit was that week; each column, whether they played again 1, 2, 3… weeks later."));
}

// Visits by weekday and hour, in this browser's time zone
function renderHeatmap(M) {
  const { body, asTable } = card("an-hours", "When people play", "visits by day and hour, your time", { table: true });
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  let any = 0;
  for (const d of M.inRange) {
    const r = M.rec(d);
    if (!r.hours) continue;
    r.hours.forEach((n, h) => {
      if (!n) return;
      const t = new Date(tOf(d) + h * 3600000);
      grid[(t.getDay() + 6) % 7][t.getHours()] += n;
      any += n;
    });
  }
  if (!any) return body.append(el("p", "st-empty", M.tracked ? "No visits in this period yet." : "Collected from 2026-10-07 on: check back in a day or two."));
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  if (asTable) return table(body, ["Day", ...Array.from({ length: 24 }, (_, h) => String(h))], grid.map((row, i) => [DAYS[i], ...row.map(String)]));
  const max = Math.max(...grid.flat());
  const hm = el("div", "an-heat");
  hm.append(el("span"));
  for (let h = 0; h < 24; h++) hm.append(el("span", "an-hh", h % 3 ? "" : hourLabel(h)));
  grid.forEach((row, i) => {
    hm.append(el("span", "an-hd", DAYS[i]));
    row.forEach((n, h) => {
      const c = el("span", "an-hc");
      if (n) {
        const step = 1 + Math.round((n / max) * (RAMP.length - 2));
        c.style.background = RAMP[step];
      }
      bindTip(c, `${nf.format(n)} visits\n${DAYS[i]} ${hourLabel(h)}–${hourLabel((h + 1) % 24)}`);
      hm.append(c);
    });
  });
  body.append(hm);
  const sc = el("div", "an-scale");
  sc.append(el("span", "", "fewer"));
  const bar = el("i");
  bar.style.background = `linear-gradient(90deg, ${RAMP[1]}, ${RAMP[RAMP.length - 1]})`;
  sc.append(bar, el("span", "", "more visits"));
  body.append(sc);
  const best = grid.flatMap((row, i) => row.map((n, h) => ({ n, i, h }))).sort((a, b) => b.n - a.n)[0];
  body.append(el("p", "an-foot", `Busiest: ${DAYS[best.i]} around ${hourLabel(best.h)}. A good time to post a challenge in the group chat.`));
}
const hourLabel = (h) => (h === 0 ? "12am" : h < 12 ? h + "am" : h === 12 ? "12pm" : h - 12 + "pm");

// New players in the period: how far they got
function renderFunnel(M) {
  const { body, asTable } = card("an-funnel", "First-time players", "how far new players get", { table: true });
  const set = new Set(M.inRange);
  const fresh = data.players.filter((p) => set.has(M.firstSeen.get(p.pid)));
  const activeDays = (pid) => M.keys.filter((k) => M.rec(k).pids.includes(pid)).length;
  const raced = (p) => Object.values(p.races || {}).reduce((a, b) => a + (b || 0), 0);
  const steps = [
    ["Opened the game", fresh.length],
    ["Finished a race", fresh.filter((p) => raced(p) >= 1).length],
    ["Finished 5+ races", fresh.filter((p) => raced(p) >= 5).length],
    ["Came back another day", fresh.filter((p) => activeDays(p.pid) >= 2).length],
    ["Played on 3+ days", fresh.filter((p) => activeDays(p.pid) >= 3).length],
  ];
  if (!fresh.length) return body.append(el("p", "st-empty", "No new players in this period."));
  if (asTable) return table(body, ["Step", "Players", "Of all new"], steps.map(([l, n]) => [l, nf.format(n), pct(n / fresh.length)]));
  const box = el("div", "an-funnel");
  steps.forEach(([l, n], i) => {
    const row = el("div", "an-fstep");
    bindTip(row, `${nf.format(n)} players (${pct(n / fresh.length)})\n${l}`);
    const lbl = el("span", "an-flbl", l);
    const track = el("div", "an-ftrack");
    const fill = el("div", "an-ffill");
    fill.style.width = (n / fresh.length) * 100 + "%";
    fill.style.background = FUNNEL[i];
    track.append(fill);
    const v = el("span", "an-fval");
    v.append(el("b", "", nf.format(n)), " ", el("small", "", pct(n / fresh.length)));
    row.append(lbl, track, v);
    box.append(row);
  });
  body.append(box);
  const drop = steps[0][1] - steps[1][1];
  if (drop > 0) body.append(el("p", "an-foot", `${nf.format(drop)} of ${nf.format(steps[0][1])} new players never finished a race. The first minute matters most.`));
}

// Where visits come from
const SOURCE_NAMES = { direct: "Direct or unknown", invite: "Room invites", share: "Shared results", ghost: "Ghost challenge links", "jgrivera.com": "Old address (jgrivera.com)", "kartchaos.com": "Kart Chaos itself" };
function sourceName(s) {
  if (SOURCE_NAMES[s]) return SOURCE_NAMES[s];
  if (/(^|\.)google\./.test(s)) return "Google";
  if (/facebook\.com$|^fb\.|fb\.com$/.test(s)) return "Facebook";
  if (/instagram\.com$/.test(s)) return "Instagram";
  if (/whatsapp/.test(s)) return "WhatsApp";
  if (s === "t.co" || /(^|\.)x\.com$|twitter\.com$/.test(s)) return "X / Twitter";
  if (/reddit\.com$/.test(s)) return "Reddit";
  if (/youtube\.com$|youtu\.be$/.test(s)) return "YouTube";
  if (/bing\.com$/.test(s)) return "Bing";
  if (/github\.com$/.test(s)) return "GitHub";
  if (/tiktok\.com$/.test(s)) return "TikTok";
  return s;
}
function renderSources(M) {
  const { body, asTable } = card("an-sources", "Where visits come from", M.tracked ? `since ${fmtDay(M.tracked)}` : "", { table: true });
  const counts = new Map();
  for (const d of M.inRange) for (const [s, n] of Object.entries(M.rec(d).sources || {})) {
    const k = sourceName(s);
    counts.set(k, (counts.get(k) || 0) + n);
  }
  const rows = [...counts].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  if (!rows.length) return body.append(el("p", "st-empty", "Collected from 2026-10-07 on."));
  if (asTable) return table(body, ["Source", "Visits"], rows.map((r) => [r.label, nf.format(r.value)]));
  hbars(body, rows, "visits");
  body.append(el("p", "an-foot", "Links shared from the game (invites, results, ghost challenges) are tagged, so they're counted even when WhatsApp hides where a visit came from."));
}

// Visitors in the period by country and by device (from each player's latest visit)
function activePlayers(M) {
  const pids = new Set();
  for (const d of M.inRange) M.rec(d).pids.forEach((p) => pids.add(p));
  return [...pids].map((p) => M.byPid.get(p)).filter(Boolean);
}
function renderCountries(M, regionName, flag) {
  const { body, asTable } = card("an-countries", "Countries", "visitors", { table: true });
  const counts = new Map();
  for (const p of activePlayers(M)) counts.set(p.country || "", (counts.get(p.country || "") || 0) + 1);
  const rows = [...counts].sort((a, b) => b[1] - a[1]).map(([cc, value]) => ({ label: cc ? regionName(cc) : "Unknown", value, icon: flag(cc) }));
  if (asTable) return table(body, ["Country", "Visitors"], rows.map((r) => [r.label, nf.format(r.value)]));
  hbars(body, rows.slice(0, 10), "visitors");
  if (rows.length > 10) body.append(el("p", "an-foot", `…and ${rows.length - 10} more (see the table).`));
}
function renderDevices(M) {
  const { body, asTable } = card("an-devices", "Devices", "visitors", { table: true });
  const ps = activePlayers(M);
  const by = (fn) => {
    const m = new Map();
    for (const p of ps) {
      const k = fn(p) || "Unknown";
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  };
  const cap = (s) => s && s[0].toUpperCase() + s.slice(1);
  const kinds = by((p) => cap(p.device));
  const browsers = by((p) => p.browser);
  if (asTable) return table(body, ["Device or browser", "Visitors"], [...kinds, ...browsers].map((r) => [r.label, nf.format(r.value)]));
  hbars(body, kinds, "visitors");
  body.append(el("h3", "an-sub", "Browsers"));
  hbars(body, browsers.slice(0, 6), "visitors");
}

// Key moments: tutorial, notifications, sharing…
const EVENT_NAMES = {
  "tutorial-start": "Started the tutorial",
  "tutorial-done": "Finished the tutorial",
  "custom-saved": "Saved a Custom racer",
  "notify-on": "Turned on notifications",
  share: "Opened a share card",
  invite: "Sent a room invite",
  "ghost-challenge": "Made a ghost challenge",
  watch: "Watched a race",
  challenge: "Challenged a player",
  feedback: "Sent feedback",
};
function renderEvents(M) {
  const { body, asTable } = card("an-events", "Key moments", M.tracked ? `since ${fmtDay(M.tracked)}` : "", { table: true });
  const counts = Object.fromEntries(Object.keys(EVENT_NAMES).map((k) => [k, 0]));
  for (const d of M.inRange) for (const [k, n] of Object.entries(M.rec(d).events || {})) if (k in counts) counts[k] += n;
  const rows = Object.entries(counts).map(([k, value]) => ({ label: EVENT_NAMES[k], value }));
  if (asTable) return table(body, ["Moment", "Times"], rows.map((r) => [r.label, nf.format(r.value)]));
  const shown = rows.filter((r) => r.value).sort((a, b) => b.value - a.value);
  if (!shown.length) return body.append(el("p", "st-empty", M.tracked ? "Nothing in this period yet." : "Collected from 2026-10-07 on."));
  hbars(body, shown, "times");
  const ts = counts["tutorial-start"], td = counts["tutorial-done"];
  if (ts) body.append(el("p", "an-foot", `${pct(td / ts)} of tutorials started were finished.`));
}

// Who played the most in the period
function renderTop(M, regionName, flag, avatar) {
  const { body } = card("an-top", "Most active players", "in this period");
  const days = new Map(), races = new Map();
  for (const d of M.inRange) {
    const r = M.rec(d);
    for (const p of r.pids) days.set(p, (days.get(p) || 0) + 1);
    for (const [p, n] of Object.entries(r.playerRaces || {})) races.set(p, (races.get(p) || 0) + n);
  }
  const rows = [...days].map(([pid, n]) => ({ p: M.byPid.get(pid), days: n, races: races.get(pid) || 0 })).filter((r) => r.p);
  rows.sort((a, b) => b.days - a.days || b.races - a.races || b.p.last - a.p.last);
  if (!rows.length) return body.append(el("p", "st-empty", "Nobody yet in this period."));
  const t = el("table", "an-table an-top");
  const head = el("tr");
  for (const [h, num] of [["Player", 0], ["Days", 1], ["Races", 1]]) head.append(el("th", num ? "num" : "", h));
  t.append(head);
  const set = new Set(M.inRange);
  for (const r of rows.slice(0, 10)) {
    const tr = el("tr");
    const who = el("td");
    const w = el("span", "st-who");
    w.append(avatar(r.p.char, 28), flag(r.p.country), el("span", "", r.p.name));
    if (M.start > M.first && set.has(M.firstSeen.get(r.p.pid))) w.append(el("span", "chip", "new"));
    who.append(w);
    tr.append(who, el("td", "num", nf.format(r.days)), el("td", "num", r.races ? nf.format(r.races) : "–"));
    t.append(tr);
  }
  const wrap = el("div", "an-table-wrap");
  wrap.append(t);
  body.append(wrap);
  if (M.tracked && M.inRange[0] < M.tracked) body.append(el("p", "an-foot", `Races per player are counted from ${fmtDay(M.tracked)}.`));
}

// ------------------------------------------------------------ render
let helpers = null;
function render() {
  if (!data || !helpers) return;
  const M = model();
  renderFilters(M);
  renderTiles(M);
  renderMain(M);
  renderActive(M);
  renderRetention(M);
  renderHeatmap(M);
  renderFunnel(M);
  renderSources(M);
  renderCountries(M, helpers.regionName, helpers.flag);
  renderDevices(M);
  renderEvents(M);
  renderTop(M, helpers.regionName, helpers.flag, helpers.avatar);
}

// The page hands over its data and a few of its helpers (flags, portraits, country names)
export function showAnalytics(d, h) {
  data = d;
  helpers = h;
  render();
}

let resizeTimer = null;
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 200);
});
