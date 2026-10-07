// Web push notifications for players who aren't in the game: "Ana is playing", challenges,
// "your record was beaten" and the new Daily Challenge. Each device picks which kinds it wants
// (prefs: playing, beaten, daily; missing means yes; challenges always come through).
// Players opt in from the Players screen. Each browser's push subscription is stored by its
// endpoint, with the player's private id (pid) and public id (uid): a player linked on several
// devices (player codes) gets notified on each of them.
import webpush from "web-push";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

const PLAYING_EVERY_MS = 30 * 60000; // at most one "X is playing" notification per half hour
const BEATEN_EVERY_MS = 5 * 60000; // a burst of passes on the boards makes one buzz, not five
const PREF_KINDS = ["playing", "beaten", "daily"];
const MAX_SUBS = 500;

export function createPush({ dir, subject, site = "/" }) {
  const keysFile = join(dir, "vapid.json");
  const subsFile = join(dir, "push.json");
  const metaFile = join(dir, "push-meta.json"); // { daily: the last Daily Challenge announced }
  let meta = null;
  try {
    meta = JSON.parse(readFileSync(metaFile, "utf8"));
  } catch {}
  let keys;
  try {
    keys = JSON.parse(readFileSync(keysFile, "utf8"));
  } catch {
    keys = webpush.generateVAPIDKeys();
    writeFileSync(keysFile, JSON.stringify(keys), { mode: 0o600 });
  }
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);

  let subs = {}; // endpoint -> { pid, uid, sub, at, lastPlaying }
  try {
    const raw = JSON.parse(readFileSync(subsFile, "utf8"));
    // Older files were keyed by pid (one device per player)
    for (const [k, e] of Object.entries(raw)) subs[e.sub?.endpoint || k] = e.pid ? e : { ...e, pid: k };
  } catch (err) {
    if (err.code !== "ENOENT") console.error("push: can't read", subsFile, err.message);
  }
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        writeFileSync(subsFile + ".tmp", JSON.stringify(subs));
        renameSync(subsFile + ".tmp", subsFile);
      } catch (err) {
        console.error("push: can't write", subsFile, err.message);
      }
    }, 500);
  };

  const validSub = (s) =>
    s && typeof s.endpoint === "string" && s.endpoint.startsWith("https://") && s.endpoint.length < 1000 &&
    typeof s.keys?.p256dh === "string" && s.keys.p256dh.length < 200 && typeof s.keys?.auth === "string" && s.keys.auth.length < 100;

  async function send(key, payload, ttl) {
    const e = subs[key];
    if (!e) return false;
    if (process.env.PUSH_LOG) console.log("push:", JSON.stringify(payload)); // tests only
    try {
      await webpush.sendNotification(e.sub, JSON.stringify(payload), { TTL: ttl });
      return true;
    } catch (err) {
      // Gone or expired: the browser dropped the subscription.
      if (err.statusCode === 404 || err.statusCode === 410) {
        delete subs[key];
        save();
      } else console.error("push: send failed", err.statusCode || err.message);
      return false;
    }
  }

  return {
    publicKey: keys.publicKey,

    subscribe(pid, uid, sub, prefs) {
      if (!validSub(sub)) return false;
      const key = sub.endpoint;
      if (!subs[key] && Object.keys(subs).length >= MAX_SUBS) return false;
      const clean = {};
      for (const k of PREF_KINDS) clean[k] = prefs && typeof prefs === "object" && prefs[k] === false ? false : true;
      subs[key] = { pid, uid, admin: subs[key]?.admin || undefined, prefs: clean, sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, at: Date.now(), lastPlaying: subs[key]?.lastPlaying || 0, lastBeaten: subs[key]?.lastBeaten || 0 };
      save();
      return true;
    },

    // This device (endpoint), or every device of the player when we don't know which.
    // A device that also gets the stats page's feedback pings keeps those.
    unsubscribe(pid, endpoint) {
      let changed = false;
      for (const [k, e] of Object.entries(subs))
        if (e.pid === pid && (!endpoint || k === endpoint)) {
          if (e.admin) e.pid = e.uid = null;
          else delete subs[k];
          changed = true;
        }
      if (changed) save();
    },

    // Feedback pings for the game's owner, turned on from the stats page (same browser
    // subscription as the game's, so one device entry can be both)
    adminSubscribe(sub) {
      if (!validSub(sub)) return false;
      const key = sub.endpoint;
      if (!subs[key] && Object.keys(subs).length >= MAX_SUBS) return false;
      subs[key] = { pid: null, uid: null, lastPlaying: 0, ...subs[key], admin: true, sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, at: Date.now() };
      save();
      return true;
    },

    adminUnsubscribe(endpoint) {
      const e = subs[endpoint];
      if (!e?.admin) return;
      if (e.pid) delete e.admin;
      else delete subs[endpoint];
      save();
    },

    adminEndpoints: () => Object.entries(subs).filter(([, e]) => e.admin).map(([k]) => k),

    admins(payload) {
      for (const [key, e] of Object.entries(subs)) if (e.admin) send(key, payload, 3600);
    },

    subscribed: (pid) => Object.values(subs).some((e) => e.pid === pid),

    // Two ids became one player (player codes)
    merge(from, to, uid) {
      let changed = false;
      for (const e of Object.values(subs))
        if (e.pid === from) {
          e.pid = to;
          e.uid = uid;
          changed = true;
        }
      if (changed) save();
    },
    reachable: (uid) => Object.values(subs).some((e) => e.uid === uid),

    // A challenge for someone who isn't in the game.
    async challenge(uid, payload) {
      let sent = false;
      for (const [key, e] of Object.entries(subs)) if (e.uid === uid) sent = (await send(key, payload, 300)) || sent;
      return sent;
    },

    // Something about one player (their record was beaten…), to each of their devices that
    // wants that kind. "beaten" buzzes at most every few minutes per device.
    notify(pid, kind, payload, ttl = 6 * 3600) {
      const now = Date.now();
      let changed = false;
      for (const [key, e] of Object.entries(subs)) {
        if (e.pid !== pid || e.prefs?.[kind] === false) continue;
        if (kind === "beaten") {
          if (now - (e.lastBeaten || 0) < BEATEN_EVERY_MS) continue;
          e.lastBeaten = now;
          changed = true;
        }
        send(key, payload, ttl);
      }
      if (changed) save();
    },

    // The new Daily Challenge, once per day, to everyone who wants it and isn't playing.
    // The first time ever it only remembers today, so a deploy doesn't announce a day that's
    // half over.
    daily(id, payload, isOnline) {
      if (meta?.daily === id) return 0;
      const first = !meta;
      meta = { ...meta, daily: id };
      try {
        writeFileSync(metaFile + ".tmp", JSON.stringify(meta));
        renameSync(metaFile + ".tmp", metaFile);
      } catch (err) {
        console.error("push: can't write", metaFile, err.message);
      }
      if (first) return 0;
      let n = 0;
      for (const [key, e] of Object.entries(subs)) {
        if (!e.pid || e.prefs?.daily === false || isOnline(e.uid)) continue;
        send(key, payload, 12 * 3600);
        n++;
      }
      return n;
    },

    // Someone just started playing: tell everyone else who opted in (and isn't playing).
    playing(fromUid, name, isOnline) {
      const now = Date.now();
      for (const [key, e] of Object.entries(subs)) {
        if (!e.pid || e.prefs?.playing === false || e.uid === fromUid || isOnline(e.uid) || now - e.lastPlaying < PLAYING_EVERY_MS) continue;
        e.lastPlaying = now;
        send(key, { title: `🏁 ${name} is playing Kart Chaos`, body: "Jump in and challenge them to a race!", url: site, tag: "playing" }, 600);
      }
      save();
    },
  };
}
