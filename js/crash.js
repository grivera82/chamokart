// Crash reports: sends the game's uncaught errors to the server for the dashboard's Bugs list.
// A plain script loaded before the modules, so it also catches errors while they load.
// main.js adds what the player was doing (window.ckCrashContext) and breadcrumbs (window.ckCrumb).
(() => {
  const MAX_PER_LOAD = 5;
  const started = Date.now();
  const crumbs = []; // the last few things that happened: [seconds since load, what]
  const sent = new Set();
  const caught = (window.ckCrashes = []); // everything caught, for debugging

  const crumb = (what) => {
    crumbs.push([Math.round((Date.now() - started) / 100) / 10, String(what).slice(0, 60)]);
    if (crumbs.length > 20) crumbs.shift();
  };
  window.ckCrumb = crumb;
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-action]");
    if (b) crumb("tap " + b.dataset.action);
  }, true);

  const pid = () => {
    try {
      return JSON.parse(localStorage.getItem("ck_pid"));
    } catch {
      return null;
    }
  };
  const version = () => {
    const s = document.querySelector('script[src*="main.js"]');
    return s ? new URL(s.src).searchParams.get("v") || "" : "";
  };
  // Only errors that come from the game itself (not browser extensions or other scripts)
  const ours = (text) => String(text || "").includes(location.origin + location.pathname.replace(/[^/]*$/, ""));

  function send(msg) {
    let ws;
    try {
      const q = new URLSearchParams(location.search).get("server");
      ws = new WebSocket(q || `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${location.pathname.replace(/[^/]*$/, "")}ws`);
    } catch {
      return;
    }
    const done = setTimeout(() => ws.close(), 8000);
    ws.onmessage = (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.t === "welcome") ws.send(JSON.stringify(msg));
      else if (m.t === "ok") {
        clearTimeout(done);
        ws.close();
      }
    };
    ws.onerror = () => clearTimeout(done);
  }

  function report(kind, err, file, line, col) {
    const message = String((err && err.message) || err || "").slice(0, 300) || "(no message)";
    const name = (err && err.name) || "";
    const stack = String((err && err.stack) || "").slice(0, 4000);
    if (!ours(stack) && !ours(file)) return;
    const key = name + message + stack.split("\n").slice(0, 2).join();
    if (sent.has(key) || sent.size >= MAX_PER_LOAD) return;
    sent.add(key);
    let ctx = {};
    try {
      ctx = window.ckCrashContext?.() || {};
    } catch {}
    const msg = {
      t: "crash",
      pid: pid(),
      kind,
      name,
      message,
      stack,
      file: String(file || "").slice(0, 300),
      line: line || 0,
      col: col || 0,
      version: version(),
      uptime: Math.round((Date.now() - started) / 1000),
      crumbs: crumbs.slice(),
      ctx: {
        ...ctx,
        viewport: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
        ua: navigator.userAgent.slice(0, 300),
        path: location.pathname,
        visible: document.visibilityState,
      },
    };
    caught.push(msg);
    send(msg);
  }

  window.ckReport = (err) => report("caught", err); // for errors the game catches itself
  addEventListener("error", (e) => report("error", e.error || e.message, e.filename, e.lineno, e.colno));
  addEventListener("unhandledrejection", (e) => report("rejection", e.reason));
})();
