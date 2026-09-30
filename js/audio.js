// Web Audio: procedural chiptune music, synthesized SFX and kart engine.
const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 4, 5, 7, 8, 10], // phrygian dominant, for that desert flavor
};
const PROGRESSIONS = [
  [0, 5, 3, 4],
  [0, 3, 4, 3],
  [0, 4, 5, 3],
  [5, 3, 0, 4],
  [0, 6, 5, 4],
];
const RHYTHMS = [
  "x.x.x..xx.x.x...",
  "x..x..x.x.x.x...",
  "x.xx.x..x.xx.x..",
  "x...x.x.x..xx...",
  "xx.x.x.xx.x..x..",
];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// 0.1s of 8-bit mono silence as a WAV blob URL.
function silentWav() {
  const n = 4410;
  const b = new DataView(new ArrayBuffer(44 + n));
  const str = (o, s) => [...s].forEach((ch, i) => b.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  b.setUint32(4, 36 + n, true);
  str(8, "WAVEfmt ");
  b.setUint32(16, 16, true);
  b.setUint16(20, 1, true);
  b.setUint16(22, 1, true);
  b.setUint32(24, 44100, true);
  b.setUint32(28, 44100, true);
  b.setUint16(32, 1, true);
  b.setUint16(34, 8, true);
  str(36, "data");
  b.setUint32(40, n, true);
  for (let i = 0; i < n; i++) b.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([b], { type: "audio/wav" }));
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.musicVol = 0.55;
    this.sfxVol = 0.8;
    this.song = null;
    this.tempoMul = 1;
    this.engines = new Map();
  }

  unlock() {
    // iOS routes Web Audio through the "ambient" session, which the ring/silent
    // switch mutes. Ask for "playback" (Safari 17+) unless voice chat has the mic.
    const session = navigator.audioSession;
    if (session && session.type !== "play-and-record") session.type = "playback";
    else if (!session && IOS) {
      // Older iOS: a looping silent <audio> element switches the session instead.
      if (!this.keepAlive) {
        this.keepAlive = document.createElement("audio");
        this.keepAlive.src = silentWav();
        this.keepAlive.loop = true;
        this.keepAlive.setAttribute("playsinline", "");
      }
      if (this.keepAlive.paused) this.keepAlive.play().catch(() => {});
    }
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = 0.9;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(c.destination);
      this.musicBus = c.createGain();
      this.musicBus.gain.value = this.musicVol * 0.5;
      this.musicBus.connect(this.master);
      this.sfxBus = c.createGain();
      this.sfxBus.gain.value = this.sfxVol;
      this.sfxBus.connect(this.master);
      const len = c.sampleRate;
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.timer = setInterval(() => this.schedule(), 25);
    }
    // iOS reports "interrupted" after calls, Siri or locking the phone.
    if (this.ctx.state !== "running") {
      this.ctx.resume().catch(() => {});
      // Older WebKit only unlocks once a source actually starts inside the gesture.
      const s = this.ctx.createBufferSource();
      s.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      s.connect(this.ctx.destination);
      s.start();
    }
  }

  setVolumes(music, sfx) {
    this.musicVol = music;
    this.sfxVol = sfx;
    if (this.ctx) {
      this.musicBus.gain.setTargetAtTime(music * 0.5 * (this.ducked ? 0.35 : 1), this.ctx.currentTime, 0.05);
      this.sfxBus.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.05);
    }
  }

  // Spoken line via the browser's text-to-speech, in an English voice when there is one.
  say(text, { pitch = 1, rate = 1 } = {}) {
    const tts = window.speechSynthesis;
    if (!tts || !window.SpeechSynthesisUtterance || this.sfxVol <= 0) return;
    tts.cancel(); // mashing the key restarts the line instead of queueing it
    const u = new SpeechSynthesisUtterance(text);
    const voices = tts.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
    const male = /david|daniel|alex|fred|tom|guy|mark|james|aaron|male/i;
    const voice = voices.find((v) => male.test(v.name) && /us/i.test(v.lang)) || voices.find((v) => male.test(v.name)) || voices.find((v) => /us/i.test(v.lang)) || voices[0];
    if (voice) u.voice = voice;
    u.lang = voice?.lang || "en-US";
    u.pitch = pitch;
    u.rate = rate;
    u.volume = Math.min(1, this.sfxVol * 1.2);
    tts.speak(u);
  }

  // Lower the music while someone on voice chat is talking.
  duck(on) {
    if (this.ducked === !!on) return;
    this.ducked = !!on;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(this.musicVol * 0.5 * (on ? 0.35 : 1), this.ctx.currentTime, on ? 0.08 : 0.6);
  }

  // ------------------------------------------------------------ primitives
  tone(t, freq, dur, { type = "square", gain = 0.2, dest, attack = 0.005, release = 0.05, slide = 0, filter = 0, vibrato = 0 } = {}) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    if (vibrato) {
      const lfo = c.createOscillator();
      const lg = c.createGain();
      lfo.frequency.value = 6;
      lg.gain.value = freq * vibrato;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t + 0.08);
      lfo.stop(t + dur + release);
    }
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.setValueAtTime(gain, t + Math.max(attack, dur - release));
    g.gain.linearRampToValueAtTime(0, t + dur + release);
    let node = o;
    if (filter) {
      const f = c.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = filter;
      o.connect(f);
      node = f;
    }
    node.connect(g).connect(dest || this.sfxBus);
    o.start(t);
    o.stop(t + dur + release + 0.02);
  }

  noiseHit(t, dur, { gain = 0.3, type = "bandpass", freq = 1000, q = 1, dest, sweep = 0 } = {}) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(dest || this.sfxBus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  // A cat's "meowww": a buzzy voice sliding up then down, through a filter that closes from
  // "ee" to "ow" (the vowel change is what makes it sound like a meow).
  meow(t, v) {
    const c = this.ctx;
    const dur = 0.95;
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(560, t);
    o.frequency.linearRampToValueAtTime(760, t + 0.18);
    o.frequency.linearRampToValueAtTime(700, t + 0.45);
    o.frequency.exponentialRampToValueAtTime(390, t + dur);
    const lfo = c.createOscillator();
    const lg = c.createGain();
    lfo.frequency.value = 7;
    lg.gain.value = 14;
    lfo.connect(lg).connect(o.frequency);
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 7;
    f.frequency.setValueAtTime(900, t);
    f.frequency.linearRampToValueAtTime(2400, t + 0.16);
    f.frequency.exponentialRampToValueAtTime(700, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22 * v, t + 0.05);
    g.gain.setValueAtTime(0.22 * v, t + dur - 0.3);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(f).connect(g).connect(this.sfxBus);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------ sfx
  play(name, vol = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.01;
    const v = vol;
    switch (name) {
      case "count":
        this.tone(t, 523, 0.22, { type: "square", gain: 0.22 * v });
        break;
      case "go":
        this.tone(t, 1046, 0.6, { type: "square", gain: 0.22 * v });
        this.tone(t, 1318, 0.6, { type: "square", gain: 0.12 * v });
        break;
      case "doorOpen":
        this.tone(t, 900, 0.03, { type: "square", gain: 0.08 * v, filter: 2500 });
        this.noiseHit(t + 0.02, 0.12, { gain: 0.18 * v, type: "bandpass", freq: 1400, q: 1.2, sweep: 0.5 });
        break;
      case "doorClose":
        this.noiseHit(t, 0.18, { gain: 0.5 * v, type: "lowpass", freq: 320, q: 0.7 });
        this.tone(t, 90, 0.12, { type: "sine", gain: 0.3 * v, slide: 0.5 });
        break;
      case "transform":
      case "transformBack": {
        // Ratcheting clicks over a whirring sweep, then a heavy clank as it locks
        const up = name === "transform";
        for (let i = 0; i < 9; i++) {
          const f = up ? 1800 + i * 260 : 3900 - i * 260;
          this.noiseHit(t + i * 0.075, 0.035, { gain: 0.22 * v, type: "bandpass", freq: f, q: 4 });
          this.tone(t + i * 0.075, (up ? 180 + i * 45 : 540 - i * 45), 0.05, { type: "square", gain: 0.06 * v, filter: 1800 });
        }
        this.tone(t, up ? 110 : 330, 0.7, { type: "sawtooth", gain: 0.1 * v, slide: up ? 3 : 0.33, filter: 1400 });
        this.noiseHit(t + 0.72, 0.25, { gain: 0.5 * v, type: "lowpass", freq: 380, q: 0.8 });
        this.tone(t + 0.72, 70, 0.2, { type: "sine", gain: 0.35 * v, slide: 0.6 });
        break;
      }
      case "hop":
        this.tone(t, 300, 0.08, { type: "square", gain: 0.1 * v, slide: 2, filter: 2000 });
        break;
      case "drift1":
      case "drift2":
      case "drift3": {
        const f = { drift1: 880, drift2: 1175, drift3: 1568 }[name];
        this.tone(t, f, 0.08, { type: "triangle", gain: 0.16 * v });
        this.tone(t + 0.07, f * 1.5, 0.1, { type: "triangle", gain: 0.14 * v });
        break;
      }
      case "boost":
        this.noiseHit(t, 0.5, { gain: 0.35 * v, type: "bandpass", freq: 400, q: 0.8, sweep: 6 });
        this.tone(t, 180, 0.4, { type: "sawtooth", gain: 0.08 * v, slide: 3, filter: 1800 });
        break;
      case "box":
        [0, 4, 7, 12].forEach((n, i) => this.tone(t + i * 0.04, mtof(84 + n), 0.08, { type: "triangle", gain: 0.12 * v }));
        break;
      case "roulette":
        for (let i = 0; i < 14; i++) this.tone(t + i * 0.085, 1200 + (i % 3) * 200, 0.02, { type: "square", gain: 0.05 * v });
        break;
      case "itemGet":
        this.tone(t, mtof(88), 0.08, { type: "square", gain: 0.12 * v });
        this.tone(t + 0.08, mtof(95), 0.16, { type: "square", gain: 0.12 * v });
        break;
      case "throw":
        this.noiseHit(t, 0.2, { gain: 0.2 * v, freq: 2000, sweep: 0.4 });
        break;
      case "shellHit":
        this.noiseHit(t, 0.4, { gain: 0.5 * v, type: "lowpass", freq: 3000, sweep: 0.1 });
        this.tone(t, 160, 0.3, { type: "sine", gain: 0.4 * v, slide: 0.3 });
        break;
      case "spin":
        this.tone(t, 900, 0.7, { type: "square", gain: 0.1 * v, slide: 0.25, filter: 2500 });
        this.tone(t, 450, 0.7, { type: "triangle", gain: 0.12 * v, slide: 0.25 });
        break;
      case "wall":
        this.tone(t, 90, 0.18, { type: "sine", gain: 0.45 * v, slide: 0.5 });
        this.noiseHit(t, 0.12, { gain: 0.25 * v, type: "lowpass", freq: 800 });
        break;
      case "bump":
        this.tone(t, 140, 0.1, { type: "sine", gain: 0.3 * v, slide: 0.6 });
        break;
      case "meow":
        this.meow(t, v);
        break;
      case "coin":
        this.tone(t, mtof(88), 0.06, { type: "square", gain: 0.1 * v });
        this.tone(t + 0.06, mtof(100), 0.2, { type: "square", gain: 0.1 * v });
        break;
      case "star":
        for (let i = 0; i < 12; i++) this.tone(t + i * 0.06, mtof(76 + [0, 4, 7, 12][i % 4] + Math.floor(i / 4) * 2), 0.06, { type: "square", gain: 0.08 * v });
        break;
      case "bolt":
        this.noiseHit(t, 0.9, { gain: 0.5 * v, type: "highpass", freq: 600 });
        this.tone(t, 1400, 0.8, { type: "sawtooth", gain: 0.12 * v, slide: 0.1 });
        break;
      case "splat":
        this.tone(t, 200, 0.35, { type: "sine", gain: 0.4 * v, slide: 0.3 });
        this.noiseHit(t, 0.3, { gain: 0.3 * v, type: "lowpass", freq: 600 });
        break;
      case "boom":
      case "bigBoom": {
        const big = name === "bigBoom";
        this.noiseHit(t, big ? 1.4 : 1.0, { gain: 0.7 * v, type: "lowpass", freq: big ? 1400 : 1000, sweep: 0.08 });
        this.tone(t, big ? 110 : 90, big ? 0.9 : 0.6, { type: "sine", gain: 0.5 * v, slide: 0.25 });
        break;
      }
      case "horn":
        [0, 4, 7].forEach((n) => this.tone(t, mtof(58 + n), 0.55, { type: "sawtooth", gain: 0.09 * v, filter: 2400 }));
        this.noiseHit(t, 0.5, { gain: 0.35 * v, type: "bandpass", freq: 600, q: 0.6, sweep: 4 });
        break;
      case "bullet":
        this.noiseHit(t, 0.35, { gain: 0.6 * v, type: "lowpass", freq: 900, sweep: 0.2 });
        this.tone(t, 70, 0.3, { type: "sine", gain: 0.5 * v, slide: 0.5 });
        this.tone(t + 0.1, 200, 1.2, { type: "sawtooth", gain: 0.07 * v, slide: 2.2, filter: 1200 });
        break;
      case "blueShell":
        // A rising siren wail
        for (let i = 0; i < 3; i++) this.tone(t + i * 0.3, 700, 0.28, { type: "square", gain: 0.07 * v, slide: 1.8, filter: 3000 });
        break;
      case "fireball":
        this.noiseHit(t, 0.18, { gain: 0.25 * v, type: "bandpass", freq: 900, q: 1.5, sweep: 2.5 });
        break;
      case "chomp":
        this.noiseHit(t, 0.08, { gain: 0.4 * v, type: "lowpass", freq: 700 });
        this.tone(t, 260, 0.06, { type: "square", gain: 0.12 * v, slide: 0.5, filter: 1200 });
        this.noiseHit(t + 0.12, 0.08, { gain: 0.4 * v, type: "lowpass", freq: 700 });
        break;
      case "boo":
        this.tone(t, 520, 0.9, { type: "sine", gain: 0.14 * v, slide: 0.55, vibrato: 0.04 });
        this.tone(t + 0.1, 780, 0.8, { type: "sine", gain: 0.08 * v, slide: 0.55, vibrato: 0.05 });
        break;
      case "stolen":
        [7, 4, 0].forEach((n, i) => this.tone(t + i * 0.12, mtof(72 + n), 0.12, { type: "square", gain: 0.1 * v }));
        break;
      case "lap":
        [0, 4, 7].forEach((n, i) => this.tone(t + i * 0.1, mtof(79 + n), 0.12, { type: "square", gain: 0.12 * v }));
        break;
      case "finalLap":
        [0, 4, 7, 12, 7, 12].forEach((n, i) => this.tone(t + i * 0.11, mtof(76 + n), 0.14, { type: "square", gain: 0.13 * v }));
        break;
      case "finish":
        [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => this.tone(t + i * 0.09, mtof(72 + n), 0.3, { type: "square", gain: 0.1 * v }));
        this.tone(t + 0.7, mtof(84), 0.8, { type: "triangle", gain: 0.2 * v, vibrato: 0.01 });
        break;
      case "fall":
        this.tone(t, 1200, 1.0, { type: "sine", gain: 0.2 * v, slide: 0.2 });
        break;
      case "land":
        this.tone(t, 110, 0.12, { type: "sine", gain: 0.3 * v, slide: 0.6 });
        break;
      case "trick":
        this.tone(t, 600, 0.12, { type: "square", gain: 0.1 * v, slide: 2.5 });
        this.tone(t + 0.1, 900, 0.12, { type: "square", gain: 0.1 * v, slide: 2 });
        break;
      case "burnout":
        this.noiseHit(t, 0.9, { gain: 0.3 * v, type: "lowpass", freq: 500 });
        this.tone(t, 70, 0.8, { type: "sawtooth", gain: 0.1 * v, filter: 300 });
        break;
      case "menu":
        this.tone(t, 880, 0.04, { type: "square", gain: 0.06 * v });
        break;
      case "select":
        this.tone(t, 660, 0.06, { type: "square", gain: 0.08 * v });
        this.tone(t + 0.06, 990, 0.1, { type: "square", gain: 0.08 * v });
        break;
      case "back":
        this.tone(t, 500, 0.06, { type: "square", gain: 0.07 * v, slide: 0.6 });
        break;
      case "wrong":
        this.tone(t, 180, 0.2, { type: "square", gain: 0.12 * v });
        break;
      case "chat":
        this.tone(t, 1300, 0.05, { type: "sine", gain: 0.12 * v });
        break;
    }
  }

  // ------------------------------------------------------------ engine
  engine(id, on) {
    if (!this.ctx) return null;
    if (!on) {
      const e = this.engines.get(id);
      if (e) {
        e.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
        setTimeout(() => {
          try {
            e.o1.stop();
            e.o2.stop();
            e.n.stop();
          } catch {}
        }, 300);
        this.engines.delete(id);
      }
      return null;
    }
    if (this.engines.has(id)) return this.engines.get(id);
    const c = this.ctx;
    const o1 = c.createOscillator();
    o1.type = "sawtooth";
    const o2 = c.createOscillator();
    o2.type = "square";
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 600;
    const g = c.createGain();
    g.gain.value = 0;
    o1.connect(f);
    o2.connect(f);
    f.connect(g).connect(this.sfxBus);
    // drift screech
    const n = c.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    const nf = c.createBiquadFilter();
    nf.type = "bandpass";
    nf.frequency.value = 2600;
    nf.Q.value = 3;
    const ng = c.createGain();
    ng.gain.value = 0;
    n.connect(nf).connect(ng).connect(this.sfxBus);
    o1.start();
    o2.start();
    n.start();
    const e = { o1, o2, f, g, n, ng };
    this.engines.set(id, e);
    return e;
  }

  updateEngine(id, speedNorm, { throttle = 0, boost = false, drift = false, air = false, vol = 1, rev = false } = {}) {
    const e = this.engines.get(id);
    if (!e) return;
    const t = this.ctx.currentTime;
    const s = Math.max(0, Math.min(1.5, speedNorm));
    const base = 55 + s * 150 + (boost ? 35 : 0) + (air ? 25 : 0) + (rev ? 60 + Math.random() * 20 : 0);
    e.o1.frequency.setTargetAtTime(base, t, 0.05);
    e.o2.frequency.setTargetAtTime(base * 0.5, t, 0.05);
    e.f.frequency.setTargetAtTime(400 + s * 1600 + throttle * 400 + (boost ? 800 : 0), t, 0.08);
    e.g.gain.setTargetAtTime((0.05 + throttle * 0.035 + s * 0.03) * vol, t, 0.06);
    e.ng.gain.setTargetAtTime(drift ? 0.05 * vol : 0, t, 0.05);
  }

  stopEngines() {
    for (const id of [...this.engines.keys()]) this.engine(id, false);
  }

  // ------------------------------------------------------------ music
  playSong(def) {
    if (!this.ctx) {
      this.pendingSong = def;
      return;
    }
    if (this.song && this.song.def === def) return;
    this.song = this.compose(def);
    this.tempoMul = 1;
    this.nextStep = this.ctx.currentTime + 0.1;
    this.step = 0;
  }

  stopMusic() {
    this.song = null;
    this.pendingSong = null;
  }

  compose(def) {
    const r = rng(def.seed * 7919 + 17);
    const scale = MODES[def.mode] || MODES.major;
    const prog = PROGRESSIONS[Math.floor(r() * PROGRESSIONS.length)];
    const progB = PROGRESSIONS[Math.floor(r() * PROGRESSIONS.length)];
    const deg = (d) => {
      const o = Math.floor(d / 7);
      return scale[((d % 7) + 7) % 7] + o * 12;
    };
    // Build a 16-bar song: A A' B A (each 4 bars)
    const makePhrase = (chords, variant) => {
      const bars = [];
      let cur = chords[0] + 7;
      for (let b = 0; b < 4; b++) {
        const rhythm = RHYTHMS[Math.floor(r() * RHYTHMS.length)];
        const chord = chords[b];
        const notes = [];
        for (let s = 0; s < 16; s++) {
          if (rhythm[s] !== "x") {
            notes.push(null);
            continue;
          }
          const tones = [chord, chord + 2, chord + 4].map((x) => x + 7);
          if (s % 4 === 0) {
            // land on a chord tone
            let best = tones[0];
            for (const tn of tones) if (Math.abs(tn - cur) < Math.abs(best - cur)) best = tn;
            cur = best;
          } else {
            cur += [-1, 1, 1, -2, 2, 0][Math.floor(r() * 6)];
            cur = Math.max(4, Math.min(16, cur));
          }
          if (variant && b === 3 && s >= 12) cur = chord + 7;
          notes.push(cur);
        }
        bars.push({ chord, notes });
      }
      return bars;
    };
    const A = makePhrase(prog, false);
    const A2 = A.map((bar, i) => (i === 3 ? makePhrase(prog, true)[3] : bar));
    const B = makePhrase(progB, true);
    const bars = [...A, ...A2, ...B, ...A2];
    const bassPat = ["r.r.o.r.r.r.o.f.", "r..r..r.r..r..o.", "r.o.r.o.r.o.f.o."][Math.floor(r() * 3)];
    return { def, bars, deg, root: def.root, bassPat, swing: def.mode === "mixolydian" ? 0.12 : 0 };
  }

  schedule() {
    if (!this.ctx) return;
    if (this.pendingSong && !this.song) {
      const d = this.pendingSong;
      this.pendingSong = null;
      this.playSong(d);
    }
    const song = this.song;
    if (!song) return;
    const c = this.ctx;
    const spb = 60 / (song.def.bpm * this.tempoMul) / 4; // seconds per 16th
    if (this.nextStep < c.currentTime - 0.2) this.nextStep = c.currentTime + 0.05;
    while (this.nextStep < c.currentTime + 0.12) {
      const t = this.nextStep + (this.step % 2 ? song.swing * spb : 0);
      const total = song.bars.length * 16;
      const s = this.step % total;
      const bar = song.bars[Math.floor(s / 16)];
      const i = s % 16;
      const root = song.root;
      const bus = this.musicBus;
      // Drums
      if (i % 4 === 0) this.tone(t, 150, 0.12, { type: "sine", gain: 0.5, slide: 0.3, dest: bus });
      if (i % 8 === 4) this.noiseHit(t, 0.14, { gain: 0.28, type: "highpass", freq: 1500, dest: bus });
      if (i % 2 === 0) this.noiseHit(t, 0.04, { gain: 0.07, type: "highpass", freq: 7000, dest: bus });
      // Bass
      const bp = song.bassPat[i];
      if (bp !== ".") {
        const d = bp === "r" ? bar.chord : bp === "o" ? bar.chord + 7 : bar.chord + 4;
        this.tone(t, mtof(root - 24 + song.deg(d)), spb * 1.6, { type: "square", gain: 0.13, filter: 700, dest: bus });
      }
      // Arp
      const arp = [0, 2, 4, 7][i % 4];
      this.tone(t, mtof(root + song.deg(bar.chord + arp)), spb * 0.8, { type: "square", gain: 0.025, filter: 3000, dest: bus });
      // Lead
      const n = bar.notes[i];
      if (n != null) {
        let len = 1;
        while (i + len < 16 && bar.notes[i + len] == null && len < 4) len++;
        this.tone(t, mtof(root + song.deg(n)), spb * len * 0.9, { type: "square", gain: 0.07, filter: 4000, vibrato: len > 2 ? 0.008 : 0, dest: bus });
        this.tone(t, mtof(root + 12 + song.deg(n)), spb * len * 0.9, { type: "triangle", gain: 0.04, dest: bus });
      }
      this.step++;
      this.nextStep += spb;
    }
  }
}

export const audio = new GameAudio();
