<p align="center">
  <img src=".github/logo.png" alt="Chamo Kart" width="420">
</p>

<p align="center"><b>¡Arranca, chamo!</b> A 3D kart racer that runs right in your browser.<br>
Race CPUs in the Copa Chamo, chase your own ghost, or race your friends online with voice chat.</p>

<p align="center"><a href="https://jgrivera.com/chamokart/"><b>▶ Play now at jgrivera.com/chamokart</b></a></p>

<p align="center"><img src="og-image.jpg" alt="The Chamo Kart racers lined up on the starting grid" width="720"></p>

## Features

- **Grand Prix:** race the 5-track Copa Chamo at 50cc, 100cc, 150cc or 200cc and win a trophy.
- **8 tracks:** the 5-track Copa Chamo plus Mars Aliens (a low-gravity run across Mars with flying saucers and aliens), Miami Vice (a night race along Ocean Drive and over the bay, with neon, go-fast boats and a thunderstorm) and Zoo City (a zoo in the city, with animals in their enclosures along the track).
- **Versus and Time Trial:** single races with your own rules, or hot laps against your saved ghost.
- **Daily Challenge:** one track, racer, kart and speed class a day, the same for everyone, with a daily board of best 3-lap times.
- **Fastest laps:** a global top 10 per track of everyone's best Time Trial lap, and you can race the record holder's ghost.
- **Online multiplayer:** public and private rooms of up to 8 racers (CPUs fill the empty spots), lobby chat, in-race chat, voice chat over WebRTC and one-tap rematches.
- **8 racers and 3 karts:** Chamo, agenteintermediario, Spider-Man, Lucas, Bumblebee, Pollito, Luchador and Calavera, on the Clásico, Bala or Burro.
- **Items:** bananas and red cocos (hold the item button to drag them behind you as a shield), green cocos (they circle you as a shield until you fire them), chiles, the Estrella, the Rayo and a splash of Chamoy.
- **Instant replay:** after Grand Prix, Versus and Online races, the best moments play back with TV cameras and slow motion (skippable).
- **Drifting and tricks:** mini-turbos, rocket starts and ramp tricks.
- **Plays anywhere:** keyboard, gamepad or touch. On phones you can steer with the on-screen pad or by tilting the phone like a steering wheel.
- **No assets to download:** the models, textures, music and sound effects are all generated in code (three.js and the Web Audio API).

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Accelerate | ↑ / W | A | automatic |
| Brake / reverse | ↓ / S | B | ◀◀ |
| Steer | ← → / A D | left stick / d-pad | pad or tilt |
| Hop & drift | Space / Shift | RB / RT | DRIFT |
| Use item | E / X | LB / LT | ITEM |
| Look behind | C | X | |
| CX-9 doors (agenteintermediario) / transform (Bumblebee) | D | | |
| Pause | Esc | Start | ❚❚ |

## Running it locally

The game is plain ES modules with no build step. three.js is loaded from a CDN.

```sh
# 1. Serve the files (any static server works)
python3 -m http.server 8000

# 2. For online play, start the multiplayer server
npm install
npm start            # listens on 127.0.0.1:8792 (set HOST / PORT to change)
```

Open <http://localhost:8000/>. To use a local multiplayer server, add `?server=ws://127.0.0.1:8792` to the URL.
By default the game connects to `ws(s)://<host>/<path>/ws`, so in production put a reverse proxy in front of the server:

```nginx
location = /chamokart/ws {
    proxy_pass http://127.0.0.1:8792/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 1h;
}
```

## Fastest-lap boards

Each Time Trial posts its lap times to the multiplayer server, which keeps each racer's best lap and the top 10 per track.
Players are identified by an anonymous id stored in their browser (`localStorage.ck_pid`), not by name.
The server rejects laps faster than `MIN_LAP_S` in `server.mjs`, which is about 15% under the theoretical best lap at 150cc.
Lap times come from the player's browser, though, so a determined cheater could still post a fake one.

The boards are saved to `$RECORDS_FILE`, or `$STATE_DIRECTORY/records.json`, or `./records.json` if neither is set.
In production, a systemd drop-in (`StateDirectory=chamokart`) puts them at `/var/lib/chamokart/records.json`.
Each board entry can also have a **ghost**: the whole Time Trial run its lap came from (20 frames a second, about 45 KB). The game uploads it with the laps when the run could improve the player's entry. The server checks that it matches the lap times, keeps it in `$STATE_DIRECTORY/ghosts/<track>-<player id>.json`, and deletes it when the entry falls off the board. In Time Trial, players can race the best-ranked ghost on a board (normally #1's).

The server keeps the boards in memory, so to remove an entry, stop the service first:

```sh
systemctl stop chamokart-ws
# edit /var/lib/chamokart/records.json (entries are sorted by "time", fastest first)
systemctl start chamokart-ws
```

## Players, challenges and notifications

While the game is open it keeps a light "presence" connection (`js/presence.js`) that shares the player's name, racer and status (menus, racing, online room). It drops after a minute in the background. The 👥 Players screen lists everyone online. **⚔️ Challenge** creates a private room and invites the other player. If they're mid-race, the invite waits until they finish, and it expires after 2 minutes.

Players are shown by a public id derived from their private `ck_pid`, so the private one never leaves the server.

**The Custom racer** (CHARACTERS index 7, `CUSTOM` in `js/look.js`) is built from a "look": a small object of choices (head, eyes, hat, colours, decals, stats…) saved in the player's settings. It travels with them everywhere others can see them: the `profile` and `presence` messages, room grids, spectator casts, board entries and ghosts. The server re-checks it with `cleanLook` (unknown options fall back to the defaults, and the stats must add up to 12, 1 to 5 each). A racer in that slot with no look, like the CPU, is Calavera (`DEFAULT_LOOK`).

**👀 Watch** follows a player's races live. The watcher sends `{t:"watch", to: uid}` on its presence connection. While anyone is watching, the racer's game (`Broadcaster` in `js/spectate.js`) sends `cast` messages on its own presence connection: the grid once per race, then every kart ten times a second (`packKart`), the items on the road, events, and item box and coin changes. It sends nothing when nobody is watching. The server checks each message's shape (`cleanCast`) and passes it on to the watchers. The watcher's `SpectateSession` plays it back 0.3 s behind with the normal race view and HUD.

**Push notifications** (`push.mjs`, the `web-push` package and `sw.js`): players opt in on the Players screen. They're told when someone starts playing (at most once every 30 minutes, and not after a server restart) and when they're challenged while the game is closed. The server keeps its VAPID keys in `$STATE_DIRECTORY/vapid.json` and the subscriptions in `push.json`. Deleting `vapid.json` invalidates every subscription. On iPhone, push only works when the game was added to the Home Screen (`manifest.json`).

## Daily Challenge

`js/daily.js` picks each day's challenge from the UTC date, so every player gets the same one without asking the server.
It shuffles the tracks in blocks (one day per track), so each track comes up once per block and never two days running.
Each new track starts a new era in `ERAS` from the day after it ships (Mars Aliens on 2026-09-27; Miami Vice and Zoo City both on 2026-09-28); earlier days keep their rotation so their boards stay valid.
The server imports the same file to check that a submitted run belongs to today's challenge (or yesterday's, for 15 minutes after midnight).

- **Boards:** the server keeps each player's best 3-lap time per day in `$DAILY_FILE`, or `$STATE_DIRECTORY/daily.json` (`/var/lib/chamokart/daily.json` in production). It keeps the last 8 days.
- **Checks:** each run needs 3 laps that add up to the total time, and every lap must be at least `MIN_LAP_S` for the track, scaled by the day's speed class. As with the fastest-lap boards, a determined cheater could still post a fake time.
- **Editing:** as with `records.json`, stop `chamokart-ws` before you edit `daily.json`.

## Stats page

`/chamokart/stats/` is a private dashboard that shows each player's visits, races, results, IP address and location.
nginx protects it with basic auth, using the password file `/etc/nginx/chamokart-stats.htpasswd`.
To add or change a login, run `htpasswd -B /etc/nginx/chamokart-stats.htpasswd <user>`.

- **What the game reports:** a `hello` on every load, each finished Grand Prix, Versus or Time Trial race, and each finished cup. Each report goes over a short-lived WebSocket.
- **Online races:** recorded by the server itself when each race ends.
- **Storage:** `$STATE_DIRECTORY/stats.json`, which is `/var/lib/chamokart/stats.json` in production.
- **Location data:** comes from Cloudflare's request headers. `CF-Connecting-IP` and `CF-IPCountry` are always sent. City and region need Cloudflare's *Add visitor location headers* managed transform.
- **Data endpoint:** the page loads its data from `/chamokart/stats/data`. nginx proxies that to `127.0.0.1:8792/stats`, behind the same password.

## Publishing a "What's new" update

Players see the **What's new** screen as soon as the game loads whenever `changelog.json` has an entry they haven't seen yet. They can also reopen it from the main menu. To announce an update, add an entry at the **top** of the list:

```json
{ "id": "2026-10-02", "title": "Short headline", "items": ["One change per line.", "Another change."] }
```

- `id` must be new for every update, because each browser remembers the last `id` it showed (`localStorage.ck_seenChangelog`). A `YYYY-MM-DD` id is also shown as the date. For a second update on the same day, use something like `2026-10-02b`.
- Fixing a typo in an existing entry keeps its `id`, so nobody sees the screen again.
- Entries added since a player's last visit get a NEW tag. The file is fetched fresh on every load, so no `?v=` bump is needed.

## How it's built

```
index.html        screens and HUD markup
changelog.json    "What's new" entries shown on load (newest first)
css/style.css     all styling (phones: portrait + landscape layouts)
js/main.js        app shell: menus, game flow, online lobby
js/game.js        a race session: ties the simulation, rendering, HUD and audio together
js/sim/           rendering-free simulation: tracks, kart physics, items, CPU drivers, race rules
js/view/          three.js world, kart models, procedural textures, particles, camera
js/audio.js       procedural chiptune music, synthesized sound effects and engines
js/net.js         WebSocket client with clock sync
js/records.js     fastest-lap and daily boards (one-off requests to the server)
js/daily.js       the daily challenge for a date (shared with server.mjs)
js/voice.js       WebRTC voice chat (the server only relays signaling)
server.mjs        rooms, lobbies, race orchestration and lap records (Node + ws)
push.mjs          web push notifications ("X is playing", challenges)
sw.js             service worker that shows the notifications
js/presence.js    who's playing: the always-on presence connection
js/replay.js      instant replay: records the race, picks the best moments, plays them back
js/spectate.js    watching a race live: the racer streams it, the watcher plays it back
js/tutorial.js    the interactive tutorial: steps, goals and the coach card (mode "tutorial" on Chamo Circuit)
js/look.js        the Custom racer's look: options, validation (shared with server.mjs, keep it import-free)
js/view/custom.js builds the Custom racer's avatar and car dressing from a look
js/sharecard.js   the 📸 Share picture of a result (drawn on a canvas)
stats.mjs         player stats for the private stats page
stats/            the stats page (password-protected)
```

Each client simulates its own kart (and the host's CPUs); the server relays kart states and items, keeps the race clock and decides the official results.
