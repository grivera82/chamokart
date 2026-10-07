// Kart Chaos multiplayer server.
// Rooms + lobbies + race orchestration. Karts are simulated by their owning
// client; this server relays state/events, keeps the race clock and decides
// the official results.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, unlinkSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { createHash, randomInt, randomBytes } from "node:crypto";
import { createStats, geoFromRequest } from "./stats.mjs";
import { createPush } from "./push.mjs";
import { createBugs } from "./bugs.mjs";
import { createFeatures } from "./features.mjs";
import { dailyChallenge, dailyId, isDailyId, DAILY_LAPS } from "./js/daily.js";
import { CUSTOM, cleanLook } from "./js/look.js";
import { TRACKS, CHARACTERS, KARTS } from "./js/data.js";
import { Track } from "./js/sim/track.js";

const HOST = process.env.HOST || "127.0.0.1";
// Where the game lives (links in notifications). It moved from jgrivera.com/chamokart/ on 2026-10-06.
const SITE = (process.env.SITE_URL || "https://kartchaos.com/").replace(/\/?$/, "/");
const siteUrl = (path) => SITE + String(path || "").replace(/^\/(chamokart\/)?/, "");
const PORT = Number(process.env.PORT || 8792);

const TRACK_COUNT = 8;
const MAX_KARTS = 8;
const CHARACTER_COUNT = 8;
const KART_COUNT = 3;
const POINTS = [15, 12, 10, 8, 6, 4, 2, 1];
const START_DELAY_MS = 6500; // time from "race" message to GO (loading + intro + countdown)
const FINISH_GRACE_MS = 30000; // after the first finisher, everybody else has this long
const ALL_HUMANS_DONE_MS = 3500; // after the last human finishes
const EVENT_TYPES = new Set(["spawn", "hit", "box", "bolt", "splat", "gone", "horn", "boom", "steal"]);
// Time Trial boards, one entry per player per track: fastest lap ("laps") and fastest
// full 3-lap race ("runs"). systemd's
// StateDirectory= sets STATE_DIRECTORY; locally the file lands in the working dir.
const STATE_DIR = process.env.STATE_DIRECTORY || ".";
const RECORDS_FILE = process.env.RECORDS_FILE || join(STATE_DIR, "records.json");
const RECORDS_TOP = 10;
// Notes for players who were passed on a board, handed over the next time they open the game
const BEATEN_FILE = process.env.BEATEN_FILE || join(STATE_DIR, "beaten.json");
const BEATEN_KEEP_MS = 60 * 86400000;
// Ghost challenges: a Time Trial run shared as a link (#ghost=CODE) for friends to race against
const CHALLENGE_DIR = join(STATE_DIR, "challenges");
const CHALLENGE_LEN = 7;
const CHALLENGE_KEEP_MS = 120 * 86400000; // since the last time anyone raced it
const CHALLENGE_TRIES_KEPT = 50;
const CHALLENGES_PER_DAY = 30; // made per player
// Ghosts (the whole Time Trial run a board lap came from), one file per board entry.
const GHOST_DIR = join(STATE_DIR, "ghosts");
const GHOST_HZ = 20;
const MAX_GHOST_S = 300; // no record run is anywhere near 5 minutes
// Laps faster than this are impossible (~15% under a lap spent entirely at max coins
// and chile speed on the centerline at 150cc), so they're rejected as tampered.
const MIN_LAP_S = [18.5, 18.5, 17, 18, 17, 16.5, 17, 17.5];
const MAX_LAP_S = 600;
const TT_LAPS = 3; // every Time Trial is 3 laps at 150cc, so whole runs compare
// Daily challenge boards: every racer's best time for each of the last few days.
const DAILY_FILE = process.env.DAILY_FILE || join(STATE_DIR, "daily.json");
const DAILY_DAYS_KEPT = 8;
const DAILY_MAX_ENTRIES = 2000;
const DAILY_GRACE_MS = 15 * 60000; // a run that started before midnight still counts for its day
const CC_SPEED = { 50: 27, 100: 32, 150: 37, 200: 43 }; // top speeds, as in js/data.js
// Player codes: a key that makes another phone or computer the same player (see "player codes").
const ACCOUNTS_FILE = process.env.ACCOUNTS_FILE || join(STATE_DIR, "accounts.json");
const CODE_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O, 1/I/L: easy to read out and type
const CODE_LEN = 12;
const LINK_TRIES = 10; // wrong codes allowed per IP ...
const LINK_WINDOW_MS = 10 * 60000; // ... in this long
// Feedback players send from the game, read on the stats page
const FEEDBACK_FILE = process.env.FEEDBACK_FILE || join(STATE_DIR, "feedback.json");
const FEEDBACK_MAX = 1000; // characters per note
const FEEDBACK_KEPT = 500;
const FEEDBACK_PER_DAY = 20; // per player
// Crash reports from the game (js/crash.js), grouped into bugs on the dashboard
const BUGS_FILE = process.env.BUGS_FILE || join(STATE_DIR, "bugs.json");
// Feature ideas and votes from the public /chamokart/features page
const FEATURES_FILE = process.env.FEATURES_FILE || join(STATE_DIR, "features.json");
const BOT_NAMES = ["Chamo", "Momo", "Bao", "Lucas", "Bumblebee", "Chicky", "Dorito", "Skully"];

const clients = new Map(); // id -> client
const rooms = new Map(); // code -> room
let nextClientId = 1;

// ---------------------------------------------------------------- helpers

const now = () => Date.now();
const clampInt = (v, lo, hi, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};
// The Custom racer's creation travels with them; everyone else has no look.
const lookOf = (char, raw) => (char === CUSTOM ? cleanLook(raw) || undefined : undefined);
const cleanName = (s) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .trim()
    .slice(0, 14) || "Racer";

function makeCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  for (let tries = 0; tries < 1000; tries++) {
    let c = "";
    for (let i = 0; i < 4; i++) c += letters[Math.floor(Math.random() * letters.length)];
    if (!rooms.has(c)) return c;
  }
  return String(Math.floor(Math.random() * 1e6));
}

function send(client, msg) {
  if (client.socket.readyState === 1) client.socket.send(typeof msg === "string" ? msg : JSON.stringify(msg));
}

function broadcast(room, msg, exceptId = null) {
  const data = JSON.stringify(msg);
  for (const p of room.players.values()) if (p.id !== exceptId) send(p, data);
}

function roomView(room) {
  return {
    code: room.code,
    public: room.public,
    host: room.hostId,
    state: room.state,
    settings: room.settings,
    raceNo: room.raceNo,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      char: p.char,
      kart: p.kart,
      look: p.look,
      ready: p.ready,
      rematch: p.rematch,
      points: p.points,
      wins: p.wins,
      voice: p.voice,
      vmuted: p.vmuted,
    })),
  };
}

function sendRoom(room) {
  broadcast(room, { t: "room", room: roomView(room) });
}

function publicRooms() {
  return [...rooms.values()]
    .filter((r) => r.public)
    .map((r) => ({
      code: r.code,
      host: r.players.get(r.hostId)?.name || "?",
      players: r.players.size,
      state: r.state,
      track: r.settings.track,
    }))
    .slice(0, 30);
}

// ---------------------------------------------------------------- rooms

function createRoom(client, isPublic) {
  const room = {
    code: makeCode(),
    public: !!isPublic,
    hostId: client.id,
    state: "lobby",
    settings: { track: 0, laps: 3, cc: 150, cpu: true, items: true },
    players: new Map(),
    race: null,
    raceNo: 0,
    created: now(),
  };
  rooms.set(room.code, room);
  joinRoom(client, room);
  return room;
}

function joinRoom(client, room) {
  if (client.room) leaveRoom(client);
  if (room.players.size >= MAX_KARTS) return send(client, { t: "err", msg: "That room is full." });
  client.room = room;
  client.ready = false;
  client.rematch = false;
  client.voice = false;
  client.vmuted = false;
  client.points = 0;
  client.wins = 0;
  room.players.set(client.id, client);
  sendRoom(room);
  broadcast(room, { t: "chat", sys: true, text: `${client.name} joined.` });
  if (room.state === "racing") send(client, { t: "wait", msg: "A race is in progress — you'll join the next one." });
}

function leaveRoom(client) {
  const room = client.room;
  if (!room) return;
  client.room = null;
  client.voice = false;
  room.players.delete(client.id);
  if (room.players.size === 0) {
    if (room.race?.timer) clearTimeout(room.race.timer);
    if (room.race?.hardTimer) clearTimeout(room.race.hardTimer);
    rooms.delete(room.code);
    return;
  }
  broadcast(room, { t: "chat", sys: true, text: `${client.name} left.` });
  if (room.hostId === client.id) {
    room.hostId = room.players.keys().next().value;
    const h = room.players.get(room.hostId);
    broadcast(room, { t: "chat", sys: true, text: `${h.name} is now the host.` });
  }
  if (room.race) {
    const race = room.race;
    const gone = race.grid.filter((g) => g.owner === client.id).map((g) => g.id);
    for (const id of gone) race.left.add(id);
    broadcast(room, { t: "left", ids: gone });
    checkRaceDone(room);
  }
  if (maybeRematch(room)) return;
  sendRoom(room);
}

// Everyone still in the room asked for a rematch: go again with the same settings.
function maybeRematch(room) {
  if (room.state !== "lobby" || room.raceNo === 0) return false;
  const players = [...room.players.values()];
  if (!players.length || !players.every((p) => p.rematch)) return false;
  broadcast(room, { t: "chat", sys: true, text: "Rematch! Here we go again." });
  startRace(room);
  return true;
}

// ---------------------------------------------------------------- racing

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startRace(room) {
  const s = room.settings;
  const humans = [...room.players.values()];
  // Leaders start at the back, like the real thing. First race: random order.
  if (room.raceNo === 0) shuffle(humans);
  else humans.sort((a, b) => a.points - b.points);

  const grid = [];
  const used = new Set(humans.map((h) => h.char));
  if (s.cpu) {
    const free = shuffle([...Array(CHARACTER_COUNT).keys()].filter((c) => !used.has(c)));
    const all = shuffle([...Array(CHARACTER_COUNT).keys()]);
    const botCount = MAX_KARTS - humans.length;
    for (let i = 0; i < botCount; i++) {
      const ch = i < free.length ? free[i] : all[i % all.length];
      grid.push({
        id: `b${room.raceNo}_${i}`,
        name: BOT_NAMES[ch],
        char: ch,
        kart: Math.floor(Math.random() * KART_COUNT),
        bot: true,
        owner: room.hostId,
      });
    }
  }
  for (const h of humans) grid.push({ id: h.id, name: h.name, char: h.char, kart: h.kart, look: h.look, bot: false, owner: h.id });

  const track = s.track < 0 ? Math.floor(Math.random() * TRACK_COUNT) : s.track;
  const startAt = now() + START_DELAY_MS;
  room.state = "racing";
  room.raceNo++;
  room.race = {
    track,
    laps: s.laps,
    startAt,
    grid,
    finishes: new Map(),
    dist: new Map(),
    left: new Set(),
    firstFinishAt: 0,
    timer: null,
    hardTimer: setTimeout(() => endRace(room), START_DELAY_MS + s.laps * 180000 + 60000),
    ended: false,
  };
  for (const p of room.players.values()) {
    p.ready = false;
    p.rematch = false;
  }
  broadcast(room, {
    t: "race",
    track,
    laps: s.laps,
    cc: s.cc,
    items: s.items,
    seed: Math.floor(Math.random() * 1e9),
    startAt,
    raceNo: room.raceNo,
    grid,
  });
  sendRoom(room);
}

function ownsKart(client, race, id) {
  const g = race.grid.find((k) => k.id === id);
  return !!g && g.owner === client.id && !race.left.has(id);
}

function checkRaceDone(room) {
  const race = room.race;
  if (!race || race.ended) return;
  const humans = race.grid.filter((g) => !g.bot && !race.left.has(g.id));
  if (humans.length === 0) return endRace(room);
  const allDone = humans.every((g) => race.finishes.has(g.id));
  if (allDone) {
    clearTimeout(race.timer);
    race.timer = setTimeout(() => endRace(room), ALL_HUMANS_DONE_MS);
  }
}

function endRace(room) {
  const race = room.race;
  if (!race || race.ended) return;
  race.ended = true;
  clearTimeout(race.timer);
  clearTimeout(race.hardTimer);
  const entries = race.grid.map((g) => ({
    id: g.id,
    name: g.name,
    char: g.char,
    look: g.look,
    bot: g.bot,
    time: race.finishes.get(g.id) ?? null,
    dist: race.dist.get(g.id) ?? -1e9,
    dnf: race.left.has(g.id),
  }));
  entries.sort((a, b) => {
    if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
    if (a.time != null && b.time != null) return a.time - b.time;
    if (a.time != null) return -1;
    if (b.time != null) return 1;
    return b.dist - a.dist;
  });
  entries.forEach((e, i) => {
    e.pts = e.dnf ? 0 : POINTS[i] || 0;
    const c = !e.bot && clients.get(e.id);
    if (c?.pid) {
      const g = race.grid.find((k) => k.id === e.id);
      stats.race(c.pid, c.geo, { mode: "online", track: race.track, name: e.name, char: e.char, kart: g?.kart ?? 0, place: e.dnf ? null : i + 1, time: e.time, laps: [], pts: e.pts });
    }
    const p = room.players.get(e.id);
    if (p) {
      p.points += e.pts;
      if (i === 0) p.wins++;
    }
    delete e.dist;
  });
  room.state = "lobby";
  room.race = null;
  broadcast(room, { t: "over", results: entries });
  sendRoom(room);
}

// ---------------------------------------------------------------- Time Trial records

const records = loadRecords();
const stats = createStats({ file: join(STATE_DIR, "stats.json"), trackCount: TRACK_COUNT, charCount: CHARACTER_COUNT, kartCount: KART_COUNT });
let recordsSaveTimer = null;

function loadRecords() {
  const empty = { laps: Array.from({ length: TRACK_COUNT }, () => []), runs: Array.from({ length: TRACK_COUNT }, () => []) };
  try {
    const data = JSON.parse(readFileSync(RECORDS_FILE, "utf8"));
    for (const board of ["laps", "runs"]) for (let i = 0; i < TRACK_COUNT; i++) if (Array.isArray(data[board]?.[i])) empty[board][i] = data[board][i];
  } catch (err) {
    if (err.code !== "ENOENT") console.error("records: can't read", RECORDS_FILE, err.message);
  }
  return empty;
}

function saveRecords() {
  clearTimeout(recordsSaveTimer);
  recordsSaveTimer = setTimeout(() => {
    try {
      writeFileSync(RECORDS_FILE + ".tmp", JSON.stringify(records, null, 1));
      renameSync(RECORDS_FILE + ".tmp", RECORDS_FILE);
    } catch (err) {
      console.error("records: can't write", RECORDS_FILE, err.message);
    }
  }, 500);
}

// Player ids stay private: a client only learns which entries are its own.
// Entries on both boards can have a ghost (the run that set the time).
function boardView(board, pid) {
  return records[board].map((list, track) =>
    list.map((e) => ({ name: e.name, char: e.char, kart: e.kart, look: e.look, time: e.time, laps: e.laps, at: e.at, mine: e.pid === pid || undefined, ghost: ghosts.has(ghostKey(track, e.pid, board)) || undefined }))
  );
}
const recordsView = (pid, extra) => ({ t: "records", laps: boardView("laps", pid), runs: boardView("runs", pid), ...extra });

// Puts a player's time on a board if it beats their entry, keeping the top RECORDS_TOP.
// Returns whether the entry improved, calls onPass(entry, oldRank) for everyone the player
// just overtook and onDrop for entries that fall off.
function recordTime(list, pid, time, fields, onDrop, onPass) {
  let entry = list.find((e) => e.pid === pid);
  if (entry && time >= entry.time) return false;
  const ahead = entry ? list.indexOf(entry) : list.length;
  list.slice(0, ahead).forEach((e, i) => e.time > time && onPass?.(e, i + 1));
  if (!entry) list.push((entry = { pid }));
  Object.assign(entry, fields, { time, at: now() });
  list.sort((a, b) => a.time - b.time);
  for (const e of list.slice(RECORDS_TOP)) onDrop?.(e);
  list.length = Math.min(list.length, RECORDS_TOP);
  return true;
}

// ---------------------------------------------------------------- ghosts

// One file per board entry: "7-<pid>" for the lap board, "r7-<pid>" for the full-race board.
// pids are checked by validPid, so these are safe file names.
const ghostKey = (track, pid, board = "laps") => `${board === "runs" ? "r" : ""}${track}-${pid}`;
const ghosts = loadGhostIndex();

function loadGhostIndex() {
  try {
    mkdirSync(GHOST_DIR, { recursive: true });
    return new Set(readdirSync(GHOST_DIR).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)));
  } catch (err) {
    console.error("ghosts: can't read", GHOST_DIR, err.message);
    return new Set();
  }
}

// A run's frames ([x, y, z, yaw] at GHOST_HZ) must be sane and match its lap times.
function validGhost(g, laps) {
  if (!g || !Array.isArray(g.frames) || !Array.isArray(laps) || !laps.length) return false;
  const time = laps.reduce((a, b) => a + Number(b), 0);
  const n = g.frames.length;
  if (!Number.isFinite(time) || Math.abs(Number(g.time) - time) > 0.1 || n < 20 || n > MAX_GHOST_S * GHOST_HZ || Math.abs(n - time * GHOST_HZ) > 40) return false;
  return g.frames.every((f) => Array.isArray(f) && f.length === 4 && f.every((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e4));
}

// The whole run, with its lap times (so the lap board can hand out just the record lap).
function saveGhost(track, entry, g, laps, board = "laps") {
  const key = ghostKey(track, entry.pid, board);
  try {
    const file = join(GHOST_DIR, key + ".json");
    writeFileSync(file + ".tmp", JSON.stringify({ char: entry.char, kart: entry.kart, look: entry.look, time: Math.round(Number(g.time) * 1000) / 1000, laps: laps.map((l) => Math.round(Number(l) * 1000) / 1000), frames: g.frames }));
    renameSync(file + ".tmp", file);
    ghosts.add(key);
  } catch (err) {
    console.error("ghosts: can't write", key, err.message);
  }
}

function dropGhost(track, pid, board = "laps") {
  const key = ghostKey(track, pid, board);
  if (!ghosts.delete(key)) return;
  try {
    unlinkSync(join(GHOST_DIR, key + ".json"));
  } catch {}
}

// Lap times of a recorded run, from where it crosses the line: its progress round the track
// (in samples, starting just behind the line) passes a multiple of the lap length.
const trackShapes = new Map();
function lapsFromFrames(track, frames) {
  if (!trackShapes.has(track)) trackShapes.set(track, new Track(TRACKS[track]));
  const t = trackShapes.get(track);
  const q = {};
  let hint = -1, prev = null, dist = 0;
  const ends = [];
  frames.forEach(([x, , z], i) => {
    t.query(x, z, hint, q);
    hint = q.idx;
    if (prev == null) dist = t.delta(0, q.idx); // just behind the line at the start
    else dist += t.delta(prev, q.idx);
    prev = q.idx;
    if (dist >= (ends.length + 1) * t.N) ends.push(i);
  });
  if (ends.length < 2) return null;
  ends[ends.length - 1] = Math.max(ends[ends.length - 1], frames.length - 1); // the last lap ends with the run
  return ends.map((f, k) => Math.round(((f - (k ? ends[k - 1] : 0)) / GHOST_HZ) * 1000) / 1000);
}

// The best-ranked ghost on a track's board (normally #1's). From the full-race board it's the
// whole run; from the lap board it's just the record lap (lapOnly), when the file has the lap
// times to find it (older ghosts are the whole run).
function ghostView(track, board = "laps") {
  const list = records[board][track] || [];
  const i = list.findIndex((e) => ghosts.has(ghostKey(track, e.pid, board)));
  if (i < 0) return { t: "ghost", track, board, none: true };
  const e = list[i];
  try {
    const g = JSON.parse(readFileSync(join(GHOST_DIR, ghostKey(track, e.pid, board) + ".json"), "utf8"));
    let frames = g.frames, lapOnly = false;
    if (board === "laps" && !Array.isArray(g.laps)) {
      // An older ghost without lap times: find them along its path, and keep them
      const laps = lapsFromFrames(track, g.frames);
      if (laps && laps.some((l) => Math.abs(l - e.time) < 0.2)) {
        g.laps = laps;
        try {
          const file = join(GHOST_DIR, ghostKey(track, e.pid) + ".json");
          writeFileSync(file + ".tmp", JSON.stringify(g));
          renameSync(file + ".tmp", file);
        } catch {}
      }
    }
    if (board === "laps" && Array.isArray(g.laps) && g.laps.length) {
      const b = g.laps.indexOf(Math.min(...g.laps));
      const start = Math.round(g.laps.slice(0, b).reduce((x, y) => x + y, 0) * GHOST_HZ);
      const n = Math.round(g.laps[b] * GHOST_HZ);
      if (start + n <= frames.length + 2) {
        frames = frames.slice(start, start + n + 1);
        lapOnly = true;
      }
    }
    return { t: "ghost", track, board, rank: i + 1, name: e.name, char: g.char, kart: g.kart, look: lookOf(g.char, g.look), lap: board === "laps" ? e.time : undefined, time: board === "laps" && lapOnly ? e.time : g.time, lapOnly, frames };
  } catch {
    return { t: "ghost", track, board, none: true };
  }
}

// Ghosts saved before lap times were kept (and before the full-race board had ghosts): when a
// player's lap-board ghost is the same run as their full-race entry (same total time), give it
// that entry's lap times, and make it the full-race entry's ghost too.
(function backfillGhosts() {
  let n = 0;
  records.laps.forEach((list, track) => {
    for (const e of list) {
      const key = ghostKey(track, e.pid);
      if (!ghosts.has(key)) continue;
      const run = records.runs[track]?.find((r) => r.pid === e.pid);
      if (!run?.laps?.length) continue;
      try {
        const file = join(GHOST_DIR, key + ".json");
        const g = JSON.parse(readFileSync(file, "utf8"));
        if (Math.abs(g.time - run.time) > 0.05) continue; // a different run
        if (!g.laps) {
          g.laps = run.laps;
          writeFileSync(file + ".tmp", JSON.stringify(g));
          renameSync(file + ".tmp", file);
          n++;
        }
        if (!ghosts.has(ghostKey(track, e.pid, "runs"))) {
          saveGhost(track, run, g, run.laps, "runs");
          n++;
        }
      } catch {}
    }
  });
  if (n) console.log(`ghosts: backfilled ${n} files`);
})();

const validPid = (pid) => typeof pid === "string" && /^[a-z0-9]{16,40}$/i.test(pid);
const profileFrom = (msg) => ({ name: msg.name ? cleanName(msg.name) : undefined, char: clampInt(msg.char, 0, CHARACTER_COUNT - 1, 0), kart: clampInt(msg.kart, 0, KART_COUNT - 1, 0) });

function submitLaps(client, msg) {
  const track = clampInt(msg.track, 0, TRACK_COUNT - 1, -1);
  // Always answer, so the client isn't left waiting. A Time Trial takes well over a
  // minute, so a second submission within 20s is a replay.
  const invalid = track !== Number(msg.track) || !validPid(msg.pid) || !Array.isArray(msg.laps);
  if (invalid || now() - (client.lastLaps || 0) < 20000) return send(client, recordsView(msg.pid));
  client.lastLaps = now();
  const valid = (t) => Number.isFinite(t) && t >= MIN_LAP_S[track] && t <= MAX_LAP_S;
  const all = msg.laps.slice(0, 5).map(Number);
  const times = all.filter(valid);
  const char = clampInt(msg.char, 0, CHARACTER_COUNT - 1, 0);
  const racer = { name: cleanName(msg.name), char, kart: clampInt(msg.kart, 0, KART_COUNT - 1, 0), look: lookOf(char, msg.look) };
  const round = (t) => Math.round(t * 1000) / 1000;
  let changed = false;
  if (times.length) {
    const lapList = records.laps[track];
    const lap = round(Math.min(...times));
    if (recordTime(lapList, msg.pid, lap, racer, (e) => dropGhost(track, e.pid), (e, was) => noteBeaten(e.pid, "laps", track, was, racer, lap))) {
      changed = true;
      // The run this lap came from becomes the entry's ghost (or it has none).
      const entry = lapList.find((e) => e.pid === msg.pid);
      if (entry) {
        if (validGhost(msg.ghost, msg.laps)) saveGhost(track, entry, msg.ghost, msg.laps);
        else dropGhost(track, entry.pid);
      }
    }
  }
  // Only a complete Time Trial with every lap plausible counts as a full race.
  if (all.length === TT_LAPS && times.length === TT_LAPS) {
    const laps = times.map(round);
    const run = round(times.reduce((a, b) => a + b, 0));
    if (recordTime(records.runs[track], msg.pid, run, { ...racer, laps }, (e) => dropGhost(track, e.pid, "runs"), (e, was) => noteBeaten(e.pid, "runs", track, was, racer, run))) {
      changed = true;
      // This run becomes the full-race entry's ghost (the track record's, if it's #1)
      const entry = records.runs[track].find((e) => e.pid === msg.pid);
      if (entry) {
        if (validGhost(msg.ghost, msg.laps)) saveGhost(track, entry, msg.ghost, msg.laps, "runs");
        else dropGhost(track, entry.pid, "runs");
      }
    }
  }
  // Renaming yourself updates your entries even without a faster time.
  for (const board of ["laps", "runs"])
    for (const e of records[board][track])
      if (e.pid === msg.pid && e.name !== racer.name) {
        e.name = racer.name;
        changed = true;
      }
  if (changed) saveRecords();
  const rankOn = (board) => records[board][track].findIndex((e) => e.pid === msg.pid) + 1 || null;
  send(client, recordsView(msg.pid, { track, rank: rankOn("laps"), runRank: rankOn("runs") }));
}

// ---------------------------------------------------------------- beaten records
// Someone passed you on a board: you hear about it the next time you open the game. One note
// per board and track, with the rank you had before the first pass and who passed you since.

const beaten = loadBeaten();
let beatenSaveTimer = null;

function loadBeaten() {
  try {
    const d = JSON.parse(readFileSync(BEATEN_FILE, "utf8"));
    const old = now() - BEATEN_KEEP_MS;
    for (const [pid, notes] of Object.entries(d)) {
      for (const [k, n] of Object.entries(notes)) if (!(n.at > old)) delete notes[k];
      if (!Object.keys(notes).length) delete d[pid];
    }
    return d;
  } catch (err) {
    if (err.code !== "ENOENT") console.error("beaten: can't read", BEATEN_FILE, err.message);
    return {};
  }
}

function saveBeaten() {
  clearTimeout(beatenSaveTimer);
  beatenSaveTimer = setTimeout(() => {
    try {
      writeFileSync(BEATEN_FILE + ".tmp", JSON.stringify(beaten));
      renameSync(BEATEN_FILE + ".tmp", BEATEN_FILE);
    } catch (err) {
      console.error("beaten: can't write", BEATEN_FILE, err.message);
    }
  }, 500);
}

function noteBeaten(pid, board, track, was, racer, time) {
  const notes = (beaten[pid] ||= {});
  const n = (notes[board + track] ||= { board, track, was, by: [] });
  n.by = [{ name: racer.name, char: racer.char, look: racer.look, time }, ...n.by.filter((b) => b.name !== racer.name)].slice(0, 3);
  n.at = now();
  saveBeaten();
  alertBeaten(pid, { kind: "board", board, track, was, name: racer.name, time });
}

// Tell them right away instead of waiting for their next visit: a nudge to their open game
// (it fetches the notes and shows them on the menus), or a push notification if they're away.
// A lap record and a full-race record falling together (or several passes in a row) arrive
// as one notification.
const fmtTime = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, "0")}`;
const pendingAlerts = new Map(); // pid -> { items, timer }

function alertBeaten(pid, item) {
  let p = pendingAlerts.get(pid);
  if (!p) pendingAlerts.set(pid, (p = { items: [], timer: setTimeout(() => flushAlerts(pid), 2000) }));
  p.items.push(item);
}

function flushAlerts(pid) {
  const p = pendingAlerts.get(pid);
  pendingAlerts.delete(pid);
  if (!p) return;
  const uid = uidOf(pid);
  const live = presenceClients().filter((c) => c.uid === uid);
  if (live.length) {
    for (const c of live) send(c, { t: "beaten-now" });
    return;
  }
  // The biggest news leads: losing #1 beats losing #5, a record beats a ghost challenge
  const items = p.items.sort((a, b) => (a.kind === "ghost") - (b.kind === "ghost") || (a.was || 99) - (b.was || 99) || (a.board === "runs" ? -1 : 1));
  const top = items[0];
  const where = TRACKS[top.track]?.name || "a track";
  let title, body;
  if (top.kind === "ghost") {
    const d = Math.abs(top.mine - top.time).toFixed(2);
    title = `👻 ${top.name} raced your ghost on ${where}`;
    body = top.time < top.mine ? `${fmtTime(top.time)}: ${d}s faster than you! Tap to race back.` : `${fmtTime(top.time)}, but you're still ${d}s faster 😎`;
  } else {
    const what = top.board === "laps" ? "best lap" : "Time Trial record";
    title = top.was === 1 ? `😱 ${top.name} took your #1 on ${where}!` : `😱 ${top.name} beat your ${what} on ${where}`;
    const also = items.length > 1 ? (items.some((x) => x.kind === "board" && x.board !== top.board && x.track === top.track) ? " They beat your " + (top.board === "laps" ? "full race" : "best lap") + " too." : " And there's more news inside.") : "";
    body = `Their ${top.board === "laps" ? "lap" : "race"}: ${fmtTime(top.time)}.${also} Tap to win it back!`;
  }
  push.notify(pid, "beaten", { title, body, url: SITE, tag: `beaten-${top.track}` });
}

// The player's notes (once: reading them clears them), minus any rank they've already won back.
function beatenView(pid) {
  const notes = validPid(pid) && beaten[pid];
  if (!notes) return { t: "beaten", list: [] };
  delete beaten[pid];
  saveBeaten();
  const list = [];
  for (const n of Object.values(notes)) {
    if (n.kind === "ghost") {
      list.push(n);
      continue;
    }
    const board = records[n.board]?.[n.track];
    if (!board) continue;
    const i = board.findIndex((e) => e.pid === pid);
    if (i >= 0 && i + 1 <= n.was) continue;
    const top = board[0];
    list.push({ board: n.board, track: n.track, was: n.was, rank: i + 1 || null, mine: board[i]?.time ?? null, by: n.by, top: top && { name: top.name, char: top.char, look: top.look, time: top.time }, at: n.at });
  }
  list.sort((a, b) => (a.kind === "ghost") - (b.kind === "ghost") || a.was - b.was || b.at - a.at);
  return { t: "beaten", list };
}

// ---------------------------------------------------------------- ghost challenges
// A player shares one of their Time Trial runs as a link. Whoever opens it races that ghost on
// the same track; everyone's best try is kept on the challenge, and its maker hears about each
// new best through the beaten notes. One file per challenge in CHALLENGE_DIR.

const challengesMade = new Map(); // pid -> { day, n }
const ownerOf = (ch) => accounts.alias[ch.pid] || ch.pid; // the maker may have merged into another id since

(function pruneChallenges() {
  try {
    mkdirSync(CHALLENGE_DIR, { recursive: true });
    const old = now() - CHALLENGE_KEEP_MS;
    for (const f of readdirSync(CHALLENGE_DIR)) {
      const file = join(CHALLENGE_DIR, f);
      if (statSync(file).mtimeMs < old) unlinkSync(file);
    }
  } catch (err) {
    console.error("challenges: can't read", CHALLENGE_DIR, err.message);
  }
})();

const validChallengeCode = (c) => typeof c === "string" && c.length === CHALLENGE_LEN && [...c].every((ch) => CODE_CHARS.includes(ch));
// The same run always gets the same code, so sharing it twice doesn't make two challenges.
function challengeCode(pid, track, time) {
  const h = createHash("sha256").update(`ghost:${pid}:${track}:${time}`).digest();
  return Array.from(h.subarray(0, CHALLENGE_LEN), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

function loadChallenge(code) {
  if (!validChallengeCode(code)) return null;
  try {
    return JSON.parse(readFileSync(join(CHALLENGE_DIR, code + ".json"), "utf8"));
  } catch {
    return null;
  }
}

function saveChallenge(ch) {
  const file = join(CHALLENGE_DIR, ch.code + ".json");
  try {
    writeFileSync(file + ".tmp", JSON.stringify(ch));
    renameSync(file + ".tmp", file);
    return true;
  } catch (err) {
    console.error("challenges: can't write", ch.code, err.message);
    return false;
  }
}

// Three plausible laps for a track, or null
function ttLaps(track, raw) {
  if (!Array.isArray(raw) || raw.length !== TT_LAPS) return null;
  const laps = raw.map((t) => Math.round(Number(t) * 1000) / 1000);
  return laps.every((t) => Number.isFinite(t) && t >= MIN_LAP_S[track] && t <= MAX_LAP_S) ? laps : null;
}
// The run's finish time as the race clock had it: it must agree with its laps
function runTime(laps, raw) {
  const sum = laps.reduce((a, b) => a + b, 0);
  const t = Number(raw);
  return Math.round((Number.isFinite(t) && Math.abs(t - sum) <= 0.1 ? t : sum) * 1000) / 1000;
}

function triesView(ch, pid) {
  return ch.tries.slice(0, 10).map((e) => ({ name: e.name, char: e.char, look: e.look, time: e.time, mine: e.pid === pid || undefined }));
}

function newChallenge(client, msg) {
  const track = clampInt(msg.track, 0, TRACK_COUNT - 1, -1);
  const laps = track === Number(msg.track) && ttLaps(track, msg.laps);
  if (!validPid(msg.pid) || !laps || !validGhost(msg.ghost, laps)) return send(client, { t: "gchal", ok: false, error: "bad" });
  const time = runTime(laps, msg.ghost.time);
  const code = challengeCode(msg.pid, track, time);
  if (existsSync(join(CHALLENGE_DIR, code + ".json"))) return send(client, { t: "gchal", ok: true, code });
  const day = dailyId();
  const made = challengesMade.get(msg.pid);
  if (made?.day === day && made.n >= CHALLENGES_PER_DAY) return send(client, { t: "gchal", ok: false, error: "slow" });
  challengesMade.set(msg.pid, { day, n: made?.day === day ? made.n + 1 : 1 });
  const char = clampInt(msg.char, 0, CHARACTER_COUNT - 1, 0);
  const g = msg.ghost;
  const ch = { code, pid: msg.pid, name: cleanName(msg.name), char, kart: clampInt(msg.kart, 0, KART_COUNT - 1, 0), look: lookOf(char, msg.look), track, time, laps, frames: g.frames, at: now(), tries: [] };
  if (!saveChallenge(ch)) return send(client, { t: "gchal", ok: false, error: "bad" });
  send(client, { t: "gchal", ok: true, code });
}

function challengeView(msg) {
  const ch = loadChallenge(msg.code);
  if (!ch) return { t: "gchal", ok: false, error: "gone" };
  return { t: "gchal", ok: true, code: ch.code, track: ch.track, name: ch.name, char: ch.char, kart: ch.kart, look: lookOf(ch.char, ch.look), time: ch.time, laps: ch.laps, frames: ch.frames, mine: ownerOf(ch) === msg.pid || undefined, tries: triesView(ch, msg.pid) };
}

// A finished race against a challenge: keep the racer's best try and tell the maker.
function challengeTry(client, msg) {
  const ch = loadChallenge(msg.code);
  const laps = ch && ttLaps(ch.track, msg.laps);
  if (!ch || !validPid(msg.pid) || !laps || now() - (client.lastTry || 0) < 20000) return send(client, { t: "gchal", ok: false, error: "bad" });
  client.lastTry = now();
  const time = runTime(laps, msg.time);
  const char = clampInt(msg.char, 0, CHARACTER_COUNT - 1, 0);
  const racer = { name: cleanName(msg.name), char, look: lookOf(char, msg.look) };
  let e = ch.tries.find((x) => x.pid === msg.pid);
  const improved = !e || time < e.time;
  if (improved) {
    if (!e) ch.tries.push((e = { pid: msg.pid }));
    Object.assign(e, racer, { time, at: now() });
    ch.tries.sort((a, b) => a.time - b.time);
    ch.tries.length = Math.min(ch.tries.length, CHALLENGE_TRIES_KEPT);
    saveChallenge(ch);
    if (msg.pid !== ownerOf(ch)) noteChallenge(ch, { ...racer, time });
  }
  const rank = ch.tries.findIndex((x) => x.pid === msg.pid) + 1 || null;
  send(client, { t: "gchal", ok: true, code: ch.code, rank, count: ch.tries.length, best: improved, tries: triesView(ch, msg.pid) });
}

// The maker's note: one per challenge, about whoever raced it last
function noteChallenge(ch, by) {
  const notes = (beaten[ownerOf(ch)] ||= {});
  const key = "g" + ch.code;
  const n = (notes[key] ||= { kind: "ghost", code: ch.code, track: ch.track, mine: ch.time, by: [] });
  n.by = [by, ...n.by.filter((b) => b.name !== by.name)].slice(0, 3);
  n.at = now();
  saveBeaten();
  alertBeaten(ownerOf(ch), { kind: "ghost", track: ch.track, mine: ch.time, name: by.name, time: by.time });
}

// ---------------------------------------------------------------- daily challenge

const daily = loadDaily();
let dailySaveTimer = null;

function loadDaily() {
  try {
    const data = JSON.parse(readFileSync(DAILY_FILE, "utf8"));
    if (data && typeof data.days === "object") return { days: data.days };
  } catch (err) {
    if (err.code !== "ENOENT") console.error("daily: can't read", DAILY_FILE, err.message);
  }
  return { days: {} };
}

function saveDaily() {
  clearTimeout(dailySaveTimer);
  dailySaveTimer = setTimeout(() => {
    const keys = Object.keys(daily.days).sort();
    while (keys.length > DAILY_DAYS_KEPT) delete daily.days[keys.shift()];
    try {
      writeFileSync(DAILY_FILE + ".tmp", JSON.stringify(daily));
      renameSync(DAILY_FILE + ".tmp", DAILY_FILE);
    } catch (err) {
      console.error("daily: can't write", DAILY_FILE, err.message);
    }
  }, 500);
}

// Today's top 10, the player's own rank, and yesterday's podium.
function dailyView(pid, day = dailyId()) {
  const list = daily.days[day] || [];
  const row = (e) => ({ name: e.name, time: e.time, at: e.at, look: e.look, mine: e.pid === pid || undefined });
  const i = list.findIndex((e) => e.pid === pid);
  const prevDay = dailyId(Date.parse(day + "T00:00:00Z") - 86400000);
  const prev = daily.days[prevDay] || [];
  return {
    t: "daily",
    day,
    top: list.slice(0, RECORDS_TOP).map(row),
    count: list.length,
    me: i < 0 ? null : { rank: i + 1, time: list[i].time },
    prev: prev.length ? { day: prevDay, top: prev.slice(0, 3).map(row) } : null,
  };
}

function submitDaily(client, msg) {
  const t = now();
  const day = msg.day;
  const fresh = day === dailyId(t) || day === dailyId(t - DAILY_GRACE_MS);
  // Always answer. A run is three laps, so a second submission within 20s is a replay.
  if (!validPid(msg.pid) || !isDailyId(day) || !fresh || !Array.isArray(msg.laps) || t - (client.lastDaily || 0) < 20000) return send(client, dailyView(msg.pid));
  client.lastDaily = t;
  const ch = dailyChallenge(day);
  const minLap = (MIN_LAP_S[ch.track] * CC_SPEED[150]) / CC_SPEED[ch.cc];
  const laps = msg.laps.map(Number);
  const time = Number(msg.time);
  const sum = laps.reduce((a, b) => a + b, 0);
  const ok = laps.length === DAILY_LAPS && laps.every((l) => Number.isFinite(l) && l >= minLap && l <= MAX_LAP_S) && Math.abs(sum - time) < 0.05;
  if (!ok) return send(client, dailyView(msg.pid, day));
  const list = (daily.days[day] ||= []);
  let entry = list.find((e) => e.pid === msg.pid);
  const name = cleanName(msg.name);
  const best = Math.round(time * 1000) / 1000;
  let improved = false;
  if (!entry && list.length < DAILY_MAX_ENTRIES) list.push((entry = { pid: msg.pid, name, time: Infinity, tries: 0 }));
  if (entry) {
    entry.tries++;
    entry.name = name;
    if (best < entry.time) {
      Object.assign(entry, { time: best, laps: laps.map((l) => Math.round(l * 1000) / 1000), look: lookOf(ch.char, msg.look), at: t });
      improved = true;
    }
    list.sort((a, b) => a.time - b.time);
    saveDaily();
  }
  send(client, { ...dailyView(msg.pid, day), improved });
}

// ---------------------------------------------------------------- player codes
// Every player is a random private id (pid) their browser keeps. A player code is a key to
// that id: entering it (or opening its link) on another device makes that device the same
// player, and whatever the device had played as its own id gets merged in. The profile
// (name, racer, kart, Custom look) is kept here for players with a code, so it follows them.

const accounts = loadAccounts();
let accountsSaveTimer = null;
const linkTries = new Map(); // ip -> { n, since }

function loadAccounts() {
  const empty = { codes: {}, players: {}, alias: {} };
  try {
    const d = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
    return { codes: d.codes || {}, players: d.players || {}, alias: d.alias || {} };
  } catch (err) {
    if (err.code !== "ENOENT") console.error("accounts: can't read", ACCOUNTS_FILE, err.message);
    return empty;
  }
}

function saveAccounts() {
  clearTimeout(accountsSaveTimer);
  accountsSaveTimer = setTimeout(() => {
    try {
      writeFileSync(ACCOUNTS_FILE + ".tmp", JSON.stringify(accounts));
      renameSync(ACCOUNTS_FILE + ".tmp", ACCOUNTS_FILE);
    } catch (err) {
      console.error("accounts: can't write", ACCOUNTS_FILE, err.message);
    }
  }, 300);
}

const cleanCode = (c) => String(c || "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, CODE_LEN);

function newCode() {
  let c;
  do c = Array.from({ length: CODE_LEN }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
  while (accounts.codes[c]);
  return c;
}

function accountOf(pid, create) {
  let a = accounts.players[pid];
  if (!a && create) {
    a = accounts.players[pid] = { code: newCode(), profile: null };
    accounts.codes[a.code] = pid;
    saveAccounts();
  }
  return a;
}

function cleanProfile(p) {
  if (!p || typeof p !== "object") return null;
  const char = clampInt(p.char, 0, CHARACTER_COUNT - 1, 0);
  const at = Number(p.at);
  return { name: cleanName(p.name), char, kart: clampInt(p.kart, 0, KART_COUNT - 1, 0), look: lookOf(char, p.look), at: Number.isFinite(at) ? Math.min(at, now()) : now() };
}

// Keep the newest profile a device sends; returns what's stored.
function syncProfile(pid, raw) {
  const a = accountOf(pid, false);
  if (!a) return null;
  const p = cleanProfile(raw);
  if (p && (!a.profile || p.at > a.profile.at)) {
    a.profile = p;
    saveAccounts();
    renamePlayer(pid, p.name);
  }
  return a.profile;
}

// Too many wrong codes from one place: someone's guessing
function linkAllowed(client) {
  const key = client.geo?.ip || client.id;
  const e = linkTries.get(key);
  if (!e || now() - e.since > LINK_WINDOW_MS) return true;
  return e.n < LINK_TRIES;
}
function linkFailed(client) {
  const key = client.geo?.ip || client.id;
  const e = linkTries.get(key);
  if (!e || now() - e.since > LINK_WINDOW_MS) linkTries.set(key, { n: 1, since: now() });
  else e.n++;
}

// Whose code is this? (for the "Play as Ana?" question before linking)
function lookupCode(client, msg) {
  if (!linkAllowed(client)) return { t: "account", ok: false, error: "slow" };
  const to = accounts.codes[cleanCode(msg.code)];
  if (!to) {
    linkFailed(client);
    return { t: "account", ok: false, error: "unknown" };
  }
  const st = stats.info(to);
  const prof = accounts.players[to]?.profile;
  return { t: "account", ok: true, same: to === msg.pid, name: prof?.name || st?.name || "Racer", char: prof?.char ?? st?.char ?? 0, look: prof?.look, to };
}

// Everything `from` did becomes `to`'s: each board keeps the better of the two times.
function mergePlayer(from, to) {
  if (from === to) return;
  const name = accounts.players[to]?.profile?.name;
  for (const board of ["laps", "runs"])
    records[board].forEach((list, track) => {
      const a = list.find((e) => e.pid === to), b = list.find((e) => e.pid === from);
      if (!b) return;
      const keepB = !a || b.time < a.time;
      const lose = keepB ? a : b;
      if (lose) {
        list.splice(list.indexOf(lose), 1);
        dropGhost(track, lose.pid, board);
      }
      if (keepB) {
        moveGhost(track, from, to, board);
        b.pid = to;
        if (name) b.name = name;
      }
    });
  saveRecords();
  for (const list of Object.values(daily.days)) {
    const a = list.find((e) => e.pid === to), b = list.find((e) => e.pid === from);
    if (!b) continue;
    if (a && a.time <= b.time) {
      a.tries += b.tries || 0;
      list.splice(list.indexOf(b), 1);
    } else {
      if (a) {
        b.tries = (b.tries || 0) + (a.tries || 0);
        list.splice(list.indexOf(a), 1);
      }
      b.pid = to;
      if (name) b.name = name;
    }
    list.sort((x, y) => x.time - y.time);
  }
  saveDaily();
  if (beaten[from]) {
    beaten[to] = { ...beaten[from], ...beaten[to] };
    delete beaten[from];
    saveBeaten();
  }
  stats.merge(from, to);
  push.merge(from, to, uidOf(to));
  // The old id now means the new one (as does anything that was merged into it before)
  for (const [k, v] of Object.entries(accounts.alias)) if (v === from) accounts.alias[k] = to;
  accounts.alias[from] = to;
  const old = accounts.players[from];
  if (old) {
    delete accounts.codes[old.code];
    delete accounts.players[from];
  }
  saveAccounts();
}

function moveGhost(track, from, to, board = "laps") {
  const a = ghostKey(track, from, board), b = ghostKey(track, to, board);
  if (!ghosts.has(a)) return;
  try {
    renameSync(join(GHOST_DIR, a + ".json"), join(GHOST_DIR, b + ".json"));
    ghosts.delete(a);
    ghosts.add(b);
  } catch (err) {
    console.error("ghosts: can't move", a, err.message);
  }
}

// A new name shows on every board the player is on
function renamePlayer(pid, name) {
  let changed = false;
  for (const list of [...records.laps, ...records.runs])
    for (const e of list)
      if (e.pid === pid && e.name !== name) {
        e.name = name;
        changed = true;
      }
  if (changed) saveRecords();
  let dailyChanged = false;
  for (const list of Object.values(daily.days))
    for (const e of list)
      if (e.pid === pid && e.name !== name) {
        e.name = name;
        dailyChanged = true;
      }
  if (dailyChanged) saveDaily();
}

function onAccount(client, msg) {
  if (!validPid(msg.pid)) return send(client, { t: "account", ok: false, error: "bad" });
  const pid = msg.pid;
  switch (msg.t) {
    case "acct-code": {
      // Your code (made the first time you ask), and your profile kept up to date
      const a = accountOf(pid, true);
      const profile = syncProfile(pid, msg.profile);
      return send(client, { t: "account", ok: true, code: a.code, profile });
    }
    case "acct-reset": {
      const a = accountOf(pid, true);
      delete accounts.codes[a.code];
      a.code = newCode();
      accounts.codes[a.code] = pid;
      saveAccounts();
      return send(client, { t: "account", ok: true, code: a.code, profile: a.profile });
    }
    case "acct-check": {
      const r = lookupCode(client, msg);
      delete r.to;
      return send(client, r);
    }
    case "acct-link": {
      const r = lookupCode(client, msg);
      if (!r.ok) return send(client, r);
      const to = r.to;
      if (to !== pid) mergePlayer(pid, to);
      const a = accountOf(to, true);
      return send(client, { t: "account", ok: true, pid: to, code: a.code, profile: a.profile || { name: r.name, char: r.char, kart: 0, look: r.look, at: 0 } });
    }
    case "acct-sync":
      // On start: which id this device should use now, and the latest profile if it has a code
      return send(client, { t: "account", ok: true, pid, code: accounts.players[pid]?.code || null, profile: syncProfile(pid, msg.profile) });
  }
}

// ---------------------------------------------------------------- feedback
// Notes from the game's "Send feedback" box. The stats page lists them (and can mark them done
// or delete them), and devices that turned on notifications there get a ping for each new one.

const feedback = loadFeedback();
let feedbackSaveTimer = null;
let nextFeedbackId = feedback.reduce((m, f) => Math.max(m, f.id), 0) + 1;

function loadFeedback() {
  try {
    const d = JSON.parse(readFileSync(FEEDBACK_FILE, "utf8"));
    return Array.isArray(d) ? d : [];
  } catch (err) {
    if (err.code !== "ENOENT") console.error("feedback: can't read", FEEDBACK_FILE, err.message);
    return [];
  }
}

function saveFeedback() {
  clearTimeout(feedbackSaveTimer);
  feedbackSaveTimer = setTimeout(() => {
    try {
      writeFileSync(FEEDBACK_FILE + ".tmp", JSON.stringify(feedback));
      renameSync(FEEDBACK_FILE + ".tmp", FEEDBACK_FILE);
    } catch (err) {
      console.error("feedback: can't write", FEEDBACK_FILE, err.message);
    }
  }, 300);
}

const cleanText = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, max);

function submitFeedback(client, msg) {
  const text = cleanText(msg.text, FEEDBACK_MAX);
  if (!validPid(msg.pid) || !text) return send(client, { t: "ok", ok: false });
  const today = now() - 86400000;
  if (now() - (client.lastFeedback || 0) < 10000 || feedback.filter((f) => f.pid === msg.pid && f.at > today).length >= FEEDBACK_PER_DAY) return send(client, { t: "ok", ok: false, error: "slow" });
  client.lastFeedback = now();
  const char = clampInt(msg.char, 0, CHARACTER_COUNT - 1, 0);
  const c = msg.ctx && typeof msg.ctx === "object" ? msg.ctx : null;
  const entry = {
    id: nextFeedbackId++,
    at: now(),
    pid: msg.pid,
    name: cleanName(msg.name),
    char,
    look: lookOf(char, msg.look),
    text,
    ctx: c ? { where: cleanText(c.where, 30), mode: cleanText(c.mode, 20), track: cleanText(c.track, 30), device: cleanText(c.device, 20), browser: cleanText(c.browser, 40), version: cleanText(c.version, 10) } : null,
    done: false,
  };
  feedback.push(entry);
  if (feedback.length > FEEDBACK_KEPT) feedback.splice(0, feedback.length - FEEDBACK_KEPT);
  saveFeedback();
  push.admins({ title: `💬 Feedback from ${entry.name}`, body: text.slice(0, 140), url: siteUrl("dashboard/#feedback"), tag: "feedback-" + entry.id });
  send(client, { t: "ok", ok: true });
}

// The stats page's buttons (POST to /chamokart/dashboard/data, behind its password), and the
// fixer's bug status updates (it posts here directly, on localhost)
function statsAction(a) {
  switch (a?.action) {
    case "fb-done": {
      const f = feedback.find((x) => x.id === a.id);
      if (!f) return { ok: false };
      f.done = !!a.done;
      saveFeedback();
      return { ok: true };
    }
    case "fb-delete": {
      const i = feedback.findIndex((x) => x.id === a.id);
      if (i < 0) return { ok: false };
      feedback.splice(i, 1);
      saveFeedback();
      return { ok: true };
    }
    case "bug-ignore":
    case "bug-delete":
    case "bug-fix":
      return bugs.action(a);
    case "idea-hide":
    case "idea-delete":
    case "idea-build":
      return features.action(a);
    case "admin-sub":
      return { ok: push.adminSubscribe(a.sub) };
    case "admin-unsub":
      push.adminUnsubscribe(String(a.endpoint || ""));
      return { ok: true };
  }
  return { ok: false };
}

// ---------------------------------------------------------------- presence and challenges
// While the game is open it keeps a "presence" connection: everyone sees who's playing and
// what they're up to, and can challenge them to a private room. Players are shown by a
// public id (uid) derived from their private one, which stays secret.

const push = createPush({ dir: STATE_DIR, subject: SITE, site: SITE });
// Their notifications link to the dashboard, on whichever address the game lives at
const bugs = createBugs({ file: BUGS_FILE, notify: (m) => push.admins({ ...m, url: siteUrl(m.url) }) });
const features = createFeatures({ file: FEATURES_FILE, notify: (m) => push.admins({ ...m, url: siteUrl(m.url) }) });
const serverStarted = now();
const PLAYING_GRACE_MS = Number(process.env.PLAYING_GRACE_MS ?? 5 * 60000); // after a restart everyone reconnects: don't announce them all
const AWAY_BEFORE_ANNOUNCE_MS = 20 * 60000;
const CHALLENGE_TTL_MS = 5 * 60000;
const lastSeen = new Map(); // uid -> time we last saw them online
const challenges = new Map(); // id -> { from, to, code, at }
let nextChallengeId = 1;
let playersTimer = null;

const uidOf = (pid) => createHash("sha256").update("chamokart:" + pid).digest("base64url").slice(0, 12);
const presenceClients = () => [...clients.values()].filter((c) => c.presence);
const isOnline = (uid) => presenceClients().some((c) => c.uid === uid);

function cleanStatus(st) {
  const where = ["menu", "race", "lobby", "online", "watch"].includes(st?.where) ? st.where : "menu";
  const out = { where };
  if (where === "race") {
    out.mode = ["gp", "vs", "tt", "daily", "tutorial", "beta"].includes(st.mode) ? st.mode : "vs";
    out.track = clampInt(st.track, 0, TRACK_COUNT - 1, 0);
  }
  return out;
}

// Everyone online, once per player (a player with two tabs open shows up once).
function playersView() {
  const seen = new Map();
  for (const c of presenceClients()) {
    if (seen.has(c.uid)) continue;
    const status = c.status.where === "watch" ? { where: "watch", of: c.watching ? nameOf(c.watching) : null } : c.status;
    seen.set(c.uid, { uid: c.uid, name: c.name, char: c.char, look: c.look, status, since: c.presenceSince });
  }
  return [...seen.values()];
}

function sendPlayers() {
  clearTimeout(playersTimer);
  playersTimer = setTimeout(() => {
    const list = playersView();
    stats.online(list.length); // the day's busiest moment, for the dashboard
    const data = JSON.stringify({ t: "players", list });
    for (const c of presenceClients()) send(c, data);
  }, 300);
}

function onPresence(client, msg) {
  if (!validPid(msg.pid)) return;
  const first = !client.presence;
  client.pid = msg.pid;
  client.uid = uidOf(msg.pid);
  client.name = cleanName(msg.name);
  client.char = clampInt(msg.char, 0, CHARACTER_COUNT - 1, 0);
  client.look = lookOf(client.char, msg.look);
  client.status = cleanStatus(msg.status);
  if (first) {
    const wasOnline = isOnline(client.uid);
    client.presence = true;
    client.presenceSince = now();
    send(client, { t: "presence-ok", uid: client.uid, push: push.subscribed(client.pid) });
    // Just started playing (not a reconnect, a second tab or a server restart): tell the others.
    const away = now() - (lastSeen.get(client.uid) || 0);
    if (!wasOnline && away > AWAY_BEFORE_ANNOUNCE_MS && now() - serverStarted > PLAYING_GRACE_MS) push.playing(client.uid, client.name, isOnline);
    // Back after a dropped connection with people still watching: pick the stream up again
    if (watchersOf(client.uid).length) sendWatchers(client.uid, true);
  }
  lastSeen.set(client.uid, now());
  sendPlayers();
}

async function onChallenge(client, msg) {
  if (!client.presence || now() - (client.lastChallenge || 0) < 3000) return;
  client.lastChallenge = now();
  const to = String(msg.to || "");
  const room = rooms.get(String(msg.code || ""));
  // The room must be one the challenger is actually in (their game connection, same player).
  if (!room || ![...room.players.values()].some((p) => p.pid === client.pid) || to === client.uid) return send(client, { t: "challenge-sent", to, delivered: "none" });
  for (const [id, c] of challenges) if (now() - c.at > CHALLENGE_TTL_MS) challenges.delete(id);
  const id = `c${nextChallengeId++}`;
  challenges.set(id, { from: client.uid, fromName: client.name, to, code: room.code, at: now() });
  const from = { uid: client.uid, name: client.name, char: client.char, look: client.look };
  const targets = presenceClients().filter((c) => c.uid === to);
  let delivered = "none";
  if (targets.length) {
    for (const c of targets) send(c, { t: "challenge", id, from, code: room.code });
    delivered = "live";
  } else if (await push.challenge(to, { title: `⚔️ ${client.name} challenges you!`, body: "Tap to join their room and race.", url: `${SITE}#room=${room.code}`, tag: "challenge" })) {
    delivered = "push";
  }
  send(client, { t: "challenge-sent", to, delivered });
}

function onChallengeReply(client, msg) {
  const c = challenges.get(String(msg.id || ""));
  if (!c || c.to !== client.uid) return;
  challenges.delete(String(msg.id));
  for (const p of presenceClients()) if (p.uid === c.from) send(p, { t: "challenge-reply", name: client.name, accept: !!msg.accept });
}

// ---------------------------------------------------------------- spectating
// A watcher follows a player (by uid). While anyone watches, that player's game streams its
// race ("cast" messages) over its presence connection, and we pass it on to the watchers.

const CAST_KINDS = new Set(["setup", "f", "end", "idle"]);
const CAST_MODES = new Set(["gp", "vs", "tt", "daily", "online", "tutorial"]);
const CAST_ITEMS = new Set(["banana", "green", "red", "blue", "bomb", "fire", "boomerang"]);
const CAST_HELD = new Set(["", "banana", "banana3", "green", "green3", "red", "red3", "blue", "chili", "chili3", "golden", "star", "bullet", "bolt", "splat", "bomb", "fire", "boomerang", "piranha", "horn", "boo", "coin", "eight"]);
const CAST_EVENTS = new Set(["wall", "land", "hit:spin", "hit:tumble", "hit:squish", "zap", "trick", "finish", "fall", "rocket", "miniturbo3", "chili", "pad", "trickBoost", "chomp", "bullet", "bulletEnd", "boo", "blasted", "lap", "use:banana", "use:green", "use:red", "use:bolt", "use:star", "use:splat", "use:blue", "use:bomb", "use:fire", "use:boomerang", "use:horn", "use:coin", "boost", "coin", "itemReady", "stolen"]);
const CAST_FX = new Set(["boxBreak", "bananaHit", "shellHit", "poof", "boom", "bigBoom", "horn"]);

const watchersOf = (uid) => presenceClients().filter((c) => c.watching === uid);
const nameOf = (uid) => presenceClients().find((c) => c.uid === uid)?.name ?? null;
const num = (v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e5;
const shortId = (v) => typeof v === "string" && v.length > 0 && v.length <= 24;

// Tell a player who's watching them (fresh: someone new, so send the race from the top).
function sendWatchers(uid, fresh) {
  const names = [...new Map(watchersOf(uid).map((c) => [c.uid, c.name])).values()];
  for (const c of presenceClients()) if (c.uid === uid) send(c, { t: "watchers", names, fresh });
}

function onWatch(client, msg) {
  if (!client.presence) return;
  const prev = client.watching;
  const to = typeof msg.to === "string" && msg.to !== client.uid ? msg.to.slice(0, 16) : null;
  client.watching = to;
  if (prev && prev !== to) sendWatchers(prev, false);
  if (to) {
    const target = presenceClients().find((c) => c.uid === to);
    send(client, { t: "watch-ok", uid: to, online: !!target, name: target?.name ?? null });
    if (target) sendWatchers(to, true);
  }
  sendPlayers();
}

// The stream comes from a player's own game, so check its shape before passing it on.
function cleanCast(m) {
  if (!CAST_KINDS.has(m.k)) return null;
  if (m.k === "idle") return { k: "idle" };
  if (m.k === "end") return { k: "end", quit: m.quit ? 1 : 0 };
  if (m.k === "setup") {
    const r = m.race;
    if (!r || !Array.isArray(r.grid) || !r.grid.length || !CAST_MODES.has(r.mode) || !num(m.tm)) return null;
    const grid = r.grid.slice(0, MAX_KARTS).filter((g) => g && shortId(g.id)).map((g) => {
      const char = clampInt(g.char, 0, CHARACTER_COUNT - 1, 0);
      return { id: g.id, name: cleanName(g.name), char, kart: clampInt(g.kart, 0, KART_COUNT - 1, 0), look: lookOf(char, g.look), human: !!g.human };
    });
    if (!grid.length) return null;
    return {
      k: "setup",
      id: String(m.id || "").slice(0, 12),
      race: { track: clampInt(r.track, 0, TRACK_COUNT - 1, 0), laps: clampInt(r.laps, 1, 5, 3), cc: [50, 100, 150, 200].includes(r.cc) ? r.cc : 150, mode: r.mode, items: !!r.items, intro: Math.min(10, Math.max(0, Number(r.intro) || 0)), grid },
      focus: shortId(m.focus) ? m.focus : null,
      tm: m.tm,
    };
  }
  // A frame
  if (!num(m.tm) || !Array.isArray(m.d)) return null;
  const f = { k: "f", tm: m.tm, p: m.p ? 1 : 0 };
  f.d = m.d.slice(0, MAX_KARTS).filter((k) => Array.isArray(k) && k.length === 11 && shortId(k[0]) && k.slice(1).every(num));
  f.o = (Array.isArray(m.o) ? m.o.slice(0, 40) : []).filter((o) => Array.isArray(o) && typeof o[0] === "string" && o[0].length <= 32 && CAST_ITEMS.has(o[1]) && [o[2], o[3], o[4]].every(num)).map((o) => [o[0], o[1], o[2], o[3], o[4], clampInt(o[5], 0, 2, 0), shortId(o[6]) ? o[6] : 0]);
  f.fin = (Array.isArray(m.fin) ? m.fin.slice(0, MAX_KARTS) : []).filter((x) => Array.isArray(x) && shortId(x[0]) && num(x[1])).map((x) => [x[0], x[1]]);
  if (Array.isArray(m.me) && CAST_HELD.has(m.me[0])) f.me = [m.me[0], clampInt(m.me[1], 0, 9, 0), clampInt(m.me[2], 0, 99, 0), m.me[3] ? 1 : 0];
  if (Array.isArray(m.e)) f.e = m.e.slice(0, 40).filter((e) => Array.isArray(e) && shortId(e[0]) && CAST_EVENTS.has(e[1])).map((e) => [e[0], e[1]]);
  if (Array.isArray(m.fx)) f.fx = m.fx.slice(0, 20).filter((x) => Array.isArray(x) && CAST_FX.has(x[0]) && [x[1], x[2], x[3]].every(num)).map((x) => [x[0], x[1], x[2], x[3]]);
  for (const key of ["bx", "cn"]) if (Array.isArray(m[key])) f[key] = m[key].slice(0, 300).filter((i) => Number.isInteger(i) && i >= 0 && i < 1000);
  return f;
}

function onCast(client, msg) {
  if (!client.presence) return;
  const ws = watchersOf(client.uid);
  if (!ws.length) return;
  const c = cleanCast(msg);
  if (!c) return;
  // A second tab sitting in the menus mustn't cut off the tab that's racing
  if (c.k === "idle" && presenceClients().some((o) => o.uid === client.uid && o !== client && ["race", "online"].includes(o.status?.where))) return;
  const data = JSON.stringify({ t: "cast", from: client.uid, ...c });
  for (const w of ws) send(w, data);
}

// Chat around a live race: a watcher's message (to: the racer they watch) reaches the racer and
// everyone else watching; the racer's own message (no to) reaches all their watchers.
function onWatchChat(client, msg) {
  const text = String(msg.text || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120);
  if (!text || now() - (client.lastWatchChat || 0) < 800) return;
  const room = watchRoom(client, msg);
  if (!room) return;
  client.lastWatchChat = now();
  const data = JSON.stringify({ t: "wchat", racer: room.racer, uid: client.uid, name: client.name, text });
  for (const c of room.audience) send(c, data);
}

// Quick emoji reactions, same audience as the chat (the emoji list lives in main.js REACTIONS)
const REACTION_COUNT = 6;
function onWatchReact(client, msg) {
  const e = Number.isInteger(msg.e) && msg.e >= 0 && msg.e < REACTION_COUNT ? msg.e : null;
  if (e == null || now() - (client.lastWatchReact || 0) < 200) return;
  const room = watchRoom(client, msg);
  if (!room) return;
  client.lastWatchReact = now();
  const data = JSON.stringify({ t: "wreact", racer: room.racer, uid: client.uid, name: client.name, e });
  for (const c of room.audience) send(c, data);
}

// Who hears a watcher's message (to: the racer they watch) or a racer's own (no to): the
// racer's tabs plus everyone watching. Null unless both sides are there.
function watchRoom(client, msg) {
  if (!client.presence) return null;
  const racer = msg.to ? (msg.to === client.watching ? client.watching : null) : client.uid;
  if (!racer) return null;
  const watchers = watchersOf(racer);
  const racers = presenceClients().filter((c) => c.uid === racer);
  if (!racers.length || !watchers.length) return null;
  return { racer, audience: new Set([...racers, ...watchers]) };
}

// ---------------------------------------------------------------- messages

function handle(client, msg) {
  const room = client.room;
  if (typeof msg.pid === "string" && accounts.alias[msg.pid]) msg.pid = accounts.alias[msg.pid]; // an id that was merged into another
  switch (msg.t) {
    case "acct-code":
    case "acct-reset":
    case "acct-check":
    case "acct-link":
    case "acct-sync":
      return onAccount(client, msg);
    case "ping":
      return send(client, { t: "pong", c: msg.c, s: now() });
    case "profile":
      if (validPid(msg.pid)) client.pid = msg.pid;
      client.name = cleanName(msg.name);
      client.char = clampInt(msg.char, 0, CHARACTER_COUNT - 1, 0);
      client.kart = clampInt(msg.kart, 0, KART_COUNT - 1, 0);
      client.look = lookOf(client.char, msg.look);
      if (room && room.state === "lobby") sendRoom(room);
      return;
    case "list":
      return send(client, { t: "rooms", list: publicRooms() });
    case "records":
      return send(client, recordsView(msg.pid));
    case "laps":
      return submitLaps(client, msg);
    case "beaten":
      return send(client, beatenView(msg.pid));
    case "gchal-new":
      return newChallenge(client, msg);
    case "gchal-get":
      return send(client, challengeView(msg));
    case "gchal-try":
      return challengeTry(client, msg);
    case "presence":
      return onPresence(client, msg);
    case "challenge":
      return onChallenge(client, msg);
    case "challenge-reply":
      return onChallengeReply(client, msg);
    case "watch":
      return onWatch(client, msg);
    case "cast":
      return onCast(client, msg);
    case "wchat":
      return onWatchChat(client, msg);
    case "wreact":
      return onWatchReact(client, msg);
    case "push-key":
      return send(client, { t: "push-key", key: push.publicKey });
    case "push-sub":
      if (!validPid(msg.pid)) return send(client, { t: "push-ok", ok: false });
      return send(client, { t: "push-ok", ok: push.subscribe(msg.pid, uidOf(msg.pid), msg.sub, msg.prefs) });
    case "push-unsub":
      if (validPid(msg.pid)) push.unsubscribe(msg.pid, typeof msg.endpoint === "string" ? msg.endpoint : null);
      return send(client, { t: "push-ok", ok: true });
    case "ghost":
      return send(client, ghostView(clampInt(msg.track, 0, TRACK_COUNT - 1, 0), msg.board === "runs" ? "runs" : "laps"));
    case "daily":
      return send(client, dailyView(msg.pid));
    case "dailyrun":
      return submitDaily(client, msg);
    case "hello": {
      if (!validPid(msg.pid)) return;
      client.pid = msg.pid;
      const device = ["phone", "tablet", "desktop"].includes(msg.device) ? msg.device : "";
      stats.visit(msg.pid, client.geo, profileFrom(msg), { device, browser: String(msg.browser || "").slice(0, 40), source: typeof msg.src === "string" ? msg.src : "" });
      return send(client, { t: "ok" });
    }
    case "event": {
      // A moment worth counting on the dashboard (finished the tutorial, turned on notifications…)
      if (validPid(msg.pid) && typeof msg.ev === "string") stats.event(msg.pid, client.geo, msg.ev);
      return send(client, { t: "ok" });
    }
    case "race": {
      // Finished offline races (Online results are recorded in endRace).
      if (!validPid(msg.pid) || !["gp", "vs", "tt", "daily"].includes(msg.mode)) return send(client, { t: "ok" });
      const time = Number(msg.time);
      const laps = Array.isArray(msg.laps) ? msg.laps.slice(0, 5).map(Number).filter((t) => Number.isFinite(t) && t > 0 && t < MAX_LAP_S) : [];
      stats.race(msg.pid, client.geo, {
        ...profileFrom(msg),
        mode: msg.mode,
        track: clampInt(msg.track, 0, TRACK_COUNT - 1, 0),
        place: msg.place == null ? null : clampInt(msg.place, 1, MAX_KARTS, null),
        time: Number.isFinite(time) && time > 0 && time < 3600 ? time : null,
        laps,
      });
      return send(client, { t: "ok" });
    }
    case "cup": {
      if (validPid(msg.pid)) stats.cup(msg.pid, client.geo, clampInt(msg.place, 1, MAX_KARTS, null));
      return send(client, { t: "ok" });
    }
    case "feedback":
      return submitFeedback(client, msg);
    case "crash":
      if (validPid(msg.pid)) bugs.report(msg.pid, msg, stats.info(msg.pid), client.geo);
      return send(client, { t: "ok" });
    // The features page: list ideas, post one, vote. Only players the stats know (who've
    // loaded the game) can post or vote.
    case "ideas":
      return send(client, { t: "ideas", list: features.publicView(validPid(msg.pid) ? msg.pid : null), played: validPid(msg.pid) && !!stats.info(msg.pid) });
    case "idea":
      if (!validPid(msg.pid)) return send(client, { t: "idea-ok", ok: false });
      return send(client, { t: "idea-ok", ...features.submit(msg.pid, msg, stats.info(msg.pid), client.geo) });
    case "vote":
      if (!validPid(msg.pid)) return send(client, { t: "idea-ok", ok: false });
      return send(client, { t: "idea-ok", ...features.vote(msg.pid, msg, stats.info(msg.pid), client.geo) });
    case "recname": {
      // Renaming yourself updates your entries on every track and board.
      if (!validPid(msg.pid)) return;
      renamePlayer(msg.pid, cleanName(msg.name));
      return send(client, recordsView(msg.pid));
    }
    case "create":
      createRoom(client, msg.public);
      return;
    case "join": {
      const code = String(msg.code || "").toUpperCase().trim();
      const r = rooms.get(code);
      if (!r) return send(client, { t: "err", msg: `Room ${code || "?"} not found.` });
      return joinRoom(client, r);
    }
    case "quick": {
      const open = [...rooms.values()]
        .filter((r) => r.public && r.players.size < MAX_KARTS)
        .sort((a, b) => (a.state === "lobby" ? 0 : 1) - (b.state === "lobby" ? 0 : 1) || b.players.size - a.players.size);
      if (open.length) return joinRoom(client, open[0]);
      createRoom(client, true);
      return;
    }
    case "leave":
      leaveRoom(client);
      return send(client, { t: "left_room" });
  }

  if (!room) return;

  switch (msg.t) {
    case "ready":
      if (room.state !== "lobby") return;
      client.ready = !!msg.v;
      return sendRoom(room);
    case "rematch": {
      if (room.state !== "lobby" || room.raceNo === 0) return;
      const v = !!msg.v;
      if (v === !!client.rematch) return;
      client.rematch = v;
      if (v && room.players.size > 1) broadcast(room, { t: "chat", sys: true, text: `${client.name} wants a rematch!` });
      if (maybeRematch(room)) return;
      return sendRoom(room);
    }
    case "settings": {
      if (client.id !== room.hostId || room.state !== "lobby") return;
      const s = room.settings;
      if (msg.track !== undefined) s.track = clampInt(msg.track, -1, TRACK_COUNT - 1, 0);
      if (msg.laps !== undefined) s.laps = clampInt(msg.laps, 1, 5, 3);
      if (msg.cc !== undefined) s.cc = [50, 100, 150, 200].includes(Number(msg.cc)) ? Number(msg.cc) : 150;
      if (msg.cpu !== undefined) s.cpu = !!msg.cpu;
      if (msg.items !== undefined) s.items = !!msg.items;
      if (msg.public !== undefined) room.public = !!msg.public;
      return sendRoom(room);
    }
    case "start": {
      if (client.id !== room.hostId || room.state !== "lobby") return;
      const others = [...room.players.values()].filter((p) => p.id !== client.id);
      if (others.some((p) => !p.ready) && !msg.force) {
        return send(client, { t: "err", msg: "Not everyone is ready yet (start again to force)." , notReady: true });
      }
      return startRace(room);
    }
    case "chat": {
      const text = String(msg.text || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120);
      if (!text || now() - client.lastChat < 400) return;
      client.lastChat = now();
      return broadcast(room, { t: "chat", id: client.id, name: client.name, text });
    }
    case "voice": {
      // Voice chat membership. Audio itself flows peer-to-peer over WebRTC.
      const on = !!msg.on;
      const muted = !!msg.muted;
      if (on === client.voice && muted === client.vmuted) return;
      if (on && !client.voice) broadcast(room, { t: "chat", sys: true, text: `${client.name} joined voice chat.` });
      client.voice = on;
      client.vmuted = muted;
      return sendRoom(room);
    }
    case "rtc": {
      // WebRTC signaling relay (offer/answer/ICE) between two voice members of the same room.
      const to = room.players.get(String(msg.to || ""));
      if (!to || to === client || !client.voice || !to.voice || !msg.d || typeof msg.d !== "object") return;
      return send(to, { t: "rtc", from: client.id, d: msg.d });
    }
    case "s": {
      // Kart states: [[id, x, y, z, yaw, vyaw, speed, flags, dist, extra...], ...]
      const race = room.race;
      if (!race || !Array.isArray(msg.d)) return;
      const d = [];
      for (const k of msg.d.slice(0, MAX_KARTS)) {
        if (!Array.isArray(k) || !ownsKart(client, race, k[0])) continue;
        const dist = Number(k[8]);
        if (Number.isFinite(dist)) race.dist.set(k[0], dist);
        d.push(k);
      }
      if (d.length) broadcast(room, { t: "s", d, ts: now() }, client.id);
      return;
    }
    case "ev": {
      if (!room.race || !msg.e || typeof msg.e !== "object" || !EVENT_TYPES.has(msg.e.type)) return;
      return broadcast(room, { t: "ev", from: client.id, e: msg.e }, client.id);
    }
    case "fin": {
      const race = room.race;
      if (!race || race.ended) return;
      const id = String(msg.id || "");
      if (!ownsKart(client, race, id) || race.finishes.has(id)) return;
      const time = Math.max(1, Number(msg.time) || 0);
      race.finishes.set(id, time);
      const place = race.finishes.size;
      broadcast(room, { t: "fin", id, time, place });
      if (!race.firstFinishAt) {
        race.firstFinishAt = now();
        race.timer = setTimeout(() => endRace(room), FINISH_GRACE_MS);
      }
      checkRaceDone(room);
      return;
    }
  }
}

// ---------------------------------------------------------------- server

// ---------------------------------------------------------------- moving house
// The game moved to kartchaos.com, and a browser's saved data (player id, settings, custom
// racer, ghosts…) stays with the old address. The old page POSTs it here, gets a one-time
// token, and sends the player to kartchaos.com/#import=TOKEN, where it's fetched (once).
const moves = new Map(); // token -> { data, at }
const MOVE_TTL_MS = 30 * 60000;
const MOVE_MAX_BYTES = 4 * 1024 * 1024;

function handleMigrate(req, res) {
  const reply = (code, obj) => {
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store, private" });
    res.end(JSON.stringify(obj));
  };
  for (const [k, v] of moves) if (now() - v.at > MOVE_TTL_MS) moves.delete(k);
  if (req.method === "POST") {
    if (moves.size >= 500) return reply(503, { error: "busy" });
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MOVE_MAX_BYTES) req.destroy();
      else chunks.push(c);
    });
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return reply(400, { error: "bad" });
      }
      const data = {};
      for (const [k, v] of Object.entries(body?.data || {})) if (/^ck_[A-Za-z0-9_]{1,48}$/.test(k) && typeof v === "string") data[k] = v;
      const token = randomBytes(18).toString("base64url");
      moves.set(token, { data, at: now() });
      reply(200, { token });
    });
    return;
  }
  const token = new URL(req.url, "http://x").searchParams.get("token");
  const m = token && moves.get(token);
  if (m) moves.delete(token);
  reply(m ? 200 : 404, m ? { data: m.data } : { error: "gone" });
}

const httpServer = createServer((req, res) => {
  // Stats for /chamokart/dashboard. The server only listens on localhost and nginx only
  // proxies this path behind the stats page's password (the public ws route always maps to "/").
  if (req.url === "/stats" && req.method === "POST") {
    // Only the stats page sends this header (a form on another site can't), so its password
    // can't be borrowed by a cross-site request.
    if (req.headers["x-chamo-stats"] !== "1") {
      res.writeHead(403);
      return res.end();
    }
    let body = "";
    req.on("data", (d) => {
      body += d;
      if (body.length > 16384) req.destroy();
    });
    req.on("end", () => {
      let out = { ok: false };
      try {
        out = statsAction(JSON.parse(body));
      } catch {}
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store, private" });
      res.end(JSON.stringify(out));
    });
    return;
  }
  if (req.url === "/stats") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store, private" });
    const fb = [...feedback].reverse();
    res.end(JSON.stringify({ ...stats.view(), records: records.laps, runs: records.runs, feedback: fb, bugs: bugs.view(), ideas: features.view((pid) => stats.info(pid)?.name), pushKey: push.publicKey, adminEndpoints: push.adminEndpoints(), online: { clients: clients.size, rooms: rooms.size }, now: now() }));
    return;
  }
  if (req.url.startsWith("/migrate")) return handleMigrate(req, res);
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ ok: true, clients: clients.size, rooms: rooms.size }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

const wss = new WebSocketServer({ server: httpServer, maxPayload: 256 * 1024 }); // room for a Time Trial ghost upload

wss.on("connection", (socket, req) => {
  const client = {
    id: `p${nextClientId++}`,
    socket,
    geo: geoFromRequest(req),
    pid: null,
    name: "Racer",
    char: 0,
    kart: 0,
    ready: false,
    points: 0,
    wins: 0,
    room: null,
    alive: true,
    lastChat: 0,
    voice: false,
    vmuted: false,
    bucket: 200,
    bucketAt: now(),
  };
  clients.set(client.id, client);
  send(client, { t: "welcome", id: client.id, s: now() });

  socket.on("pong", () => (client.alive = true));
  socket.on("message", (raw) => {
    // Token bucket: 150 msgs/sec sustained is far above what a client needs.
    const t = now();
    client.bucket = Math.min(300, client.bucket + ((t - client.bucketAt) / 1000) * 150);
    client.bucketAt = t;
    if (client.bucket < 1) return;
    client.bucket -= 1;
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    try {
      handle(client, msg);
    } catch (err) {
      console.error("handler error", err);
    }
  });
  const drop = () => {
    if (!clients.has(client.id)) return;
    leaveRoom(client);
    clients.delete(client.id);
    if (client.presence) {
      lastSeen.set(client.uid, now());
      if (client.pid && client.presenceSince) stats.session(client.pid, now() - client.presenceSince); // how long the game was open
      sendPlayers();
      if (client.watching) sendWatchers(client.watching, false);
      // Their last connection closed: anyone watching them hears they've gone
      if (!isOnline(client.uid)) for (const w of watchersOf(client.uid)) send(w, { t: "cast", from: client.uid, k: "gone" });
    }
  };
  socket.on("close", drop);
  socket.on("error", drop);
});

setInterval(() => {
  for (const c of clients.values()) {
    if (!c.alive) {
      c.socket.terminate();
      continue;
    }
    c.alive = false;
    try {
      c.socket.ping();
    } catch {}
  }
}, 20000);

// Push the public room list to everyone browsing (not in a room) every few seconds.
setInterval(() => {
  const list = publicRooms();
  const data = JSON.stringify({ t: "rooms", list });
  for (const c of clients.values()) if (!c.room && !c.presence) send(c, data); // presence connections don't browse rooms
}, 3000);

// The new Daily Challenge, announced once a day (just after midnight UTC) to players who want it
function announceDaily() {
  if (now() - serverStarted < PLAYING_GRACE_MS) return; // let everyone reconnect after a restart first
  const id = dailyId();
  const ch = dailyChallenge(id);
  const winner = daily.days[dailyId(now() - 86400000)]?.[0];
  const racer = CHARACTERS[ch.char]?.custom ? "your Custom racer" : CHARACTERS[ch.char]?.name;
  const n = push.daily(
    id,
    {
      title: "📅 Today's challenge is up!",
      body: `${TRACKS[ch.track]?.name} · ${racer} in the ${KARTS[ch.kart]?.name} · ${ch.cc}cc.${winner ? ` Yesterday's winner: ${winner.name} 🥇` : ""} Can you top the board?`,
      url: SITE + "#daily",
      tag: "daily",
    },
    isOnline
  );
  if (n) console.log(`daily: announced ${id} to ${n} devices`);
}
setInterval(announceDaily, 60000);

httpServer.listen(PORT, HOST, () => console.log(`Kart Chaos server on ${HOST}:${PORT}`));

const shutdown = () => {
  for (const c of clients.values()) c.socket.close(1001, "server restarting");
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
