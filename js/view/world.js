// Builds the visual world for a track: sky, lights, terrain, road, scenery.
import * as THREE from "three";
import { CURB } from "../sim/track.js?v=4";
import * as T from "./textures.js?v=9";
import { mat } from "./models.js?v=25";

export const THEMES = {
  meadow: {
    skyTop: 0x2f86e6, skyBottom: 0xcdeeff, fog: 0xd4ecff, fogNear: 220, fogFar: 1100,
    sun: 0xfff1d6, sunI: 2.7, hemiSky: 0xd8ecff, hemiGround: 0x4e7a34, hemiI: 1.15,
    near: 0x4f9e3c, far: 0x78b85a, high: 0x8ac070, mountain: 0x5f8f64, mountain2: 0x86a98a,
  },
  desert: {
    skyTop: 0x3f8fe0, skyBottom: 0xffe3b8, fog: 0xf5dcb5, fogNear: 200, fogFar: 1000,
    sun: 0xffe6c0, sunI: 3.0, hemiSky: 0xffe9cc, hemiGround: 0xa0643a, hemiI: 1.1,
    near: 0xe0b27a, far: 0xc9854e, high: 0xb3643a, mountain: 0xb0603a, mountain2: 0xcf8a5a,
  },
  snow: {
    skyTop: 0x5a8fd0, skyBottom: 0xe6f0ff, fog: 0xe8f0fb, fogNear: 160, fogFar: 950,
    sun: 0xffffff, sunI: 2.4, hemiSky: 0xeaf2ff, hemiGround: 0x8090a8, hemiI: 1.25,
    near: 0xf2f6ff, far: 0xdfe8f5, high: 0xffffff, mountain: 0x9fb0c8, mountain2: 0xe8eef8,
  },
  beach: {
    skyTop: 0x1f9be8, skyBottom: 0xc6f3ff, fog: 0xcff1ff, fogNear: 240, fogFar: 1200,
    sun: 0xfff3dc, sunI: 2.8, hemiSky: 0xd6f4ff, hemiGround: 0xd0b080, hemiI: 1.15,
    near: 0xf2d9a2, far: 0xe6c88a, high: 0x6fae4f, mountain: 0x4f9a5a, mountain2: 0x7cbf7a,
  },
  neon: {
    skyTop: 0x05010f, skyBottom: 0x2a0a4a, fog: 0x14052a, fogNear: 250, fogFar: 1300,
    sun: 0xc9a8ff, sunI: 1.6, hemiSky: 0x6a4aff, hemiGround: 0x200a40, hemiI: 1.3,
    near: 0x221040, far: 0x120828, high: 0x331a5a, mountain: 0x3a1a6a, mountain2: 0x5a2a8a,
  },
  mars: {
    skyTop: 0x8a3a22, skyBottom: 0xf2b27a, fog: 0xe9a26c, fogNear: 200, fogFar: 1050,
    sun: 0xffe6cc, sunI: 2.6, hemiSky: 0xffc9a0, hemiGround: 0x7a3018, hemiI: 1.15,
    near: 0xc65a2e, far: 0xa8461f, high: 0x7c2f18, mountain: 0x8a3a20, mountain2: 0xb4603c,
  },
  // Michael Mann's Miami: humid night, teal sodium haze, city glow on the horizon
  miami: {
    skyTop: 0x02060f, skyBottom: 0x1b3c5c, fog: 0x0f2638, fogNear: 160, fogFar: 950,
    sun: 0xa8c4ff, sunI: 1.4, hemiSky: 0x7090c8, hemiGround: 0x1a1a2a, hemiI: 1.3,
    near: 0x34463a, far: 0x2a3830, high: 0x3a3a40, mountain: 0x0f1a28, mountain2: 0x142238,
  },
  // Safari Run (beta): late-afternoon savanna, golden grass and haze
  savanna: {
    skyTop: 0x4a90d8, skyBottom: 0xffe2b0, fog: 0xf2dcb0, fogNear: 230, fogFar: 1150,
    sun: 0xffe2b8, sunI: 2.9, hemiSky: 0xffe8c8, hemiGround: 0x8a6a30, hemiI: 1.15,
    near: 0xc9a24e, far: 0xb8903e, high: 0x9a8a48, mountain: 0x8a7a5a, mountain2: 0xa89870,
  },
  zoo: {
    skyTop: 0x3a8fe8, skyBottom: 0xd6f0ff, fog: 0xdcefff, fogNear: 240, fogFar: 1150,
    sun: 0xfff1d6, sunI: 2.7, hemiSky: 0xd8ecff, hemiGround: 0x4e7a34, hemiI: 1.15,
    near: 0x5aa845, far: 0x7cbf5a, high: 0x8ac070, mountain: 0x5f8f64, mountain2: 0x86a98a,
  },
};

// --------------------------------------------------------------- noise
function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z) {
  return vnoise(x, z) * 0.6 + vnoise(x * 2.1, z * 2.1) * 0.28 + vnoise(x * 4.3, z * 4.3) * 0.12;
}
const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// --------------------------------------------------------------- world
export function buildWorld(scene, track, quality = "high") {
  const def = track.def;
  const theme = def.theme;
  const th = THEMES[theme];
  const group = new THREE.Group();
  scene.add(group);
  const animated = [];
  const saucers = []; // Mars spacecraft: { obj, spin, path? }
  animated.push((dt, time) => {
    for (const u of saucers) {
      u.obj.rotation.y += u.spin * dt;
      const p = u.path;
      if (p) {
        const a = p.a + time * p.w;
        u.obj.position.set(p.x + Math.cos(a) * p.r, p.y + Math.sin(time * 1.3 + p.ph) * 2, p.z + Math.sin(a) * p.r);
      }
      const lights = u.obj.userData.lights;
      for (let i = 0; i < lights.length; i++) lights[i].material.color.setHSL((i / lights.length + time * 0.4) % 1, 1, 0.6);
    }
  });
  const rand = seeded(1000 + track.N);
  const b = track.bounds;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const radius = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2;

  scene.background = new THREE.Color(th.skyBottom);
  scene.fog = new THREE.Fog(th.fog, th.fogNear, th.fogFar);

  // Sky dome
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color(th.skyTop) }, bottom: { value: new THREE.Color(th.skyBottom) } },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.08,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, pow(h,0.8)),1.0); }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), skyMat);
  sky.renderOrder = -10;
  group.add(sky);
  animated.push((dt, time, cam) => sky.position.copy(cam.position));

  // Lights
  const hemi = new THREE.HemisphereLight(th.hemiSky, th.hemiGround, th.hemiI);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(th.sun, th.sunI);
  const sunDir = new THREE.Vector3(0.45, 0.8, 0.3).normalize();
  sun.position.copy(sunDir).multiplyScalar(120);
  if (quality !== "low") {
    sun.castShadow = true;
    const size = quality === "high" ? 2048 : 1024;
    sun.shadow.mapSize.set(size, size);
    const s = 55;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 300 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.04;
  }
  group.add(sun);
  group.add(sun.target);

  // ------------------------------------------------------------- helpers
  const N = track.N;
  const { px, pz, py, hw, tx, tz, bump, gap } = track;
  const wallDist = (i) => hw[i] + CURB + track.shoulder;
  const cell = track.cell;

  function nearest(x, z, maxR = 4) {
    const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
    let best = -1, bd = Infinity;
    for (let dx = -maxR; dx <= maxR; dx++)
      for (let dz = -maxR; dz <= maxR; dz++) {
        const list = track.grid.get(track.key(gx + dx, gz + dz));
        if (!list) continue;
        for (const i of list) {
          const d = (x - px[i]) ** 2 + (z - pz[i]) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
      }
    return [best, Math.sqrt(bd)];
  }

  function baseHeight(x, z) {
    const n = fbm(x / 140, z / 140);
    const dc = Math.hypot(x - cx, z - cz);
    const edge = smoothstep(radius + 60, radius + 380, dc);
    switch (theme) {
      case "meadow": return n * 16 - 5 + edge * 60 * fbm(x / 90, z / 90);
      case "desert": return 10 + n * 26 + edge * 50;
      case "snow": return n * 26 - 4 + edge * 120 * fbm(x / 110, z / 110);
      case "beach": return -9 + Math.max(0, fbm(x / 70 + 9, z / 70) - 0.55) * 60 + edge * 25 * fbm(x / 80, z / 80);
      case "mars": return 6 + n * 22 + edge * 110 * fbm(x / 120, z / 120) + craterHeight(x, z);
      case "miami": return -7 + 8.8 * miamiLand(x, z) + n * 1.5;
      case "zoo": return n * 8 - 2 + edge * 40 * fbm(x / 90, z / 90);
      case "savanna": return n * 8 - 2 + edge * 45 * fbm(x / 100, z / 100);
      default: return -200;
    }
  }

  function terrainHeight(x, z) {
    const [i, d] = nearest(x, z);
    const base = baseHeight(x, z);
    if (i < 0) return base;
    const road = py[i] - 0.08;
    const wd = wallDist(i);
    if (track.boundary === "wall") {
      if (gap[i] && d < wd + 10) return road - 32;
      // Zoo City's enclosures sit on level ground; Miami's causeways drop straight into the
      // bay; elsewhere the land eases away from the road.
      // Safari Run's herds wait on level ground beside the road too.
      const level = theme === "zoo" ? 48 : theme === "savanna" ? 30 : 2.5;
      if (d < wd + level) return road;
      return road + (base - road) * smoothstep(wd + level, wd + (theme === "miami" ? 14 : theme === "zoo" ? 110 : theme === "savanna" ? 90 : 55), d);
    }
    // Void boundary (beach): sand shoulders, then slope into the sea.
    if (d < wd + 0.3) return road;
    const t = smoothstep(wd + 0.3, wd + 14, d);
    return road + (Math.min(base, road - 7) - road) * t + Math.max(0, base - (road - 7)) * smoothstep(wd + 40, wd + 90, d);
  }

  // ------------------------------------------------------------- Miami land
  // Miami Beach (Ocean Drive, west), the island at the far turn, and downtown across the bay.
  // Everything else is water.
  const downtown = { x: b.maxX + 330, z: cz + 140, r: 260 };
  let island = null;
  if (theme === "miami") {
    let far = -Infinity;
    for (let i = 0; i < N; i += 4) if (px[i] > far) { far = px[i]; island = { x: px[i] + 20, z: pz[i] }; }
  }
  function miamiLand(x, z) {
    const west = smoothstep(75, 30, x);
    const isle = island ? 1 - smoothstep(55, 95, Math.hypot(x - island.x, z - island.z)) : 0;
    const city = 1 - smoothstep(downtown.r - 40, downtown.r, Math.hypot(x - downtown.x, z - downtown.z));
    return Math.max(west, isle, city);
  }

  // ------------------------------------------------------------- Zoo enclosures
  // Each enclosure runs along a stretch of the lap on one side of the road, from the wall
  // out to ENCLOSURE_DEPTH, with its own ground colour, animals and props.
  const ENCLOSURE_DEPTH = 46;
  const HABITAT = { savanna: 0xd9c27a, dirt: 0xb99468, grass: 0x8cc860, snow: 0xeef4fa, bamboo: 0x5e9a3a, jungle: 0x3f8a3a };
  const zones = theme !== "zoo" ? [] : [
    // size: storybook scale, so even penguins are easy to spot from a kart
    { kind: "giraffe", name: "GIRAFFES", f0: 0.03, f1: 0.14, ground: "savanna", count: 6, size: 1.35 },
    { kind: "elephant", name: "ELEPHANTS", f0: 0.16, f1: 0.26, ground: "dirt", count: 5, size: 1.6 },
    { kind: "lion", name: "LIONS", f0: 0.27, f1: 0.36, ground: "savanna", count: 6, size: 2 },
    { kind: "zebra", name: "ZEBRAS", f0: 0.37, f1: 0.46, ground: "grass", count: 9, size: 1.7 },
    { kind: "penguin", name: "PENGUINS", f0: 0.48, f1: 0.56, ground: "snow", count: 16, size: 2.4, pool: 0x7fd3ff },
    { kind: "flamingo", name: "FLAMINGOS", f0: 0.58, f1: 0.66, ground: "grass", count: 14, size: 2, pool: 0x4fb8d8 },
    { kind: "panda", name: "PANDAS", f0: 0.67, f1: 0.75, ground: "bamboo", count: 6, size: 2.4 },
    { kind: "monkey", name: "MONKEYS", f0: 0.77, f1: 0.86, ground: "jungle", count: 12, size: 2.6 },
    { kind: "hippo", name: "HIPPOS", f0: 0.87, f1: 0.97, ground: "dirt", count: 5, size: 1.7, pool: 0x5aa0b8 },
  ];
  const lateralOf = (i, x, z) => (x - px[i]) * -tz[i] + (z - pz[i]) * tx[i]; // + right of the road, - left
  const zoneOf = new Array(N).fill(null);
  for (const zn of zones) {
    zn.k0 = Math.round(zn.f0 * N);
    zn.k1 = Math.round(zn.f1 * N);
    // Put it on whichever side of the road has more room at its middle.
    const k = Math.round((zn.k0 + zn.k1) / 2);
    let best = -Infinity;
    for (const sd of [-1, 1]) {
      const l = sd * (wallDist(k) + 30);
      const [d, i] = roadDist(px[k] + -tz[k] * l, pz[k] + tx[k] * l);
      if (d - wallDist(i) > best) { best = d - wallDist(i); zn.side = sd; }
    }
    for (let i = zn.k0; i <= zn.k1; i++) zoneOf[i % N] = zn;
  }
  // The enclosure (if any) that (x, z) falls in, given its nearest road sample i at distance d.
  function enclosureAt(x, z, i, d) {
    const zn = i >= 0 ? zoneOf[i] : null;
    if (!zn || d > wallDist(i) + ENCLOSURE_DEPTH || Math.sign(lateralOf(i, x, z)) !== zn.side) return null;
    return zn;
  }

  // ------------------------------------------------------------- Mars craters
  // Distance from (x, z) to the road centerline, by brute force (build time only).
  function roadDist(x, z) {
    let bd = Infinity, bi = 0;
    for (let i = 0; i < N; i += 2) {
      const d = (x - px[i]) ** 2 + (z - pz[i]) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    return [Math.sqrt(bd), bi];
  }
  function insideLoop(x, z) {
    let inside = false;
    for (let i = 0, j = N - 1; i < N; j = i++) {
      if (pz[i] > z !== pz[j] > z && x < ((px[j] - px[i]) * (z - pz[i])) / (pz[j] - pz[i]) + px[i]) inside = !inside;
    }
    return inside;
  }
  const craters = [];
  let mainCrater = null;
  if (theme === "mars") {
    // The biggest crater sits in the roomiest spot inside the loop: that's where the mothership lands.
    let best = 0;
    for (let x = b.minX; x <= b.maxX; x += 6)
      for (let z = b.minZ; z <= b.maxZ; z += 6) {
        if (!insideLoop(x, z)) continue;
        const [d, i] = roadDist(x, z);
        const room = d - wallDist(i);
        if (room > best) { best = room; mainCrater = { x, z }; }
      }
    if (mainCrater) {
      mainCrater.r = Math.max(14, Math.min(55, (best - 10) * 0.75));
      mainCrater.depth = mainCrater.r * 0.22;
      craters.push(mainCrater);
    }
    for (let tries = 0; tries < 400 && craters.length < 18; tries++) {
      const x = b.minX - 300 + rand() * (b.maxX - b.minX + 600);
      const z = b.minZ - 300 + rand() * (b.maxZ - b.minZ + 600);
      const r = 12 + rand() * 38;
      const [d, i] = roadDist(x, z);
      if (d < wallDist(i) + r * 1.5 + 20) continue;
      if (craters.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + r + 10)) continue;
      craters.push({ x, z, r, depth: r * (0.18 + rand() * 0.1) });
    }
  }
  // Bowl plus a raised rim.
  function craterHeight(x, z) {
    let h = 0;
    for (const c of craters) {
      const d = Math.hypot(x - c.x, z - c.z) / c.r;
      if (d > 1.8) continue;
      if (d < 1) h -= c.depth * (1 - d * d);
      h += c.depth * 0.45 * Math.exp(-(((d - 1) / 0.22) ** 2));
    }
    return h;
  }

  // ------------------------------------------------------------- terrain
  if (theme !== "neon") {
    const margin = 420;
    const W = b.maxX - b.minX + margin * 2, H = b.maxZ - b.minZ + margin * 2;
    const step = quality === "low" ? 6 : 4.5;
    const nx = Math.ceil(W / step), nz = Math.ceil(H / step);
    const geo = new THREE.PlaneGeometry(W, H, nx, nz);
    geo.rotateX(-Math.PI / 2);
    geo.translate(cx, 0, cz);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cNear = new THREE.Color(th.near), cFar = new THREE.Color(th.far), cHigh = new THREE.Color(th.high), cDeep = new THREE.Color(0x5a2212);
    const tmp = new THREE.Color();
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v), z = pos.getZ(v);
      const h = terrainHeight(x, z);
      pos.setY(v, h);
      const [i, d] = nearest(x, z, 3);
      const nearF = i < 0 ? 0 : 1 - smoothstep(10, 45, d - (i >= 0 ? wallDist(i) : 0));
      tmp.copy(cFar).lerp(cNear, nearF);
      if (theme === "snow" || theme === "meadow" || theme === "desert" || theme === "mars") {
        const hf = smoothstep(18, 60, h - (i >= 0 ? py[i] : 0));
        tmp.lerp(cHigh, hf * 0.8);
      }
      if (theme === "mars") tmp.lerp(cDeep, smoothstep(-1, -9, h - (i >= 0 ? py[i] : 0)) * 0.55); // shadowy crater floors
      if (theme === "zoo") {
        const zn = enclosureAt(x, z, i, d);
        if (zn) {
          const wd = wallDist(i);
          const t = smoothstep(wd + 1, wd + 5, d) * (1 - smoothstep(wd + ENCLOSURE_DEPTH - 4, wd + ENCLOSURE_DEPTH, d));
          const along = Math.min(i - zn.k0, zn.k1 - i);
          tmp.lerp(new THREE.Color(HABITAT[zn.ground]), t * smoothstep(0, 6, along));
        }
      }
      if (theme === "miami" && h < 0.8) tmp.set(0x6e6452).lerp(new THREE.Color(0x0b1a24), smoothstep(0.8, -2, h)); // sand, then seabed
      if (theme === "beach") {
        if (h < -1.2) tmp.set(0xd8c08a).lerp(new THREE.Color(0x9ec8b0), smoothstep(-1.2, -6, h));
        else if (h > 1.5) tmp.lerp(cHigh, smoothstep(1.5, 6, h));
      }
      const jitter = 0.94 + hash(x * 0.37, z * 0.37) * 0.1;
      colors[v * 3] = tmp.r * jitter;
      colors[v * 3 + 1] = tmp.g * jitter;
      colors[v * 3 + 2] = tmp.b * jitter;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const gtex = T.groundTexture(theme).clone();
    gtex.needsUpdate = true;
    gtex.userData.owned = true;
    gtex.repeat.set(W / 14, H / 14);
    const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: gtex, vertexColors: true }));
    terrain.receiveShadow = true;
    group.add(terrain);
  }

  // Water
  if (theme === "miami") {
    const wtex = T.waterTexture().clone();
    wtex.needsUpdate = true;
    wtex.userData.owned = true;
    wtex.repeat.set(200, 200);
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(5000, 5000),
      new THREE.MeshStandardMaterial({ color: 0x0c2c40, map: wtex, roughness: 0.18, metalness: 0.55 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(cx, -1.2, cz);
    water.receiveShadow = true;
    group.add(water);
    animated.push((dt, time) => wtex.offset.set(time * 0.006, time * 0.004));
  }
  if (theme === "beach") {
    const wtex = T.waterTexture().clone();
    wtex.needsUpdate = true;
    wtex.userData.owned = true;
    wtex.repeat.set(160, 160);
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshStandardMaterial({ color: 0x1fb5d6, map: wtex, transparent: true, opacity: 0.88, roughness: 0.15, metalness: 0.1 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(cx, -1.4, cz);
    water.receiveShadow = true;
    group.add(water);
    animated.push((dt, time) => {
      wtex.offset.set(time * 0.01, time * 0.006);
      water.position.y = -1.4 + Math.sin(time * 0.8) * 0.12;
    });
  }

  // ------------------------------------------------------------- road
  function strip(latA, latB, yOff, vScale, skip) {
    const verts = [], uvs = [], idx = [];
    let dist = 0;
    for (let i = 0; i <= N; i++) {
      const k = i % N;
      if (i > 0) dist += track.spacing;
      const rx = -tz[k], rz = tx[k];
      const la = latA(k), lb = latB(k);
      const y = py[k] + bump[k] + yOff;
      verts.push(px[k] + rx * la, y, pz[k] + rz * la, px[k] + rx * lb, y, pz[k] + rz * lb);
      uvs.push(0, dist / vScale, 1, dist / vScale);
      if (i > 0 && !(skip && skip(k, (k - 1 + N) % N))) {
        const a = (i - 1) * 2, c = i * 2;
        idx.push(a, a + 1, c, a + 1, c + 1, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  const noGap = (k, j) => gap[k] || gap[j];

  const roadTex = T.roadTexture(theme);
  const roadMat =
    theme === "neon"
      ? new THREE.MeshBasicMaterial({ map: roadTex, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide });
  // Road normals must face up: strip goes left(-hw) -> right(+hw); flip winding if needed via DoubleSide.
  const road = new THREE.Mesh(strip((k) => -hw[k], (k) => hw[k], 0.03, 24, noGap), roadMat);
  road.receiveShadow = true;
  group.add(road);

  const curbMat = theme === "neon"
    ? new THREE.MeshBasicMaterial({ map: T.curbTexture(theme), side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({ map: T.curbTexture(theme), roughness: 0.7, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    const curb = new THREE.Mesh(
      strip((k) => s * hw[k], (k) => s * (hw[k] + CURB), 0.05, 4, noGap),
      curbMat
    );
    curb.receiveShadow = true;
    group.add(curb);
  }

  // Floating slab under void roads (neon) so the road reads as solid.
  if (theme === "neon") {
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x1a0a3a, roughness: 0.6, emissive: 0x12052a, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const verts = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const k = i % N;
        const rx = -tz[k], rz = tx[k];
        const l = s * (hw[k] + CURB);
        const y = py[k] + bump[k];
        verts.push(px[k] + rx * l, y + 0.04, pz[k] + rz * l, px[k] + rx * l * 0.9, y - 2.2, pz[k] + rz * l * 0.9);
        if (i > 0 && !noGap(k, (k - 1 + N) % N)) {
          const a = (i - 1) * 2, c = i * 2;
          idx.push(a, c, a + 1, a + 1, c, c + 1);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      group.add(new THREE.Mesh(g, slabMat));
      // Glow rail
      const railMat = new THREE.MeshBasicMaterial({ color: s > 0 ? 0x20e7ff : 0xff2bd6 });
      const rail = new THREE.Mesh(strip((k) => s * (hw[k] + CURB - 0.25), (k) => s * (hw[k] + CURB + 0.15), 0.12, 10, noGap), railMat);
      group.add(rail);
    }
    const under = new THREE.Mesh(strip((k) => -(hw[k] + CURB) * 0.9, (k) => (hw[k] + CURB) * 0.9, -2.2, 24, noGap), slabMat);
    group.add(under);
  }

  // Walls
  if (track.boundary === "wall") {
    const wtex = T.wallTexture(theme);
    const wmat = new THREE.MeshStandardMaterial({ map: wtex, roughness: 0.8, side: THREE.DoubleSide });
    const topMat = mat(theme === "snow" ? 0xffffff : theme === "desert" ? 0x6e4424 : 0xdddddd);
    for (const s of [-1, 1]) {
      const verts = [], uvs = [], idx = [], tv = [], tIdx = [];
      let dist = 0;
      for (let i = 0; i <= N; i++) {
        const k = i % N;
        if (i > 0) dist += track.spacing;
        const rx = -tz[k], rz = tx[k];
        const l = s * (wallDist(k) + 0.2);
        const l2 = s * (wallDist(k) + 0.9);
        const y = py[k];
        const h = theme === "snow" ? 1.0 : 1.15;
        verts.push(px[k] + rx * l, y - 0.3, pz[k] + rz * l, px[k] + rx * l, y + h, pz[k] + rz * l);
        uvs.push(dist / 8, 0, dist / 8, 1);
        tv.push(px[k] + rx * l, y + h, pz[k] + rz * l, px[k] + rx * l2, y + h, pz[k] + rz * l2);
        if (i > 0 && !noGap(k, (k - 1 + N) % N)) {
          const a = (i - 1) * 2, c = i * 2;
          idx.push(a, c, a + 1, a + 1, c, c + 1);
          tIdx.push(a, c, a + 1, a + 1, c, c + 1);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const wall = new THREE.Mesh(g, wmat);
      wall.castShadow = true;
      wall.receiveShadow = true;
      group.add(wall);
      const tg = new THREE.BufferGeometry();
      tg.setAttribute("position", new THREE.Float32BufferAttribute(tv, 3));
      tg.setIndex(tIdx);
      tg.computeVertexNormals();
      const top = new THREE.Mesh(tg, topMat);
      top.material.side = THREE.DoubleSide;
      group.add(top);
    }
  }

  // Start line
  {
    const len = 3;
    const verts = [], uvs = [];
    const w = hw[0] + CURB;
    const rx = -tz[0], rz = tx[0];
    const y = py[0] + 0.07;
    for (const [l, f, u, v] of [[-w, -len / 2, 0, 0], [w, -len / 2, 1, 0], [-w, len / 2, 0, 1], [w, len / 2, 1, 1]]) {
      verts.push(px[0] + rx * l + tx[0] * f, y, pz[0] + rz * l + tz[0] * f);
      uvs.push(u * 3, v);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex([0, 2, 1, 1, 2, 3]);
    g.computeVertexNormals();
    const ct = T.checkerTexture();
    const line = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: ct, roughness: 0.8, side: THREE.DoubleSide }));
    line.receiveShadow = true;
    group.add(line);

    // Gate
    const gate = new THREE.Group();
    const span = track.boundary === "wall" ? wallDist(0) + 0.6 : w + 1.5;
    const pillarMat = theme === "neon" ? new THREE.MeshBasicMaterial({ color: 0xff2bd6 }) : mat(0xe23b3b, { rough: 0.4 });
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 9, 1.2), pillarMat);
      p.position.set(s * span, 4.5, 0);
      p.castShadow = true;
      gate.add(p);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10), mat(0xffd23f, { metal: 0.6, rough: 0.3 }));
      cap.position.set(s * span, 9.4, 0);
      gate.add(cap);
    }
    const bannerMat = new THREE.MeshBasicMaterial({ map: T.bannerTexture("KART CHAOS") });
    for (const side of [0, Math.PI]) {
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(span * 2, span * 2 / 8), bannerMat);
      banner.position.set(0, 7.8, side ? 0.05 : -0.05);
      banner.rotation.y = side;
      gate.add(banner);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 1.2, 0.5, 0.6), pillarMat);
    beam.position.set(0, 9.2, 0);
    gate.add(beam);
    gate.position.set(px[0], py[0], pz[0]);
    // Local +z = along the road, local x = across it.
    gate.rotation.y = Math.atan2(tx[0], tz[0]);
    group.add(gate);
  }

  // Boost pads
  const padTex = T.boostTexture();
  const padMat = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
  for (const pad of track.boosts) {
    const verts = [], uvs = [];
    const steps = pad.len + 1;
    for (let j = 0; j <= steps; j++) {
      const k = track.wrap(pad.i + j - 0.5 | 0);
      const rx = -tz[k], rz = tx[k];
      const c = pad.lat * hw[k];
      const y = py[k] + bump[k] + 0.09;
      verts.push(px[k] + rx * (c - pad.half), y, pz[k] + rz * (c - pad.half), px[k] + rx * (c + pad.half), y, pz[k] + rz * (c + pad.half));
      uvs.push(0, (j / steps) * 1.4, 1, (j / steps) * 1.4);
    }
    const idx = [];
    for (let j = 0; j < steps; j++) {
      const a = j * 2, c = a + 2;
      idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    group.add(new THREE.Mesh(g, padMat));
  }
  animated.push((dt, time) => (padTex.offset.y = -time * 1.5));

  // Ramps (visual skin over the bumped road + side panels)
  {
    const rampMat = new THREE.MeshStandardMaterial({ map: T.rampTexture(), roughness: 0.6, side: THREE.DoubleSide });
    const sideMat = mat(0x1e2a44);
    for (const lip of track.ramps) {
      let start = lip;
      while (bump[track.wrap(start - 1)] > 0) start = track.wrap(start - 1);
      const verts = [], uvs = [], idx = [], sv = [], sIdx = [];
      const count = track.delta(start, lip) + 1;
      for (let j = 0; j < count; j++) {
        const k = track.wrap(start + j);
        const rx = -tz[k], rz = tx[k];
        const w = hw[k] + CURB;
        const y = py[k] + bump[k] + 0.08;
        verts.push(px[k] - rx * w, y, pz[k] - rz * w, px[k] + rx * w, y, pz[k] + rz * w);
        uvs.push(0, j / 3, w / 3, j / 3);
        for (const s of [-1, 1]) sv.push(px[k] + rx * w * s, py[k] - 0.2, pz[k] + rz * w * s, px[k] + rx * w * s, y, pz[k] + rz * w * s);
        if (j > 0) {
          const a = (j - 1) * 2, c = j * 2;
          idx.push(a, c, a + 1, a + 1, c, c + 1);
          const sa = (j - 1) * 4, sc = j * 4;
          sIdx.push(sa, sc, sa + 1, sa + 1, sc, sc + 1, sa + 2, sc + 2, sa + 3, sa + 3, sc + 2, sc + 3);
        }
      }
      // Front face at the lip
      const k = lip;
      const rx = -tz[k], rz = tx[k], w = hw[k] + CURB;
      const base = sv.length / 3;
      sv.push(px[k] - rx * w, py[k] - 0.2, pz[k] - rz * w, px[k] + rx * w, py[k] - 0.2, pz[k] + rz * w, px[k] - rx * w, py[k] + bump[k], pz[k] - rz * w, px[k] + rx * w, py[k] + bump[k], pz[k] + rz * w);
      sIdx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, rampMat);
      m.receiveShadow = true;
      group.add(m);
      const sg = new THREE.BufferGeometry();
      sg.setAttribute("position", new THREE.Float32BufferAttribute(sv, 3));
      sg.setIndex(sIdx);
      sg.computeVertexNormals();
      group.add(new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: 0x1e2a44, side: THREE.DoubleSide })));
      void sideMat;
    }
  }

  // Papel picado (festive flag strings across the road)
  if (theme !== "neon" && theme !== "miami") {
    const colors = [0xff3b6b, 0xffd23f, 0x3bc8ff, 0x3bff8a, 0xff9a3b, 0xb05bff, 0xff5bd6];
    const verts = [], cols = [];
    const poleMat = mat(0x6b4a2b);
    const at = [0.12, 0.37, 0.62, 0.9];
    const tmpc = new THREE.Color();
    for (const f of at) {
      const k = Math.round(f * N) % N;
      if (gap[k] || bump[k] > 0) continue;
      const rx = -tz[k], rz = tx[k];
      const span = (track.boundary === "wall" ? wallDist(k) + 1.2 : hw[k] + CURB + 1.5);
      const top = py[k] + 8;
      for (const s of [-1, 1]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 8.6, 8), poleMat);
        pole.position.set(px[k] + rx * span * s, py[k] + 4.2, pz[k] + rz * span * s);
        pole.castShadow = true;
        group.add(pole);
      }
      for (let row = 0; row < 2; row++) {
        const n = Math.round(span * 1.2);
        for (let j = 0; j < n; j++) {
          const u = (j + 0.5) / n;
          const l = -span + u * 2 * span;
          const sag = Math.sin(u * Math.PI) * (1.6 + row * 0.6);
          const y = top - row * 1.2 - sag;
          const x = px[k] + rx * l + tx[k] * row * 0.6, z = pz[k] + rz * l + tz[k] * row * 0.6;
          const hwf = (span / n) * 0.8;
          // flag quad hanging down with a notched bottom
          const p = [
            [x - rx * hwf, y, z - rz * hwf], [x + rx * hwf, y, z + rz * hwf],
            [x - rx * hwf, y - 1.1, z - rz * hwf], [x + rx * hwf, y - 1.1, z + rz * hwf],
            [x, y - 0.8, z],
          ];
          const tri = [[0, 2, 4], [0, 4, 1], [1, 4, 3]];
          tmpc.set(colors[(j + row * 3 + k) % colors.length]);
          for (const t of tri) for (const vi of t) {
            verts.push(...p[vi]);
            cols.push(tmpc.r, tmpc.g, tmpc.b);
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    g.computeVertexNormals();
    const flags = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    group.add(flags);
  }

  // ------------------------------------------------------------- scenery
  const protos = scenery(theme);
  const placements = new Map();
  const place = (name, x, y, z, s, ry) => {
    if (!placements.has(name)) placements.set(name, []);
    placements.get(name).push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(s, s, s)));
  };
  const count = quality === "low" ? 220 : 480;
  const kinds = {
    meadow: [["tree", 0.55], ["bush", 0.3], ["rock", 0.15]],
    desert: [["cactus", 0.5], ["rock", 0.35], ["bush", 0.15]],
    snow: [["pine", 0.75], ["snowman", 0.08], ["rock", 0.17]],
    beach: [["palm", 0.55], ["umbrella", 0.15], ["bush", 0.3]],
    neon: [["crystal", 0.6], ["ring", 0.4]],
    mars: [["rock", 0.4], ["spire", 0.16], ["alien", 0.16], ["glow", 0.14], ["dish", 0.07], ["habitat", 0.07]],
    miami: [["palm", 0.8], ["bush", 0.2]],
    zoo: [["tree", 0.6], ["bush", 0.3], ["rock", 0.1]],
    savanna: [["acacia", 0.3], ["tuft", 0.4], ["bush", 0.18], ["rock", 0.12]],
  }[theme];
  let placed = 0;
  for (let tries = 0; tries < count * 8 && placed < count; tries++) {
    const x = b.minX - 150 + rand() * (b.maxX - b.minX + 300);
    const z = b.minZ - 150 + rand() * (b.maxZ - b.minZ + 300);
    const [i, d] = nearest(x, z, 5);
    const wd = i >= 0 ? wallDist(i) : 0;
    if (i >= 0 && d < wd + 6) continue;
    if (i < 0 && theme !== "neon" && rand() < 0.6) continue;
    let y;
    if (theme === "neon") {
      y = (i >= 0 ? py[i] : 15) + (rand() - 0.4) * 60;
      if (i >= 0 && d < wd + 20) continue;
    } else {
      y = terrainHeight(x, z);
      if (theme === "beach" && y < -0.6) continue;
      if (theme === "miami" && (y < 0.3 || miamiLand(x, z) < 0.9)) continue; // palms stay on land
      if (theme === "zoo" && enclosureAt(x, z, i, d)) continue; // enclosures get their own props
    }
    let r = rand(), kind = kinds[0][0];
    for (const [k, p] of kinds) {
      if (r < p) { kind = k; break; }
      r -= p;
    }
    // keep big things away from the road
    if ((kind === "rock" && theme === "desert") && d < wd + 14) continue;
    if (mainCrater && Math.hypot(x - mainCrater.x, z - mainCrater.z) < mainCrater.r * 1.2) continue; // the mothership's landing site
    place(kind, x, y, z, 0.8 + rand() * 0.7, rand() * Math.PI * 2);
    placed++;
  }
  // Theme set pieces
  if (theme === "desert") {
    for (let i = 0; i < 26; i++) {
      const a = rand() * Math.PI * 2, r = radius + 180 + rand() * 350;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      place("mesa", x, terrainHeight(x, z) - 4, z, 0.7 + rand() * 1.2, rand() * 6);
    }
  }
  if (theme === "miami") buildMiami();
  if (theme === "zoo") buildZoo();
  if (theme === "savanna") buildSavanna();
  if (theme === "mars") {
    // Mothership parked in the big crater, with a welcoming committee
    if (mainCrater) {
      const { x, z, r } = mainCrater;
      const ship = buildSaucer(true);
      ship.scale.setScalar(Math.min(2.6, r / 11));
      ship.position.set(x, terrainHeight(x, z) + 3.2 * ship.scale.y, z); // feet on the crater floor
      group.add(ship);
      saucers.push({ obj: ship, spin: 0.15 });
      for (let j = 0; j < 9; j++) {
        const a = (j / 9) * Math.PI * 2 + 0.3;
        const ax = x + Math.cos(a) * r * 0.8, az = z + Math.sin(a) * r * 0.8;
        place("alien", ax, terrainHeight(ax, az), az, 1.1 + rand() * 0.3, Math.atan2(-Math.cos(a), -Math.sin(a))); // facing the ship
      }
    }
    // A rocket on its pad beside the start straight, on whichever side has more room
    {
      const k = Math.round(N * 0.035);
      const rx = -tz[k], rz = tx[k];
      let spot = null, room = -1;
      for (const s of [-1, 1]) {
        const l = s * (wallDist(k) + 24);
        const x = px[k] + rx * l, z = pz[k] + rz * l;
        const [d, i] = roadDist(x, z);
        if (d - wallDist(i) > room) { room = d - wallDist(i); spot = [x, z]; }
      }
      if (spot) {
        const rocket = buildRocket();
        rocket.position.set(spot[0], terrainHeight(spot[0], spot[1]) - 0.3, spot[1]);
        group.add(rocket);
      }
    }
    // Flying saucers cruising over the course, some with tractor beams on
    for (let j = 0; j < 5; j++) {
      const k = Math.floor(((j + 0.3) / 5) * N);
      const ufo = buildSaucer(false, j % 2 === 0);
      ufo.scale.setScalar(0.9 + rand() * 0.4);
      group.add(ufo);
      const c = { x: px[k], z: pz[k], y: py[k] + 32 + rand() * 18, r: 35 + rand() * 50, a: rand() * 6.3, w: (rand() < 0.5 ? -1 : 1) * (0.12 + rand() * 0.1), ph: rand() * 6 };
      saucers.push({ obj: ufo, spin: 1.4, path: c });
    }
    // A giant mothership hanging in the sky, and Phobos and Deimos
    const far = buildSaucer(false);
    far.scale.setScalar(14);
    far.position.set(cx - 650, 260, cz - 700);
    far.rotation.z = 0.12;
    far.traverse((o) => {
      if (!o.material) return;
      o.material = o.material.clone(); // don't un-fog the shared materials
      o.material.fog = false;
    });
    group.add(far);
    saucers.push({ obj: far, spin: 0.05 });
    const moonMat = new THREE.MeshLambertMaterial({ color: 0x9c8a7a, flatShading: true, fog: false });
    for (const [r, x, y, z, sx] of [[55, 520, 330, -800, 1.4], [26, -300, 420, 700, 1.15]]) {
      const moon = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 1), moonMat);
      moon.scale.set(sx, 1, 1.05);
      moon.position.set(cx + x, y, cz + z);
      group.add(moon);
    }
  }
  for (const [name, mats] of placements) {
    const parts = protos[name];
    if (!parts) continue;
    for (const part of parts) {
      const im = new THREE.InstancedMesh(part.geo, part.mat, mats.length);
      const m4 = new THREE.Matrix4();
      mats.forEach((M, j) => im.setMatrixAt(j, m4.multiplyMatrices(M, part.m)));
      im.castShadow = part.shadow !== false && quality === "high";
      im.receiveShadow = false;
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      group.add(im);
      if (name === "ring" || name === "crystal") animated.push((dt) => (im.rotation.y += 0 * dt));
    }
  }

  // Distant mountains / backdrop
  if (theme !== "miami" && theme !== "zoo") {
    const geo = new THREE.ConeGeometry(1, 1, 6, 1);
    geo.translate(0, 0.5, 0);
    const m1 = new THREE.MeshLambertMaterial({ color: th.mountain, flatShading: true, fog: true });
    const m2 = new THREE.MeshLambertMaterial({ color: th.mountain2, flatShading: true, fog: true });
    const n = theme === "beach" ? 14 : 40;
    const im1 = new THREE.InstancedMesh(geo, m1, n), im2 = new THREE.InstancedMesh(geo, m2, n);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand() * 0.2;
      const r = radius + 600 + rand() * 350;
      const h = theme === "beach" || theme === "savanna" ? 40 + rand() * 60 : theme === "neon" ? 0.001 : 140 + rand() * 260;
      const w = h * (0.8 + rand() * 0.8);
      const baseY = theme === "neon" ? -9999 : theme === "beach" ? -8 : -20;
      m4.compose(new THREE.Vector3(cx + Math.cos(a) * r, baseY, cz + Math.sin(a) * r), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 3), new THREE.Vector3(w, h, w));
      im1.setMatrixAt(i, m4);
      const a2 = a + Math.PI / n;
      m4.compose(new THREE.Vector3(cx + Math.cos(a2) * (r + 150), baseY, cz + Math.sin(a2) * (r + 150)), new THREE.Quaternion(), new THREE.Vector3(w * 1.2, h * 1.3, w * 1.2));
      im2.setMatrixAt(i, m4);
    }
    im1.computeBoundingSphere();
    im2.computeBoundingSphere();
    im1.frustumCulled = im2.frustumCulled = false;
    group.add(im1, im2);
  }

  // Clouds
  if (theme !== "neon" && theme !== "mars" && theme !== "miami") {
    const cg = new THREE.IcosahedronGeometry(1, 1);
    const cm = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0.92, fog: false, emissive: 0x9aa4b0, emissiveIntensity: 0.35 });
    const puffs = 30 * 5;
    const im = new THREE.InstancedMesh(cg, cm, puffs);
    const m4 = new THREE.Matrix4();
    let j = 0;
    for (let c = 0; c < 30; c++) {
      const a = rand() * Math.PI * 2, r = 200 + rand() * 700;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, y = 110 + rand() * 90;
      for (let p = 0; p < 5; p++) {
        const s = 10 + rand() * 14;
        m4.compose(new THREE.Vector3(x + (p - 2) * 12 + rand() * 6, y + rand() * 6, z + rand() * 10), new THREE.Quaternion(), new THREE.Vector3(s * 1.3, s * 0.8, s));
        im.setMatrixAt(j++, m4);
      }
    }
    im.frustumCulled = false;
    group.add(im);
    animated.push((dt) => (im.rotation.y += dt * 0.004));
    im.position.set(0, 0, 0);
  }

  // Neon: stars + planets + grid
  if (theme === "neon") {
    const n = 2500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rand() * 2 - 1, a = rand() * Math.PI * 2;
      const r = 1400;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(a) * s * r;
      pos[i * 3 + 1] = u * r;
      pos[i * 3 + 2] = Math.sin(a) * s * r;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false }));
    group.add(stars);
    animated.push((dt, time, cam) => stars.position.copy(cam.position));
    const planets = [
      [0xff7ad9, 90, -500, 160, -300],
      [0x5ad6ff, 60, 450, 220, 500],
      [0xffc35a, 140, 700, 60, -700],
    ];
    for (const [col, r, x, y, z] of planets) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 20), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.25, roughness: 0.8, fog: false }));
      p.position.set(cx + x, y, cz + z);
      group.add(p);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.6, r * 0.08, 6, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, fog: false }));
      ring.rotation.x = 1.2;
      ring.position.copy(p.position);
      group.add(ring);
    }
    const grid = new THREE.GridHelper(4000, 80, 0xff2bd6, 0x5a2a9a);
    grid.position.set(cx, -60, cz);
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    group.add(grid);
  }

  // ------------------------------------------------------------- Zoo set pieces
  // ------------------------------------------------------------- Safari Run (beta)
  // A yellow warning sign before each animal crossing, and herds grazing out on the plain.
  function buildSavanna() {
    const post = mat(0x8a8a8a, { metal: 0.4, rough: 0.5 });
    for (const c of track.def.crossings || []) {
      const at = track.wrap(Math.round(c.at * N) - 22); // about 45 units before it
      const sd = 1; // on the right, facing the karts coming
      const rx = -tz[at], rz = tx[at];
      const l = sd * (wallDist(at) + 2.5);
      const x = px[at] + rx * l, z = pz[at] + rz * l, y = py[at];
      const sign = new THREE.Group();
      sign.position.set(x, y, z);
      sign.rotation.y = Math.atan2(-tx[at], -tz[at]); // its face looks back down the road
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.2, 8), post);
      pole.position.y = 2.1;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshLambertMaterial({ map: T.crossingSignTexture(c.kind), transparent: true, alphaTest: 0.1, side: THREE.DoubleSide }));
      face.position.y = 4.6;
      sign.add(pole, face);
      sign.traverse((o) => (o.castShadow = true));
      group.add(sign);
    }
    // Herds far from the road
    const kinds = ["zebra", "elephant", "giraffe", "zebra", "lion", "hippo"];
    for (let h = 0; h < 14; h++) {
      let hx, hz, ok = false;
      for (let tries = 0; tries < 40 && !ok; tries++) {
        hx = b.minX - 120 + rand() * (b.maxX - b.minX + 240);
        hz = b.minZ - 120 + rand() * (b.maxZ - b.minZ + 240);
        const [i, d] = nearest(hx, hz, 6);
        ok = i < 0 || d > wallDist(i) + 45;
      }
      if (!ok) continue;
      const kind = kinds[h % kinds.length];
      const n = kind === "lion" ? 2 : 2 + Math.floor(rand() * 4);
      for (let j = 0; j < n; j++) {
        const x = hx + (rand() - 0.5) * 22, z = hz + (rand() - 0.5) * 22;
        place(kind, x, terrainHeight(x, z), z, 1.2 + rand() * 0.3, rand() * Math.PI * 2);
      }
    }
  }

  function buildZoo() {
    // A spot inside enclosure zn: along its stretch, `out` units beyond the wall.
    const spot = (zn, u, out) => {
      const k = Math.round(zn.k0 + u * (zn.k1 - zn.k0)) % N;
      const l = zn.side * (wallDist(k) + out);
      return [px[k] + -tz[k] * l, pz[k] + tx[k] * l, k];
    };
    // Only accept spots that really are in this enclosure (not nearer another stretch of road).
    const inside = (zn, x, z, margin = 5) => {
      const [i, d] = nearest(x, z, 6);
      return enclosureAt(x, z, i, d) === zn && d > wallDist(i) + margin && d < wallDist(i) + ENCLOSURE_DEPTH - 3;
    };
    const faceRoad = (k, side) => Math.atan2(side * tz[k], -side * tx[k]); // local +z toward the road
    const props = { giraffe: "acacia", elephant: "acacia", lion: "rock", zebra: "acacia", penguin: "ice", panda: "bamboo", monkey: "tree", flamingo: "bush", hippo: "rock" };
    for (const zn of zones) {
      // Pool in the middle of the enclosure
      let pool = null;
      if (zn.pool) {
        const [x, z] = spot(zn, 0.5, 22);
        if (inside(zn, x, z, 8)) {
          pool = { x, z, r: 12, y: terrainHeight(x, z) };
          const water = new THREE.Mesh(new THREE.CylinderGeometry(pool.r, pool.r, 0.3, 32), new THREE.MeshStandardMaterial({ color: zn.pool, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.9 }));
          water.position.set(x, pool.y + 0.05, z);
          water.receiveShadow = true;
          group.add(water);
          const rim = new THREE.Mesh(new THREE.TorusGeometry(pool.r, 0.6, 6, 32), new THREE.MeshLambertMaterial({ color: zn.kind === "penguin" ? 0xe6f2fb : 0x9a9a92, flatShading: true }));
          rim.rotation.x = Math.PI / 2;
          rim.position.set(x, pool.y + 0.15, z);
          group.add(rim);
        }
      }
      // Animals
      for (let n = 0, tries = 0; n < zn.count && tries < zn.count * 20; tries++) {
        let x, z, y, k;
        if (pool && (zn.kind === "hippo" || (zn.kind !== "penguin" && n % 2 === 0) || (zn.kind === "penguin" && n % 3 === 0))) {
          // In the water: hippos wallow, flamingos wade, some penguins swim
          const a = rand() * Math.PI * 2, r = rand() * (pool.r - 3);
          x = pool.x + Math.cos(a) * r;
          z = pool.z + Math.sin(a) * r;
          y = pool.y + (zn.kind === "hippo" ? -0.7 : zn.kind === "penguin" ? -0.45 : -0.1) * zn.size;
          k = nearest(x, z, 6)[0];
        } else {
          [x, z, k] = spot(zn, 0.08 + rand() * 0.84, 5 + rand() ** 1.6 * (ENCLOSURE_DEPTH - 12)); // most of them near the fence
          if (!inside(zn, x, z) || (pool && Math.hypot(x - pool.x, z - pool.z) < pool.r + 1.5)) continue;
          y = terrainHeight(x, z);
        }
        if (k < 0) continue;
        const ry = faceRoad(k, zn.side) + (rand() - 0.5) * 2.2; // roughly facing the racers
        place(zn.kind, x, y, z, zn.size * (0.85 + rand() * 0.3), ry);
        n++;
      }
      // Habitat props
      const prop = props[zn.kind];
      for (let n = 0, tries = 0; n < 5 && tries < 60; tries++) {
        const [x, z] = spot(zn, rand(), 12 + rand() * (ENCLOSURE_DEPTH - 16));
        if (!inside(zn, x, z, 9) || (pool && Math.hypot(x - pool.x, z - pool.z) < pool.r + 4)) continue;
        const y = terrainHeight(x, z);
        const sc = 0.8 + rand() * 0.5;
        place(prop, x, y, z, sc, rand() * 6.3);
        if (zn.kind === "monkey" && n % 2 === 0) place("monkey", x + 0.3 * sc, y + 7.4 * sc, z, zn.size * 0.8, rand() * 6.3); // sitting on top of the tree
        n++;
      }
      // Wooden sign at the start of the enclosure, facing oncoming racers
      const k = (zn.k0 + 4) % N;
      if (bump[k] <= 0) {
        const l = zn.side * (wallDist(k) + 2.4);
        const x = px[k] + -tz[k] * l, z = pz[k] + tx[k] * l;
        const sign = new THREE.Group();
        const post = new THREE.MeshLambertMaterial({ color: 0x5a3a1e });
        for (const sx of [-2.2, 2.2]) {
          const p = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 4.4, 6), post);
          p.position.set(sx, 2.2, 0);
          p.castShadow = true;
          sign.add(p);
        }
        const board = new THREE.Mesh(new THREE.BoxGeometry(5.6, 1.75, 0.2), [post, post, post, post, new THREE.MeshLambertMaterial({ map: T.signTexture(zn.name) }), post]);
        board.position.y = 3.6;
        board.castShadow = true;
        sign.add(board);
        sign.position.set(x, py[k], z);
        sign.rotation.y = Math.atan2(-tx[k], -tz[k]) - zn.side * 0.5; // toward oncoming karts, angled to the road
        group.add(sign);
      }
    }

    // Entrance arch over the road just after the start, with giraffes standing on top
    {
      const k = Math.round(N * 0.05);
      const span = wallDist(k) + 1;
      const arch = new THREE.Group();
      const print = new THREE.MeshLambertMaterial({ map: T.giraffeTexture() });
      for (const sd of [-1, 1]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(2, 11, 2), print);
        pillar.position.set(sd * span, 5.5, 0);
        pillar.castShadow = true;
        arch.add(pillar);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 2.4, 1.2, 1.4), new THREE.MeshLambertMaterial({ color: 0x2f8a3a }));
      beam.position.y = 11.2;
      arch.add(beam);
      const bannerMat = new THREE.MeshBasicMaterial({ map: T.bannerTexture("ZOO CITY", "#2f8a3a") });
      for (const side of [0, Math.PI]) {
        const banner = new THREE.Mesh(new THREE.PlaneGeometry(span * 1.6, span * 1.6 / 8), bannerMat);
        banner.position.set(0, 9.6, side ? 0.72 : -0.72);
        banner.rotation.y = side;
        arch.add(banner);
      }
      arch.position.set(px[k], py[k], pz[k]);
      const ry = Math.atan2(tx[k], tz[k]);
      arch.rotation.y = ry;
      group.add(arch);
      for (const sd of [-1, 1]) {
        const x = px[k] + -tz[k] * sd * span, z = pz[k] + tx[k] * sd * span;
        place("giraffe", x, py[k] + 11.8, z, 0.7, ry + Math.PI / 2 * -sd);
      }
    }

    // The city beyond the zoo walls
    const towerMats = [3, 8, 13].map((seed) => new THREE.MeshLambertMaterial({ map: T.dayTowerTexture(seed) }));
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    boxGeo.translate(0, 0.5, 0);
    const lists = [[], [], []];
    for (let n = 0, tries = 0; n < 90 && tries < 400; tries++) {
      const a = rand() * Math.PI * 2, r = radius + 260 + rand() * 380;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const w = 18 + rand() * 24, h = 35 + rand() * 140 * (1 - (r - radius - 260) / 600);
      lists[n % 3].push(new THREE.Matrix4().compose(new THREE.Vector3(x, terrainHeight(x, z) - 2, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 1.5), new THREE.Vector3(w, h, w * (0.7 + rand() * 0.5))));
      n++;
    }
    lists.forEach((list, j) => {
      const im = new THREE.InstancedMesh(boxGeo, towerMats[j], list.length);
      list.forEach((m, n) => im.setMatrixAt(n, m));
      im.computeBoundingSphere();
      im.frustumCulled = false;
      group.add(im);
    });
  }

  // ------------------------------------------------------------- Miami set pieces
  function buildMiami() {
    // Sodium streetlights along the course, alternating sides, with warm pools of light
    const lampSpots = [];
    const pools = [];
    for (let k = 0, j = 0; k < N; k += 18, j++) {
      if (gap[k] || bump[k] > 0 || gap[track.wrap(k + 6)] || gap[track.wrap(k - 6)]) continue;
      const sd = j % 2 ? 1 : -1;
      const rx = -tz[k], rz = tx[k];
      const l = sd * (wallDist(k) + 1.4);
      const x = px[k] + rx * l, z = pz[k] + rz * l;
      const ry = Math.atan2(sd * rz, -sd * rx); // arm (local +x) reaches over the road
      place("streetlight", x, py[k], z, 1, ry);
      const hx = x - sd * rx * 3.2, hz = z - sd * rz * 3.2;
      lampSpots.push(hx, py[k] + 9.3, hz);
      pools.push([hx, py[k] + bump[k] + 0.13, hz]);
    }
    const glowMat = new THREE.PointsMaterial({ map: T.glowTexture(), color: 0xffb35a, size: 5, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(lampSpots, 3));
    group.add(new THREE.Points(lg, glowMat));
    {
      const verts = [], uvs = [], idx = [];
      const R = 8;
      pools.forEach(([x, y, z], n) => {
        verts.push(x - R, y, z - R, x + R, y, z - R, x - R, y, z + R, x + R, y, z + R);
        uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
        const a = n * 4;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      });
      const pg = new THREE.BufferGeometry();
      pg.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      pg.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      pg.setIndex(idx);
      group.add(new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ map: T.glowTexture(), color: 0xff9a40, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending })));
    }

    // Art deco hotels facing Ocean Drive (the start straight), pastel with neon trim
    const pastel = [0xf7c6d9, 0x9fe6dc, 0xfbe3a8, 0xc9d8ff, 0xffd1b0];
    const neonCols = ["#ff4fa3", "#2de0f0", "#ff4fa3", "#b46cff", "#2de0f0"];
    const names = ["CARLYLE", "COLONY", "BRETON", "TIDES", "VICE", "CHAMO", "PARK CENTRAL", "LESLIE"];
    let hotel = 0;
    for (let k = 0; k < N && hotel < names.length; k += 13) {
      if (px[k] > 40 || gap[k]) continue; // Ocean Drive only (on the Miami Beach side)
      const rx = -tz[k], rz = tx[k];
      const sd = px[k] + rx * 10 < px[k] ? 1 : -1; // the side away from the water (west)
      const l = sd * (wallDist(k) + 16);
      const x = px[k] + rx * l, z = pz[k] + rz * l;
      if (miamiLand(x, z) < 0.95) continue;
      const [d, i] = roadDist(x, z);
      if (d < wallDist(i) + 12) continue;
      const h = 12 + (hotel % 3) * 5;
      const col = pastel[hotel % pastel.length];
      const neon = neonCols[hotel % neonCols.length];
      const g = buildDecoHotel(h, col, neon, names[hotel]);
      g.position.set(x, terrainHeight(x, z), z);
      g.rotation.y = Math.atan2(-sd * rx, -sd * rz); // local +z faces the road
      group.add(g);
      hotel++;
    }

    // Skyline across the bay (and condo towers behind the beach): lit windows, unfogged
    const towerMats = [11, 23, 37].map((seed) => {
      const t = T.towerTexture(seed);
      return new THREE.MeshStandardMaterial({ color: 0x141c28, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.3, fog: false });
    });
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    boxGeo.translate(0, 0.5, 0);
    const towers = [[], [], []];
    const beacons = [];
    const addTower = (x, z, w, h) => {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, -1, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 0.6), new THREE.Vector3(w, h, w * (0.7 + rand() * 0.5)));
      towers[Math.floor(rand() * 3)].push(m);
      if (h > 90) beacons.push(x, h + 1, z);
    };
    for (let n = 0; n < 70; n++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * (downtown.r - 50);
      const x = downtown.x + Math.cos(a) * r, z = downtown.z + Math.sin(a) * r;
      const centre = 1 - r / downtown.r;
      addTower(x, z, 14 + rand() * 18, 30 + centre * 150 + rand() * 60);
    }
    for (let n = 0; n < 30; n++) {
      const x = b.minX - 90 - rand() * 380, z = b.minZ - 150 + rand() * (b.maxZ - b.minZ + 300);
      const [d, i] = roadDist(x, z);
      if (d < wallDist(i) + 60) continue;
      addTower(x, z, 12 + rand() * 12, 25 + rand() * 55);
    }
    towers.forEach((list, j) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(boxGeo, towerMats[j], list.length);
      list.forEach((m, n) => im.setMatrixAt(n, m));
      im.computeBoundingSphere();
      im.frustumCulled = false;
      group.add(im);
    });
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.Float32BufferAttribute(beacons, 3));
    const beaconMat = new THREE.PointsMaterial({ color: 0xff2a2a, size: 4, sizeAttenuation: false, fog: false, transparent: true });
    group.add(new THREE.Points(bg, beaconMat));
    animated.push((dt, time) => (beaconMat.opacity = 0.35 + 0.65 * Math.max(0, Math.sin(time * 3)))); // aircraft warning lights

    // Moon, a few stars that make it through the city glow
    const moon = new THREE.Mesh(new THREE.SphereGeometry(40, 20, 14), new THREE.MeshBasicMaterial({ color: 0xe6eefc, fog: false }));
    moon.position.set(cx + sunDir.x * 1300, 420, cz + sunDir.z * 1300);
    group.add(moon);
    {
      const pos = [];
      for (let n = 0; n < 350; n++) {
        const u = 0.25 + rand() * 0.75, a = rand() * Math.PI * 2, s2 = Math.sqrt(1 - u * u);
        pos.push(Math.cos(a) * s2 * 1400, u * 1400, Math.sin(a) * s2 * 1400);
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xaab8d0, size: 1.5, sizeAttenuation: false, fog: false }));
      group.add(stars);
      animated.push((dt, time, cam) => stars.position.copy(cam.position));
    }

    // Thunderstorm out over the ocean: dark clouds that light up with every strike
    const stormDir = -Math.PI / 2 + 0.35; // out over open water to the south (land is west, downtown north-east)
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0x1a2231, flatShading: true, fog: false, emissive: 0x05080f });
    const cg = new THREE.IcosahedronGeometry(1, 1);
    const puffs = 26 * 6;
    const clouds = new THREE.InstancedMesh(cg, cloudMat, puffs);
    const m4 = new THREE.Matrix4();
    let j = 0;
    const cloudSpots = [];
    for (let c = 0; c < 26; c++) {
      const a = stormDir + (rand() - 0.5) * 2.2, r = radius + 550 + rand() * 300;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, y = 90 + rand() * 60;
      cloudSpots.push([x, y, z]);
      for (let p = 0; p < 6; p++) {
        const sc = 22 + rand() * 26;
        m4.compose(new THREE.Vector3(x + (p - 2.5) * 22 + rand() * 10, y + rand() * 16, z + rand() * 20), new THREE.Quaternion(), new THREE.Vector3(sc * 1.5, sc * 0.7, sc));
        clouds.setMatrixAt(j++, m4);
      }
    }
    clouds.frustumCulled = false;
    group.add(clouds);
    const boltMat = new THREE.MeshBasicMaterial({ color: 0xe8f0ff, fog: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const bolts = [];
    for (let n = 0; n < 4; n++) {
      const [x, y, z] = cloudSpots[Math.floor(rand() * cloudSpots.length)];
      const bolt = new THREE.Mesh(boltGeometry(rand, y + 10), boltMat);
      bolt.position.set(x, 0, z);
      bolt.lookAt(cx, 0, cz);
      bolt.visible = false;
      group.add(bolt);
      bolts.push(bolt);
    }
    let nextStrike = 3 + rand() * 4, strikeT = 0, active = null;
    const skyBottom = new THREE.Color(th.skyBottom), flashSky = new THREE.Color(0x6a88b8);
    animated.push((dt) => {
      nextStrike -= dt;
      if (nextStrike <= 0) {
        active = bolts[Math.floor(Math.random() * bolts.length)];
        strikeT = 0.45;
        nextStrike = 4 + Math.random() * 7;
      }
      strikeT = Math.max(0, strikeT - dt);
      // Double flicker: on, off, on, fade
      const f = strikeT > 0.3 ? 1 : strikeT > 0.22 ? 0.15 : strikeT / 0.22;
      for (const bt of bolts) bt.visible = bt === active && strikeT > 0 && (strikeT > 0.3 || strikeT < 0.22);
      hemi.intensity = th.hemiI + f * 1.6;
      cloudMat.emissive.setRGB(0.02 + f * 0.22, 0.03 + f * 0.26, 0.06 + f * 0.38);
      skyMat.uniforms.bottom.value.copy(skyBottom).lerp(flashSky, f * 0.7);
    });

    // Go-fast boats racing around the bay, each with a white wake
    for (let n = 0, tries = 0; n < 5 && tries < 300; tries++) {
      const x = b.minX - 100 + rand() * (b.maxX - b.minX + 400), z = b.minZ - 100 + rand() * (b.maxZ - b.minZ + 200);
      const r = 30 + rand() * 45;
      let ok = true;
      for (let q = 0; q < 12 && ok; q++) {
        const a = (q / 12) * Math.PI * 2, qx = x + Math.cos(a) * r, qz = z + Math.sin(a) * r;
        const [d, i] = roadDist(qx, qz);
        if (miamiLand(qx, qz) > 0.05 || d < wallDist(i) + 30) ok = false;
      }
      if (!ok) continue;
      const boat = buildGoFastBoat(n);
      group.add(boat);
      const w = (rand() < 0.5 ? -1 : 1) * (0.25 + rand() * 0.15), a0 = rand() * 6.3;
      animated.push((dt, time) => {
        const a = a0 + time * w;
        boat.position.set(x + Math.cos(a) * r, -1.1 + Math.sin(time * 3 + n) * 0.08, z + Math.sin(a) * r);
        boat.rotation.set(0, -a + (w > 0 ? 0 : Math.PI), -Math.sign(w) * 0.12); // nose along the circle, leaning in
      });
      n++;
    }
  }

  return {
    group,
    sun,
    sunDir,
    theme: th,
    terrainHeight,
    update(dt, time, camera, focus) {
      for (const f of animated) f(dt, time, camera);
      if (focus) {
        sun.target.position.set(focus.x, focus.y, focus.z);
        sun.position.set(focus.x + sunDir.x * 120, focus.y + sunDir.y * 120, focus.z + sunDir.z * 120);
      }
    },
    dispose() {
      scene.remove(group);
      sun.dispose(); // frees the shadow map render target
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material?.map && o.material.map.userData?.owned) o.material.map.dispose();
      });
    },
  };
}

// --------------------------------------------------------------- prototypes
// Movable animals for Safari Run's crossings (the same models as Zoo City's), one group each
export function animalMaker() {
  const P = scenery("zoo");
  return (kind) => {
    const g = new THREE.Group();
    for (const p of P[kind] || []) {
      const m = new THREE.Mesh(p.geo, p.mat);
      m.applyMatrix4(p.m);
      m.castShadow = p.shadow !== false;
      g.add(m);
    }
    return g;
  };
}

function part(geo, material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0, shadow = true) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)),
    new THREE.Vector3(sx, sy, sz)
  );
  return { geo, mat: material, m, shadow };
}

function scenery(theme) {
  const flat = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, flatShading: true, ...extra });
  const trunk = flat(0x7a5230);
  const P = {};
  P.tree = [
    part(new THREE.CylinderGeometry(0.4, 0.6, 3.5, 7), trunk, 0, 1.75),
    part(new THREE.IcosahedronGeometry(2.6, 0), flat(0x3f9a3a), 0, 5, 0, 1, 1.1, 1),
    part(new THREE.IcosahedronGeometry(1.9, 0), flat(0x57b347), 0.6, 6.6, 0.3),
  ];
  P.bush = [part(new THREE.IcosahedronGeometry(1.3, 0), flat(theme === "desert" ? 0x8a9a4a : 0x4a9a3a), 0, 0.8, 0, 1.3, 0.8, 1.2)];
  P.rock = [part(new THREE.DodecahedronGeometry(2, 0), flat({ desert: 0xb0643a, snow: 0x8a94a6, mars: 0x8a3a22 }[theme] ?? 0x9a9a92), 0, 1, 0, 1.2, 0.8, 1)];
  const cactusMat = flat(0x3f8f45);
  P.cactus = [
    part(new THREE.CylinderGeometry(0.55, 0.6, 6, 8), cactusMat, 0, 3),
    part(new THREE.CylinderGeometry(0.35, 0.35, 1.6, 8), cactusMat, 1.1, 3, 0, 1, 1, 1, 0, Math.PI / 2),
    part(new THREE.CylinderGeometry(0.35, 0.35, 2, 8), cactusMat, 1.8, 4, 0),
    part(new THREE.CylinderGeometry(0.33, 0.33, 1.2, 8), cactusMat, -0.9, 2.3, 0, 1, 1, 1, 0, Math.PI / 2),
    part(new THREE.CylinderGeometry(0.33, 0.33, 1.6, 8), cactusMat, -1.4, 3.1, 0),
    part(new THREE.SphereGeometry(0.3, 8, 6), flat(0xff4f9a), 0, 6.1, 0),
  ];
  P.mesa = [part(new THREE.CylinderGeometry(40, 50, 60, 9), flat(0xb8663c), 0, 30), part(new THREE.CylinderGeometry(40.5, 41, 6, 9), flat(0xd08a55), 0, 58)];
  const pineMat = flat(0x2f6a4a);
  const snowMat = flat(0xffffff);
  P.pine = [
    part(new THREE.CylinderGeometry(0.35, 0.5, 2, 6), trunk, 0, 1),
    part(new THREE.ConeGeometry(2.8, 3.6, 7), pineMat, 0, 3.4),
    part(new THREE.ConeGeometry(2.2, 3.2, 7), pineMat, 0, 5.2),
    part(new THREE.ConeGeometry(1.5, 2.6, 7), pineMat, 0, 6.9),
    part(new THREE.ConeGeometry(0.8, 1.3, 7), snowMat, 0, 8.1),
  ];
  P.snowman = [
    part(new THREE.SphereGeometry(1.3, 12, 10), snowMat, 0, 1.2),
    part(new THREE.SphereGeometry(0.95, 12, 10), snowMat, 0, 3.0),
    part(new THREE.SphereGeometry(0.65, 12, 10), snowMat, 0, 4.4),
    part(new THREE.ConeGeometry(0.12, 0.7, 8), flat(0xff7a1a), 0, 4.4, 0.8, 1, 1, 1, Math.PI / 2),
    part(new THREE.CylinderGeometry(0.5, 0.5, 0.7, 10), flat(0x222222), 0, 5.1),
    part(new THREE.TorusGeometry(0.8, 0.14, 6, 14), flat(0xe23b3b), 0, 3.7, 0, 1, 1, 1, Math.PI / 2),
  ];
  const palmTrunk = flat(0x9a7045);
  const leaf = flat(0x3aa84a, { side: THREE.DoubleSide });
  P.palm = [
    part(new THREE.CylinderGeometry(0.35, 0.5, 3.2, 7), palmTrunk, 0, 1.6),
    part(new THREE.CylinderGeometry(0.3, 0.36, 3.2, 7), palmTrunk, 0.4, 4.6, 0, 1, 1, 1, 0, -0.18),
    part(new THREE.CylinderGeometry(0.26, 0.3, 2.6, 7), palmTrunk, 1.0, 7.4, 0, 1, 1, 1, 0, -0.3),
    part(new THREE.SphereGeometry(0.5, 8, 6), flat(0x6b4a2b), 1.4, 8.5, 0),
  ];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const g = new THREE.ConeGeometry(0.7, 4.2, 4);
    g.rotateZ(-Math.PI / 2);
    g.translate(2.1, 0, 0);
    g.scale(1, 0.25, 1);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(1.4, 8.7, 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a, -0.45, "YXZ")),
      new THREE.Vector3(1, 1, 1)
    );
    P.palm.push({ geo: g, mat: leaf, m, shadow: true });
  }
  const umbrellaCols = [0xff4f6b, 0xffd23f, 0x3bc8ff];
  P.umbrella = [
    part(new THREE.CylinderGeometry(0.08, 0.08, 3.4, 6), flat(0xffffff), 0, 1.7),
    part(new THREE.ConeGeometry(2.2, 0.9, 8), flat(umbrellaCols[Math.floor(Math.random() * 3)]), 0, 3.5),
    part(new THREE.BoxGeometry(1.2, 0.15, 2.2), flat(0x3bc8ff), 1.6, 0.3, 0),
  ];
  // Zoo animals (all facing +z) and habitat props
  const tan = flat(0xd9a55a), dark = flat(0x1a1a20), white2 = flat(0xf6f4ee);
  const giraffeCoat = new THREE.MeshLambertMaterial({ map: T.giraffeTexture() });
  const zebraCoat = new THREE.MeshLambertMaterial({ map: T.zebraTexture() });
  const S = (r, w = 12, h = 10) => new THREE.SphereGeometry(r, w, h);
  const C = (rt, rb, h, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);
  const legs = (geo, m, x, y, z) => [-1, 1].flatMap((sx) => [-1, 1].map((sz) => part(geo, m, sx * x, y, sz * z)));
  P.giraffe = [
    part(S(1), giraffeCoat, 0, 2.6, 0, 0.75, 0.65, 1.25),
    ...legs(C(0.1, 0.12, 2.2, 6), giraffeCoat, 0.42, 1.1, 0.8),
    part(C(0.2, 0.32, 2.6), giraffeCoat, 0, 3.9, 0.95, 1, 1, 1, 0.45),
    part(new THREE.BoxGeometry(0.36, 0.36, 0.8), flat(0xf3dfa6), 0, 5.2, 1.55),
    part(new THREE.BoxGeometry(0.3, 0.26, 0.3), flat(0xb8662a), 0, 5.1, 1.95),
    part(C(0.04, 0.04, 0.32, 5), flat(0x6b4a2b), 0.1, 5.5, 1.35),
    part(C(0.04, 0.04, 0.32, 5), flat(0x6b4a2b), -0.1, 5.5, 1.35),
    part(C(0.03, 0.03, 1, 5), flat(0x6b4a2b), 0, 2.2, -1.25, 1, 1, 1, 0.3),
  ];
  const elephantSkin = flat(0x8e9096);
  P.elephant = [
    part(S(1), elephantSkin, 0, 2.1, 0, 1.3, 1.1, 1.7),
    ...legs(C(0.35, 0.38, 1.3), elephantSkin, 0.7, 0.65, 0.9),
    part(S(0.8), elephantSkin, 0, 2.55, 1.7),
    part(S(0.75), flat(0x9a8c96), 0.75, 2.5, 1.45, 0.12, 1, 0.85),
    part(S(0.75), flat(0x9a8c96), -0.75, 2.5, 1.45, 0.12, 1, 0.85),
    part(C(0.22, 0.14, 1.6), elephantSkin, 0, 1.65, 2.35, 1, 1, 1, 0.2),
    part(C(0.14, 0.12, 0.5), elephantSkin, 0, 0.85, 2.55, 1, 1, 1, -0.5),
    part(new THREE.ConeGeometry(0.08, 0.8, 6), white2, 0.32, 1.95, 2.3, 1, 1, 1, 1.3),
    part(new THREE.ConeGeometry(0.08, 0.8, 6), white2, -0.32, 1.95, 2.3, 1, 1, 1, 1.3),
    part(S(0.07, 6, 5), dark, 0.42, 2.75, 2.28),
    part(S(0.07, 6, 5), dark, -0.42, 2.75, 2.28),
  ];
  P.lion = [
    part(S(1), tan, 0, 1.05, 0, 0.55, 0.5, 1),
    ...legs(C(0.12, 0.13, 0.8, 6), tan, 0.3, 0.4, 0.55),
    part(S(0.62), flat(0x8a4a1c), 0, 1.5, 0.82, 1, 1, 0.7),
    part(S(0.38), tan, 0, 1.48, 1.05),
    part(S(0.18), flat(0xf0d8a8), 0, 1.36, 1.38),
    part(S(0.06, 6, 5), dark, 0, 1.42, 1.55),
    part(S(0.05, 6, 5), dark, 0.14, 1.58, 1.38),
    part(S(0.05, 6, 5), dark, -0.14, 1.58, 1.38),
    part(C(0.04, 0.04, 0.9, 5), tan, 0, 0.9, -1.2, 1, 1, 1, -0.7),
    part(S(0.12, 6, 5), flat(0x8a4a1c), 0, 0.6, -1.55),
  ];
  P.zebra = [
    part(new THREE.BoxGeometry(0.7, 0.8, 1.7), zebraCoat, 0, 1.5, 0),
    ...legs(C(0.08, 0.09, 1.1, 6), zebraCoat, 0.25, 0.55, 0.65),
    part(new THREE.BoxGeometry(0.35, 0.95, 0.4), zebraCoat, 0, 2.1, 0.95, 1, 1, 1, 0.5),
    part(new THREE.BoxGeometry(0.08, 0.55, 0.9), dark, 0, 2.3, 0.82, 1, 1, 1, 0.5),
    part(new THREE.BoxGeometry(0.3, 0.35, 0.75), zebraCoat, 0, 2.5, 1.38),
    part(new THREE.BoxGeometry(0.28, 0.26, 0.24), dark, 0, 2.42, 1.75),
    part(new THREE.ConeGeometry(0.07, 0.25, 4), zebraCoat, 0.1, 2.78, 1.2),
    part(new THREE.ConeGeometry(0.07, 0.25, 4), zebraCoat, -0.1, 2.78, 1.2),
    part(C(0.03, 0.03, 0.8, 5), dark, 0, 1.4, -0.95, 1, 1, 1, 0.3),
  ];
  const black = flat(0x1c1c24), orange = flat(0xff8a1a);
  P.penguin = [
    part(S(0.4), black, 0, 0.6, 0, 1, 1.4, 0.9),
    part(S(0.34), white2, 0, 0.58, 0.14, 0.85, 1.3, 0.6),
    part(S(0.25), black, 0, 1.15, 0.02),
    part(S(0.05, 6, 5), white2, 0.1, 1.2, 0.2),
    part(S(0.05, 6, 5), white2, -0.1, 1.2, 0.2),
    part(new THREE.ConeGeometry(0.07, 0.25, 6), orange, 0, 1.1, 0.32, 1, 1, 1, Math.PI / 2),
    part(new THREE.BoxGeometry(0.14, 0.05, 0.22), orange, 0.12, 0.03, 0.12),
    part(new THREE.BoxGeometry(0.14, 0.05, 0.22), orange, -0.12, 0.03, 0.12),
    part(new THREE.BoxGeometry(0.06, 0.45, 0.18), black, 0.4, 0.7, 0, 1, 1, 1, 0, 0.3),
    part(new THREE.BoxGeometry(0.06, 0.45, 0.18), black, -0.4, 0.7, 0, 1, 1, 1, 0, -0.3),
  ];
  const pink = flat(0xff7fa8), pinkDark = flat(0xe0507e);
  P.flamingo = [
    part(S(0.4), pink, 0, 1.5, 0, 0.8, 0.75, 1.3),
    part(C(0.03, 0.03, 1.3, 5), pinkDark, 0.05, 0.75, 0),
    part(C(0.03, 0.03, 0.6, 5), pinkDark, -0.05, 1.05, 0.12, 1, 1, 1, 1.2), // the other leg, tucked up
    part(C(0.05, 0.06, 0.8, 6), pink, 0, 1.95, 0.4, 1, 1, 1, 0.5),
    part(C(0.05, 0.05, 0.5, 6), pink, 0, 2.4, 0.5, 1, 1, 1, -0.4),
    part(S(0.12, 8, 6), pink, 0, 2.62, 0.42),
    part(new THREE.ConeGeometry(0.05, 0.24, 5), dark, 0, 2.55, 0.58, 1, 1, 1, 2.1),
  ];
  P.panda = [
    part(S(0.6), white2, 0, 0.65, 0, 1, 1.1, 0.9),
    part(C(0.15, 0.15, 0.6, 6), black, 0.45, 0.85, 0.25, 1, 1, 1, -0.8),
    part(C(0.15, 0.15, 0.6, 6), black, -0.45, 0.85, 0.25, 1, 1, 1, -0.8),
    part(S(0.26), black, 0.35, 0.25, 0.38),
    part(S(0.26), black, -0.35, 0.25, 0.38),
    part(S(0.42), white2, 0, 1.5, 0.05),
    part(S(0.14), black, 0.3, 1.85, 0),
    part(S(0.14), black, -0.3, 1.85, 0),
    part(S(0.1, 8, 6), black, 0.15, 1.55, 0.37, 1, 1.3, 0.5, 0, 0.4),
    part(S(0.1, 8, 6), black, -0.15, 1.55, 0.37, 1, 1.3, 0.5, 0, -0.4),
    part(S(0.06, 6, 5), black, 0, 1.42, 0.46),
    part(C(0.04, 0.04, 0.9, 5), flat(0x7ab84a), 0.35, 1.05, 0.45, 1, 1, 1, 0, 0.4), // snack
  ];
  const fur = flat(0x7a4a2a), face = flat(0xe0c09a);
  P.monkey = [
    part(S(0.3), fur, 0, 0.5, 0, 1, 1.2, 0.9),
    part(S(0.22), fur, 0, 0.95, 0.05),
    part(S(0.16), face, 0, 0.93, 0.18, 1, 0.9, 0.5),
    part(S(0.08, 6, 5), face, 0.22, 0.97, 0),
    part(S(0.08, 6, 5), face, -0.22, 0.97, 0),
    part(C(0.06, 0.06, 0.55, 5), fur, 0.3, 0.55, 0.15, 1, 1, 1, 0, 0.5),
    part(C(0.06, 0.06, 0.55, 5), fur, -0.3, 0.55, 0.15, 1, 1, 1, 0, -0.5),
    part(new THREE.TorusGeometry(0.3, 0.04, 6, 12, Math.PI * 1.3), fur, 0, 0.35, -0.3),
  ];
  const hippoSkin = flat(0x8a7a90);
  P.hippo = [
    part(S(1), hippoSkin, 0, 1.0, 0, 1.1, 0.85, 1.6),
    ...legs(C(0.28, 0.3, 0.6, 6), hippoSkin, 0.6, 0.3, 0.8),
    part(S(0.7), hippoSkin, 0, 1.25, 1.55, 1.1, 0.8, 1),
    part(S(0.55), flat(0xb896a8), 0, 1.05, 2.05, 1.2, 0.7, 0.8),
    part(S(0.12, 6, 5), dark, 0.3, 1.75, 1.45),
    part(S(0.12, 6, 5), dark, -0.3, 1.75, 1.45),
    part(S(0.1, 6, 5), hippoSkin, 0.5, 1.8, 1.25),
    part(S(0.1, 6, 5), hippoSkin, -0.5, 1.8, 1.25),
  ];
  const straw = flat(0xd9b45a);
  P.tuft = [0, 1, 2, 3].map((j) => part(new THREE.ConeGeometry(0.18, 1.5, 4), straw, Math.cos(j * 1.7) * 0.35, 0.7, Math.sin(j * 1.7) * 0.35, 1, 1, 1, Math.cos(j) * 0.25, Math.sin(j) * 0.25, false));
  P.acacia = [
    part(C(0.3, 0.45, 4, 6), trunk, 0, 2, 0),
    part(C(3.2, 2.6, 0.8, 8), flat(0x6a9a3a), 0, 4.4, 0),
    part(C(2, 1.6, 0.6, 7), flat(0x7aab44), 1.2, 4.95, 0.6),
  ];
  const cane = flat(0x7ab84a);
  P.bamboo = [0, 1, 2, 3, 4].flatMap((i) => {
    const a = i * 1.3, r = 0.5 + (i % 2) * 0.4, h = 5 + (i % 3);
    return [part(C(0.12, 0.12, h, 6), cane, Math.cos(a) * r, h / 2, Math.sin(a) * r), part(new THREE.ConeGeometry(0.6, 1.4, 5), flat(0x4f9a3a), Math.cos(a) * r, h + 0.3, Math.sin(a) * r)];
  });
  P.ice = [part(new THREE.DodecahedronGeometry(1.4, 0), flat(0xeaf6ff), 0, 0.5, 0, 1.3, 0.6, 1)];

  // Miami streetlight: pole, arm over the road (+x), sodium lamp head
  const grey = flat(0x5a616b);
  P.streetlight = [
    part(new THREE.CylinderGeometry(0.16, 0.22, 9.4, 8), grey, 0, 4.7),
    part(new THREE.BoxGeometry(3.4, 0.16, 0.16), grey, 1.6, 9.35),
    part(new THREE.BoxGeometry(0.9, 0.18, 0.45), new THREE.MeshBasicMaterial({ color: 0xffc27a }), 3.2, 9.25, 0, 1, 1, 1, 0, 0, false),
  ];

  // Mars
  const redRock = flat(0x9a4428);
  P.spire = [
    part(new THREE.CylinderGeometry(1.2, 2.3, 9, 6), redRock, 0, 4.5),
    part(new THREE.CylinderGeometry(0.8, 1.3, 4, 6), flat(0xb5563a), 0.3, 10.5),
    part(new THREE.DodecahedronGeometry(1.5, 0), flat(0x7a3320), 0.4, 13.2, 0, 1.3, 0.8, 1.3),
  ];
  const alienSkin = flat(0x5bd96b);
  const alienEye = new THREE.MeshLambertMaterial({ color: 0x111118 });
  P.alien = [
    part(new THREE.CylinderGeometry(0.16, 0.16, 0.9, 6), alienSkin, 0.24, 0.45),
    part(new THREE.CylinderGeometry(0.16, 0.16, 0.9, 6), alienSkin, -0.24, 0.45),
    part(new THREE.CylinderGeometry(0.42, 0.55, 1.1, 8), flat(0xc9d2dc), 0, 1.4), // silver suit
    part(new THREE.CylinderGeometry(0.12, 0.12, 1.0, 6), alienSkin, 0.72, 2.2, 0, 1, 1, 1, 0, -0.5), // waving
    part(new THREE.SphereGeometry(0.22, 8, 6), alienSkin, 0.95, 2.7),
    part(new THREE.CylinderGeometry(0.12, 0.12, 0.9, 6), alienSkin, -0.6, 1.4, 0, 1, 1, 1, 0, 0.35),
    part(new THREE.SphereGeometry(0.72, 12, 10), alienSkin, 0, 2.55, 0, 1, 1.15, 1),
    part(new THREE.SphereGeometry(0.22, 10, 8), alienEye, 0.3, 2.6, 0.58, 1.3, 0.8, 0.6, 0, 0.45),
    part(new THREE.SphereGeometry(0.22, 10, 8), alienEye, -0.3, 2.6, 0.58, 1.3, 0.8, 0.6, 0, -0.45),
    part(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 5), alienSkin, 0, 3.55),
    part(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe14d }), 0, 3.9, 0, 1, 1, 1, 0, 0, false),
  ];
  const glowGreen = new THREE.MeshBasicMaterial({ color: 0x39ff88 });
  const glowPurple = new THREE.MeshBasicMaterial({ color: 0xb45cff });
  P.glow = [
    part(new THREE.OctahedronGeometry(1.2, 0), glowGreen, 0, 1.8, 0, 0.6, 1.9, 0.6, 0, 0, false),
    part(new THREE.OctahedronGeometry(0.9, 0), glowGreen, 0.9, 1.0, 0.3, 0.6, 1.5, 0.6, 0, -0.5, false),
    part(new THREE.OctahedronGeometry(0.8, 0), glowPurple, -0.8, 0.9, -0.2, 0.6, 1.4, 0.6, 0.2, 0.6, false),
  ];
  const white = flat(0xe8ecf0);
  const dishGeo = new THREE.SphereGeometry(2.2, 14, 6, 0, Math.PI * 2, 0, Math.PI / 3.2);
  P.dish = [
    part(new THREE.CylinderGeometry(0.25, 0.35, 4, 8), flat(0x8d949e), 0, 2),
    part(dishGeo, new THREE.MeshLambertMaterial({ color: 0xe8ecf0, flatShading: true, side: THREE.DoubleSide }), 0, 5.3, 0, 1, 1, 1, Math.PI - 0.7),
    part(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 5), white, 0, 4.8, 0.55, 1, 1, 1, -0.7),
    part(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3b3b }), 0, 5.5, 1.1, 1, 1, 1, 0, 0, false),
  ];
  P.habitat = [
    part(new THREE.SphereGeometry(4, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), white, 0, 0),
    part(new THREE.CylinderGeometry(4.05, 4.05, 0.5, 18), flat(0x8d949e), 0, 0.25),
    part(new THREE.TorusGeometry(3.6, 0.14, 6, 24), new THREE.MeshBasicMaterial({ color: 0x20e7ff }), 0, 1.7, 0, 1, 1, 1, Math.PI / 2, 0, false),
    part(new THREE.BoxGeometry(1.8, 2.2, 2.4), white, 0, 1.1, 3.8),
  ];

  const glowA = new THREE.MeshBasicMaterial({ color: 0x20e7ff });
  const glowB = new THREE.MeshBasicMaterial({ color: 0xff2bd6 });
  P.crystal = [part(new THREE.OctahedronGeometry(3, 0), glowA, 0, 0, 0, 1, 2, 1, 0, 0, false), part(new THREE.OctahedronGeometry(1.4, 0), glowB, 3, 3, 1, 1, 2, 1, 0, 0, false)];
  P.ring = [part(new THREE.TorusGeometry(5, 0.35, 6, 32), glowB, 0, 0, 0, 1, 1, 1, Math.PI / 2 - 0.3, 0, false)];
  return P;
}

// --------------------------------------------------------------- Mars spacecraft
// A flying saucer about 12 units across. Landed ones stand on legs with the ramp down;
// flying ones can shine a tractor beam. userData.lights are recoloured every frame.
function buildSaucer(landed, beam = false) {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0xd2d9e0, metalness: 0.3, roughness: 0.35 }); // no env map, so keep metalness low or it renders black
  const disc = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 12), hull);
  disc.scale.set(6, 1.1, 6);
  disc.castShadow = true;
  g.add(disc);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(5.9, 0.35, 8, 40), mat(0x5c6670, { metal: 0.7, rough: 0.3 }));
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(2.6, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x7fffd0, transparent: true, opacity: 0.5, roughness: 0.05, metalness: 0.2, emissive: 0x1a6a50, depthWrite: false })
  );
  dome.position.y = 0.7;
  dome.renderOrder = 2;
  g.add(dome);
  // The pilot
  const pilot = new THREE.Mesh(new THREE.SphereGeometry(0.9, 14, 10), mat(0x5bd96b));
  pilot.scale.set(1, 1.15, 1);
  pilot.position.y = 1.5;
  g.add(pilot);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), mat(0x111118, { rough: 0.2 }));
    eye.scale.set(1.3, 0.8, 0.6);
    eye.position.set(s * 0.38, 1.6, 0.72);
    eye.rotation.z = s * 0.45;
    g.add(eye);
  }
  const lights = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe14d }));
    l.position.set(Math.cos(a) * 5.2, -0.2, Math.sin(a) * 5.2);
    g.add(l);
    lights.push(l);
  }
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.2, 20), new THREE.MeshBasicMaterial({ color: 0x39ff88 }));
  glow.position.y = -1.05;
  g.add(glow);
  if (landed) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 2.6, 8), mat(0x5c6670, { metal: 0.6 }));
      leg.position.set(Math.cos(a) * 3.4, -1.9, Math.sin(a) * 3.4);
      leg.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3);
      g.add(leg);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.2, 10), mat(0x5c6670, { metal: 0.6 }));
      foot.position.set(Math.cos(a) * 3.8, -3.2, Math.sin(a) * 3.8);
      g.add(foot);
    }
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(2, 0.15, 4), new THREE.MeshBasicMaterial({ color: 0xc8ffe0 }));
    ramp.position.set(0, -2.2, 3.2);
    ramp.rotation.x = -0.55;
    g.add(ramp);
  }
  if (beam) {
    const h = 34;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(7, h, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x5dff9a, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    cone.position.y = -1 - h / 2;
    g.add(cone);
  }
  g.userData.lights = lights;
  return g;
}

// Retro rocket on its launch pad, about 25 units tall.
function buildRocket() {
  const g = new THREE.Group();
  const white = mat(0xf2f2f0, { rough: 0.4 });
  const red = mat(0xe23b3b, { rough: 0.4 });
  const add = (geo, m, x, y, z) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.castShadow = true;
    g.add(o);
    return o;
  };
  add(new THREE.CylinderGeometry(6, 6.5, 0.8, 24), mat(0x8d949e), 0, 0.4, 0);
  add(new THREE.CylinderGeometry(1.2, 2, 2.4, 16), mat(0x33363c, { metal: 0.6 }), 0, 2.3, 0);
  add(new THREE.CylinderGeometry(2.2, 2.2, 16, 20), white, 0, 11.4, 0);
  add(new THREE.CylinderGeometry(2.25, 2.25, 1.2, 20), red, 0, 17, 0);
  add(new THREE.ConeGeometry(2.2, 6, 20), red, 0, 22.4, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const fin = add(new THREE.BoxGeometry(0.35, 5, 3), red, Math.cos(a) * 2.9, 5.6, Math.sin(a) * 2.9);
    fin.rotation.y = Math.PI / 2 - a; // long side points outward
  }
  for (const y of [12, 15]) {
    const port = add(new THREE.CylinderGeometry(0.6, 0.6, 0.3, 14), new THREE.MeshBasicMaterial({ color: 0x7fe8ff }), 0, y, 2.2);
    port.rotation.x = Math.PI / 2;
  }
  return g;
}

// --------------------------------------------------------------- Miami props
// Art deco hotel, `h` tall, its front (+z) facing the street: pastel block, white "eyebrow"
// ledges over rows of lit windows, a central fin and a neon sign across the top.
function buildDecoHotel(h, color, neon, name) {
  const g = new THREE.Group();
  const w = 22, d = 14;
  const facade = new THREE.MeshLambertMaterial({ color });
  const white = new THREE.MeshLambertMaterial({ color: 0xf4f1ea });
  const add = (geo, m, x, y, z) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.castShadow = true;
    g.add(o);
    return o;
  };
  add(new THREE.BoxGeometry(w, h, d), facade, 0, h / 2, 0);
  const lit = new THREE.MeshBasicMaterial({ color: 0xd9b36a });
  for (let y = 3; y < h - 2; y += 3.2) {
    add(new THREE.BoxGeometry(w + 0.6, 0.25, 1.2), white, 0, y + 1.3, d / 2 + 0.5); // eyebrow ledge
    for (const x of [-7, -3.5, 3.5, 7]) add(new THREE.BoxGeometry(2.2, 1.3, 0.1), lit, x, y, d / 2 + 0.05);
  }
  add(new THREE.BoxGeometry(3, h + 5, 1.6), white, 0, (h + 5) / 2, d / 2 + 0.6); // central fin
  const neonMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(neon) });
  add(new THREE.BoxGeometry(w + 0.4, 0.3, 0.3), neonMat, 0, h - 0.4, d / 2 + 0.2); // neon trim
  add(new THREE.BoxGeometry(w + 0.4, 0.3, 0.3), neonMat, 0, 2.2, d / 2 + 0.2);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.5), new THREE.MeshBasicMaterial({ map: T.neonTexture(name, neon), transparent: true, depthWrite: false }));
  sign.position.set(0, h + 2.6, d / 2 + 1.5);
  g.add(sign);
  return g;
}

// A cigarette-style go-fast boat about 10 long, pointing +z, with a wake trailing behind.
function buildGoFastBoat(n) {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: n % 2 ? 0xf4f4f4 : 0x14161c, roughness: 0.3, metalness: 0.2 });
  const stripe = new THREE.MeshBasicMaterial({ color: n % 2 ? 0x2de0f0 : 0xff4fa3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 7), hull);
  body.position.set(0, 0.45, -0.6);
  g.add(body);
  const bow = new THREE.Mesh(new THREE.ConeGeometry(1.2, 3.6, 4), hull);
  bow.rotation.x = Math.PI / 2;
  bow.rotation.y = Math.PI / 4;
  bow.scale.set(1.4, 1, 0.55);
  bow.position.set(0, 0.45, 4.6);
  g.add(bow);
  for (const s of [-1, 1]) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 7), stripe);
    st.position.set(s * 1.22, 0.55, -0.6);
    g.add(st);
  }
  const screen = new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 0.1), new THREE.MeshStandardMaterial({ color: 0x1c2a3a, roughness: 0.1, metalness: 0.6 }));
  screen.position.set(0, 1.1, 1.2);
  screen.rotation.x = -0.5;
  g.add(screen);
  for (const s of [-0.5, 0.5]) {
    const engine = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1, 0.6), new THREE.MeshLambertMaterial({ color: 0x111111 }));
    engine.position.set(s, 0.8, -4.3);
    g.add(engine);
  }
  // Wake: a white V spreading out behind
  const wake = new THREE.Mesh(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1.2, 0, -4), new THREE.Vector3(1.2, 0, -4), new THREE.Vector3(-7, 0, -26), new THREE.Vector3(7, 0, -26)]),
    new THREE.MeshBasicMaterial({ color: 0x9fc8e0, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
  );
  wake.geometry.setIndex([0, 2, 1, 1, 2, 3]);
  wake.position.y = 0.05;
  g.add(wake);
  return g;
}

// A jagged lightning bolt from `top` down to the sea, as a flat ribbon in the XY plane.
function boltGeometry(rand, top) {
  const verts = [], idx = [];
  let x = 0;
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const y = top - (top / steps) * i;
    const w = 5 * (1 - i / steps) + 1.4;
    verts.push(x - w, y, 0, x + w, y, 0);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    x += (rand() - 0.5) * 30;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  return g;
}

