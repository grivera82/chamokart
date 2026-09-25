// Voice chat: a WebRTC audio mesh between the players of a room who joined
// voice. The game server only relays offers/answers/ICE candidates ("rtc").
// To avoid offer glare, the player with the lower id always makes the call.
const ICE_SERVERS = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
const TALK_LEVEL = 0.03; // RMS above this counts as talking
const TALK_HOLD_MS = 350;
const MAX_RETRIES = 2;

const idNum = (id) => Number(String(id).replace(/\D/g, "")) || 0;

export class Voice {
  constructor(net, audio) {
    this.net = net;
    this.audio = audio;
    this.active = false;
    this.joining = false;
    this.muted = false;
    this.stream = null; // null while active means listen-only (no mic)
    this.peers = new Map(); // id -> { pc, el, meter, pending }
    this.retries = new Map();
    this.blocked = new Set(); // players you muted locally
    this.volume = 1;
    this.talking = new Set(); // ids talking right now (your own id included)
    this.self = null;
    this.room = null;
    this.timer = null;
    this.onChange = () => {};
    this.onTalk = () => {};
    this.box = document.createElement("div");
    this.box.hidden = true;
    document.body.append(this.box);
    net.on("rtc", (m) => this.onSignal(m.from, m.d));
  }

  get supported() {
    return typeof RTCPeerConnection === "function";
  }

  // Returns an error message when the mic couldn't be opened (you can still listen).
  async join() {
    if (this.active || this.joining || !this.supported) return null;
    this.joining = true;
    this.onChange();
    let err = null;
    // iOS: the mic needs a play-and-record session (audio.js sets "playback").
    if (navigator.audioSession) navigator.audioSession.type = "play-and-record";
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (e) {
      this.stream = null;
      err = e?.name === "NotAllowedError" ? "Microphone blocked: you can listen but not talk." : "No microphone found: you can listen but not talk.";
    }
    this.joining = false;
    if (!this.net.connected || !this.room) {
      this.stopMic();
      this.onChange();
      return null;
    }
    this.active = true;
    this.muted = false;
    this.self = this.stream ? this.meter(this.stream) : null;
    this.timer = setInterval(() => this.tick(), 100);
    this.announce();
    this.sync(this.room);
    this.onChange();
    return err;
  }

  leave(silent = false) {
    if (!this.active) return;
    this.active = false;
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.retries.clear();
    this.stopMic();
    clearInterval(this.timer);
    this.talking.clear();
    this.audio.duck?.(false);
    if (!silent) this.announce();
    this.onTalk(this.talking);
    this.onChange();
  }

  stopMic() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (navigator.audioSession) navigator.audioSession.type = "playback";
    this.self?.disconnect();
    this.self = null;
  }

  setMuted(v) {
    if (!this.stream) return;
    this.muted = !!v;
    for (const t of this.stream.getAudioTracks()) t.enabled = !this.muted;
    this.announce();
    this.onChange();
  }

  toggleMute() {
    this.setMuted(!this.muted);
  }

  setBlocked(id, v) {
    if (v) this.blocked.add(id);
    else this.blocked.delete(id);
    const el = this.peers.get(id)?.el;
    if (el) el.muted = !!v;
    this.onChange();
  }

  setVolume(v) {
    this.volume = v;
    for (const p of this.peers.values()) if (p.el) p.el.volume = v;
  }

  // "connected" | "connecting" | "failed" | null
  peerState(id) {
    const p = this.peers.get(id);
    if (!p) return null;
    const s = p.pc.connectionState || p.pc.iceConnectionState;
    if (s === "connected" || s === "completed") return "connected";
    if (s === "failed") return "failed";
    return "connecting";
  }

  announce() {
    this.net.send({ t: "voice", on: this.active, muted: this.active && (this.muted || !this.stream) });
  }

  signal(to, d) {
    this.net.send({ t: "rtc", to, d });
  }

  // Called on every room update: connect to new voice members, drop departed ones.
  sync(room) {
    this.room = room;
    if (!this.active) return;
    const me = this.net.id;
    const want = new Set((room?.players || []).filter((p) => p.id !== me && p.voice).map((p) => p.id));
    for (const id of [...this.peers.keys()]) if (!want.has(id)) this.drop(id);
    for (const id of [...this.retries.keys()]) if (!want.has(id)) this.retries.delete(id);
    for (const id of want) if (!this.peers.has(id) && idNum(me) < idNum(id)) this.call(id);
  }

  peer(id) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const p = { pc, el: null, meter: null, pending: [] };
    this.peers.set(id, p);
    const live = () => this.peers.get(id) === p;
    pc.onicecandidate = (e) => live() && e.candidate && this.signal(id, { ice: e.candidate.toJSON() });
    pc.ontrack = (e) => live() && this.attach(p, id, e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      if (!live()) return;
      if (pc.connectionState === "connected") this.retries.delete(id);
      if (pc.connectionState === "failed" && idNum(this.net.id) < idNum(id)) {
        const n = (this.retries.get(id) || 0) + 1;
        if (n <= MAX_RETRIES) {
          this.retries.set(id, n);
          this.drop(id);
          setTimeout(() => this.active && !this.peers.has(id) && this.room?.players.some((q) => q.id === id && q.voice) && this.call(id), 1500);
        }
      }
      this.onChange();
    };
    return p;
  }

  async call(id) {
    const p = this.peer(id);
    if (this.stream) for (const t of this.stream.getAudioTracks()) p.pc.addTrack(t, this.stream);
    else p.pc.addTransceiver("audio", { direction: "recvonly" });
    try {
      await p.pc.setLocalDescription(await p.pc.createOffer());
      if (this.peers.get(id) === p) this.signal(id, { sdp: { type: "offer", sdp: p.pc.localDescription.sdp } });
    } catch (e) {
      console.warn("voice: offer failed", e);
    }
  }

  async onSignal(from, d) {
    if (!this.active || !d || typeof d !== "object") return;
    try {
      if (d.sdp?.type === "offer") {
        this.drop(from);
        const p = this.peer(from);
        await p.pc.setRemoteDescription(d.sdp);
        if (this.stream) for (const t of this.stream.getAudioTracks()) p.pc.addTrack(t, this.stream);
        await p.pc.setLocalDescription(await p.pc.createAnswer());
        if (this.peers.get(from) !== p) return;
        this.signal(from, { sdp: { type: "answer", sdp: p.pc.localDescription.sdp } });
        this.flush(p);
      } else if (d.sdp?.type === "answer") {
        const p = this.peers.get(from);
        if (!p || p.pc.signalingState !== "have-local-offer") return;
        await p.pc.setRemoteDescription(d.sdp);
        this.flush(p);
      } else if (d.ice) {
        const p = this.peers.get(from);
        if (!p) return;
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(d.ice).catch(() => {});
        else p.pending.push(d.ice);
      }
    } catch (e) {
      console.warn("voice: signaling failed", e);
    }
  }

  flush(p) {
    for (const c of p.pending.splice(0)) p.pc.addIceCandidate(c).catch(() => {});
  }

  attach(p, id, stream) {
    if (p.el) return;
    const el = document.createElement("audio");
    el.autoplay = true;
    el.playsInline = true;
    el.srcObject = stream;
    el.volume = this.volume;
    el.muted = this.blocked.has(id);
    this.box.append(el);
    el.play().catch(() => {});
    p.el = el;
    p.meter = this.meter(stream);
    this.onChange();
  }

  drop(id) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    p.pc.onicecandidate = p.pc.ontrack = p.pc.onconnectionstatechange = null;
    p.pc.close();
    if (p.el) {
      p.el.srcObject = null;
      p.el.remove();
    }
    p.meter?.disconnect();
    this.talking.delete(id);
  }

  // Level meter on a stream (for the "who's talking" indicators).
  meter(stream) {
    const ctx = this.audio.ctx;
    if (!ctx) return null;
    try {
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      return {
        last: 0,
        level() {
          an.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          return Math.sqrt(sum / buf.length);
        },
        disconnect() {
          src.disconnect();
        },
      };
    } catch {
      return null;
    }
  }

  tick() {
    const t = performance.now();
    const next = new Set();
    const check = (id, m, silent) => {
      if (!m) return;
      if (!silent && m.level() > TALK_LEVEL) m.last = t;
      if (t - m.last < TALK_HOLD_MS) next.add(id);
    };
    check(this.net.id, this.self, this.muted);
    for (const [id, p] of this.peers) check(id, p.meter, this.blocked.has(id));
    const changed = next.size !== this.talking.size || [...next].some((id) => !this.talking.has(id));
    if (!changed) return;
    this.talking = next;
    this.audio.duck?.([...next].some((id) => id !== this.net.id));
    this.onTalk(next);
  }
}
