// The Custom racer, built from a look (see js/look.js): the avatar (head, face, hair, hat,
// outfit, extras) and the dressing on top of a standard kart (paint finish, decals, rims,
// spoiler, flag, underglow and boost colour). Everything is procedural, like the other racers.
import * as THREE from "three";

const TAU = Math.PI * 2;
const hex = (c) => "#" + c.toString(16).padStart(6, "0");

// Materials are cached and shared between karts, like models.js does it.
const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.55, metalness: opts.metal ?? 0.05, emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.ei ?? 1, transparent: !!opts.opacity, opacity: opts.opacity ?? 1, side: opts.side ?? THREE.FrontSide });
    m.userData.shared = true;
    matCache.set(key, m);
  }
  return matCache.get(key);
}

const texCache = new Map();
function texMat(key, draw, w, h, opts = {}) {
  if (!texCache.has(key)) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: opts.rough ?? 0.5, metalness: opts.metal ?? 0.05, transparent: !!opts.transparent, alphaTest: opts.transparent ? 0.05 : 0, side: opts.side ?? THREE.FrontSide, polygonOffset: !!opts.decal, polygonOffsetFactor: opts.decal ? -2 : 0, depthWrite: !opts.decal });
    m.userData.shared = true;
    texCache.set(key, m);
  }
  return texCache.get(key);
}

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

const G = {
  sphere: (r, w = 16, h = 12) => new THREE.SphereGeometry(r, w, h),
  box: (x, y, z) => new THREE.BoxGeometry(x, y, z),
  cyl: (rt, rb, h, s = 14) => new THREE.CylinderGeometry(rt, rb, h, s),
  cone: (r, h, s = 12) => new THREE.ConeGeometry(r, h, s),
  capsule: (r, l) => new THREE.CapsuleGeometry(r, l, 4, 10),
  torus: (r, t, rs = 8, ts = 20, arc = TAU) => new THREE.TorusGeometry(r, t, rs, ts, arc),
  cap: (r, frac = 0.5, w = 20) => new THREE.SphereGeometry(r, w, 10, 0, TAU, 0, Math.PI * frac),
};

// ---------------------------------------------------------------- canvas art

function star(g, x, y, r, points = 5, inner = 0.45) {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * TAU - Math.PI / 2;
    const rr = i % 2 ? r * inner : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}

function heart(g, x, y, s) {
  g.beginPath();
  g.moveTo(x, y + s * 0.35);
  g.bezierCurveTo(x - s * 0.9, y - s * 0.3, x - s * 0.35, y - s * 0.95, x, y - s * 0.45);
  g.bezierCurveTo(x + s * 0.35, y - s * 0.95, x + s * 0.9, y - s * 0.3, x, y + s * 0.35);
  g.fill();
}

function bolt(g, x, y, s) {
  g.beginPath();
  const p = [[0.1, -1], [-0.45, 0.1], [-0.02, 0.1], [-0.2, 1], [0.5, -0.2], [0.05, -0.2], [0.3, -1]];
  p.forEach(([a, b], i) => (i ? g.lineTo(x + a * s, y + b * s) : g.moveTo(x + a * s, y + b * s)));
  g.closePath();
  g.fill();
}

function numberText(g, n, x, y, size, fill, stroke) {
  g.font = `900 ${size}px Arial Black, Arial, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  if (stroke) {
    g.lineWidth = size * 0.14;
    g.strokeStyle = stroke;
    g.strokeText(String(n), x, y);
  }
  g.fillStyle = fill;
  g.fillText(String(n), x, y);
}

// The shirt wraps around the torso: u = 0 (and 1) is the chest, u = 0.5 the back.
// Things on the chest are drawn twice, at x = 0 and x = w, so they meet across the seam.
function drawOutfit(g, w, h, look) {
  const { outfit, shirt, shirt2, number } = look;
  g.fillStyle = hex(shirt);
  g.fillRect(0, 0, w, h);
  const chest = (fn) => {
    fn(0);
    fn(w);
  };
  if (outfit === "stripes") {
    g.fillStyle = hex(shirt2);
    for (let y = 0; y < h; y += 48) g.fillRect(0, y, w, 22);
  } else if (outfit === "jersey") {
    g.fillStyle = hex(shirt2);
    g.fillRect(0, h * 0.2, w, 10);
    numberText(g, number, w / 2, h * 0.52, 120, "#fff", hex(shirt2)); // big number on the back
    chest((x) => numberText(g, number, x, h * 0.45, 60, "#fff", hex(shirt2)));
    g.fillStyle = hex(shirt2);
    g.fillRect(w * 0.2, 0, 14, h * 0.2);
    g.fillRect(w * 0.8 - 14, 0, 14, h * 0.2);
  } else if (outfit === "suit") {
    // White shirt in a V, and a tie
    chest((x) => {
      g.fillStyle = "#f6f6f2";
      g.beginPath();
      g.moveTo(x - 50, h * 0.12);
      g.lineTo(x + 50, h * 0.12);
      g.lineTo(x, h * 0.62);
      g.closePath();
      g.fill();
      g.fillStyle = hex(shirt2);
      g.beginPath();
      g.moveTo(x - 12, h * 0.16);
      g.lineTo(x + 12, h * 0.16);
      g.lineTo(x + 16, h * 0.5);
      g.lineTo(x, h * 0.6);
      g.lineTo(x - 16, h * 0.5);
      g.closePath();
      g.fill();
    });
    g.fillStyle = "rgba(0,0,0,0.25)";
    chest((x) => g.fillRect(x - 3, h * 0.62, 6, h * 0.3));
  } else if (outfit === "hoodie") {
    g.fillStyle = "rgba(0,0,0,0.18)";
    chest((x) => g.fillRect(x - 70, h * 0.55, 140, h * 0.22)); // pocket
    g.fillStyle = hex(shirt2);
    chest((x) => {
      g.fillRect(x - 22, h * 0.14, 5, h * 0.3);
      g.fillRect(x + 17, h * 0.14, 5, h * 0.3);
    });
  } else if (outfit === "hero") {
    g.fillStyle = hex(shirt2);
    chest((x) => {
      g.beginPath();
      g.moveTo(x, h * 0.18);
      g.lineTo(x + 62, h * 0.3);
      g.lineTo(x, h * 0.62);
      g.lineTo(x - 62, h * 0.3);
      g.closePath();
      g.fill();
    });
    g.fillStyle = hex(shirt);
    chest((x) => star(g, x, h * 0.36, 26));
  } else {
    g.fillStyle = hex(shirt2);
    g.fillRect(0, 0, w, 16); // collar
  }
}

// Decals are drawn on transparent canvases. Side ones run front (left) to back (right);
// the top one runs front (top) to back (bottom).
function drawDecal(g, w, h, look, top) {
  const c = hex(look.decalColor);
  g.fillStyle = c;
  g.strokeStyle = c;
  switch (look.decal) {
    case "flames": {
      // Tongues of fire licking back from the front
      const L = top ? h : w, W = top ? w : h;
      g.save();
      if (top) {
        g.translate(w, 0);
        g.rotate(Math.PI / 2);
      }
      const n = 5;
      g.beginPath();
      g.moveTo(0, W * 0.1);
      for (let i = 0; i < n; i++) {
        const y = W * (0.1 + (0.8 * (i + 0.5)) / n);
        const len = L * (0.55 + 0.35 * Math.sin(i * 2.1 + 1));
        g.quadraticCurveTo(len * 0.5, y - W * 0.12, len, y);
        g.quadraticCurveTo(len * 0.45, y + W * 0.02, L * 0.12, W * (0.1 + (0.8 * (i + 1)) / n));
      }
      g.lineTo(0, W * 0.9);
      g.closePath();
      g.fill();
      g.restore();
      break;
    }
    case "stripes":
      if (top) {
        g.fillRect(w * 0.28, 0, w * 0.14, h);
        g.fillRect(w * 0.58, 0, w * 0.14, h);
      } else {
        g.fillRect(0, h * 0.3, w, h * 0.14);
        g.fillRect(0, h * 0.56, w, h * 0.14);
      }
      break;
    case "number": {
      const r = Math.min(w, h) * 0.42;
      g.fillStyle = "#fff";
      g.beginPath();
      g.arc(w / 2, h / 2, r, 0, TAU);
      g.fill();
      g.lineWidth = r * 0.14;
      g.stroke();
      numberText(g, look.number, w / 2, h / 2 + r * 0.05, r * 1.15, c);
      break;
    }
    case "stars":
      for (let i = 0; i < 7; i++) star(g, (w * (i + 0.5 + (top ? 0 : (i % 2) * 0.2))) / 7, h * (i % 2 ? 0.32 : 0.66), Math.min(w, h) * 0.16);
      break;
    case "checker": {
      const s = Math.min(w, h) / 4;
      if (top)
        for (let y = h * 0.15; y < h * 0.15 + s * 2; y += s) for (let x = 0; x < w; x += s) (Math.round(x / s) + Math.round(y / s)) % 2 && g.fillRect(x, y, s, s);
      else for (let y = h * 0.25; y < h * 0.25 + s * 2; y += s) for (let x = 0; x < w; x += s) (Math.round(x / s) + Math.round(y / s)) % 2 && g.fillRect(x, y, s, s);
      break;
    }
    case "lightning":
      if (top) bolt(g, w / 2, h / 2, Math.min(w, h) * 0.42);
      else for (let i = 0; i < 3; i++) bolt(g, w * (0.2 + i * 0.3), h / 2, h * 0.42);
      break;
    case "hearts":
      for (let i = 0; i < 5; i++) heart(g, (w * (i + 0.5)) / 5, h * (i % 2 ? 0.42 : 0.62), Math.min(w, h) * 0.3);
      break;
  }
}

const FLAGS = {
  vzla: (g, w, h) => {
    ["#f4c300", "#00247d", "#cf142b"].forEach((c, i) => ((g.fillStyle = c), g.fillRect(0, (i * h) / 3, w, h / 3 + 1)));
    g.fillStyle = "#fff";
    for (let i = 0; i < 8; i++) {
      const a = Math.PI * (1.12 + (i / 7) * 0.76);
      star(g, w / 2 + Math.cos(a) * h * 0.26, h * 0.62 + Math.sin(a) * h * 0.26, h * 0.045);
    }
  },
  mex: (g, w, h) => {
    ["#006847", "#fff", "#ce1126"].forEach((c, i) => ((g.fillStyle = c), g.fillRect((i * w) / 3, 0, w / 3 + 1, h)));
    g.fillStyle = "#8a5a1a";
    g.beginPath();
    g.ellipse(w / 2, h / 2, h * 0.14, h * 0.17, 0, 0, TAU);
    g.fill();
  },
  col: (g, w, h) => {
    g.fillStyle = "#fcd116";
    g.fillRect(0, 0, w, h / 2);
    g.fillStyle = "#003893";
    g.fillRect(0, h / 2, w, h / 4);
    g.fillStyle = "#ce1126";
    g.fillRect(0, (h * 3) / 4, w, h / 4);
  },
  usa: (g, w, h) => {
    for (let i = 0; i < 13; i++) ((g.fillStyle = i % 2 ? "#fff" : "#b22234"), g.fillRect(0, (i * h) / 13, w, h / 13 + 1));
    g.fillStyle = "#3c3b6e";
    g.fillRect(0, 0, w * 0.42, (h * 7) / 13);
    g.fillStyle = "#fff";
    for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) star(g, w * 0.05 + x * w * 0.08, h * 0.07 + y * h * 0.12, h * 0.03);
  },
  pr: (g, w, h) => {
    for (let i = 0; i < 5; i++) ((g.fillStyle = i % 2 ? "#fff" : "#ed0000"), g.fillRect(0, (i * h) / 5, w, h / 5 + 1));
    g.fillStyle = "#0050f0";
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(w * 0.45, h / 2);
    g.lineTo(0, h);
    g.fill();
    g.fillStyle = "#fff";
    star(g, w * 0.15, h / 2, h * 0.12);
  },
  esp: (g, w, h) => {
    g.fillStyle = "#aa151b";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#f1bf00";
    g.fillRect(0, h / 4, w, h / 2);
  },
  arg: (g, w, h) => {
    ["#74acdf", "#fff", "#74acdf"].forEach((c, i) => ((g.fillStyle = c), g.fillRect(0, (i * h) / 3, w, h / 3 + 1)));
    g.fillStyle = "#f6b40e";
    g.beginPath();
    g.arc(w / 2, h / 2, h * 0.1, 0, TAU);
    g.fill();
  },
  per: (g, w, h) => {
    ["#d91023", "#fff", "#d91023"].forEach((c, i) => ((g.fillStyle = c), g.fillRect((i * w) / 3, 0, w / 3 + 1, h)));
  },
  pirate: (g, w, h) => {
    g.fillStyle = "#111";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(w / 2, h * 0.42, h * 0.2, 0, TAU);
    g.fill();
    g.fillRect(w / 2 - h * 0.12, h * 0.5, h * 0.24, h * 0.14);
    g.fillStyle = "#111";
    g.beginPath();
    g.arc(w / 2 - h * 0.08, h * 0.4, h * 0.05, 0, TAU);
    g.arc(w / 2 + h * 0.08, h * 0.4, h * 0.05, 0, TAU);
    g.fill();
    g.strokeStyle = "#fff";
    g.lineWidth = h * 0.06;
    g.beginPath();
    g.moveTo(w / 2 - h * 0.35, h * 0.62);
    g.lineTo(w / 2 + h * 0.35, h * 0.9);
    g.moveTo(w / 2 + h * 0.35, h * 0.62);
    g.lineTo(w / 2 - h * 0.35, h * 0.9);
    g.stroke();
  },
  checker: (g, w, h) => {
    const s = h / 4;
    for (let y = 0; y < 4; y++) for (let x = 0; x * s < w; x++) ((g.fillStyle = (x + y) % 2 ? "#111" : "#fff"), g.fillRect(x * s, y * s, s, s));
  },
  rainbow: (g, w, h) => {
    ["#e40303", "#ff8c00", "#ffed00", "#008026", "#004dff", "#750787"].forEach((c, i) => ((g.fillStyle = c), g.fillRect(0, (i * h) / 6, w, h / 6 + 1)));
  },
};

function glowMaterial(color) {
  const key = "glow" + color;
  if (!texCache.has(key)) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.5, "rgba(255,255,255,0.45)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const m = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    m.userData.shared = true;
    texCache.set(key, m);
  }
  return texCache.get(key);
}

// ---------------------------------------------------------------- the avatar

// Where the face sits on each head (head-local): eye height/spacing, face depth, mouth height
const FACE = {
  human: { ey: 0.06, ex: 0.15, z: 0.36, my: -0.18 },
  skull: { ey: 0.05, ex: 0.15, z: 0.34, my: -0.22 },
  robot: { ey: 0.06, ex: 0.16, z: 0.36, my: -0.17 },
  alien: { ey: 0.02, ex: 0.17, z: 0.36, my: -0.2 },
  cat: { ey: 0.08, ex: 0.15, z: 0.36, my: -0.17 },
  bear: { ey: 0.1, ex: 0.16, z: 0.35, my: -0.2 },
  frog: { ey: 0.3, ex: 0.19, z: 0.22, my: -0.08 },
  pumpkin: { ey: 0.08, ex: 0.16, z: 0.4, my: -0.16 },
};

function buildHead(head, look) {
  const skin = mat(look.skin);
  const dark = mat(0x15151c);
  switch (look.head) {
    case "skull": {
      head.add(mesh(G.sphere(0.42, 20, 16), skin));
      for (const s of [-1, 1]) {
        const socket = mesh(G.sphere(0.12, 12, 10), dark, s * 0.15, 0.05, 0.33);
        socket.scale.set(1, 1.1, 0.6);
        head.add(socket);
      }
      const n = mesh(G.cone(0.05, 0.1, 3), dark, 0, -0.08, 0.4);
      n.rotation.x = Math.PI;
      head.add(n);
      const jaw = mesh(G.box(0.26, 0.07, 0.05), dark, 0, -0.22, 0.37);
      head.add(jaw);
      for (let i = -2; i <= 2; i++) head.add(mesh(G.box(0.012, 0.08, 0.06), skin, i * 0.05, -0.22, 0.375));
      break;
    }
    case "robot": {
      const m = mat(look.skin, { rough: 0.3, metal: 0.45 });
      head.add(mesh(G.box(0.74, 0.64, 0.7), m));
      head.add(mesh(G.box(0.6, 0.44, 0.02), mat(0x1a1a24, { rough: 0.2 }), 0, 0.02, 0.355)); // screen face
      for (const s of [-1, 1]) {
        const bolt = mesh(G.cyl(0.08, 0.08, 0.1, 10), mat(0x777a85, { metal: 0.6, rough: 0.3 }), s * 0.41, 0, 0);
        bolt.rotation.z = Math.PI / 2;
        head.add(bolt);
      }
      head.add(mesh(G.cyl(0.02, 0.02, 0.3, 6), m, 0, 0.45, 0));
      head.add(mesh(G.sphere(0.06, 10, 8), mat(look.eyeColor, { emissive: look.eyeColor, ei: 0.8 }), 0, 0.62, 0));
      break;
    }
    case "alien": {
      const s = mesh(G.sphere(0.42, 20, 16), skin, 0, 0.04, 0);
      s.scale.set(1, 1.18, 0.95);
      head.add(s);
      for (const sd of [-1, 1]) {
        const a = mesh(G.cyl(0.018, 0.018, 0.34, 6), skin, sd * 0.16, 0.56, -0.02);
        a.rotation.z = -sd * 0.35;
        head.add(a);
        head.add(mesh(G.sphere(0.06, 10, 8), mat(look.eyeColor, { emissive: look.eyeColor, ei: 0.6 }), sd * 0.23, 0.72, -0.02));
      }
      break;
    }
    case "cat": {
      head.add(mesh(G.sphere(0.42, 20, 16), skin));
      const pink = mat(0xff9fb0);
      for (const sd of [-1, 1]) {
        const ear = mesh(G.cone(0.14, 0.26, 4), skin, sd * 0.24, 0.38, -0.02);
        ear.rotation.z = -sd * 0.35;
        head.add(ear);
        const inner = mesh(G.cone(0.08, 0.16, 4), pink, sd * 0.235, 0.37, 0.04);
        inner.rotation.z = -sd * 0.35;
        head.add(inner);
        for (const dy of [-0.03, 0.03]) {
          const w = mesh(G.box(0.3, 0.012, 0.012), dark, sd * 0.3, -0.08 + dy, 0.33);
          w.rotation.z = sd * dy * 3;
          head.add(w);
        }
      }
      head.add(mesh(G.sphere(0.05, 8, 6), pink, 0, -0.05, 0.41));
      break;
    }
    case "bear": {
      head.add(mesh(G.sphere(0.42, 20, 16), skin));
      for (const sd of [-1, 1]) {
        const ear = mesh(G.sphere(0.13, 12, 10), skin, sd * 0.3, 0.33, -0.05);
        ear.scale.z = 0.6;
        head.add(ear);
        head.add(mesh(G.sphere(0.07, 10, 8), mat(0x3a2a20), sd * 0.3, 0.33, 0.0));
      }
      const snout = mesh(G.sphere(0.17, 14, 10), mat(0xf0dcc0), 0, -0.1, 0.33);
      snout.scale.set(1.15, 0.85, 0.8);
      head.add(snout);
      head.add(mesh(G.sphere(0.06, 10, 8), dark, 0, -0.04, 0.46));
      break;
    }
    case "frog": {
      const s = mesh(G.sphere(0.42, 20, 16), skin, 0, -0.02, 0);
      s.scale.set(1.18, 0.78, 1);
      head.add(s);
      for (const sd of [-1, 1]) head.add(mesh(G.sphere(0.15, 12, 10), skin, sd * 0.19, 0.26, 0.12)); // eye bumps
      break;
    }
    case "pumpkin": {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        const lobe = mesh(G.sphere(0.3, 14, 12), skin, Math.sin(a) * 0.17, 0, Math.cos(a) * 0.17);
        lobe.scale.set(1, 1.15, 1);
        head.add(lobe);
      }
      const stem = mesh(G.cyl(0.04, 0.06, 0.18, 8), mat(0x3a7a2a), 0, 0.4, 0);
      stem.rotation.z = 0.2;
      head.add(stem);
      break;
    }
    default: {
      head.add(mesh(G.sphere(0.42, 20, 16), skin));
      head.add(mesh(G.sphere(0.085, 10, 8), skin, 0, -0.03, 0.42)); // nose
      for (const sd of [-1, 1]) head.add(mesh(G.sphere(0.09, 10, 8), skin, sd * 0.41, 0, 0)); // ears
    }
  }
}

function buildEyes(head, look, f) {
  const white = mat(0xffffff, { rough: 0.3 });
  const iris = mat(look.eyeColor, { rough: 0.2 });
  const glow = mat(look.eyeColor, { emissive: look.eyeColor, ei: 0.9 });
  const darkM = mat(0x15151c);
  const pair = (fn) => [-1, 1].forEach((s) => fn(s, s * f.ex));
  switch (look.eyes) {
    case "cool":
      pair((s, x) => {
        const l = mesh(G.box(0.22, 0.12, 0.04), mat(look.eyeColor, { rough: 0.15, metal: 0.6 }), x, f.ey, f.z + 0.05);
        l.rotation.y = s * 0.25;
        head.add(l);
      });
      head.add(mesh(G.box(0.1, 0.03, 0.03), darkM, 0, f.ey + 0.03, f.z + 0.08));
      break;
    case "goggles": {
      const strap = mesh(G.torus(0.43, 0.03, 6, 28), darkM, 0, f.ey, 0);
      strap.rotation.x = Math.PI / 2;
      head.add(strap);
      pair((s, x) => {
        const rim = mesh(G.cyl(0.11, 0.11, 0.08, 16), mat(0xb8bcc8, { metal: 0.6, rough: 0.3 }), x, f.ey, f.z + 0.05);
        rim.rotation.x = Math.PI / 2;
        head.add(rim);
        const lens = mesh(G.cyl(0.085, 0.085, 0.085, 16), mat(look.eyeColor, { rough: 0.1, metal: 0.3, opacity: 0.8 }), x, f.ey, f.z + 0.055);
        lens.rotation.x = Math.PI / 2;
        head.add(lens);
      });
      break;
    }
    case "visor": {
      const v = mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.12, 24, 1, true, -1.1, 2.2), mat(look.eyeColor, { emissive: look.eyeColor, ei: 0.7, side: THREE.DoubleSide }), 0, f.ey, 0);
      head.add(v);
      break;
    }
    case "glow":
      pair((s, x) => head.add(mesh(G.sphere(0.055, 10, 8), glow, x, f.ey, f.z + 0.03)));
      break;
    case "cyclops": {
      const e = mesh(G.sphere(0.17, 14, 12), white, 0, f.ey + 0.02, f.z - 0.02);
      e.scale.set(1, 1, 0.6);
      head.add(e);
      head.add(mesh(G.sphere(0.08, 12, 10), iris, 0, f.ey + 0.02, f.z + 0.08));
      head.add(mesh(G.sphere(0.035, 8, 6), darkM, 0, f.ey + 0.02, f.z + 0.14));
      break;
    }
    default: {
      const big = look.eyes === "big";
      pair((s, x) => {
        const e = mesh(G.sphere(big ? 0.13 : 0.1, 12, 10), white, x, f.ey, f.z);
        e.scale.set(1, 1.25, 0.7);
        head.add(e);
        head.add(mesh(G.sphere(big ? 0.08 : 0.055, 10, 8), iris, x, f.ey - (big ? 0.01 : 0), f.z + (big ? 0.08 : 0.065)));
        if (big) head.add(mesh(G.sphere(0.025, 6, 6), white, x + 0.03, f.ey + 0.04, f.z + 0.14));
        if (look.eyes === "angry") {
          const brow = mesh(G.box(0.16, 0.04, 0.05), darkM, x, f.ey + 0.16, f.z + 0.04);
          brow.rotation.z = -s * 0.4;
          head.add(brow);
        } else if (look.eyes === "sleepy") {
          const lid = mesh(G.cap(0.105, 0.5, 12), mat(look.head === "skull" ? 0x15151c : look.skin), x, f.ey - 0.01, f.z + 0.005);
          lid.scale.set(1, 1.25, 0.75);
          lid.rotation.x = 0.35;
          head.add(lid);
        }
      });
    }
  }
}

function buildMouth(head, look, f) {
  const lip = mat(0x6a1a22);
  const white = mat(0xffffff, { rough: 0.3 });
  const hair = mat(look.hairColor, { rough: 0.8 });
  const smile = () => {
    const m = mesh(G.torus(0.09, 0.022, 6, 14, Math.PI), lip, 0, f.my + 0.06, f.z + 0.03);
    m.rotation.z = Math.PI;
    head.add(m);
  };
  switch (look.mouth) {
    case "smile":
      smile();
      break;
    case "grin":
      head.add(mesh(G.box(0.22, 0.08, 0.05), lip, 0, f.my, f.z + 0.01));
      head.add(mesh(G.box(0.19, 0.035, 0.05), white, 0, f.my + 0.015, f.z + 0.025));
      break;
    case "mustache":
      for (const s of [-1, 1]) {
        const m = mesh(G.capsule(0.045, 0.12), hair, s * 0.08, f.my + 0.07, f.z + 0.03);
        m.rotation.z = Math.PI / 2 + s * 0.35;
        head.add(m);
      }
      break;
    case "beard": {
      // The front of a shell around the jaw, under the mouth
      head.add(mesh(new THREE.SphereGeometry(0.44, 18, 10, 0, Math.PI, Math.PI * 0.6, Math.PI * 0.32), hair, 0, 0.02, 0.01));
      break;
    }
    case "fangs":
      smile();
      for (const s of [-1, 1]) {
        const t = mesh(G.cone(0.025, 0.08, 6), white, s * 0.055, f.my + 0.01, f.z + 0.05);
        t.rotation.x = Math.PI;
        head.add(t);
      }
      break;
    case "tongue":
      smile();
      head.add(mesh(G.sphere(0.05, 10, 8), mat(0xff6b8a), 0, f.my - 0.02, f.z + 0.04));
      break;
  }
}

function buildHair(head, look, hasHat) {
  const hair = mat(look.hairColor, { rough: 0.8 });
  const top = look.head === "robot" ? 0.34 : 0.4;
  switch (look.hair) {
    case "short": {
      const h = mesh(G.cap(0.44, 0.5), hair, 0, 0.05, -0.04);
      h.rotation.x = -0.3;
      head.add(h);
      break;
    }
    case "spiky":
      head.add(mesh(G.cap(0.43, 0.45), hair, 0, 0.04, -0.03));
      if (!hasHat)
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * TAU;
          const sp = mesh(G.cone(0.1, 0.3, 6), hair, Math.sin(a) * 0.2, top, Math.cos(a) * 0.2 - 0.05);
          sp.rotation.set(Math.cos(a) * 0.6, 0, -Math.sin(a) * 0.6);
          head.add(sp);
        }
      break;
    case "mohawk":
      if (!hasHat)
        for (let i = 0; i < 6; i++) {
          const sp = mesh(G.cone(0.08, 0.32, 4), hair, 0, top + 0.08 - Math.abs(i - 2.5) * 0.03, 0.28 - i * 0.12);
          sp.scale.x = 0.4;
          head.add(sp);
        }
      break;
    case "afro":
      head.add(mesh(G.sphere(0.52, 16, 12), hair, 0, 0.24, -0.2));
      break;
    case "long": {
      head.add(mesh(G.cap(0.45, 0.55), hair, 0, 0.03, -0.03));
      const back = mesh(G.capsule(0.3, 0.45), hair, 0, -0.35, -0.2);
      back.scale.z = 0.6;
      head.add(back);
      break;
    }
    case "ponytail": {
      const h = mesh(G.cap(0.44, 0.5), hair, 0, 0.04, -0.03);
      h.rotation.x = -0.2;
      head.add(h);
      const tail = mesh(G.capsule(0.09, 0.35), hair, 0, 0.05, -0.55);
      tail.rotation.x = 0.9;
      head.add(tail);
      break;
    }
  }
}

function buildHat(head, look, ud) {
  const c = mat(look.hatColor, { rough: 0.5 });
  const trim = mat(look.shirt2, { rough: 0.5 });
  const lift = look.hair === "afro" ? 0.2 : look.head === "robot" ? -0.02 : look.head === "alien" ? 0.1 : 0;
  const g = new THREE.Group();
  g.position.y = lift;
  head.add(g);
  switch (look.hat) {
    case "cap":
    case "backcap": {
      g.add(mesh(G.cap(0.45, 0.5), c, 0, 0.08, 0));
      const brim = mesh(G.cyl(0.3, 0.3, 0.05, 20), c, 0, 0.1, 0.38);
      brim.scale.set(1.1, 1, 0.8);
      g.add(brim);
      const badge = mesh(G.cyl(0.12, 0.12, 0.03, 16), trim, 0, 0.3, 0.36);
      badge.rotation.x = Math.PI / 2 - 0.5;
      g.add(badge);
      if (look.hat === "backcap") g.rotation.y = Math.PI;
      break;
    }
    case "cowboy": {
      const brim = mesh(G.cyl(0.72, 0.72, 0.04, 28), c, 0, 0.22, 0);
      brim.scale.z = 0.85;
      g.add(brim);
      g.add(mesh(G.cyl(0.3, 0.36, 0.34, 20), c, 0, 0.4, 0));
      g.add(mesh(G.cyl(0.365, 0.365, 0.07, 20), trim, 0, 0.27, 0));
      break;
    }
    case "sombrero": {
      g.add(mesh(G.cyl(0.95, 0.95, 0.04, 32), c, 0, 0.26, 0));
      g.add(mesh(G.torus(0.95, 0.05, 6, 32), c, 0, 0.3, 0).rotateX(Math.PI / 2));
      g.add(mesh(G.cone(0.34, 0.6, 20), c, 0, 0.58, 0));
      g.add(mesh(G.cyl(0.3, 0.33, 0.08, 20), trim, 0, 0.34, 0));
      break;
    }
    case "crown": {
      const gold = mat(look.hatColor, { rough: 0.25, metal: 0.6 });
      g.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.18, 20, 1, true), mat(look.hatColor, { rough: 0.25, metal: 0.6, side: THREE.DoubleSide }), 0, 0.46, 0));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        g.add(mesh(G.cone(0.07, 0.16, 6), gold, Math.sin(a) * 0.29, 0.62, Math.cos(a) * 0.29));
        g.add(mesh(G.sphere(0.04, 8, 6), mat(i % 2 ? 0xe23b3b : 0x3a7ad8, { rough: 0.2 }), Math.sin(a) * 0.3, 0.46, Math.cos(a) * 0.3));
      }
      break;
    }
    case "helmet": {
      const shell = mesh(new THREE.SphereGeometry(0.49, 24, 16, Math.PI / 2 + 0.95, TAU - 1.9, 0, Math.PI * 0.72), mat(look.hatColor, { rough: 0.25, metal: 0.2, side: THREE.DoubleSide }), 0, 0.02, 0);
      g.add(shell);
      const stripe = mesh(G.torus(0.49, 0.035, 6, 32, Math.PI), trim, 0, 0.02, 0);
      stripe.rotation.y = Math.PI / 2;
      g.add(stripe);
      break;
    }
    case "beanie": {
      g.add(mesh(G.cap(0.45, 0.5), c, 0, 0.06, 0));
      g.add(mesh(G.cyl(0.46, 0.46, 0.12, 20), trim, 0, 0.1, 0));
      g.add(mesh(G.sphere(0.1, 10, 8), trim, 0, 0.55, 0));
      break;
    }
    case "tophat": {
      g.add(mesh(G.cyl(0.52, 0.52, 0.04, 24), c, 0, 0.32, 0));
      g.add(mesh(G.cyl(0.3, 0.3, 0.55, 20), c, 0, 0.6, 0));
      g.add(mesh(G.cyl(0.305, 0.305, 0.09, 20), trim, 0, 0.39, 0));
      break;
    }
    case "flowers": {
      const cols = [look.hatColor, 0xffd23f, 0x38e0c8, 0xff7a1a, 0xe23b3b];
      for (let i = 0; i < 5; i++) {
        const a = -0.9 + i * 0.45;
        g.add(mesh(G.sphere(0.09, 8, 6), mat(cols[i]), Math.sin(a) * 0.36, 0.3, Math.cos(a) * 0.2 - 0.05));
      }
      break;
    }
    case "horns":
      for (const s of [-1, 1]) {
        const h = mesh(G.cone(0.08, 0.34, 10), mat(look.hatColor, { rough: 0.4 }), s * 0.26, 0.42, 0);
        h.rotation.z = -s * 0.5;
        g.add(h);
      }
      break;
    case "halo": {
      const h = mesh(G.torus(0.26, 0.04, 8, 28), mat(look.hatColor, { emissive: look.hatColor, ei: 0.8 }), 0, 0.7, 0);
      h.rotation.x = Math.PI / 2;
      g.add(h);
      break;
    }
    case "propeller": {
      g.add(mesh(G.cap(0.44, 0.5), c, 0, 0.06, 0));
      g.add(mesh(G.cyl(0.02, 0.02, 0.14, 6), mat(0x333333), 0, 0.54, 0));
      const blades = new THREE.Group();
      blades.position.y = 0.61;
      for (const s of [-1, 1]) blades.add(mesh(G.box(0.34, 0.02, 0.08), trim, s * 0.17, 0, 0));
      g.add(blades);
      ud.spin.push(blades);
      break;
    }
    case "party": {
      const cone = mesh(G.cone(0.2, 0.5, 16), c, 0.08, 0.6, 0);
      cone.rotation.z = -0.2;
      g.add(cone);
      g.add(mesh(G.sphere(0.07, 8, 6), trim, 0.13, 0.86, 0));
      break;
    }
  }
}

function buildExtra(g, look, ud) {
  const c = mat(look.extraColor, { rough: 0.6, side: THREE.DoubleSide });
  switch (look.extra) {
    case "cape": {
      const pivot = new THREE.Group();
      pivot.position.set(0, 1.3, -0.45);
      const cape = mesh(G.box(0.72, 0.02, 1.1), c, 0, 0, -0.55);
      pivot.add(cape);
      pivot.rotation.x = -0.55; // streaming back in the wind
      g.add(pivot);
      ud.flutter.push({ o: pivot, base: -0.55, amp: 0.08 });
      break;
    }
    case "scarf": {
      const ring = mesh(G.torus(0.22, 0.07, 8, 18), c, 0, 1.25, -0.16);
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      const pivot = new THREE.Group();
      pivot.position.set(0.12, 1.25, -0.36);
      pivot.add(mesh(G.box(0.14, 0.03, 0.7), c, 0, 0, -0.35));
      pivot.rotation.x = -0.2;
      g.add(pivot);
      ud.flutter.push({ o: pivot, base: -0.2, amp: 0.15 });
      break;
    }
    case "wings":
      for (const s of [-1, 1]) {
        const w = mesh(G.sphere(0.5, 14, 10), mat(look.extraColor, { rough: 0.5 }), s * 0.45, 1.25, -0.55);
        w.scale.set(1, 0.45, 0.12);
        w.rotation.set(0, s * 0.6, s * 0.4);
        g.add(w);
        ud.flap.push({ o: w, s });
      }
      break;
    case "jetpack": {
      const m = mat(look.extraColor, { rough: 0.35, metal: 0.4 });
      for (const s of [-1, 1]) {
        g.add(mesh(G.cyl(0.12, 0.12, 0.5, 12), m, s * 0.15, 0.95, -0.52));
        const cone = mesh(G.cone(0.1, 0.16, 10), mat(0x333333), s * 0.15, 0.64, -0.52);
        cone.rotation.x = Math.PI;
        g.add(cone);
        const flame = mesh(G.cone(0.07, 0.25, 8), mat(0xff9a2a, { emissive: 0xff7a1a, ei: 1 }), s * 0.15, 0.46, -0.52);
        flame.rotation.x = Math.PI;
        g.add(flame);
      }
      break;
    }
    case "guitar": {
      const m = mat(look.extraColor, { rough: 0.4 });
      const guitar = new THREE.Group();
      guitar.position.set(0, 0.95, -0.5);
      guitar.rotation.set(0.2, 0, 0.7);
      const body = mesh(G.sphere(0.24, 14, 10), m, 0, -0.1, 0);
      body.scale.set(1, 1.2, 0.35);
      guitar.add(body);
      guitar.add(mesh(G.cyl(0.07, 0.07, 0.02, 12), mat(0x15151c), 0, -0.05, 0.09).rotateX(Math.PI / 2));
      guitar.add(mesh(G.box(0.07, 0.6, 0.04), mat(0x5a3a1a), 0, 0.35, 0));
      g.add(guitar);
      break;
    }
  }
}

export function buildCustomDriver(look, ud) {
  const g = new THREE.Group();
  const outfit = texMat("outfit" + [look.outfit, look.shirt, look.shirt2, look.number].join(), (ctx, w, h) => drawOutfit(ctx, w, h, look), 512, 256);
  const shirt = mat(look.shirt);
  const trim = mat(look.shirt2);
  const skin = look.head === "robot" ? mat(look.skin, { rough: 0.3, metal: 0.45 }) : mat(look.skin);

  const torso = mesh(G.capsule(0.3, 0.3), outfit, 0, 0.82, -0.2);
  torso.scale.set(1.1, 1, 0.9);
  g.add(torso);
  g.add(mesh(G.cyl(0.33, 0.33, 0.1), look.outfit === "hero" ? trim : mat(0x333333), 0, 0.6, -0.2)); // belt
  for (const s of [-1, 1]) {
    const arm = mesh(G.capsule(0.09, 0.42), shirt, s * 0.36, 0.86, 0.06);
    arm.rotation.x = -1.1;
    arm.rotation.z = s * 0.25;
    g.add(arm);
    g.add(mesh(G.sphere(0.1, 10, 8), skin, s * 0.26, 0.72, 0.38));
  }
  if (look.outfit === "hoodie") {
    const hood = mesh(G.torus(0.26, 0.1, 8, 18), shirt, 0, 1.22, -0.38);
    hood.rotation.x = 1.2;
    g.add(hood);
  } else if (look.outfit === "suit") {
    for (const s of [-1, 1]) {
      const lapel = mesh(G.box(0.12, 0.3, 0.03), mat(look.shirt, { rough: 0.35 }), s * 0.13, 1.08, 0.06);
      lapel.rotation.z = s * 0.35;
      g.add(lapel);
    }
  }
  if (look.head !== "robot") g.add(mesh(G.cyl(0.12, 0.14, 0.2, 10), skin, 0, 1.2, -0.17)); // neck
  buildExtra(g, look, ud);

  const head = new THREE.Group();
  head.position.set(0, 1.46, -0.16);
  g.add(head);
  const f = FACE[look.head] || FACE.human;
  buildHead(head, look);
  const helmet = look.hat === "helmet";
  if (!helmet || look.hair === "long" || look.hair === "ponytail") buildHair(head, look, look.hat !== "none");
  buildEyes(head, look, f);
  buildMouth(head, look, f);
  buildHat(head, look, ud);
  g.userData.head = head;
  return g;
}

// ---------------------------------------------------------------- the car

// The paint for each finish (chrome and metallic keep a little glow: there's no environment
// map to reflect, so pure metal would look black).
export function paintMaterial(look) {
  const c = look.paint;
  switch (look.finish) {
    case "matte": return mat(c, { rough: 0.95, metal: 0 });
    case "metal": return mat(c, { rough: 0.3, metal: 0.55 });
    case "chrome": return mat(c, { rough: 0.12, metal: 0.7, emissive: c, ei: 0.18 });
    case "neon": return mat(c, { rough: 0.4, emissive: c, ei: 0.45 });
    default: return mat(c, { rough: 0.35, metal: 0.2 });
  }
}

export function kartColors(look) {
  return {
    paint: paintMaterial(look),
    accent: mat(look.trim, { rough: 0.4 }),
    bar: mat(look.trim, { rough: 0.3, metal: 0.5 }),
    hub: mat(look.rims, { rough: 0.3, metal: 0.6 }),
  };
}

// Surfaces decals go on, per kart type: [x, y, z, width (along the car), height, face]
// face: "L"/"R" sides, "T" top (lying flat, tilt = rotation.x)
const DECAL_SPOTS = [
  [[0.755, 0.48, -0.05, 1.08, 0.3, "R"], [-0.755, 0.48, -0.05, 1.08, 0.3, "L"], [0, 0.845, 0.95, 0.72, 0.62, "T"]],
  [[0.505, 0.5, 0.2, 1.85, 0.3, "R"], [-0.505, 0.5, 0.2, 1.85, 0.3, "L"], [0, 0.685, 0.55, 1.1, 0.7, "T"]],
  [[0.555, 0.7, 0.8, 0.68, 0.38, "R"], [-0.555, 0.7, 0.8, 0.68, 0.38, "L"], [0, 0.903, 0.77, 0.68, 1.05, "T", -0.15]],
];

function addDecals(body, look, kartIndex) {
  if (look.decal === "none") return;
  for (const [x, y, z, len, h, face, tilt = 0] of DECAL_SPOTS[kartIndex]) {
    const top = face === "T";
    const pw = top ? h : len, ph = top ? len : h; // plane size (width across x for the top)
    const aspect = pw / ph;
    const W = top ? 256 : Math.min(1024, Math.round(256 * aspect)), H = top ? Math.round(256 / aspect) : 256;
    const key = ["decal", look.decal, look.decalColor, look.number, W, H].join();
    const m = texMat(key, (ctx, w, hh) => drawDecal(ctx, w, hh, look, top), W, H, { transparent: true, decal: true });
    const geo = new THREE.PlaneGeometry(pw, ph);
    // Lying flat, turned so it reads right from the chase camera: image top towards the nose
    if (top) geo.rotateX(-Math.PI / 2).rotateY(Math.PI);
    const plane = new THREE.Mesh(geo, m);
    plane.position.set(x, y, z);
    if (top) plane.rotation.x = tilt;
    else {
      plane.rotation.y = face === "R" ? Math.PI / 2 : -Math.PI / 2;
      // Keep flames and stripes running front to back on both sides (numbers must not be mirrored)
      if (face === "L" && look.decal !== "number") plane.scale.x = -1;
    }
    body.add(plane);
  }
}

function addSpoiler(body, look, kartIndex) {
  if (look.spoiler === "none") return;
  const big = look.spoiler === "big";
  const m = mat(look.trim, { rough: 0.35, metal: 0.2 });
  const base = kartIndex === 1 ? 1.22 : 0.75;
  const y = base + (big ? 0.55 : 0.3);
  const z = kartIndex === 2 ? -1.25 : -1.15;
  for (const s of [-1, 1]) body.add(mesh(G.box(0.07, y - base, 0.2), m, s * 0.4, (y + base) / 2, z));
  const wing = mesh(G.box(big ? 1.9 : 1.3, 0.07, big ? 0.55 : 0.4), paintMaterial(look), 0, y, z);
  wing.rotation.x = -0.12;
  body.add(wing);
  if (big) for (const s of [-1, 1]) body.add(mesh(G.box(0.05, 0.32, 0.6), m, s * 0.95, y + 0.05, z));
}

function addFlag(body, look, ud) {
  if (look.flag === "none" || !FLAGS[look.flag]) return;
  body.add(mesh(G.cyl(0.02, 0.02, 1.9, 6), mat(0x333333, { metal: 0.5, rough: 0.3 }), -0.5, 1.5, -1.15));
  const pivot = new THREE.Group();
  pivot.position.set(-0.5, 2.3, -1.15);
  const m = texMat("flag" + look.flag, (ctx, w, h) => FLAGS[look.flag](ctx, w, h), 192, 128, { side: THREE.DoubleSide });
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.5), m);
  flag.position.set(0, 0, -0.375);
  flag.rotation.y = Math.PI / 2;
  pivot.add(flag);
  body.add(pivot);
  ud.flutter.push({ o: pivot, base: 0, amp: 0.25, axis: "y" });
}

function addGlow(root, look) {
  if (look.glow < 0) return;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.4), glowMaterial(look.glow));
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = 0.08;
  plane.renderOrder = 3;
  root.add(plane);
}

// Everything a custom kart adds on top of the standard body; also sets up the little
// animations (propeller, cape, flag) run by ud.tick.
export function dressCustomKart(root, look, kartIndex, anim) {
  const ud = root.userData;
  addDecals(ud.body, look, kartIndex);
  addSpoiler(ud.body, look, kartIndex);
  addFlag(ud.body, look, anim);
  addGlow(ud.body, look);
  ud.boostColor = look.boost;
  ud.tick = anim.tick;
}

export function customAnim() {
  const anim = { spin: [], flutter: [], flap: [] };
  anim.tick = (dt, time, speed = 12) => {
    for (const o of anim.spin) o.rotation.y += dt * (8 + speed * 0.6);
    for (const f of anim.flutter) {
      const v = f.base + Math.sin(time * (6 + speed * 0.2) + f.amp * 10) * f.amp;
      if (f.axis === "y") f.o.rotation.y = v;
      else f.o.rotation.x = v;
    }
    for (const w of anim.flap) w.o.rotation.z = w.s * (0.4 + Math.sin(time * 5) * 0.15);
  };
  return anim;
}
