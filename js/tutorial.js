// The interactive tutorial: a lap-by-lap coach on Chamo Circuit. Each step asks for one thing
// (drift, grab coins, hold a banana behind you…), watches the race for it, cheers and moves on.
// Things you have to drive to (boxes, boosters, the ramp) get a distance and a minimap marker.
import { audio } from "./audio.js?v=11";
import { input } from "./input.js?v=6";

const $ = (s) => document.querySelector(s);
const DONE_PAUSE = 1.4; // seconds the "✓ Nice!" stays up before the next step

// Controls as the player sees them (touch buttons or keys)
const K = (touch, keys) => (input.touchMode ? `<span class="tk">${touch}</span>` : keys.map((k) => `<kbd>${k}</kbd>`).join(""));
const DRIFT = () => K("DRIFT", ["Space"]);
const ITEM = () => K("ITEM", ["E"]);

const STEPS = [
  {
    id: "go",
    title: "Let's drive!",
    text: () => (input.touchMode ? "Your kart speeds up on its own. Drag the pad left and right to steer." : `Hold ${K("", ["↑"])} to speed up.`),
    check: (s, k) => k.fwdSpeed > 14,
  },
  {
    id: "steer",
    title: "Steer",
    text: () => (input.touchMode ? "Drag the pad to follow the road. Grass slows you down, so stay on the track!" : `Steer with ${K("", ["←", "→"])} and follow the road. Grass slows you down!`),
    need: 60, // samples of track driven
    progress: (s, k) => k.dist - s.startDist,
  },
  {
    id: "coins",
    title: "Grab 3 coins 🪙",
    text: () => "Every coin raises your top speed a little (up to 10). Getting hit makes you drop some.",
    need: 3,
    on: { coin: 1 },
    target: (sim) => sim.items.coins.filter((c) => c.active),
  },
  {
    id: "drift",
    title: "Drift!",
    text: () => `Hold ${DRIFT()} while you turn. Your kart hops and slides round the corner.`,
    need: 1.2, // seconds
    progress: (s, k, dt) => (s.acc += k.drifting && k.grounded ? dt : 0),
  },
  {
    id: "turbo",
    title: "Mini-turbo 🔥",
    text: () => `Keep drifting until the sparks turn <b class="c-blue">blue</b>, then <b class="c-orange">orange</b>, and let go of ${DRIFT()} for a burst of speed. The longer the drift, the bigger the boost!`,
    check: (s, k, e) => e.some((x) => x.startsWith("miniturbo")),
  },
  {
    id: "box",
    title: "Item boxes",
    text: () => "Drive through a rainbow box to get an item.",
    target: (sim) => sim.items.boxes.filter((b) => b.active && Math.abs(b.lat) < 3), // the middle box of each row
    check: (s, k) => !!k.item || k.roulette > 0,
  },
  {
    id: "banana",
    title: "Banana shield 🍌",
    text: () => `Here's a banana. <b>Hold</b> ${ITEM()} to drag it behind you: it blocks shells from behind! Let go to drop it on the road.`,
    give: "banana",
    check: (s, k, e, dt) => {
      if (k.trailId) s.acc += dt;
      if (!e.includes("use:banana")) return false;
      if (s.acc > 0.3) return true;
      s.retry = "Nearly! Keep holding the button for a moment before you let go.";
      return "again";
    },
  },
  {
    id: "coco",
    title: "Throw a shell",
    text: () => `A green shell circles you as a shield. <b>Tap</b> ${ITEM()} to throw it forward${input.touchMode ? ", or hold ◀◀ as you throw to fire it backwards" : `, or hold ${K("", ["↓"])} as you throw to fire it backwards`}.`,
    give: "green",
    check: (s, k, e) => e.includes("use:green"),
  },
  {
    id: "pad",
    title: "Speed boosters ⚡",
    text: () => "Drive over the yellow striped strips on the road for a free boost.",
    target: (sim) => sim.track.boosts.map((b) => ({ i: b.i, ...sim.track.pointAt(b.i, b.lat * sim.track.hw[b.i]) })),
    check: (s, k, e) => e.includes("pad"),
  },
  {
    id: "trick",
    title: "Ramp trick 🤸",
    text: () => `Fly off the ramp and tap ${DRIFT()} while you're in the air. Do a trick and you land with a boost!`,
    target: (sim) => sim.track.ramps.map((i) => ({ i, x: sim.track.px[i], z: sim.track.pz[i] })),
    check: (s, k, e) => e.includes("trick"),
    miss: (s, k, e) => e.includes("land") && s.air && "So close! Tap it right after you leave the ramp. Next lap!",
  },
];

export class Tutorial {
  constructor(session, onDone) {
    this.session = session;
    this.onDone = onDone;
    this.i = -1;
    this.doneT = 0;
    this.finished = false;
    this.el = $("#tutorial-ui");
    this.el.classList.add("on");
    document.body.classList.add("tutorial");
    this.next();
  }

  get step() {
    return STEPS[this.i];
  }

  next() {
    this.i++;
    if (this.i >= STEPS.length) return this.finish();
    const me = this.session.me;
    this.state = { startDist: me.dist, acc: 0, count: 0 };
    const st = this.step;
    if (st.give) {
      // Hand over the item this step is about (whatever the box gave before)
      Object.assign(me, { item: st.give, itemCount: 1, roulette: 0, pendingItem: null });
    }
    this.render();
  }

  skip() {
    audio.play("menu");
    this.next();
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.session.app.hud.tutTarget = null;
    this.el.classList.remove("on");
    this.onDone();
  }

  dispose() {
    this.el.classList.remove("on", "done");
    document.body.classList.remove("tutorial");
    this.session.app.hud.tutTarget = null;
  }

  render(extra = "") {
    const st = this.step;
    if (!st) return;
    const s = this.state;
    $("#tut-count").textContent = `${this.i + 1}/${STEPS.length}`;
    $("#tut-title").textContent = st.title;
    $("#tut-text").innerHTML = st.text() + (s.retry ? `<em>${s.retry}</em>` : "");
    $("#tut-where").textContent = extra;
    const bar = $("#tut-bar");
    bar.hidden = !st.need;
    this.el.classList.remove("done");
    $("#tut-dots").innerHTML = STEPS.map((_, j) => `<i class="${j < this.i ? "ok" : j === this.i ? "cur" : ""}"></i>`).join("");
  }

  update(dt, events) {
    if (this.finished) return;
    const sim = this.session.sim;
    const me = this.session.me;
    if (!me || sim.time < 0) return;
    if (this.doneT > 0) {
      this.doneT -= dt;
      if (this.doneT <= 0) this.next();
      return;
    }
    const st = this.step;
    const s = this.state;
    const e = events.filter((x) => x.kart === me).map((x) => x.e);
    if (e.includes("launch")) s.air = true;
    // Progress
    let done = false;
    if (st.need) {
      if (st.on) for (const x of e) s.count += st.on[x] || 0;
      const v = st.on ? s.count : st.progress(s, me, dt);
      $("#tut-bar i").style.width = Math.min(100, (v / st.need) * 100) + "%";
      done = v >= st.need;
    } else {
      const r = st.check(s, me, e, dt);
      if (r === "again") {
        // Let them try that one again
        Object.assign(me, { item: st.give, itemCount: 1, roulette: 0 });
        this.state = { ...this.state, acc: 0 };
        this.render();
        return;
      }
      done = r === true;
      const miss = !done && st.miss?.(s, me, e);
      if (miss) {
        s.retry = miss;
        s.air = false;
        this.render();
      }
    }
    if (e.includes("land")) s.air = false;
    // Where to go next, for steps that need a spot on the track
    const hud = this.session.app.hud;
    if (st.target && !done) {
      const t = sim.track;
      // The nearest one ahead (spots are { i: track sample, x, z })
      let best = null, bd = Infinity;
      for (const p of st.target(sim)) {
        const d = (((p.i - me.q.idx) % t.N) + t.N) % t.N;
        if (d > 2 && d < bd) (bd = d), (best = p);
      }
      const where = best ? `📍 Next one: ${Math.round((bd * t.spacing) / 5) * 5} m ahead` : "";
      if ($("#tut-where").textContent !== where) $("#tut-where").textContent = where;
      hud.tutTarget = best && { x: best.x, z: best.z };
    } else hud.tutTarget = null;
    if (done) {
      this.doneT = DONE_PAUSE;
      this.el.classList.add("done");
      $("#tut-title").textContent = ["✓ Nice!", "✓ Great!", "✓ Awesome!", "✓ Perfect!"][this.i % 4];
      $("#tut-where").textContent = "";
      audio.play("itemGet");
    }
  }
}
