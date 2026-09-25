<p align="center">
  <img src=".github/logo.png" alt="Chamo Kart" width="420">
</p>

<p align="center"><b>¡Arranca, chamo!</b> A 3D kart racer that runs right in your browser.<br>
Race CPUs in the Copa Chamo, chase your own ghost, or race your friends online with voice chat.</p>

<p align="center"><a href="https://jgrivera.com/chamokart/"><b>▶ Play now at jgrivera.com/chamokart</b></a></p>

<p align="center"><img src="og-image.jpg" alt="The Chamo Kart racers lined up on the starting grid" width="720"></p>

## Features

- **Grand Prix:** race the 5-track Copa Chamo at 50cc, 100cc, 150cc or 200cc and win a trophy.
- **Versus and Time Trial:** single races with your own rules, or hot laps against your saved ghost.
- **Online multiplayer:** public and private rooms of up to 8 racers (CPUs fill the empty spots), lobby chat, in-race chat, voice chat over WebRTC and one-tap rematches.
- **8 racers and 3 karts:** Chamo, agenteintermediario, Paco, Nena, El Toro, Pollito, Luchador and Calavera, on the Clásico, Bala or Burro.
- **Items:** bananas, green and red cocos, chiles, the Estrella, the Rayo and a splash of Chamoy.
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

## How it's built

```
index.html        screens and HUD markup
css/style.css     all styling (phones: portrait + landscape layouts)
js/main.js        app shell: menus, game flow, online lobby
js/game.js        a race session: ties the simulation, rendering, HUD and audio together
js/sim/           rendering-free simulation: tracks, kart physics, items, CPU drivers, race rules
js/view/          three.js world, kart models, procedural textures, particles, camera
js/audio.js       procedural chiptune music, synthesized sound effects and engines
js/net.js         WebSocket client with clock sync
js/voice.js       WebRTC voice chat (the server only relays signaling)
server.mjs        rooms, lobbies and race orchestration (Node + ws)
```

Each client simulates its own kart (and the host's CPUs); the server relays kart states and items, keeps the race clock and decides the official results.
