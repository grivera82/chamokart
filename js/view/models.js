// Procedural low-poly models: karts, drivers, items.
import * as THREE from "three";
import { CHARACTERS } from "../data.js?v=3";
import { itemBoxTexture, shirtLogoTexture } from "./textures.js?v=3";

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    matCache.set(
      key,
      new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.55, metalness: opts.metal ?? 0.05, flatShading: !!opts.flat, emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.ei ?? 1 })
    );
    matCache.get(key).userData.shared = true;
  }
  return matCache.get(key);
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
  torus: (r, t, rs = 8, ts = 20, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, rs, ts, arc),
};

// ---------------------------------------------------------------- driver

let logoMat = null;
function shirtLogoMaterial() {
  if (!logoMat) {
    logoMat = new THREE.MeshStandardMaterial({ map: shirtLogoTexture("BALMAIN"), transparent: true, alphaTest: 0.4, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    logoMat.userData.shared = true;
  }
  return logoMat;
}

function eyes(head, opts = {}) {
  const white = mat(0xffffff, { rough: 0.3 });
  const pupil = mat(0x1a1a22, { rough: 0.2 });
  for (const s of [-1, 1]) {
    const e = mesh(G.sphere(0.1, 12, 10), white, s * 0.15, 0.06, 0.35);
    e.scale.set(1, 1.25, 0.7);
    head.add(e);
    const p = mesh(G.sphere(0.055, 10, 8), opts.pupil || pupil, s * 0.15, 0.06, 0.42);
    head.add(p);
  }
}

function mustache(head, color = 0x2a1a10) {
  const m = mesh(G.capsule(0.05, 0.26), mat(color), 0, -0.13, 0.38);
  m.rotation.z = Math.PI / 2;
  head.add(m);
}

function nose(head, skin) {
  head.add(mesh(G.sphere(0.085, 10, 8), mat(skin), 0, -0.03, 0.42));
}

export function buildDriver(charIndex) {
  const c = CHARACTERS[charIndex];
  const g = new THREE.Group();
  const skin = mat(c.skin);
  const shirt = mat(c.color);
  const accent = mat(c.accent);
  const style = c.style;
  const animal = style === "chick" || style === "bull";

  // Torso + arms
  const torso = mesh(G.capsule(0.3, 0.3), shirt, 0, 0.82, -0.2);
  torso.scale.set(1.1, 1, 0.9);
  g.add(torso);
  if (style === "balmain") {
    // Curved "BALMAIN" print hugging the front of the torso.
    const print = new THREE.Mesh(new THREE.CylinderGeometry(0.306, 0.306, 0.16, 16, 1, true, -0.8, 1.6), shirtLogoMaterial());
    print.position.y = 0.05;
    torso.add(print);
  }
  const belt = mesh(G.cyl(0.33, 0.33, 0.1), mat(0x333333), 0, 0.6, -0.2);
  g.add(belt);
  for (const s of [-1, 1]) {
    const arm = mesh(G.capsule(0.09, 0.42), style === "chick" ? shirt : animal ? skin : shirt, s * 0.36, 0.86, 0.06);
    arm.rotation.x = -1.1;
    arm.rotation.z = s * 0.25;
    g.add(arm);
    const hand = mesh(G.sphere(0.1, 10, 8), style === "mask" || style === "skull" ? mat(0xffffff) : skin, s * 0.26, 0.72, 0.38);
    g.add(hand);
  }

  const head = new THREE.Group();
  head.position.set(0, 1.46, -0.16);
  g.add(head);
  const headColor = style === "mask" ? c.color : c.skin;
  const skull = mesh(G.sphere(0.42, 20, 16), mat(headColor), 0, 0, 0);
  head.add(skull);

  switch (style) {
    case "cap": {
      eyes(head);
      nose(head, c.skin);
      mustache(head);
      const cap = mesh(G.sphere(0.445, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), shirt, 0, 0.08, 0);
      cap.geometry = new THREE.SphereGeometry(0.445, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      head.add(cap);
      const brim = mesh(G.cyl(0.3, 0.3, 0.05, 20), shirt, 0, 0.1, 0.38);
      brim.scale.set(1.1, 1, 0.8);
      head.add(brim);
      const badge = mesh(G.cyl(0.13, 0.13, 0.03, 16), accent, 0, 0.3, 0.36);
      badge.rotation.x = Math.PI / 2 - 0.5;
      head.add(badge);
      const hair = mesh(G.sphere(0.43, 16, 10), mat(0x2a1a10), 0, -0.05, -0.08);
      hair.scale.set(1.02, 0.85, 0.95);
      head.add(hair);
      break;
    }
    case "balmain": {
      nose(head, c.skin);
      // Short slicked-back hair with a fade
      const hairMat = mat(0x1c120c);
      const hair = mesh(G.sphere(0.44), hairMat, 0, 0.07, -0.05);
      hair.geometry = new THREE.SphereGeometry(0.44, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
      hair.rotation.x = -0.35;
      hair.scale.set(1.02, 1.05, 1.05);
      head.add(hair);
      // Sunglasses
      const lens = mat(0x111116, { rough: 0.15, metal: 0.6 });
      for (const s of [-1, 1]) {
        const l = mesh(G.box(0.22, 0.12, 0.04), lens, s * 0.15, 0.07, 0.4);
        l.rotation.y = s * 0.25;
        head.add(l);
      }
      head.add(mesh(G.box(0.1, 0.03, 0.03), lens, 0, 0.1, 0.43));
      // Stubble
      const stubble = mesh(G.sphere(0.4), mat(0x3a2a20, { rough: 0.9 }), 0, -0.02, 0.035);
      stubble.geometry = new THREE.SphereGeometry(0.4, 16, 8, Math.PI * 0.15, Math.PI * 0.7, Math.PI * 0.6, Math.PI * 0.3);
      head.add(stubble);
      break;
    }
    case "sombrero": {
      eyes(head);
      nose(head, c.skin);
      mustache(head, 0x1a1008);
      const straw = mat(0xe8c872, { flat: true });
      const brim = mesh(G.cyl(0.95, 0.95, 0.06, 24), straw, 0, 0.3, 0);
      head.add(brim);
      const rim = mesh(G.torus(0.95, 0.06, 6, 28), straw, 0, 0.33, 0);
      rim.rotation.x = Math.PI / 2;
      head.add(rim);
      head.add(mesh(G.cyl(0.26, 0.36, 0.5, 16), straw, 0, 0.58, 0));
      const band = mesh(G.cyl(0.37, 0.37, 0.1, 16), shirt, 0, 0.4, 0);
      head.add(band);
      break;
    }
    case "pigtails": {
      eyes(head);
      nose(head, c.skin);
      const hairMat = mat(0xa0522d);
      const hair = mesh(G.sphere(0.45, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat, 0, 0.04, -0.04);
      hair.geometry = new THREE.SphereGeometry(0.45, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
      head.add(hair);
      for (const s of [-1, 1]) {
        const pt = mesh(G.sphere(0.2, 12, 10), hairMat, s * 0.5, -0.05, -0.1);
        pt.scale.set(0.8, 1.3, 0.8);
        head.add(pt);
      }
      for (const s of [-1, 1]) {
        const b = mesh(G.cone(0.12, 0.25, 8), accent, s * 0.13, 0.46, 0);
        b.rotation.z = -s * Math.PI / 2;
        head.add(b);
      }
      break;
    }
    case "bull": {
      eyes(head);
      const snout = mesh(G.sphere(0.27, 14, 10), mat(0xe9c9a8), 0, -0.15, 0.3);
      snout.scale.set(1.1, 0.8, 0.8);
      head.add(snout);
      for (const s of [-1, 1]) head.add(mesh(G.sphere(0.045, 8, 6), mat(0x222222), s * 0.09, -0.12, 0.51));
      const ring = mesh(G.torus(0.09, 0.02, 6, 16), mat(0xffd23f, { metal: 0.8, rough: 0.3 }), 0, -0.3, 0.46);
      head.add(ring);
      for (const s of [-1, 1]) {
        const horn = mesh(G.cone(0.09, 0.5, 10), mat(0xf2e8d5), s * 0.45, 0.32, 0);
        horn.rotation.z = -s * 1.0;
        head.add(horn);
        const ear = mesh(G.sphere(0.12, 10, 8), mat(c.skin), s * 0.42, 0.1, -0.05);
        ear.scale.set(1.4, 0.6, 0.8);
        head.add(ear);
      }
      break;
    }
    case "chick": {
      eyes(head);
      const beak = mesh(G.cone(0.13, 0.3, 10), mat(0xff8a1a), 0, -0.08, 0.48);
      beak.rotation.x = Math.PI / 2;
      head.add(beak);
      for (let i = 0; i < 3; i++) head.add(mesh(G.sphere(0.1, 8, 6), mat(0xe8322f), 0, 0.42 + (i === 1 ? 0.06 : 0), -0.1 + i * 0.12));
      for (const s of [-1, 1]) {
        const cheek = mesh(G.sphere(0.07, 8, 6), mat(0xff9fb0), s * 0.26, -0.1, 0.3);
        head.add(cheek);
      }
      break;
    }
    case "mask": {
      eyes(head);
      for (const s of [-1, 1]) {
        const patch = mesh(G.sphere(0.16, 12, 10), mat(0xffffff), s * 0.15, 0.08, 0.3);
        patch.scale.set(1.2, 1, 0.5);
        head.add(patch);
      }
      const mouth = mesh(G.sphere(0.13, 10, 8), mat(c.skin), 0, -0.2, 0.33);
      mouth.scale.set(1.3, 0.8, 0.6);
      head.add(mouth);
      const stripe = mesh(G.torus(0.42, 0.03, 6, 24, Math.PI), accent, 0, 0, 0);
      stripe.rotation.y = Math.PI / 2;
      head.add(stripe);
      const flame = mesh(G.cone(0.1, 0.25, 6), mat(0xe23b3b), 0, 0.32, 0.3);
      flame.rotation.x = 0.5;
      head.add(flame);
      break;
    }
    case "skull": {
      const glow = mat(c.accent, { emissive: c.accent, ei: 0.8 });
      for (const s of [-1, 1]) {
        const socket = mesh(G.sphere(0.12, 12, 10), mat(0x15151c), s * 0.15, 0.05, 0.33);
        socket.scale.set(1, 1.1, 0.6);
        head.add(socket);
        head.add(mesh(G.sphere(0.04, 8, 6), glow, s * 0.15, 0.05, 0.4));
      }
      const n = mesh(G.cone(0.05, 0.1, 3), mat(0x15151c), 0, -0.08, 0.4);
      n.rotation.x = Math.PI;
      head.add(n);
      const teeth = mesh(G.box(0.22, 0.05, 0.05), mat(0x15151c), 0, -0.22, 0.37);
      head.add(teeth);
      const cols = [0xff4f9a, 0xffd23f, 0x38e0c8, 0xff7a1a, 0x8e44ad];
      for (let i = 0; i < 5; i++) {
        const a = -0.9 + i * 0.45;
        head.add(mesh(G.sphere(0.09, 8, 6), mat(cols[i]), Math.sin(a) * 0.36, 0.3, Math.cos(a) * 0.2 - 0.05));
      }
      break;
    }
  }
  g.userData.head = head;
  return g;
}

// ---------------------------------------------------------------- kart

export const WHEEL_POS = [
  [0.8, 0.85], [-0.8, 0.85], [0.82, -0.82], [-0.82, -0.82],
];

export function buildKart(charIndex, kartIndex) {
  const c = CHARACTERS[charIndex];
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const paint = mat(c.color, { rough: 0.35, metal: 0.2 });
  const accent = mat(c.accent, { rough: 0.4 });
  const dark = mat(0x23232b, { rough: 0.7 });
  const metal = mat(0xb8bcc8, { rough: 0.3, metal: 0.8 });
  const tire = mat(0x1b1b1f, { rough: 0.9 });

  const wheelR = kartIndex === 2 ? 0.46 : 0.37;
  const wheels = [];
  const steerPivots = [];
  WHEEL_POS.forEach(([x, z], i) => {
    const pivot = new THREE.Group();
    const r = i >= 2 ? wheelR * 1.08 : wheelR;
    pivot.position.set(x, r, z);
    const wheel = new THREE.Group();
    const t = mesh(G.cyl(r, r, 0.32, 16), tire);
    t.rotation.z = Math.PI / 2;
    wheel.add(t);
    const hub = mesh(G.cyl(r * 0.55, r * 0.55, 0.34, 10), kartIndex === 1 ? accent : metal);
    hub.rotation.z = Math.PI / 2;
    wheel.add(hub);
    pivot.add(wheel);
    body.add(pivot);
    wheels.push(wheel);
    if (i < 2) steerPivots.push(pivot);
  });

  const exhausts = [];
  if (kartIndex === 0) {
    body.add(mesh(G.box(1.25, 0.16, 2.2), dark, 0, 0.32, 0));
    const nose = mesh(G.box(1.05, 0.34, 0.75), paint, 0, 0.5, 0.95);
    body.add(nose);
    const noseTop = mesh(G.cyl(0.52, 0.52, 0.75, 16, 1), paint, 0, 0.66, 0.95);
    noseTop.rotation.x = Math.PI / 2;
    noseTop.scale.set(1, 1, 0.35);
    body.add(noseTop);
    const bumper = mesh(G.capsule(0.1, 1.3), dark, 0, 0.34, 1.38);
    bumper.rotation.z = Math.PI / 2;
    body.add(bumper);
    for (const s of [-1, 1]) {
      body.add(mesh(G.box(0.26, 0.32, 1.1), accent, s * 0.62, 0.48, -0.05));
    }
    body.add(mesh(G.box(0.85, 0.7, 0.18), dark, 0, 0.8, -0.62));
    body.add(mesh(G.box(0.9, 0.42, 0.55), metal, 0, 0.56, -1.0));
    const plate = mesh(G.box(0.5, 0.3, 0.04), mat(0xffffff), 0, 0.62, 1.34);
    body.add(plate);
  } else if (kartIndex === 1) {
    body.add(mesh(G.box(1.15, 0.2, 2.5), dark, 0, 0.3, 0));
    const hull = mesh(G.box(1.0, 0.32, 1.9), paint, 0, 0.5, 0.2);
    body.add(hull);
    const nose = mesh(G.cone(0.52, 1.0, 4), paint, 0, 0.48, 1.6);
    nose.rotation.x = Math.PI / 2;
    nose.rotation.y = Math.PI / 4;
    nose.scale.set(1, 1, 0.55);
    body.add(nose);
    for (const s of [-1, 1]) {
      const fin = mesh(G.box(0.08, 0.5, 0.35), accent, s * 0.6, 0.95, -1.1);
      body.add(fin);
    }
    body.add(mesh(G.box(1.6, 0.07, 0.45), accent, 0, 1.2, -1.15));
    body.add(mesh(G.box(0.85, 0.7, 0.18), dark, 0, 0.8, -0.62));
    body.add(mesh(G.box(0.8, 0.38, 0.5), metal, 0, 0.55, -1.05));
    const stripe = mesh(G.box(0.25, 0.02, 1.9), accent, 0, 0.67, 0.2);
    body.add(stripe);
  } else {
    body.add(mesh(G.box(1.3, 0.2, 2.1), dark, 0, 0.45, 0));
    const hood = mesh(G.box(1.1, 0.4, 0.7), paint, 0, 0.7, 0.8);
    hood.rotation.x = -0.15;
    body.add(hood);
    const grille = mesh(G.box(0.9, 0.3, 0.05), metal, 0, 0.62, 1.17);
    body.add(grille);
    for (const s of [-1, 1]) {
      body.add(mesh(G.sphere(0.1, 10, 8), mat(0xfff6c0, { emissive: 0xfff2a0, ei: 0.8 }), s * 0.34, 0.8, 1.18));
    }
    // Roll cage
    const bar = mat(c.accent, { rough: 0.3, metal: 0.5 });
    for (const s of [-1, 1]) {
      const post = mesh(G.cyl(0.05, 0.05, 1.3, 8), bar, s * 0.55, 1.1, -0.55);
      body.add(post);
      const side = mesh(G.cyl(0.05, 0.05, 1.2, 8), bar, s * 0.55, 1.7, -0.05);
      side.rotation.x = Math.PI / 2 - 0.45;
      body.add(side);
    }
    const top = mesh(G.cyl(0.05, 0.05, 1.1, 8), bar, 0, 1.75, -0.55);
    top.rotation.z = Math.PI / 2;
    body.add(top);
    body.add(mesh(G.box(0.85, 0.7, 0.18), dark, 0, 0.9, -0.62));
    body.add(mesh(G.box(0.9, 0.45, 0.45), metal, 0, 0.7, -0.95));
  }
  // Exhaust pipes + flames
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff9a2a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const baseY = kartIndex === 2 ? 0.75 : 0.62;
  for (const s of [-1, 1]) {
    const pipe = mesh(G.cyl(0.08, 0.1, 0.4, 10), metal, s * 0.26, baseY, -1.32);
    pipe.rotation.x = Math.PI / 2 - 0.2;
    body.add(pipe);
    const flame = new THREE.Mesh(G.cone(0.16, 0.9, 10), flameMat.clone());
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(s * 0.26, baseY + 0.08, -1.85);
    flame.visible = false;
    body.add(flame);
    exhausts.push(flame);
  }
  // Steering wheel
  const sw = mesh(G.torus(0.2, 0.035, 6, 16), dark, 0, 0.95, 0.32);
  sw.rotation.x = -0.9;
  body.add(sw);

  const driver = buildDriver(charIndex);
  driver.position.set(0, kartIndex === 2 ? 0.12 : 0, -0.05);
  body.add(driver);

  root.userData = { body, wheels, steerPivots, exhausts, driver, wheelR, steeringWheel: sw };
  return root;
}

// ---------------------------------------------------------------- items

export function buildBanana() {
  const g = new THREE.Group();
  const peel = mesh(G.torus(0.42, 0.15, 8, 16, Math.PI * 0.95), mat(0xffd83a, { rough: 0.4 }));
  peel.rotation.z = Math.PI * 0.53;
  peel.position.y = 0.1;
  g.add(peel);
  g.add(mesh(G.sphere(0.07, 6, 5), mat(0x5a3a1a), -0.4, 0.26, 0));
  return g;
}

export function buildCoco(red) {
  const g = new THREE.Group();
  const shell = mesh(G.sphere(0.55, 16, 12), mat(red ? 0xd92b2b : 0x3ca83c, { rough: 0.5 }));
  shell.scale.set(1, 0.85, 1);
  g.add(shell);
  const rim = mesh(G.torus(0.52, 0.09, 8, 20), mat(0xf5f0dc));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = -0.12;
  g.add(rim);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    g.add(mesh(G.sphere(0.09, 8, 6), mat(0x3a2412), Math.cos(a) * 0.3, 0.38, Math.sin(a) * 0.3));
  }
  return g;
}

export function buildItemBox() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({
    map: itemBoxTexture(),
    transparent: true,
    opacity: 0.85,
    emissive: 0xffffff,
    emissiveIntensity: 0.25,
    emissiveMap: itemBoxTexture(),
    roughness: 0.2,
  });
  const box = new THREE.Mesh(G.box(1.7, 1.7, 1.7), m);
  box.castShadow = true;
  g.add(box);
  return g;
}

export function buildCoin() {
  const coin = new THREE.Mesh(G.cyl(0.5, 0.5, 0.12, 20), mat(0xffcc22, { metal: 0.9, rough: 0.25, emissive: 0x553300, ei: 0.6 }));
  coin.rotation.x = Math.PI / 2;
  const g = new THREE.Group();
  g.add(coin);
  const inner = new THREE.Mesh(G.cyl(0.3, 0.3, 0.14, 16), mat(0xffe680, { metal: 0.8, rough: 0.3 }));
  inner.rotation.x = Math.PI / 2;
  g.add(inner);
  return g;
}
