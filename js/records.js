// One-off requests to the multiplayer server (fastest-lap and daily boards, player stats).
// Each is a short-lived WebSocket so it works without joining Online.
import { Net } from "./net.js?v=7";

// Sends one message and resolves with the server's reply: { t: "records", laps, rank? }
// for board requests, { t: "daily", ... } for the daily challenge, { t: "ghost", ... } for a board's
// record ghost, { t: "ok" } for stats reports.
export function serverRequest(msg, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let ws;
    try {
      ws = new WebSocket(new Net().url());
    } catch (e) {
      return reject(e);
    }
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("timeout"));
    }, timeoutMs);
    ws.onmessage = (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.t === "welcome") ws.send(JSON.stringify(msg));
      else if (["records", "daily", "ghost", "ok", "push-key", "push-ok", "account", "beaten", "gchal"].includes(m.t)) {
        clearTimeout(timer);
        ws.close();
        resolve(m);
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("unreachable"));
    };
  });
}
