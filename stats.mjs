// Player stats for the private /stats page: visits, races, results and where
// players connect from. Players are keyed by the anonymous id their browser
// keeps (localStorage ck_pid), the same one the fastest-lap boards use.
import { readFileSync, writeFileSync, renameSync } from "node:fs";

const MODES = ["gp", "vs", "tt", "daily", "online"];
const IP_HISTORY = 5;
const DAYS_KEPT = 400; // a year and a bit: daily, weekly and monthly charts on the dashboard
const MAX_SESSION_S = 4 * 3600; // a tab left open all night isn't 9 hours of play
// Moments in a player's life worth counting (see the "event" message in server.mjs)
export const EVENTS = ["tutorial-start", "tutorial-done", "custom-saved", "notify-on", "share", "invite", "watch", "challenge", "ghost-challenge", "feedback"];

export function createStats({ file, trackCount, charCount, kartCount }) {
  const zeros = (n) => Array(n).fill(0);
  const data = load();
  let saveTimer = null;

  function load() {
    try {
      const d = JSON.parse(readFileSync(file, "utf8"));
      return { players: d.players || {}, days: d.days || {} };
    } catch (err) {
      if (err.code !== "ENOENT") console.error("stats: can't read", file, err.message);
      return { players: {}, days: {} };
    }
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        writeFileSync(file + ".tmp", JSON.stringify(data));
        renameSync(file + ".tmp", file);
      } catch (err) {
        console.error("stats: can't write", file, err.message);
      }
    }, 2000);
  }

  // One record per UTC day. Days from before 2026-10-07 only have visits, races and pids;
  // the rest fill in from then on.
  const today = () => new Date().toISOString().slice(0, 10);
  function day() {
    const d = today();
    if (!data.days[d]) {
      data.days[d] = { visits: 0, races: 0, pids: [] };
      const keys = Object.keys(data.days).sort();
      while (keys.length > DAYS_KEPT) delete data.days[keys.shift()];
    }
    const r = data.days[d];
    r.hours ||= zeros(24); // visits by UTC hour
    r.sessions ||= 0;
    r.playTime ||= 0; // seconds with the game open
    for (const k of ["sources", "countries", "devices", "modes", "tracks", "events", "playerRaces"]) r[k] ||= {};
    r.peak ||= 0; // most players online at once
    return r;
  }
  const bump = (obj, key, n = 1) => (obj[key] = (obj[key] || 0) + n);
  // Where a visit came from: ?s= on our own shared links, a utm_source, or the referring site
  const cleanSource = (v) => String(v || "").toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9.-]/g, "").slice(0, 40) || "direct";

  function player(pid) {
    let p = data.players[pid];
    if (!p) {
      p = data.players[pid] = {
        pid,
        name: "Racer",
        char: 0,
        kart: 0,
        first: Date.now(),
        last: Date.now(),
        visits: 0,
        device: "",
        browser: "",
        ip: "",
        country: "",
        city: "",
        region: "",
        ips: [],
        races: Object.fromEntries(MODES.map((m) => [m, 0])),
        wins: 0,
        podiums: 0,
        finished: 0,
        raceTime: 0,
        laps: 0,
        tracks: zeros(trackCount),
        chars: zeros(charCount),
        karts: zeros(kartCount),
        cups: { played: 0, won: 0 },
        online: { races: 0, wins: 0, points: 0 },
        bestLap: Array(trackCount).fill(null),
        bestRace: Array(trackCount).fill(null),
      };
    }
    return p;
  }

  // Where this connection comes from, per Cloudflare's headers (see touch()).
  function locate(p, geo) {
    if (!geo?.ip) return;
    Object.assign(p, { ip: geo.ip, country: geo.country || p.country, city: geo.city || p.city, region: geo.region || p.region });
    p.ips = p.ips.filter((e) => e.ip !== geo.ip);
    p.ips.unshift({ ip: geo.ip, country: geo.country, city: geo.city, region: geo.region, at: Date.now() });
    p.ips.length = Math.min(p.ips.length, IP_HISTORY);
  }

  function touch(pid, geo, profile) {
    const p = player(pid);
    p.last = Date.now();
    locate(p, geo);
    if (profile?.name) p.name = profile.name;
    if (Number.isInteger(profile?.char)) p.char = profile.char;
    if (Number.isInteger(profile?.kart)) p.kart = profile.kart;
    const d = day();
    if (!d.pids.includes(pid)) {
      d.pids.push(pid);
      if (geo?.country) bump(d.countries, geo.country); // players per country that day
    }
    return p;
  }

  return {
    visit(pid, geo, profile, client) {
      const d = day();
      const firstToday = !d.pids.includes(pid);
      const p = touch(pid, geo, profile);
      p.visits++;
      if (client?.device) p.device = client.device;
      if (client?.browser) p.browser = client.browser;
      d.visits++;
      d.hours[new Date().getUTCHours()]++;
      const src = cleanSource(client?.source);
      bump(d.sources, src);
      p.source ||= src; // how they first found the game
      if (firstToday) bump(d.devices, p.device || "unknown");
      save();
    },

    // The game was open for this long (one presence connection)
    session(pid, ms) {
      const p = data.players[pid];
      const s = Math.min(MAX_SESSION_S, Math.round(ms / 1000));
      if (!p || s < 3) return;
      const d = day();
      d.sessions++;
      d.playTime += s;
      p.sessions = (p.sessions || 0) + 1;
      p.playTime = (p.playTime || 0) + s;
      save();
    },

    event(pid, geo, name) {
      if (!EVENTS.includes(name)) return;
      const p = touch(pid, geo);
      bump(day().events, name);
      p.events ||= {};
      bump(p.events, name);
      save();
    },

    // Players online right now (the busiest moment of the day is kept)
    online(n) {
      const d = day();
      if (n > d.peak) {
        d.peak = n;
        save();
      }
    },

    // One finished race. place/of are null when there's no ranking (Time Trial).
    race(pid, geo, r) {
      const p = touch(pid, geo, r);
      if (!MODES.includes(r.mode)) return;
      p.races[r.mode] = (p.races[r.mode] || 0) + 1; // players from before a mode existed lack its key
      p.tracks[r.track] = (p.tracks[r.track] || 0) + 1; // players from before a track existed lack its slot
      p.chars[r.char]++;
      p.karts[r.kart]++;
      if (r.place === 1) p.wins++;
      if (r.place && r.place <= 3) p.podiums++;
      if (r.time) {
        p.finished++;
        p.raceTime += r.time;
      }
      p.laps += r.laps.length;
      if (r.laps.length) {
        const best = Math.min(...r.laps);
        if (r.mode === "tt" && (p.bestLap[r.track] == null || best < p.bestLap[r.track])) p.bestLap[r.track] = best;
      }
      if (r.mode === "tt" && r.time && (p.bestRace[r.track] == null || r.time < p.bestRace[r.track])) p.bestRace[r.track] = r.time;
      if (r.mode === "online") {
        p.online.races++;
        p.online.points += r.pts || 0;
        if (r.place === 1) p.online.wins++;
      }
      const d = day();
      d.races++;
      bump(d.modes, r.mode);
      bump(d.tracks, r.track);
      bump(d.playerRaces, pid);
      save();
    },

    cup(pid, geo, place) {
      const p = touch(pid, geo);
      p.cups.played++;
      if (place === 1) p.cups.won++;
      save();
    },

    view() {
      return { players: Object.values(data.players), days: data.days };
    },

    // A player's name and racer, if we've seen them (nothing is created)
    info(pid) {
      const p = data.players[pid];
      return p ? { name: p.name, char: p.char } : null;
    },

    // Two ids turned out to be the same player (linked with a player code): fold `from` into `to`.
    merge(from, to) {
      if (from === to) return;
      for (const d of Object.values(data.days)) {
        if (d.playerRaces?.[from]) {
          d.playerRaces[to] = (d.playerRaces[to] || 0) + d.playerRaces[from];
          delete d.playerRaces[from];
        }
        const i = d.pids.indexOf(from);
        if (i < 0) continue;
        if (d.pids.includes(to)) d.pids.splice(i, 1);
        else d.pids[i] = to;
      }
      const b = data.players[from];
      if (!b) return save();
      delete data.players[from];
      const a = data.players[to];
      if (!a) {
        data.players[to] = Object.assign(b, { pid: to });
        return save();
      }
      const sumArr = (x = [], y = []) => Array.from({ length: Math.max(x.length, y.length) }, (_, i) => (x[i] || 0) + (y[i] || 0));
      const minArr = (x = [], y = []) => Array.from({ length: Math.max(x.length, y.length) }, (_, i) => (x[i] == null ? y[i] ?? null : y[i] == null ? x[i] : Math.min(x[i], y[i])));
      const newer = b.last > a.last ? b : a;
      Object.assign(a, {
        first: Math.min(a.first, b.first),
        last: Math.max(a.last, b.last),
        visits: a.visits + b.visits,
        device: newer.device || a.device,
        browser: newer.browser || a.browser,
        ip: newer.ip || a.ip,
        country: newer.country || a.country,
        city: newer.city || a.city,
        region: newer.region || a.region,
        ips: [...a.ips, ...b.ips].filter((e, i, all) => all.findIndex((x) => x.ip === e.ip) === i).sort((x, y) => y.at - x.at).slice(0, IP_HISTORY),
        races: Object.fromEntries(MODES.map((m) => [m, (a.races[m] || 0) + (b.races[m] || 0)])),
        wins: a.wins + b.wins,
        podiums: a.podiums + b.podiums,
        finished: a.finished + b.finished,
        raceTime: a.raceTime + b.raceTime,
        laps: a.laps + b.laps,
        tracks: sumArr(a.tracks, b.tracks),
        chars: sumArr(a.chars, b.chars),
        karts: sumArr(a.karts, b.karts),
        cups: { played: a.cups.played + b.cups.played, won: a.cups.won + b.cups.won },
        online: { races: a.online.races + b.online.races, wins: a.online.wins + b.online.wins, points: a.online.points + b.online.points },
        bestLap: minArr(a.bestLap, b.bestLap),
        bestRace: minArr(a.bestRace, b.bestRace),
        sessions: (a.sessions || 0) + (b.sessions || 0),
        playTime: (a.playTime || 0) + (b.playTime || 0),
        source: a.first <= b.first ? a.source || b.source : b.source || a.source,
        events: Object.fromEntries([...new Set([...Object.keys(a.events || {}), ...Object.keys(b.events || {})])].map((k) => [k, (a.events?.[k] || 0) + (b.events?.[k] || 0)])),
      });
      save();
    },
  };
}

// Cloudflare sits in front of nginx: it passes the visitor's IP and location as
// request headers, which nginx forwards to this server untouched.
export function geoFromRequest(req) {
  const h = req.headers;
  const clean = (v) => (typeof v === "string" ? v.slice(0, 80) : "");
  const country = clean(h["cf-ipcountry"]).toUpperCase();
  return {
    ip: clean(h["cf-connecting-ip"] || h["x-real-ip"] || req.socket.remoteAddress),
    country: /^[A-Z]{2}$/.test(country) && country !== "XX" ? country : "",
    city: clean(h["cf-ipcity"]),
    region: clean(h["cf-region"]),
  };
}
