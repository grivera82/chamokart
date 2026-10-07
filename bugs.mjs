// Crash reports from players' browsers (js/crash.js), grouped into bugs for the dashboard.
// The same error from the same place in the code is one bug, however many times it happens.
// The fixer service (/opt/chamokart-fixer) asks Claude to fix a bug and tells us how it went.
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";

const BUGS_KEPT = 300;
const SAMPLES_KEPT = 5; // the latest reports of each bug, with what the player was doing
const PIDS_KEPT = 200; // per bug, to count players
const PER_PLAYER_PER_HOUR = 30;
const ALL_PER_HOUR = 1000;
const NEW_BUG_PINGS_PER_HOUR = 6;
const FIX_STATES = ["queued", "running", "ready", "no-fix", "failed", "cancelled", "rejected", "deployed", "conflict", "rolled-back"];

const text = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, max);
const line = (v, max) => text(v, max).replace(/\s+/g, " ").trim();

// A URL in the game's own code (kartchaos.com, or the old jgrivera.com/chamokart/), as a match
// whose [1] is the file's path: not three.js from its CDN, not browser extensions.
const gamePath = (u) => u.match(/^https?:\/\/(?:(?:www\.)?kartchaos\.com|[^/]+\/chamokart)\/([^?#]*)/);

// "at update (https://kartchaos.com/js/sim/kart.js?v=12:340:17)" or "update@https://…/kart.js?v=12:340:17"
// -> { fn: "update", file: "js/sim/kart.js", line: 340 } for the first frame in the game's own code.
function topFrame(stack, file, lineNo) {
  for (const l of String(stack).split("\n")) {
    const m = l.match(/(?:at\s+(?:async\s+)?([^\s(]*)\s*\(?|^\s*([^@]*)@)(https?:\/\/[^\s)]+?):(\d+):\d+\)?\s*$/);
    if (!m) continue;
    const path = gamePath(m[3]);
    if (path) return { fn: m[1] || m[2] || "", file: path[1] || "index.html", line: Number(m[4]) };
  }
  const path = gamePath(String(file));
  return path ? { fn: "", file: path[1] || "index.html", line: lineNo || 0 } : { fn: "", file: "", line: 0 };
}

export function createBugs({ file, notify }) {
  const data = load();
  let saveTimer = null;
  let nextId = data.bugs.reduce((m, b) => Math.max(m, b.id), 0) + 1;
  const recent = new Map(); // pid -> report times this hour
  let allRecent = [];
  let pings = [];

  function load() {
    try {
      const d = JSON.parse(readFileSync(file, "utf8"));
      return { bugs: Array.isArray(d.bugs) ? d.bugs : [] };
    } catch (err) {
      if (err.code !== "ENOENT") console.error("bugs: can't read", file, err.message);
      return { bugs: [] };
    }
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        writeFileSync(file + ".tmp", JSON.stringify(data));
        renameSync(file + ".tmp", file);
      } catch (err) {
        console.error("bugs: can't write", file, err.message);
      }
    }, 1000);
  }

  function allowed(pid, now) {
    const hour = now - 3600000;
    allRecent = allRecent.filter((t) => t > hour);
    const mine = (recent.get(pid) || []).filter((t) => t > hour);
    if (mine.length >= PER_PLAYER_PER_HOUR || allRecent.length >= ALL_PER_HOUR) return false;
    mine.push(now);
    recent.set(pid, mine);
    allRecent.push(now);
    if (recent.size > 5000) recent.clear();
    return true;
  }

  // A report from js/crash.js. `player` is { name } from the stats, `geo` the connection's location.
  function report(pid, msg, player, geo) {
    const now = Date.now();
    if (!allowed(pid, now)) return false;
    const message = line(msg.message, 300) || "(no message)";
    const name = line(msg.name, 40);
    const stack = text(msg.stack, 4000);
    const at = topFrame(stack, msg.file, Number(msg.line) || 0);
    // Numbers in messages vary ("index 7 out of range"), and line numbers move with every change.
    const sig = createHash("sha1").update([name, message.replace(/\d+/g, "#"), at.file, at.fn].join("|")).digest("hex").slice(0, 16);
    const c = msg.ctx && typeof msg.ctx === "object" ? msg.ctx : {};
    const ctx = {};
    for (const k of ["screen", "mode", "track", "char", "kart", "device", "browser", "quality", "controls", "viewport", "path", "visible"]) if (c[k] != null && c[k] !== "") ctx[k] = line(c[k], 60);
    for (const k of ["online", "watching"]) if (c[k]) ctx[k] = true;
    if (c.cc) ctx.cc = line(c.cc, 5);
    const sample = {
      at: now,
      pid,
      name: player?.name || "",
      version: line(msg.version, 10),
      kind: line(msg.kind, 12),
      uptime: Math.max(0, Math.round(Number(msg.uptime) || 0)),
      stack,
      ctx,
      ua: line(c.ua, 300),
      country: geo?.country || "",
      crumbs: (Array.isArray(msg.crumbs) ? msg.crumbs : []).slice(-20).map((x) => [Number(x?.[0]) || 0, line(x?.[1], 60)]),
    };
    let bug = data.bugs.find((b) => b.sig === sig);
    const fresh = !bug;
    if (!bug) {
      bug = { id: nextId++, sig, name, message, where: at, first: now, last: now, count: 0, pids: [], versions: {}, browsers: {}, samples: [], ignored: false, fix: null, fixedAt: null, sinceFix: 0 };
      data.bugs.push(bug);
      trim();
    }
    bug.message = message;
    bug.where = at;
    bug.last = now;
    bug.count++;
    if (!bug.pids.includes(pid)) {
      bug.pids.push(pid);
      if (bug.pids.length > PIDS_KEPT) bug.pids.shift();
    }
    if (sample.version) bug.versions[sample.version] = (bug.versions[sample.version] || 0) + 1;
    if (ctx.browser) bug.browsers[ctx.browser] = (bug.browsers[ctx.browser] || 0) + 1;
    if (bug.fixedAt) bug.sinceFix++;
    bug.samples.push(sample);
    if (bug.samples.length > SAMPLES_KEPT) bug.samples.shift();
    save();
    if (fresh && !bug.ignored) {
      pings = pings.filter((t) => t > now - 3600000);
      if (pings.length < NEW_BUG_PINGS_PER_HOUR) {
        pings.push(now);
        notify({ title: "🐞 New crash", body: `${message.slice(0, 120)}${at.file ? ` (${at.file})` : ""}`, url: "/chamokart/dashboard/#bugs", tag: "bug-" + bug.id });
      }
    }
    return true;
  }

  // Too many bugs: forget ignored ones first, then the ones not seen for the longest.
  function trim() {
    while (data.bugs.length > BUGS_KEPT) {
      const pool = data.bugs.some((b) => b.ignored) ? data.bugs.filter((b) => b.ignored) : data.bugs;
      const oldest = pool.reduce((a, b) => (b.last < a.last ? b : a));
      data.bugs.splice(data.bugs.indexOf(oldest), 1);
    }
  }

  function view() {
    return [...data.bugs].sort((a, b) => b.last - a.last).map(({ pids, ...b }) => ({ ...b, players: pids.length }));
  }

  const get = (id) => data.bugs.find((b) => b.id === id);

  // The dashboard's buttons, and the fixer's status updates
  function action(a) {
    const bug = get(a.id);
    if (!bug) return { ok: false };
    switch (a.action) {
      case "bug-ignore":
        bug.ignored = !!a.ignored;
        break;
      case "bug-delete":
        data.bugs.splice(data.bugs.indexOf(bug), 1);
        break;
      case "bug-fix": {
        // From the fixer: how Claude's fix for this bug is going
        if (!FIX_STATES.includes(a.status)) return { ok: false };
        const was = bug.fix?.status;
        bug.fix = { job: line(a.job, 40), status: a.status, at: Date.now() };
        if (a.status === "deployed") (bug.fixedAt = Date.now()), (bug.sinceFix = 0);
        if (a.status === "rolled-back") bug.fixedAt = null;
        if (was !== a.status && ["ready", "no-fix", "failed"].includes(a.status)) {
          const what = { ready: "🔧 Fix ready to review", "no-fix": "🔎 Claude looked into a bug", failed: "⚠️ Claude's fix run failed" }[a.status];
          notify({ title: what, body: bug.message.slice(0, 140), url: "/chamokart/dashboard/#bug-" + bug.id, tag: "fix-" + bug.id });
        }
        break;
      }
      default:
        return { ok: false };
    }
    save();
    return { ok: true };
  }

  return { report, view, get, action };
}
