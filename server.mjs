// Chamo Kart multiplayer server.
// Rooms + lobbies + race orchestration. Karts are simulated by their owning
// client; this server relays state/events, keeps the race clock and decides
// the official results.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { createHash, randomInt } from "node:crypto";
import { createStats, geoFromRequest } from "./stats.mjs";
import { createPush } from "./push.mjs";
import { dailyChallenge, dailyId, isDailyId, DAILY_LAPS } from "./js/daily.js";
import { CUSTOM, cleanLook } from "./js/look.js";

const HOST = process.env.HOST || "127.0.0.1";
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
const BOT_NAMES = ["Chamo", "agenteintermediario", "Spider-Man", "Lucas", "Bumblebee", "Chicky", "Dorito", "Skully"];

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
// Ghosts belong to the lap board.
function boardView(board, pid) {
  return records[board].map((list, track) =>
    list.map((e) => ({ name: e.name, char: e.char, kart: e.kart, look: e.look, time: e.time, laps: e.laps, at: e.at, mine: e.pid === pid || undefined, ghost: (board === "laps" && ghosts.has(ghostKey(track, e.pid))) || undefined }))
  );
}
const recordsView = (pid, extra) => ({ t: "records", laps: boardView("laps", pid), runs: boardView("runs", pid), ...extra });

// Puts a player's time on a board if it beats their entry, keeping the top RECORDS_TOP.
// Returns whether the entry improved, and calls onDrop for entries that fall off.
function recordTime(list, pid, time, fields, onDrop) {
  let entry = list.find((e) => e.pid === pid);
  if (entry && time >= entry.time) return false;
  if (!entry) list.push((entry = { pid }));
  Object.assign(entry, fields, { time, at: now() });
  list.sort((a, b) => a.time - b.time);
  for (const e of list.slice(RECORDS_TOP)) onDrop?.(e);
  list.length = Math.min(list.length, RECORDS_TOP);
  return true;
}

// ---------------------------------------------------------------- ghosts

const ghostKey = (track, pid) => `${track}-${pid}`; // pids are checked by validPid, so this is a safe file name
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

function saveGhost(track, entry, g) {
  const key = ghostKey(track, entry.pid);
  try {
    const file = join(GHOST_DIR, key + ".json");
    writeFileSync(file + ".tmp", JSON.stringify({ char: entry.char, kart: entry.kart, look: entry.look, time: Math.round(Number(g.time) * 1000) / 1000, frames: g.frames }));
    renameSync(file + ".tmp", file);
    ghosts.add(key);
  } catch (err) {
    console.error("ghosts: can't write", key, err.message);
  }
}

function dropGhost(track, pid) {
  const key = ghostKey(track, pid);
  if (!ghosts.delete(key)) return;
  try {
    unlinkSync(join(GHOST_DIR, key + ".json"));
  } catch {}
}

// The best-ranked ghost on a track's board (normally #1's).
function ghostView(track) {
  const list = records.laps[track] || [];
  const i = list.findIndex((e) => ghosts.has(ghostKey(track, e.pid)));
  if (i < 0) return { t: "ghost", track, none: true };
  const e = list[i];
  try {
    const g = JSON.parse(readFileSync(join(GHOST_DIR, ghostKey(track, e.pid) + ".json"), "utf8"));
    return { t: "ghost", track, rank: i + 1, name: e.name, char: g.char, kart: g.kart, look: lookOf(g.char, g.look), lap: e.time, time: g.time, frames: g.frames };
  } catch {
    return { t: "ghost", track, none: true };
  }
}

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
    if (recordTime(lapList, msg.pid, round(Math.min(...times)), racer, (e) => dropGhost(track, e.pid))) {
      changed = true;
      // The run this lap came from becomes the entry's ghost (or it has none).
      const entry = lapList.find((e) => e.pid === msg.pid);
      if (entry) {
        if (validGhost(msg.ghost, msg.laps)) saveGhost(track, entry, msg.ghost);
        else dropGhost(track, entry.pid);
      }
    }
  }
  // Only a complete Time Trial with every lap plausible counts as a full race.
  if (all.length === TT_LAPS && times.length === TT_LAPS) {
    const laps = times.map(round);
    if (recordTime(records.runs[track], msg.pid, round(times.reduce((a, b) => a + b, 0)), { ...racer, laps })) changed = true;
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
        if (board === "laps") dropGhost(track, lose.pid);
      }
      if (keepB) {
        if (board === "laps") moveGhost(track, from, to);
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

function moveGhost(track, from, to) {
  const a = ghostKey(track, from), b = ghostKey(track, to);
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
  push.admins({ title: `💬 Feedback from ${entry.name}`, body: text.slice(0, 140), url: "/chamokart/stats/#feedback", tag: "feedback-" + entry.id });
  send(client, { t: "ok", ok: true });
}

// The stats page's buttons (POST to /chamokart/stats/data, behind its password)
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

const push = createPush({ dir: STATE_DIR, subject: "https://jgrivera.com/chamokart/" });
const serverStarted = now();
const PLAYING_GRACE_MS = 5 * 60000; // after a restart everyone reconnects: don't announce them all
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
    out.mode = ["gp", "vs", "tt", "daily", "tutorial"].includes(st.mode) ? st.mode : "vs";
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
    const data = JSON.stringify({ t: "players", list: playersView() });
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
  } else if (await push.challenge(to, { title: `⚔️ ${client.name} challenges you!`, body: "Tap to join their room and race.", url: `/chamokart/#room=${room.code}`, tag: "challenge" })) {
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
    case "push-key":
      return send(client, { t: "push-key", key: push.publicKey });
    case "push-sub":
      if (!validPid(msg.pid)) return send(client, { t: "push-ok", ok: false });
      return send(client, { t: "push-ok", ok: push.subscribe(msg.pid, uidOf(msg.pid), msg.sub) });
    case "push-unsub":
      if (validPid(msg.pid)) push.unsubscribe(msg.pid, typeof msg.endpoint === "string" ? msg.endpoint : null);
      return send(client, { t: "push-ok", ok: true });
    case "ghost":
      return send(client, ghostView(clampInt(msg.track, 0, TRACK_COUNT - 1, 0)));
    case "daily":
      return send(client, dailyView(msg.pid));
    case "dailyrun":
      return submitDaily(client, msg);
    case "hello": {
      if (!validPid(msg.pid)) return;
      client.pid = msg.pid;
      const device = ["phone", "tablet", "desktop"].includes(msg.device) ? msg.device : "";
      stats.visit(msg.pid, client.geo, profileFrom(msg), { device, browser: String(msg.browser || "").slice(0, 40) });
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

const httpServer = createServer((req, res) => {
  // Stats for /chamokart/stats. The server only listens on localhost and nginx only
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
    res.end(JSON.stringify({ ...stats.view(), records: records.laps, runs: records.runs, feedback: fb, pushKey: push.publicKey, adminEndpoints: push.adminEndpoints(), online: { clients: clients.size, rooms: rooms.size }, now: now() }));
    return;
  }
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

httpServer.listen(PORT, HOST, () => console.log(`Chamo Kart server on ${HOST}:${PORT}`));

const shutdown = () => {
  for (const c of clients.values()) c.socket.close(1001, "server restarting");
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
