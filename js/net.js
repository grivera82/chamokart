// WebSocket client with clock sync.
export class Net {
  constructor() {
    this.ws = null;
    this.id = null;
    this.handlers = new Map();
    this.offset = 0;
    this.samples = [];
    this.connected = false;
    this.pingTimer = null;
  }

  url() {
    const q = new URLSearchParams(location.search).get("server");
    if (q) return q;
    const base = location.pathname.replace(/[^/]*$/, "");
    return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${base}ws`;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type).delete(fn);
  }

  emit(type, msg) {
    const hs = this.handlers.get(type);
    if (hs) for (const fn of hs) fn(msg);
  }

  connect() {
    if (this.connected && this.ws) return Promise.resolve(this.id);
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(this.url());
      } catch (e) {
        this.connecting = null;
        reject(e);
        return;
      }
      this.ws = ws;
      const timeout = setTimeout(() => {
        ws.close();
        this.connecting = null;
        reject(new Error("timeout"));
      }, 8000);
      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.t === "welcome") {
          clearTimeout(timeout);
          this.id = msg.id;
          this.connected = true;
          this.offset = msg.s - Date.now();
          this.connecting = null;
          this.startPing();
          resolve(msg.id);
        } else if (msg.t === "pong") {
          const now = Date.now();
          const rtt = now - msg.c;
          this.samples.push({ rtt, off: msg.s + rtt / 2 - now });
          if (this.samples.length > 10) this.samples.shift();
          const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
          this.offset = best.off;
          this.rtt = best.rtt;
        }
        this.emit(msg.t, msg);
      };
      ws.onclose = () => {
        clearTimeout(timeout);
        const was = this.connected;
        this.connected = false;
        this.connecting = null;
        this.ws = null;
        clearInterval(this.pingTimer);
        if (was) this.emit("disconnect", {});
        else reject(new Error("closed"));
      };
      ws.onerror = () => {};
    });
    return this.connecting;
  }

  startPing() {
    clearInterval(this.pingTimer);
    const ping = () => this.send({ t: "ping", c: Date.now() });
    ping();
    setTimeout(ping, 300);
    setTimeout(ping, 700);
    this.pingTimer = setInterval(ping, 2000);
  }

  serverNow() {
    return Date.now() + this.offset;
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  close() {
    if (this.ws) {
      this.connected = false;
      this.ws.close();
      this.ws = null;
    }
    clearInterval(this.pingTimer);
  }
}

// Kart state packing: [id, x, y, z, yaw, speed, flags, dist, lap, vy]
const F = {
  drift: 1, driftR: 2, boost: 4, star: 8, shrink: 16, spin: 32, tumble: 64,
  respawn: 128, squish: 256, finished: 512, air: 1024, trick: 2048, hot: 4096,
};
const r2 = (v) => Math.round(v * 100) / 100;

export function packKart(k) {
  let f = 0;
  if (k.drifting) f |= F.drift;
  if (k.driftDir > 0) f |= F.driftR;
  if (k.boostT > 0) f |= F.boost;
  if (k.boostPower > 1.3) f |= F.hot;
  if (k.starT > 0) f |= F.star;
  if (k.shrinkT > 0) f |= F.shrink;
  if (k.spinT > 0) f |= F.spin;
  if (k.tumbleT > 0) f |= F.tumble;
  if (k.respawnT > 0) f |= F.respawn;
  if (k.squishT > 0) f |= F.squish;
  if (k.finished) f |= F.finished;
  if (!k.grounded) f |= F.air;
  if (k.trickT > 0) f |= F.trick;
  f |= (k.driftLevel & 3) << 13;
  return [k.id, r2(k.x), r2(k.y), r2(k.z), r2(k.yaw), r2(k.fwdSpeed), f, r2(k.dist), k.lap, r2(k.pitch), r2(k.steerVis)];
}

export function applyFlags(k, f) {
  k.drifting = !!(f & F.drift);
  k.driftDir = k.drifting ? (f & F.driftR ? 1 : -1) : 0;
  k.driftLevel = (f >> 13) & 3;
  k.boostT = f & F.boost ? 0.2 : 0;
  k.boostPower = f & F.hot ? 1.4 : 1.27;
  k.starT = f & F.star ? 0.2 : 0;
  k.shrinkT = f & F.shrink ? 0.2 : 0;
  k.spinT = f & F.spin ? 0.2 : 0;
  k.tumbleT = f & F.tumble ? 0.2 : 0;
  k.squishT = f & F.squish ? 0.2 : 0;
  const resp = !!(f & F.respawn);
  k.respawnT = resp ? 0.5 : 0;
  k.respawnMoved = resp;
  k.grounded = !(f & F.air);
  k.trickT = f & F.trick ? 0.2 : 0;
  if (f & F.finished) k.finished = true;
}
