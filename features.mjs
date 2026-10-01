// Feature ideas from players (the public /chamokart/features page) and their votes.
// When enough different players back an idea, the fixer service (/opt/chamokart-fixer) has
// Claude build it; the owner reviews it on the dashboard and approves it before it goes live.
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";

export const VOTES_TO_BUILD = 2; // different players (on different connections), the idea's author included
const TITLE_MAX = 80;
const TEXT_MAX = 1000;
const IDEAS_PER_PLAYER_PER_DAY = 3;
const IDEAS_PER_DAY = 40;
const VOTES_PER_PLAYER_PER_HOUR = 30;
const IDEAS_KEPT = 500;
// How a build is going (from the fixer) -> what players see
const BUILD_STATE = { queued: "building", running: "building", ready: "review", deployed: "live", "no-fix": "declined", rejected: "declined", "rolled-back": "declined", failed: "open", cancelled: "open", conflict: "review" };

const text = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, max);
const line = (v, max) => text(v, max).replace(/\s+/g, " ");
// Only a hash of the voter's IP address is kept: enough to tell connections apart.
const netOf = (ip) => createHash("sha256").update("chamokart-vote:" + String(ip || "")).digest("base64url").slice(0, 12);

export function createFeatures({ file, notify }) {
  const data = load();
  let saveTimer = null;
  let nextId = data.ideas.reduce((m, i) => Math.max(m, i.id), 0) + 1;
  const voteTimes = new Map(); // pid -> vote times this hour

  function load() {
    try {
      const d = JSON.parse(readFileSync(file, "utf8"));
      return { ideas: Array.isArray(d.ideas) ? d.ideas : [] };
    } catch (err) {
      if (err.code !== "ENOENT") console.error("features: can't read", file, err.message);
      return { ideas: [] };
    }
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        writeFileSync(file + ".tmp", JSON.stringify(data));
        renameSync(file + ".tmp", file);
      } catch (err) {
        console.error("features: can't write", file, err.message);
      }
    }, 500);
  }

  // Backers that count: one per player, and one per connection (two browsers at home count once)
  const backers = (idea) => new Set(idea.votes.map((v) => v.net)).size;
  const get = (id) => data.ideas.find((i) => i.id === id);

  function checkReady(idea) {
    if (idea.state === "open" && !idea.hidden && !idea.wanted && backers(idea) >= VOTES_TO_BUILD) {
      idea.wanted = Date.now(); // the fixer picks it up from here
      notify({ title: "💡 An idea got its votes", body: `Claude will build: ${idea.title}`, url: "/chamokart/dashboard/#idea-" + idea.id, tag: "idea-" + idea.id });
    }
  }

  // What players see: no ids, IP hashes or who voted, just counts and whether *you* voted.
  function publicView(pid) {
    return data.ideas
      .filter((i) => !i.hidden)
      .map((i) => ({ id: i.id, title: i.title, text: i.text, name: i.name, at: i.at, votes: backers(i), voted: i.votes.some((v) => v.pid === pid), mine: i.pid === pid, state: i.state, stateAt: i.stateAt || null }))
      .sort((a, b) => b.at - a.at);
  }

  // `player` is the stats' { name } for this pid: only players who've played can post or vote.
  function submit(pid, msg, player, geo) {
    if (!player) return { ok: false, error: "play" };
    const title = line(msg.title, TITLE_MAX);
    const body = text(msg.text, TEXT_MAX);
    if (title.length < 4) return { ok: false, error: "short" };
    const day = Date.now() - 86400000;
    if (data.ideas.filter((i) => i.pid === pid && i.at > day).length >= IDEAS_PER_PLAYER_PER_DAY || data.ideas.filter((i) => i.at > day).length >= IDEAS_PER_DAY) return { ok: false, error: "slow" };
    const idea = { id: nextId++, at: Date.now(), pid, name: player.name || "Racer", title, text: body, votes: [{ pid, net: netOf(geo?.ip), at: Date.now() }], state: "open", stateAt: null, hidden: false, wanted: null, job: null };
    data.ideas.push(idea);
    while (data.ideas.length > IDEAS_KEPT) {
      const drop = data.ideas.find((i) => i.state === "declined" || i.hidden) || data.ideas.find((i) => i.state !== "live" && i.state !== "building" && i.state !== "review");
      if (!drop) break;
      data.ideas.splice(data.ideas.indexOf(drop), 1);
    }
    save();
    notify({ title: `💡 New idea from ${idea.name}`, body: title, url: "/chamokart/dashboard/#idea-" + idea.id, tag: "idea-new-" + idea.id });
    return { ok: true, id: idea.id };
  }

  function vote(pid, msg, player, geo) {
    if (!player) return { ok: false, error: "play" };
    const idea = get(Number(msg.id));
    if (!idea || idea.hidden) return { ok: false, error: "gone" };
    const now = Date.now();
    const recent = (voteTimes.get(pid) || []).filter((t) => t > now - 3600000);
    if (recent.length >= VOTES_PER_PLAYER_PER_HOUR) return { ok: false, error: "slow" };
    recent.push(now);
    voteTimes.set(pid, recent);
    if (voteTimes.size > 5000) voteTimes.clear();
    const i = idea.votes.findIndex((v) => v.pid === pid);
    if (msg.on && i < 0) idea.votes.push({ pid, net: netOf(geo?.ip), at: now });
    else if (!msg.on && i >= 0 && idea.pid !== pid) idea.votes.splice(i, 1); // authors keep their own vote
    checkReady(idea);
    save();
    return { ok: true };
  }

  // The dashboard: everything, including who voted.
  function view(nameOf) {
    return [...data.ideas]
      .sort((a, b) => b.at - a.at)
      .map(({ votes, ...i }) => ({ ...i, backers: backers({ votes }), voters: votes.map((v) => nameOf(v.pid) || "someone") }));
  }

  // The dashboard's buttons, and the fixer's build updates
  function action(a) {
    const idea = get(a.id);
    if (!idea) return { ok: false };
    switch (a.action) {
      case "idea-hide":
        idea.hidden = !!a.hidden;
        break;
      case "idea-delete":
        data.ideas.splice(data.ideas.indexOf(idea), 1);
        break;
      case "idea-build": {
        // From the fixer: how the build is going
        const state = BUILD_STATE[a.status];
        if (!state) return { ok: false };
        idea.job = { id: line(a.job, 40), status: a.status, at: Date.now() };
        // A failed or cancelled build goes back to "open" but isn't retried on its own: the fixer
        // builds an idea by itself only once, then it's the owner's call (🔧 Build now).
        if (idea.state !== state) (idea.state = state), (idea.stateAt = Date.now());
        if (a.status === "ready") notify({ title: "✅ Feature ready to review", body: idea.title, url: "/chamokart/dashboard/#idea-" + idea.id, tag: "idea-" + idea.id });
        if (a.status === "no-fix") notify({ title: "🔎 Claude passed on an idea", body: idea.title, url: "/chamokart/dashboard/#idea-" + idea.id, tag: "idea-" + idea.id });
        break;
      }
      default:
        return { ok: false };
    }
    save();
    return { ok: true };
  }

  return { publicView, submit, vote, view, action, get };
}
