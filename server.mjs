// Chamo Kart multiplayer server.
// Rooms + lobbies + race orchestration. Karts are simulated by their owning
// client; this server relays state/events, keeps the race clock and decides
// the official results.
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8792);

const TRACK_COUNT = 5;
const MAX_KARTS = 8;
const CHARACTER_COUNT = 8;
const KART_COUNT = 3;
const POINTS = [15, 12, 10, 8, 6, 4, 2, 1];
const START_DELAY_MS = 6500; // time from "race" message to GO (loading + intro + countdown)
const FINISH_GRACE_MS = 30000; // after the first finisher, everybody else has this long
const ALL_HUMANS_DONE_MS = 3500; // after the last human finishes
const EVENT_TYPES = new Set(["spawn", "hit", "box", "bolt", "splat"]);
const BOT_NAMES = ["Chamo", "agenteintermediario", "Paco", "Nena", "El Toro", "Pollito", "Luchador", "Calavera"];

const clients = new Map(); // id -> client
const rooms = new Map(); // code -> room
let nextClientId = 1;

// ---------------------------------------------------------------- helpers

const now = () => Date.now();
const clampInt = (v, lo, hi, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};
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
  for (const h of humans) grid.push({ id: h.id, name: h.name, char: h.char, kart: h.kart, bot: false, owner: h.id });

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

// ---------------------------------------------------------------- messages

function handle(client, msg) {
  const room = client.room;
  switch (msg.t) {
    case "ping":
      return send(client, { t: "pong", c: msg.c, s: now() });
    case "profile":
      client.name = cleanName(msg.name);
      client.char = clampInt(msg.char, 0, CHARACTER_COUNT - 1, 0);
      client.kart = clampInt(msg.kart, 0, KART_COUNT - 1, 0);
      if (room && room.state === "lobby") sendRoom(room);
      return;
    case "list":
      return send(client, { t: "rooms", list: publicRooms() });
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
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ ok: true, clients: clients.size, rooms: rooms.size }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

const wss = new WebSocketServer({ server: httpServer, maxPayload: 16 * 1024 });

wss.on("connection", (socket) => {
  const client = {
    id: `p${nextClientId++}`,
    socket,
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
  for (const c of clients.values()) if (!c.room) send(c, data);
}, 3000);

httpServer.listen(PORT, HOST, () => console.log(`Chamo Kart server on ${HOST}:${PORT}`));

const shutdown = () => {
  for (const c of clients.values()) c.socket.close(1001, "server restarting");
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
