// Who else is playing: a light, always-on connection that shares our status, keeps the
// players list fresh and carries challenges. It drops after a minute in the background so we
// don't look online while the phone is in a pocket (and push notifications reach us instead).
import { Net } from "./net.js?v=7";

const AWAY_AFTER_MS = 60000;

export class Presence {
  constructor({ hello, on }) {
    this.hello = hello; // () => { pid, name, char, status }
    this.on = on; // (type, msg) => void
    this.ws = null;
    this.uid = null;
    this.retryMs = 2000;
    this.retryTimer = null;
    this.awayTimer = null;
    this.last = "";
  }

  start() {
    this.connect();
    document.addEventListener("visibilitychange", () => {
      clearTimeout(this.awayTimer);
      if (document.hidden) this.awayTimer = setTimeout(() => this.disconnect(), AWAY_AFTER_MS);
      else this.connect();
    });
  }

  connect() {
    if (this.ws || document.hidden) return;
    clearTimeout(this.retryTimer);
    let ws;
    try {
      ws = new WebSocket(new Net().url());
    } catch {
      return this.retry();
    }
    this.ws = ws;
    ws.onmessage = (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.t === "welcome") {
        this.retryMs = 2000;
        this.last = "";
        this.update();
      } else if (m.t === "presence-ok") this.uid = m.uid;
      this.on(m.t, m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.uid = null;
      this.on("players", { list: [] });
      this.retry();
    };
    ws.onerror = () => {};
  }

  retry() {
    if (document.hidden) return; // reconnects when the game is visible again
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), this.retryMs);
    this.retryMs = Math.min(60000, this.retryMs * 2);
  }

  disconnect() {
    const ws = this.ws;
    this.ws = null;
    this.uid = null;
    ws?.close();
    this.on("players", { list: [] });
  }

  // Send our name, racer and status whenever one of them changes.
  update() {
    const h = this.hello();
    const key = JSON.stringify(h);
    if (key === this.last) return;
    if (this.send({ t: "presence", ...h })) this.last = key;
  }

  send(msg) {
    if (this.ws?.readyState !== 1) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }
}
