// Builds the visual world for a track: sky, lights, terrain, road, scenery.
import * as THREE from "three";
import { CURB } from "../sim/track.js?v=3";
import * as T from "./textures.js?v=3";
import { mat } from "./models.js?v=3";

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
      if (d < wd + 2.5) return road;
      return road + (base - road) * smoothstep(wd + 2.5, wd + 55, d);
    }
    // Void boundary (beach): sand shoulders, then slope into the sea.
    if (d < wd + 0.3) return road;
    const t = smoothstep(wd + 0.3, wd + 14, d);
    return road + (Math.min(base, road - 7) - road) * t + Math.max(0, base - (road - 7)) * smoothstep(wd + 40, wd + 90, d);
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
    const cNear = new THREE.Color(th.near), cFar = new THREE.Color(th.far), cHigh = new THREE.Color(th.high);
    const tmp = new THREE.Color();
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v), z = pos.getZ(v);
      const h = terrainHeight(x, z);
      pos.setY(v, h);
      const [i, d] = nearest(x, z, 3);
      const nearF = i < 0 ? 0 : 1 - smoothstep(10, 45, d - (i >= 0 ? wallDist(i) : 0));
      tmp.copy(cFar).lerp(cNear, nearF);
      if (theme === "snow" || theme === "meadow" || theme === "desert") {
        const hf = smoothstep(18, 60, h - (i >= 0 ? py[i] : 0));
        tmp.lerp(cHigh, hf * 0.8);
      }
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
    const bannerMat = new THREE.MeshBasicMaterial({ map: T.bannerTexture("CHAMO KART") });
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
  if (theme !== "neon") {
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
    }
    let r = rand(), kind = kinds[0][0];
    for (const [k, p] of kinds) {
      if (r < p) { kind = k; break; }
      r -= p;
    }
    // keep big things away from the road
    if ((kind === "rock" && theme === "desert") && d < wd + 14) continue;
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
  {
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
      const h = theme === "beach" ? 40 + rand() * 60 : theme === "neon" ? 0.001 : 140 + rand() * 260;
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
  if (theme !== "neon") {
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
  P.rock = [part(new THREE.DodecahedronGeometry(2, 0), flat(theme === "desert" ? 0xb0643a : theme === "snow" ? 0x8a94a6 : 0x9a9a92), 0, 1, 0, 1.2, 0.8, 1)];
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
  const glowA = new THREE.MeshBasicMaterial({ color: 0x20e7ff });
  const glowB = new THREE.MeshBasicMaterial({ color: 0xff2bd6 });
  P.crystal = [part(new THREE.OctahedronGeometry(3, 0), glowA, 0, 0, 0, 1, 2, 1, 0, 0, false), part(new THREE.OctahedronGeometry(1.4, 0), glowB, 3, 3, 1, 1, 2, 1, 0, 0, false)];
  P.ring = [part(new THREE.TorusGeometry(5, 0.35, 6, 32), glowB, 0, 0, 0, 1, 1, 1, Math.PI / 2 - 0.3, 0, false)];
  return P;
}
