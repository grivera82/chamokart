// Chamo Kart service worker: shows push notifications ("Ana is playing", challenges, and
// feedback pings for the stats page) and opens the right page when one is tapped.
// It doesn't cache anything.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title || "Chamo Kart", {
      body: data.body || "",
      icon: "apple-touch-icon.png",
      badge: "apple-touch-icon.png",
      tag: data.tag || "chamokart",
      renotify: true,
      data: { url: data.url || "/chamokart/" },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/chamokart/", self.location.origin).href;
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Game pings reuse an open game tab; a feedback ping only reuses an open stats page
      // (it mustn't pull a game tab away from a race).
      const path = new URL(url).pathname;
      const game = self.registration.scope.replace(self.location.origin, "");
      const open = wins.find((w) => new URL(w.url).pathname === path) || (path === game ? wins.find((w) => w.url.startsWith(self.registration.scope)) : null);
      if (open) {
        // The game picks up the room from the hash (see hashchange in main.js).
        await open.focus();
        return open.navigate ? open.navigate(url) : null;
      }
      return self.clients.openWindow(url);
    })()
  );
});
