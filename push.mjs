// Web push notifications: "Ana is playing" and challenges for players who aren't in the game.
// Players opt in from the Players screen. Each browser's push subscription is stored by its
// endpoint, with the player's private id (pid) and public id (uid): a player linked on several
// devices (player codes) gets notified on each of them.
import webpush from "web-push";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

const PLAYING_EVERY_MS = 30 * 60000; // at most one "X is playing" notification per half hour
const MAX_SUBS = 500;

export function createPush({ dir, subject }) {
  const keysFile = join(dir, "vapid.json");
  const subsFile = join(dir, "push.json");
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

    subscribe(pid, uid, sub) {
      if (!validSub(sub)) return false;
      const key = sub.endpoint;
      if (!subs[key] && Object.keys(subs).length >= MAX_SUBS) return false;
      subs[key] = { pid, uid, admin: subs[key]?.admin || undefined, sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, at: Date.now(), lastPlaying: subs[key]?.lastPlaying || 0 };
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

    // Someone just started playing: tell everyone else who opted in (and isn't playing).
    playing(fromUid, name, isOnline) {
      const now = Date.now();
      for (const [key, e] of Object.entries(subs)) {
        if (!e.pid || e.uid === fromUid || isOnline(e.uid) || now - e.lastPlaying < PLAYING_EVERY_MS) continue;
        e.lastPlaying = now;
        send(key, { title: `🏁 ${name} is playing Chamo Kart`, body: "Jump in and challenge them to a race!", url: "/chamokart/", tag: "playing" }, 600);
      }
      save();
    },
  };
}
