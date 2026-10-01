// Procedural low-poly models: karts, drivers, items.
import * as THREE from "three";
import { CHARACTERS } from "../data.js?v=19";
import { cleanLook, DEFAULT_LOOK } from "../look.js?v=3";
import { buildCustomDriver, dressCustomKart, kartColors, customAnim } from "./custom.js?v=3";
import { tabbyTexture, itemBoxTexture, shirtLogoTexture, spiderSuitTexture, spiderMaskTexture, spiderWebTexture } from "./textures.js?v=8";

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
  const animal = style === "chick";
  const trex = style === "trex";
  const spidey = style === "spidey";
  const tabby = style === "tabby";
  const monkey = style === "monkey";
  const panda = style === "panda";
  const fur = tabby ? furMaterial("body") : monkey ? mat(MONKEY_FUR, { rough: 0.85 }) : panda && mat(PANDA_BLACK, { rough: 0.85 });

  // Torso + arms
  const torso = mesh(G.capsule(0.3, 0.3), trex || panda ? skin : spidey ? spiderMaterial("suit") : fur || shirt, 0, 0.82, -0.2);
  torso.scale.set(1.1, 1, 0.9);
  g.add(torso);
  if (trex) buildTrexBody(g, c, skin);
  if (tabby) buildTabbyBody(g);
  if (monkey) buildMonkeyBody(g, skin);
  if (panda) buildPandaBody(g, fur);
  if (spidey) {
    const emblem = spiderEmblem(0.22, mat(0x140a0a));
    emblem.position.set(0, 0.98, 0.075);
    emblem.rotation.x = -0.12;
    g.add(emblem);
  }
  if (style === "balmain") {
    // Curved "BALMAIN" print hugging the front of the torso.
    const print = new THREE.Mesh(new THREE.CylinderGeometry(0.306, 0.306, 0.16, 16, 1, true, -0.8, 1.6), shirtLogoMaterial());
    print.position.y = 0.05;
    torso.add(print);
  }
  if (!trex && !spidey && !tabby && !monkey && !panda) g.add(mesh(G.cyl(0.33, 0.33, 0.1), mat(0x333333), 0, 0.6, -0.2)); // belt
  for (const s of trex ? [] : [-1, 1]) {
    const arm = mesh(G.capsule(0.09, 0.42), fur || shirt, s * 0.36, 0.86, 0.06);
    arm.rotation.x = -1.1;
    arm.rotation.z = s * 0.25;
    g.add(arm);
    const hand = mesh(G.sphere(0.1, 10, 8), style === "skull" ? mat(0xffffff) : tabby ? mat(0xf6e6c8) : panda ? fur : skin, s * 0.26, 0.72, 0.38);
    g.add(hand);
  }

  const head = new THREE.Group();
  if (trex) head.position.set(0, 1.85, -0.02);
  else head.position.set(0, 1.46, -0.16);
  g.add(head);
  const skull = mesh(G.sphere(0.42, 24, 18), spidey ? spiderMaterial("mask") : tabby ? furMaterial("head") : monkey ? fur : mat(c.skin), 0, 0, 0);
  if (spidey) skull.rotation.x = Math.PI / 2; // texture pole to the front: the web radiates from the face
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
    case "spidey": {
      // Big white lenses with black rims, tilted up at the outer corners
      const rim = mat(0x140a0a, { rough: 0.4 });
      const lens = mat(0xffffff, { rough: 0.25 });
      for (const sd of [-1, 1]) {
        const eye = new THREE.Group();
        eye.position.set(sd * 0.17, 0.07, 0.36);
        eye.rotation.set(-0.1, sd * 0.42, sd * 0.55);
        const r = mesh(G.sphere(0.13, 14, 10), rim);
        r.scale.set(1.3, 0.85, 0.3);
        const l = mesh(G.sphere(0.105, 14, 10), lens, 0, 0, 0.02);
        l.scale.set(1.3, 0.8, 0.3);
        eye.add(r, l);
        head.add(eye);
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
    case "tabby": {
      // Dorito: an orange tabby with pale green-gold eyes and a slightly unimpressed look
      skull.scale.set(1.08, 0.95, 0.95);
      const cream = mat(0xf8ecd8, { rough: 0.8 });
      const pink = mat(0xe89a92, { rough: 0.6 });
      for (const sd of [-1, 1]) {
        // Big pointed ears, pink inside
        const ear = mesh(G.cone(0.16, 0.34, 14), furMaterial("head"), sd * 0.27, 0.37, -0.04);
        ear.scale.z = 0.55;
        ear.rotation.z = -sd * 0.32;
        head.add(ear);
        const inner = mesh(G.cone(0.1, 0.24, 12), pink, sd * 0.265, 0.35, 0.0);
        inner.scale.z = 0.35;
        inner.rotation.z = -sd * 0.32;
        head.add(inner);
        // Almond eyes with slit pupils under heavy, sleepy lids
        const eye = mesh(G.sphere(0.1, 14, 10), mat(0xc4c98a, { rough: 0.25 }), sd * 0.16, 0.04, 0.335);
        eye.scale.set(1.15, 0.85, 0.55);
        eye.rotation.z = sd * 0.12;
        head.add(eye);
        const slit = mesh(G.sphere(0.05, 8, 8), mat(0x141414, { rough: 0.2 }), sd * 0.16, 0.035, 0.385);
        slit.scale.set(0.35, 1.3, 0.4);
        head.add(slit);
        const lid = mesh(new THREE.SphereGeometry(0.108, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), furMaterial("head"), sd * 0.16, 0.045, 0.335);
        lid.scale.set(1.2, 0.95, 0.62);
        lid.rotation.set(0.5, 0, -sd * 0.18);
        head.add(lid);
        // White muzzle puffs and long whiskers
        const puff = mesh(G.sphere(0.12, 12, 10), cream, sd * 0.085, -0.15, 0.33);
        puff.scale.set(1, 0.85, 0.8);
        head.add(puff);
        for (const [dy, a] of [[-0.12, 0.12], [-0.15, -0.02], [-0.18, -0.16]]) {
          const wh = mesh(G.cyl(0.006, 0.006, 0.55, 4), mat(0xffffff), sd * 0.38, dy, 0.3);
          wh.rotation.set(0, sd * 0.25, Math.PI / 2 + sd * a);
          head.add(wh);
        }
      }
      head.add(mesh(G.sphere(0.1, 10, 8), cream, 0, -0.26, 0.28)); // chin
      const noseM = mesh(G.sphere(0.06, 10, 8), pink, 0, -0.07, 0.41); // pink nose
      noseM.scale.set(1.2, 0.75, 0.7);
      head.add(noseM);
      head.add(mesh(G.box(0.012, 0.06, 0.02), mat(0x7a3a2a), 0, -0.13, 0.42));
      break;
    }
    case "monkey": {
      // Momo: a heart-shaped peach face, big shiny eyes, round ears and a little smile
      const face = mat(c.skin, { rough: 0.7 });
      for (const sd of [-1, 1]) {
        const patch = mesh(G.sphere(0.19, 16, 12), face, sd * 0.13, 0.06, 0.25);
        patch.scale.set(1, 1.1, 0.75);
        head.add(patch);
        const eye = mesh(G.sphere(0.085, 14, 12), mat(0x24140c, { rough: 0.15 }), sd * 0.125, 0.07, 0.36);
        eye.scale.set(0.95, 1.1, 0.6);
        head.add(eye);
        head.add(mesh(G.sphere(0.026, 8, 6), mat(0xffffff, { rough: 0.2 }), sd * 0.125 + 0.03, 0.11, 0.405)); // sparkle
        head.add(mesh(G.sphere(0.06, 10, 8), mat(0xff9fb0, { rough: 0.8 }), sd * 0.25, -0.1, 0.3)); // blush
        // Big round ears, peach inside
        const ear = mesh(G.sphere(0.16, 16, 12), fur, sd * 0.43, 0.04, -0.02);
        ear.scale.set(0.45, 1, 1);
        head.add(ear);
        const inner = mesh(G.sphere(0.11, 14, 10), face, sd * 0.47, 0.04, 0.0);
        inner.scale.set(0.3, 1, 1);
        head.add(inner);
        head.add(mesh(G.sphere(0.018, 6, 5), mat(0x5a3020), sd * 0.035, -0.08, 0.46)); // nostril
      }
      const muzzle = mesh(G.sphere(0.21, 18, 12), face, 0, -0.13, 0.27);
      muzzle.scale.set(1.25, 0.85, 0.75);
      head.add(muzzle);
      const smile = mesh(G.torus(0.07, 0.014, 6, 14, Math.PI), mat(0x5a3020), 0, -0.15, 0.43);
      smile.rotation.set(-0.35, 0, Math.PI);
      head.add(smile);
      // A little tuft of hair on top
      for (const [x, a] of [[-0.06, 0.4], [0, 0], [0.06, -0.4]]) {
        const tuft = mesh(G.cone(0.05, 0.18, 8), fur, x, 0.44, 0.02);
        tuft.rotation.z = a;
        head.add(tuft);
      }
      break;
    }
    case "panda": {
      // Bao: a round white face, droopy black eye patches, black ears and a button nose
      skull.scale.set(1.08, 0.98, 1);
      for (const sd of [-1, 1]) {
        const patch = mesh(G.sphere(0.12, 16, 12), fur, sd * 0.15, 0.03, 0.33);
        patch.scale.set(0.85, 1.25, 0.55);
        patch.rotation.z = sd * 0.55; // tilted down and out
        head.add(patch);
        head.add(mesh(G.sphere(0.055, 12, 10), mat(0x2a2a30, { rough: 0.15 }), sd * 0.14, 0.05, 0.405));
        head.add(mesh(G.sphere(0.022, 8, 6), mat(0xffffff, { rough: 0.2 }), sd * 0.14 + 0.022, 0.075, 0.448)); // sparkle
        head.add(mesh(G.sphere(0.055, 10, 8), mat(0xffa6b8, { rough: 0.8 }), sd * 0.27, -0.13, 0.3)); // blush
        const ear = mesh(G.sphere(0.14, 16, 12), fur, sd * 0.3, 0.33, -0.04);
        ear.scale.set(1, 1, 0.6);
        head.add(ear);
      }
      const muzzle = mesh(G.sphere(0.15, 16, 12), skin, 0, -0.13, 0.32);
      muzzle.scale.set(1.3, 0.85, 0.8);
      head.add(muzzle);
      const nose = mesh(G.sphere(0.055, 12, 10), fur, 0, -0.07, 0.44);
      nose.scale.set(1.3, 0.8, 0.8);
      head.add(nose);
      const smile = mesh(G.torus(0.045, 0.012, 6, 12, Math.PI), fur, 0, -0.15, 0.435);
      smile.rotation.set(-0.3, 0, Math.PI);
      head.add(smile);
      break;
    }
    case "trex": {
      skull.scale.set(0.85, 0.82, 1);
      const dark = mat(0x3d7a2a);
      const snout = mesh(G.sphere(0.3), skin, 0, 0, 0.42);
      snout.scale.set(0.95, 0.74, 1.35);
      head.add(snout);
      const jaw = mesh(G.sphere(0.27), skin, 0, -0.3, 0.33);
      jaw.scale.set(0.9, 0.5, 1.3);
      head.add(jaw);
      // A grin full of teeth along the upper jaw
      const tooth = mat(0xfffbea, { rough: 0.3 });
      for (const s of [-1, 1]) {
        for (const dz of [-0.16, -0.02, 0.12, 0.26]) {
          const x = 0.285 * Math.sqrt(1 - (dz / 0.41) ** 2) * 0.82;
          const t = mesh(G.cone(0.03, 0.1, 6), tooth, s * x, -0.2, 0.42 + dz);
          t.rotation.x = Math.PI;
          head.add(t);
        }
      }
      // Eyes on the sides under heavy brows
      const white = mat(0xffffff, { rough: 0.3 });
      const pupil = mat(0x1a1a22, { rough: 0.2 });
      for (const s of [-1, 1]) {
        const e = mesh(G.sphere(0.085, 12, 10), white, s * 0.26, 0.13, 0.2);
        e.scale.set(0.7, 1, 1);
        head.add(e);
        head.add(mesh(G.sphere(0.045, 10, 8), pupil, s * 0.3, 0.14, 0.25));
        const brow = mesh(G.box(0.14, 0.05, 0.22), dark, s * 0.23, 0.24, 0.2);
        brow.rotation.z = s * 0.35;
        head.add(brow);
        head.add(mesh(G.sphere(0.035, 8, 6), mat(0x1d3312), s * 0.09, 0.09, 0.84)); // nostril
      }
      // Darker spots on top
      for (const [x, y, z] of [[0.12, 0.29, -0.05], [-0.11, 0.3, 0.1], [0.02, 0.27, -0.25], [-0.05, 0.19, 0.36]]) {
        const spot = mesh(G.sphere(0.07, 8, 6), dark, x, y, z);
        spot.scale.set(1, 0.4, 1);
        head.add(spot);
      }
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

// Dorito's fur (cached, like Spider-Man's suit)
const furMats = {};
function furMaterial(part) {
  if (!furMats[part]) {
    furMats[part] = new THREE.MeshStandardMaterial({ map: tabbyTexture(part), roughness: 0.85 });
    furMats[part].userData.shared = true;
  }
  return furMats[part];
}

// A white bib down the chest and a striped tail curling up behind the seat.
function buildTabbyBody(g) {
  const bib = mesh(G.sphere(0.24, 14, 10), mat(0xf8ecd8, { rough: 0.8 }), 0, 1.02, 0.02);
  bib.scale.set(0.85, 1.05, 0.45);
  g.add(bib);
  const tail = new THREE.Group();
  tail.position.set(0.18, 0.72, -0.62);
  let parent = tail;
  const rings = [mat(0xe8913a, { rough: 0.85 }), mat(0xb85a1c, { rough: 0.85 })];
  for (let i = 0; i < 7; i++) {
    // Each segment hangs off the last and bends a little more: back, then up
    const seg = new THREE.Group();
    if (i) seg.position.y = 0.17;
    seg.rotation.x = i === 0 ? -1.2 : 0.2;
    seg.add(mesh(G.capsule(0.075 - i * 0.003, 0.12), rings[i % 2], 0, 0.08, 0));
    parent.add(seg);
    parent = seg;
  }
  g.add(tail);
  g.userData.tail = tail;
  g.userData.cat = true; // the race view makes him look back and meow on speed boosters
}

// Momo's peach belly and a long tail that curls up into a spiral behind the seat.
const MONKEY_FUR = 0x8a5a33;
function buildMonkeyBody(g, skin) {
  const belly = mesh(G.sphere(0.25, 14, 10), mat(skin.color.getHex(), { rough: 0.7 }), 0, 0.8, 0.03);
  belly.scale.set(0.85, 1.1, 0.45);
  g.add(belly);
  const tail = new THREE.Group();
  tail.position.set(-0.15, 0.62, -0.55);
  const fur = mat(MONKEY_FUR, { rough: 0.85 });
  let parent = tail;
  for (let i = 0; i < 11; i++) {
    // Back and up, then tighter and tighter into a curl at the tip
    const seg = new THREE.Group();
    if (i) seg.position.y = 0.13;
    seg.rotation.x = i === 0 ? -1.4 : i < 4 ? 0.12 : 0.5;
    seg.add(mesh(G.capsule(0.05 - i * 0.002, 0.09), fur, 0, 0.06, 0));
    parent.add(seg);
    parent = seg;
  }
  g.add(tail);
  g.userData.tail = tail;
  g.userData.monkey = true;
}

// Bao's black shoulders: a band across the back and over both shoulders, like a real panda.
const PANDA_BLACK = 0x1e1e24;
function buildPandaBody(g, black) {
  const band = mesh(G.capsule(0.2, 0.42), black, 0, 1.06, -0.22);
  band.rotation.z = Math.PI / 2;
  band.scale.set(1, 1, 1.05);
  g.add(band);
  g.userData.panda = true;
}

// Neck, belly, tail and tiny arms (the head is built with the rest of the heads).
function buildTrexBody(g, c, skin) {
  const belly = mesh(G.sphere(0.28, 14, 10), mat(0xe8dca0), 0, 0.78, 0.02);
  belly.scale.set(0.9, 1.25, 0.5);
  g.add(belly);
  const neck = mesh(G.capsule(0.19, 0.4), skin, 0, 1.4, -0.12);
  neck.rotation.x = 0.3;
  g.add(neck);
  // Out the back window, drooping over the bed
  const tail = mesh(G.cone(0.26, 1.3, 12), skin, 0, 1.08, -0.95);
  tail.rotation.x = -Math.PI / 2 - 0.25;
  g.add(tail);
  // Ridge down the back of the neck
  const dark = mat(0x3d7a2a);
  for (let i = 0; i < 4; i++) {
    const spike = mesh(G.cone(0.06, 0.14, 6), dark, 0, 1.65 - i * 0.2, -0.28 - i * 0.06);
    spike.rotation.x = -0.6;
    g.add(spike);
  }
  // Famously tiny arms, nowhere near the wheel
  const claw = mat(0xfffbea, { rough: 0.3 });
  for (const s of [-1, 1]) {
    const arm = mesh(G.capsule(0.055, 0.12), skin, s * 0.2, 1.0, 0.1);
    arm.rotation.x = -1.3;
    g.add(arm);
    for (const d of [-1, 1]) {
      const cl = mesh(G.cone(0.02, 0.07, 5), claw, s * 0.2 + d * 0.025, 0.96, 0.24);
      cl.rotation.x = Math.PI / 2 + 0.4;
      g.add(cl);
    }
  }
}

// Spider-Man's suit and mask (cached so every Spider-Man shares them).
const spiderMats = {};
function spiderMaterial(kind) {
  if (!spiderMats[kind]) {
    const map = kind === "suit" ? spiderSuitTexture() : kind === "mask" ? spiderMaskTexture() : spiderWebTexture();
    spiderMats[kind] = new THREE.MeshStandardMaterial({ map, roughness: 0.5 });
    spiderMats[kind].userData.shared = true;
  }
  return spiderMats[kind];
}

// A spider facing +z, `size` across (chest logo, hood badge, headlight).
function spiderEmblem(size, material) {
  const g = new THREE.Group();
  const body = mesh(G.sphere(0.12, 10, 8), material, 0, -0.05, 0);
  body.scale.set(0.7, 1.3, 0.35);
  g.add(body);
  const head = mesh(G.sphere(0.07, 8, 6), material, 0, 0.13, 0);
  head.scale.set(1, 1, 0.4);
  g.add(head);
  for (const sd of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      // Upper legs reach up and out, lower ones down and out
      const up = i < 2;
      const a = sd * (up ? 0.5 + i * 0.35 : 1.9 + (i - 2) * 0.4);
      const leg = mesh(G.box(0.025, 0.3, 0.02), material, sd * 0.05, up ? 0.05 : -0.05, 0);
      leg.geometry.translate(0, 0.15, 0);
      leg.rotation.z = -a;
      g.add(leg);
    }
  }
  g.scale.setScalar(size / 0.6);
  return g;
}

// ---------------------------------------------------------------- kart

export const WHEEL_POS = [
  [0.8, 0.85], [-0.8, 0.85], [0.82, -0.82], [-0.82, -0.82],
];

// look: the Custom racer's creation (ignored for everyone else)
export function buildKart(charIndex, kartIndex, look) {
  const c = CHARACTERS[charIndex];
  const custom = c.custom ? cleanLook(look) || DEFAULT_LOOK : null;
  const cc = custom && kartColors(custom);
  const anim = custom && customAnim();
  if (c.car === "cx9") return buildCX9(charIndex);
  if (c.car === "pickup") return buildPickup(charIndex);
  if (c.car === "spider") return buildSpiderMobile(charIndex);
  if (c.car === "transformer") return buildTransformer(charIndex);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const paint = cc ? cc.paint : mat(c.color, { rough: 0.35, metal: 0.2 });
  const accent = cc ? cc.accent : mat(c.accent, { rough: 0.4 });
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
    const hub = mesh(G.cyl(r * 0.55, r * 0.55, 0.34, 10), cc ? cc.hub : kartIndex === 1 ? accent : metal);
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
    const bar = cc ? cc.bar : mat(c.accent, { rough: 0.3, metal: 0.5 });
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

  const driver = custom ? buildCustomDriver(custom, anim) : buildDriver(charIndex);
  driver.position.set(0, kartIndex === 2 ? 0.12 : 0, -0.05);
  body.add(driver);

  root.userData = { body, wheels, steerPivots, exhausts, driver, wheelR, steeringWheel: sw };
  if (custom) dressCustomKart(root, custom, kartIndex, anim);
  if (driver.userData.panda) {
    // Bao: a stalk of bamboo standing on the nose, with a couple of leaves
    const bamboo = new THREE.Group();
    const stalk = mat(0x6cbf3c, { rough: 0.5 });
    const node = mat(0x4a9a2a, { rough: 0.5 });
    for (let i = 0; i < 3; i++) {
      bamboo.add(mesh(G.cyl(0.045, 0.05, 0.2, 8), stalk, 0, 0.1 + i * 0.21, 0));
      bamboo.add(mesh(G.cyl(0.058, 0.058, 0.025, 8), node, 0, 0.205 + i * 0.21, 0));
    }
    for (const sd of [-1, 1]) {
      const leaf = mesh(G.sphere(0.12, 8, 6), mat(0x3f9a32, { rough: 0.6 }), sd * 0.1, 0.5 + (sd > 0 ? 0.12 : 0), 0);
      leaf.scale.set(1, 0.18, 0.4);
      leaf.rotation.z = sd * 0.5;
      bamboo.add(leaf);
    }
    bamboo.position.set(...[[0.38, 0.72, 1.05], [0.36, 0.58, 1.2], [0.42, 0.85, 0.95]][kartIndex]); // off to the side, clear of his face
    bamboo.rotation.z = -0.2;
    body.add(bamboo);
  }
  if (driver.userData.monkey) {
    // Momo: a banana on the nose, standing up like a hood ornament
    const banana = buildBanana();
    banana.scale.setScalar(0.6);
    banana.position.set(...[[0, 0.92, 1.0], [0, 0.72, 1.25], [0, 1.0, 0.9]][kartIndex]);
    body.add(banana);
  }
  if (driver.userData.cat) {
    // Dorito: a tortilla chip on the nose
    // Standing up on the nose like a hood ornament, point up, cheese dust facing forward
    const chip = mesh(G.cyl(0.3, 0.3, 0.06, 3), mat(0xf5b02e, { rough: 0.7 }), ...[[0, 1.02, 1.05], [0, 0.82, 1.3], [0, 1.1, 0.95]][kartIndex]);
    chip.rotation.set(Math.PI / 2, 0, 0);
    chip.rotation.z = Math.PI / 2; // a corner at the top
    body.add(chip);
    for (const [x, z] of [[0.06, 0.05], [-0.08, -0.03], [0.02, -0.1], [-0.02, 0.12]]) chip.add(mesh(G.sphere(0.03, 6, 4), mat(0xd9481a), x, 0.035, z));
  }
  if (driver.userData.tail) {
    // Dorito's and Momo's tails swish (faster at speed)
    const tail = driver.userData.tail;
    let t = 0;
    root.userData.tick = (dt, time, speed = 0) => {
      t += dt * (2 + Math.min(speed, 40) * 0.08);
      tail.rotation.z = Math.sin(t) * 0.35;
    };
  }
  return root;
}

// ---------------------------------------------------------------- Mazda CX-9 (2019, Jet Black Mica)

// Side profile (pairs of [z, y]) extruded across the car's width.
function profileGeo(pts, arch, width, bevel = 0.05) {
  const sh = new THREE.Shape();
  sh.moveTo(pts[0][0], pts[0][1]);
  if (arch) sh.absarc(arch[0], arch[1], arch[2], arch[3], arch[4], arch[5]);
  for (const [z, y] of pts.slice(1)) sh.lineTo(z, y);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 14 });
  geo.rotateY(-Math.PI / 2);
  geo.translate(width / 2 - bevel, 0, 0);
  return geo;
}

// Flat polygon (pairs of [z, y]) standing in the car's side plane (x = 0).
function sideGeo(pts) {
  const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const geo = new THREE.ShapeGeometry(sh);
  geo.rotateY(-Math.PI / 2);
  return geo;
}

// Thin box running from point a to point b (both [z, y]) at x.
function strut(a, b, x, w, t, material) {
  const dz = b[0] - a[0], dy = b[1] - a[1];
  const m = mesh(G.box(w, Math.hypot(dz, dy), t), material, x, (a[1] + b[1]) / 2, (a[0] + b[0]) / 2);
  m.rotation.x = Math.atan2(dz, dy);
  return m;
}

// Shared by the full-size cars (CX-9 and pickup).
let cx9Mats = null;
function cx9Materials() {
  if (!cx9Mats) {
    const shared = (m) => ((m.userData.shared = true), m);
    cx9Mats = {
      paint: shared(new THREE.MeshPhysicalMaterial({ color: 0x0b0c10, metalness: 0.35, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.06 })),
      glass: shared(new THREE.MeshStandardMaterial({ color: 0x1a222c, metalness: 0.4, roughness: 0.05, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false })),
      trim: mat(0x151518, { rough: 0.8 }),
      chrome: mat(0xe4e8ee, { rough: 0.12, metal: 1 }),
      cabin: mat(0x2a2522, { rough: 0.85 }),
      leather: mat(0x3b2a22, { rough: 0.6 }),
      head: mat(0xf4f8ff, { emissive: 0xdfeaff, ei: 0.9 }),
      tail: mat(0xd01a22, { emissive: 0x9a0a10, ei: 0.8, rough: 0.3 }),
      tire: mat(0x1b1b1f, { rough: 0.9 }),
      rim: mat(0xc9ccd2, { rough: 0.25, metal: 0.9 }),
      rimDark: mat(0x3a3c42, { rough: 0.5, metal: 0.6 }),
    };
  }
  return cx9Mats;
}

// A hinged door: pivot sits on the front edge, the door extends back toward -z.
// win: window outline in door space ([z, y], z <= 0).
function cx9Door(M, side, zFront, len, win, mirror) {
  const pivot = new THREE.Group();
  pivot.position.set(side * 0.96, 0, zFront);
  // Outer skin painted, inside face trimmed in cabin leather.
  const faces = side > 0 ? [M.paint, M.cabin, M.paint, M.trim, M.paint, M.paint] : [M.cabin, M.paint, M.paint, M.trim, M.paint, M.paint];
  const panel = mesh(G.box(0.07, 0.8, len - 0.02), faces, -side * 0.035, 0.84, -len / 2);
  pivot.add(panel);
  pivot.add(mesh(G.box(0.02, 0.1, len - 0.04), M.trim, side * 0.005, 0.5, -len / 2)); // lower cladding
  pivot.add(mesh(G.box(0.02, 0.025, len - 0.04), M.chrome, side * 0.004, 1.235, -len / 2)); // belt chrome
  const glass = new THREE.Mesh(sideGeo(win), M.glass);
  glass.position.x = -side * 0.04;
  pivot.add(glass);
  // Window frame (top + rear edges) in gloss black
  const top = win.filter(([, y]) => y > 1.5);
  if (top.length >= 2) pivot.add(strut(top[0], top[1], -side * 0.04, 0.05, 0.04, M.trim));
  pivot.add(mesh(G.box(0.1, 0.04, 0.03), M.chrome, side * 0.02, 1.05, -len + 0.28)); // handle
  if (mirror) {
    const m = new THREE.Group();
    m.position.set(side * 0.1, 1.33, -0.12);
    m.add(mesh(G.box(0.2, 0.04, 0.08), M.trim, -side * 0.06, -0.05, 0));
    const cap = mesh(G.box(0.2, 0.15, 0.1), M.paint, side * 0.06, 0.03, 0);
    m.add(cap);
    m.add(mesh(G.box(0.16, 0.11, 0.01), M.chrome, side * 0.06, 0.03, -0.055));
    pivot.add(m);
  }
  return pivot;
}

function cx9Wheel(M, side, r) {
  const wheel = new THREE.Group();
  const t = mesh(G.cyl(r, r, 0.3, 20), M.tire);
  t.rotation.z = Math.PI / 2;
  wheel.add(t);
  const barrel = mesh(G.cyl(r * 0.7, r * 0.7, 0.31, 18), M.rimDark);
  barrel.rotation.z = Math.PI / 2;
  wheel.add(barrel);
  // 20" machined ten-spoke alloys
  for (let i = 0; i < 10; i++) {
    const sp = mesh(G.box(0.03, r * 0.66, 0.05), M.rim, side * 0.15, 0, 0);
    sp.rotation.x = (i / 10) * Math.PI * 2;
    sp.geometry.translate(0, r * 0.33, 0);
    wheel.add(sp);
  }
  const lip = mesh(G.torus(r * 0.68, 0.025, 6, 22), M.rim, side * 0.15, 0, 0);
  lip.rotation.y = Math.PI / 2;
  wheel.add(lip);
  const cap = mesh(G.cyl(0.06, 0.06, 0.02, 12), M.chrome, side * 0.16, 0, 0);
  cap.rotation.z = Math.PI / 2;
  wheel.add(cap);
  return wheel;
}

// A girl riding shotgun in the CX-9: long brown hair, a pink top and a hair bow.
function buildPassenger() {
  const g = new THREE.Group();
  const skin = mat(0xe8b48c);
  const top = mat(0xf06aa8);
  const hairM = mat(0x4a2a18, { rough: 0.7 });
  const torso = mesh(G.capsule(0.28, 0.3), top, 0, 0.82, -0.2);
  torso.scale.set(1.05, 1, 0.9);
  g.add(torso);
  for (const s of [-1, 1]) {
    const arm = mesh(G.capsule(0.085, 0.42), top, s * 0.34, 0.86, 0.04);
    arm.rotation.x = -0.8;
    arm.rotation.z = s * 0.2;
    g.add(arm);
    g.add(mesh(G.sphere(0.095, 10, 8), skin, s * 0.26, 0.7, 0.3));
  }
  const head = new THREE.Group();
  head.position.set(0, 1.42, -0.16);
  g.add(head);
  head.add(mesh(G.sphere(0.4, 24, 18), skin));
  eyes(head);
  head.add(mesh(G.sphere(0.06, 10, 8), mat(0xd9957a), 0, -0.05, 0.4)); // nose
  const smile = mesh(G.torus(0.09, 0.012, 6, 14, Math.PI), mat(0xc2454f), 0, -0.14, 0.36);
  smile.rotation.z = Math.PI;
  head.add(smile);
  for (const s of [-1, 1]) head.add(mesh(G.sphere(0.07, 8, 6), mat(0xff9fb0), s * 0.24, -0.08, 0.3)); // cheeks
  // Hair: a cap over the top and back, long locks down the sides, a fringe and a bow
  const cap = mesh(G.sphere(0.43, 18, 10), hairM, 0, 0.05, -0.06);
  cap.geometry = new THREE.SphereGeometry(0.43, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
  cap.rotation.x = -0.25;
  head.add(cap);
  const back = mesh(G.sphere(0.4), hairM, 0, -0.22, -0.16);
  back.scale.set(1, 1.15, 0.8);
  head.add(back);
  for (const s of [-1, 1]) {
    const lock = mesh(G.capsule(0.09, 0.4), hairM, s * 0.36, -0.22, -0.02);
    lock.rotation.z = s * 0.06;
    head.add(lock);
  }
  const fringe = mesh(G.sphere(0.3), hairM, 0, 0.27, 0.22);
  fringe.scale.set(1.2, 0.35, 0.7);
  head.add(fringe);
  const bow = mat(0xffd23f);
  for (const s of [-1, 1]) {
    const w = mesh(G.cone(0.1, 0.2, 10), bow, s * 0.14, 0.4, 0.05);
    w.rotation.z = -s * Math.PI / 2;
    head.add(w);
  }
  head.add(mesh(G.sphere(0.055, 8, 6), bow, 0, 0.4, 0.05));
  g.userData = { head };
  return g;
}

export const CX9_SCALE = 0.8;
const CX9_WHEELS = [[0.85, 1.55], [-0.85, 1.55], [0.85, -1.5], [-0.85, -1.5]];

function buildCX9(charIndex) {
  const M = cx9Materials();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const car = new THREE.Group(); // modelled at full size, scaled to sit among the karts
  car.scale.setScalar(CX9_SCALE);
  body.add(car);
  const W = 1.92;
  const wheelR = 0.44;
  const belt = 1.25;
  const roofY = 1.97;

  // Profiles are drawn 0.05 inside the final outline: the bevel grows them back out.
  // Front clip: bumper, long hood and front fenders, around the front wheel arch.
  car.add(mesh(profileGeo(
    [[1.05, 0.46], [2.13, 0.46], [2.2, 0.4], [2.27, 0.52], [2.28, 0.8], [2.24, 0.98], [2.1, 1.1], [1.05, 1.2]],
    [1.55, 0.44, 0.58, Math.PI, 0, true], W), M.paint));
  // Rear quarter: rear fenders, liftgate base and bumper, around the rear arch.
  car.add(mesh(profileGeo(
    [[-0.91, 0.46], [-2.1, 0.46], [-2.18, 0.42], [-2.25, 0.55], [-2.26, 0.95], [-2.2, 1.2], [-0.91, 1.2]],
    [-1.5, 0.44, 0.58, 0, Math.PI, false], W), M.paint));
  // Wheel-well liners so the arches don't look through the car
  for (const z of [1.55, -1.5]) car.add(mesh(G.box(1.4, 0.56, 1.1), M.trim, 0, 0.74, z));
  // Black arch cladding
  for (const s of [-1, 1]) {
    for (const z of [1.55, -1.5]) {
      const arch = mesh(G.torus(0.55, 0.05, 6, 20, Math.PI), M.trim, s * 0.96, 0.44, z);
      arch.rotation.y = Math.PI / 2;
      car.add(arch);
    }
  }

  // Floor, sills and cabin (seen with the doors open)
  car.add(mesh(G.box(W - 0.04, 0.14, 1.94), M.paint, 0, 0.44, 0.05));
  for (const s of [-1, 1]) car.add(mesh(G.box(0.05, 0.08, 1.92), M.trim, s * 0.94, 0.42, 0.05));
  car.add(mesh(G.box(W - 0.14, 0.05, 1.9), M.cabin, 0, 0.52, 0.05));
  car.add(mesh(G.box(W - 0.14, 0.3, 0.3), M.cabin, 0, 1.08, 0.9)); // dashboard
  car.add(mesh(G.box(0.26, 0.3, 0.55), M.cabin, 0, 0.7, 0.5)); // centre console
  const seat = (x, z, w) => {
    car.add(mesh(G.box(w, 0.16, 0.52), M.leather, x, 0.64, z));
    const back = mesh(G.box(w, 0.72, 0.14), M.leather, x, 1.02, z - 0.3);
    back.rotation.x = -0.12;
    car.add(back);
  };
  seat(0.45, 0.05, 0.56);
  seat(-0.45, 0.05, 0.56);
  seat(0, -0.62, 1.6);

  // Greenhouse: raked windshield, roof, rear glass, pillars
  const wsA = [1.05, belt], wsB = [0.32, roofY];
  car.add(strut(wsA, wsB, 0, W - 0.2, 0.03, M.glass));
  const roofBack = [-1.72, roofY], rgA = [-2.2, belt + 0.02];
  car.add(strut(rgA, roofBack, 0, W - 0.28, 0.03, M.glass));
  car.add(mesh(G.box(W - 0.16, 0.08, wsB[0] - roofBack[0] + 0.06), M.paint, 0, roofY + 0.03, (wsB[0] + roofBack[0]) / 2));
  for (const s of [-1, 1]) {
    const x = s * 0.9;
    car.add(strut(wsA, wsB, x, 0.08, 0.1, M.paint)); // A-pillar
    car.add(mesh(G.box(0.07, roofY - belt, 0.1), M.trim, x, (roofY + belt) / 2, 0.08)); // B-pillar
    car.add(mesh(G.box(0.07, roofY - belt, 0.08), M.trim, x, (roofY + belt) / 2, -0.93)); // C-pillar
    car.add(strut(rgA, roofBack, x, 0.1, 0.2, M.paint)); // D-pillar
    // Fixed rear quarter glass
    const q = new THREE.Mesh(sideGeo([[-0.97, belt + 0.01], [-2.12, belt + 0.01], [-1.7, roofY - 0.03], [-0.97, roofY - 0.03]]), M.glass);
    q.position.x = s * 0.92;
    car.add(q);
    car.add(mesh(G.box(0.02, 0.025, 1.2), M.chrome, s * 0.975, belt - 0.01, -1.55)); // belt chrome
    car.add(strut([-1.7, roofY - 0.02], [0.34, roofY - 0.02], s * 0.93, 0.03, 0.03, M.chrome)); // roofline chrome
    // Roof rails
    car.add(mesh(G.box(0.05, 0.05, 1.8), M.rimDark, s * 0.68, roofY + 0.13, -0.7));
    for (const z of [0.1, -1.5]) car.add(mesh(G.box(0.07, 0.08, 0.14), M.trim, s * 0.68, roofY + 0.1, z));
  }

  // Doors (front hinged at the A-pillar, rear at the B-pillar)
  const doors = [];
  for (const s of [-1, 1]) {
    const front = cx9Door(M, s, 1.03, 0.96, [[-0.03, belt + 0.02], [-0.95, belt + 0.02], [-0.95, roofY - 0.04], [-0.7, roofY - 0.04]], true);
    const rear = cx9Door(M, s, 0.08, 0.99, [[-0.06, belt + 0.02], [-0.96, belt + 0.02], [-0.96, roofY - 0.04], [-0.06, roofY - 0.04]], false);
    car.add(front, rear);
    doors.push({ pivot: front, side: s, max: 1.15 }, { pivot: rear, side: s, max: 1.05 });
  }

  // Front: shield grille, chrome signature wing, slim headlights, emblem
  const fz = 2.33;
  const gs = new THREE.Shape([[-0.42, 0.95], [0.42, 0.95], [0.52, 0.64], [0.4, 0.5], [-0.4, 0.5], [-0.52, 0.64]].map(([x, y]) => new THREE.Vector2(x, y)));
  car.add(mesh(new THREE.ExtrudeGeometry(gs, { depth: 0.06, bevelEnabled: false }), M.trim, 0, 0, fz - 0.03));
  for (let i = 0; i < 4; i++) car.add(mesh(G.box(0.74 - i * 0.04, 0.02, 0.02), M.rimDark, 0, 0.6 + i * 0.08, fz + 0.035));
  const emblem = mesh(G.torus(0.075, 0.016, 6, 18), M.chrome, 0, 0.78, fz + 0.045);
  car.add(emblem);
  car.add(mesh(G.box(0.02, 0.08, 0.02), M.chrome, 0, 0.78, fz + 0.045));
  car.add(mesh(G.box(0.82, 0.035, 0.03), M.chrome, 0, 0.51, fz));
  for (const s of [-1, 1]) {
    const wing = mesh(G.box(0.34, 0.035, 0.03), M.chrome, s * 0.56, 0.66, fz - 0.01);
    wing.rotation.z = s * 0.8;
    car.add(wing);
    const hl = mesh(G.box(0.42, 0.08, 0.05), M.head, s * 0.64, 0.88, fz - 0.04);
    hl.rotation.y = s * 0.3;
    hl.rotation.z = -s * 0.1;
    car.add(hl);
    car.add(mesh(G.box(0.14, 0.05, 0.03), M.trim, s * 0.7, 0.47, fz - 0.02)); // fog light bezel
    // Rear: slim LED taillights joined by a chrome bar
    const tl = mesh(G.box(0.46, 0.09, 0.05), M.tail, s * 0.66, 1.1, -2.28);
    tl.rotation.y = -s * 0.25;
    car.add(tl);
  }
  car.add(mesh(G.box(0.86, 0.035, 0.03), M.chrome, 0, 1.08, -2.3));
  car.add(mesh(G.box(0.36, 0.18, 0.02), mat(0xffffff), 0, 0.82, -2.31)); // plate
  car.add(mesh(G.box(1.6, 0.14, 0.05), M.trim, 0, 0.5, -2.28));
  const exhausts = [];
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff9a2a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const s of [-1, 1]) {
    const tip = mesh(G.cyl(0.065, 0.065, 0.12, 12), M.chrome, s * 0.62, 0.46, -2.3);
    tip.rotation.x = Math.PI / 2;
    car.add(tip);
    const flame = new THREE.Mesh(G.cone(0.16, 0.9, 10), flameMat.clone());
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(s * 0.62, 0.46, -2.8);
    flame.visible = false;
    car.add(flame);
    exhausts.push(flame);
  }

  // Wheels
  const wheels = [];
  const steerPivots = [];
  CX9_WHEELS.forEach(([x, z], i) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, wheelR, z);
    const wheel = cx9Wheel(M, Math.sign(x), wheelR);
    pivot.add(wheel);
    car.add(pivot);
    wheels.push(wheel);
    if (i < 2) steerPivots.push(pivot);
  });

  // Driver on the left (+x), behind the wheel
  const sw = mesh(G.torus(0.19, 0.03, 6, 16), M.trim, 0.45, 1.16, 0.72);
  sw.rotation.x = -0.9;
  car.add(sw);
  const driver = buildDriver(charIndex);
  driver.position.set(0.45, -0.02, 0.36);
  car.add(driver);
  // Her friend next to him in the front seat
  const passenger = buildPassenger();
  passenger.position.set(-0.45, -0.02, 0.36);
  car.add(passenger);

  root.userData = { body, wheels, steerPivots, exhausts, driver, passenger, wheelR: wheelR * CX9_SCALE, steeringWheel: sw, doors, showroomScale: 0.8,
    wheelPos: CX9_WHEELS.map(([x, z]) => [x * CX9_SCALE, z * CX9_SCALE]) };
  return root;
}

// ---------------------------------------------------------------- pickup truck (Lucas)

function pickupWheel(M, side, r, hubMat) {
  const wheel = new THREE.Group();
  const t = mesh(G.cyl(r, r, 0.38, 20), M.tire);
  t.rotation.z = Math.PI / 2;
  wheel.add(t);
  // Chunky off-road tread
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const lug = mesh(G.box(0.4, 0.07, 0.12), M.tire, 0, Math.cos(a) * r, Math.sin(a) * r);
    lug.rotation.x = -a;
    wheel.add(lug);
  }
  // Painted steel wheel with chrome hub and lug nuts
  const rim = mesh(G.cyl(r * 0.6, r * 0.6, 0.4, 16), hubMat);
  rim.rotation.z = Math.PI / 2;
  wheel.add(rim);
  const hub = mesh(G.cyl(r * 0.22, r * 0.22, 0.44, 12), M.chrome);
  hub.rotation.z = Math.PI / 2;
  wheel.add(hub);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const nut = mesh(G.cyl(0.03, 0.03, 0.44, 6), M.chrome, 0, Math.cos(a) * r * 0.36, Math.sin(a) * r * 0.36);
    nut.rotation.z = Math.PI / 2;
    wheel.add(nut);
  }
  return wheel;
}

const PICKUP_SCALE = 0.8;
const PICKUP_WHEELS = [[0.88, 1.5], [-0.88, 1.5], [0.88, -1.55], [-0.88, -1.55]];

// A lifted two-tone pickup with a T-rex at the wheel, head out of the sunroof and
// tail out of the back window.
function buildPickup(charIndex) {
  const c = CHARACTERS[charIndex];
  const M = cx9Materials();
  const paint = mat(c.color, { rough: 0.3, metal: 0.25 });
  const cream = mat(c.accent, { rough: 0.4 });
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const car = new THREE.Group(); // modelled at full size, scaled to sit among the karts
  car.scale.setScalar(PICKUP_SCALE);
  body.add(car);
  const W = 1.95;
  const wheelR = 0.5;
  const sill = 1.48; // top of the doors, hood and bed rails
  const roofY = 2.05;

  // Front clip: hood, grille surround and front fenders, around the front arch.
  car.add(mesh(profileGeo(
    [[0.8, 0.55], [2.16, 0.55], [2.3, 0.62], [2.34, 0.9], [2.32, 1.32], [2.2, 1.43], [0.8, sill]],
    [1.5, 0.5, 0.64, Math.PI, 0, true], W), paint));
  // Cab below the windows
  car.add(mesh(profileGeo([[-0.55, 0.55], [0.8, 0.55], [0.8, sill], [-0.55, sill]], null, W), paint));
  // Bed: two side walls (each around the rear arch), floor, wheel tubs and tailgate
  const bedSide = [[-0.62, 0.62], [-2.2, 0.62], [-2.4, 0.66], [-2.4, sill], [-0.62, sill]];
  for (const s of [-1, 1]) {
    const wall = mesh(profileGeo(bedSide, [-1.55, 0.5, 0.64, 0, Math.PI, false], 0.14, 0.03), paint);
    wall.position.x = s * (W / 2 - 0.07);
    car.add(wall);
    car.add(mesh(G.box(0.18, 0.05, 1.82), M.trim, s * (W / 2 - 0.07), sill + 0.02, -1.51)); // rail cap
    car.add(mesh(G.box(0.36, 0.3, 1.2), M.trim, s * 0.62, 1.08, -1.55)); // wheel tub
  }
  car.add(mesh(G.box(W - 0.2, 0.08, 1.8), M.trim, 0, 0.92, -1.5));
  car.add(mesh(G.box(W - 0.04, 0.86, 0.1), paint, 0, 1.07, -2.37));
  car.add(mesh(G.box(1.1, 0.12, 0.02), cream, 0, 1.2, -2.43)); // tailgate stripe
  // Frame rails and wheel-well liners
  car.add(mesh(G.box(1.2, 0.2, 4.2), M.trim, 0, 0.5, -0.05));
  car.add(mesh(G.box(1.5, 0.56, 1.14), M.trim, 0, 0.8, 1.5));
  // Arch trim and the cream two-tone stripe along each side
  for (const s of [-1, 1]) {
    for (const z of [1.5, -1.55]) {
      const arch = mesh(G.torus(0.64, 0.06, 6, 20, Math.PI), M.trim, s * (W / 2 + 0.005), 0.5, z);
      arch.rotation.y = Math.PI / 2;
      car.add(arch);
    }
    car.add(mesh(G.box(0.02, 0.14, 4.6), cream, s * (W / 2 + 0.02), 1.28, -0.05));
  }

  // Cab interior: bench seat, dashboard, steering wheel
  car.add(mesh(G.box(W - 0.14, 0.05, 1.3), M.cabin, 0, 0.6, 0.12));
  car.add(mesh(G.box(W - 0.2, 0.2, 0.55), M.leather, 0, 0.84, -0.12));
  const back = mesh(G.box(W - 0.2, 0.7, 0.14), M.leather, 0, 1.2, -0.42);
  back.rotation.x = -0.12;
  car.add(back);
  car.add(mesh(G.box(W - 0.14, 0.26, 0.3), M.cabin, 0, 1.38, 0.66));

  // Greenhouse: windshield, pillars, side glass, roof with a sunroof, open back window
  const wsA = [0.8, sill], wsB = [0.35, roofY];
  car.add(strut(wsA, wsB, 0, W - 0.2, 0.03, M.glass));
  for (const s of [-1, 1]) {
    const x = s * 0.92;
    car.add(strut(wsA, wsB, x, 0.1, 0.1, paint)); // A-pillar
    car.add(mesh(G.box(0.12, roofY - sill, 0.1), paint, x, (roofY + sill) / 2, -0.5)); // B-pillar
    const glass = new THREE.Mesh(sideGeo([[0.74, sill + 0.02], [-0.44, sill + 0.02], [-0.44, roofY - 0.04], [0.34, roofY - 0.04]]), M.glass);
    glass.position.x = s * 0.94;
    car.add(glass);
    car.add(mesh(G.box(0.06, 0.02, 1.2), M.chrome, s * (W / 2 + 0.01), sill - 0.02, 0.12)); // belt chrome
    car.add(mesh(G.box(0.1, 0.04, 0.03), M.chrome, s * (W / 2 + 0.02), 1.3, -0.3)); // door handle
    car.add(mesh(G.box(0.01, 0.9, 0.02), M.trim, s * (W / 2 + 0.005), 1.02, -0.52)); // door seam
    // Mirror on a stalk
    car.add(mesh(G.box(0.2, 0.04, 0.05), M.trim, s * 1.02, sill + 0.08, 0.7));
    car.add(mesh(G.box(0.08, 0.22, 0.14), M.chrome, s * 1.14, sill + 0.14, 0.7));
  }
  // Roof, leaving a sunroof hole over the driver (+x)
  const roof = (x0, x1, z0, z1) => car.add(mesh(G.box(x1 - x0, 0.08, z1 - z0), paint, (x0 + x1) / 2, roofY + 0.03, (z0 + z1) / 2));
  roof(-0.97, 0.06, -0.56, 0.36);
  roof(0.84, 0.97, -0.56, 0.36);
  roof(0.06, 0.84, -0.56, -0.34);
  for (const x of [0.06, 0.84]) car.add(mesh(G.box(0.04, 0.1, 0.7), M.trim, x, roofY + 0.05, 0.01)); // sunroof edge
  for (const x of [-0.5, 0, 0.5]) car.add(mesh(G.box(0.12, 0.05, 0.06), mat(0xffa21f, { emissive: 0xff8a00, ei: 0.7 }), x - 0.3, roofY + 0.09, 0.32)); // cab lights
  // Back wall of the cab above the sill: a frame around an open window
  for (const s of [-1, 1]) car.add(mesh(G.box(0.18, roofY - sill, 0.08), paint, s * 0.88, (roofY + sill) / 2, -0.52));
  car.add(mesh(G.box(W - 0.1, 0.08, 0.08), paint, 0, roofY - 0.04, -0.52));

  // Front: chrome grille, round headlights, big bumper
  const fz = 2.36;
  car.add(mesh(G.box(1.36, 0.5, 0.06), M.chrome, 0, 1.0, fz));
  car.add(mesh(G.box(1.2, 0.36, 0.06), M.trim, 0, 1.0, fz + 0.015));
  for (let i = 0; i < 3; i++) car.add(mesh(G.box(1.2, 0.03, 0.03), M.chrome, 0, 0.9 + i * 0.1, fz + 0.05));
  car.add(mesh(G.box(0.36, 0.08, 0.03), cream, 0, 1.0, fz + 0.07)); // badge
  for (const s of [-1, 1]) {
    const hl = mesh(G.cyl(0.14, 0.14, 0.06, 16), M.head, s * 0.78, 1.02, fz - 0.01);
    hl.rotation.x = Math.PI / 2;
    car.add(hl);
    const bezel = mesh(G.torus(0.14, 0.025, 6, 16), M.chrome, s * 0.78, 1.02, fz + 0.02);
    car.add(bezel);
  }
  car.add(mesh(G.box(W + 0.06, 0.18, 0.2), M.chrome, 0, 0.62, fz + 0.06));
  // Rear: tall taillights, step bumper, plate
  for (const s of [-1, 1]) car.add(mesh(G.box(0.1, 0.36, 0.05), M.tail, s * 0.88, 1.22, -2.44));
  car.add(mesh(G.box(W + 0.02, 0.16, 0.2), M.chrome, 0, 0.62, -2.5));
  car.add(mesh(G.box(0.36, 0.18, 0.02), mat(0xffffff), 0, 0.84, -2.43));
  const exhausts = [];
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff9a2a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const s of [-1, 1]) {
    const tip = mesh(G.cyl(0.07, 0.07, 0.16, 12), M.chrome, s * 0.55, 0.46, -2.5);
    tip.rotation.x = Math.PI / 2;
    car.add(tip);
    const flame = new THREE.Mesh(G.cone(0.16, 0.9, 10), flameMat.clone());
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(s * 0.55, 0.46, -3.0);
    flame.visible = false;
    car.add(flame);
    exhausts.push(flame);
  }

  // Wheels
  const wheels = [];
  const steerPivots = [];
  PICKUP_WHEELS.forEach(([x, z], i) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, wheelR, z);
    const wheel = pickupWheel(M, Math.sign(x), wheelR, cream);
    pivot.add(wheel);
    car.add(pivot);
    wheels.push(wheel);
    if (i < 2) steerPivots.push(pivot);
  });

  // Driver on the left (+x), behind the wheel
  const sw = mesh(G.torus(0.2, 0.03, 6, 16), M.trim, 0.45, 1.5, 0.55);
  sw.rotation.x = -0.9;
  car.add(sw);
  const driver = buildDriver(charIndex);
  driver.position.set(0.45, 0.58, -0.05);
  car.add(driver);

  root.userData = { body, wheels, steerPivots, exhausts, driver, wheelR: wheelR * PICKUP_SCALE, steeringWheel: sw, showroomScale: 0.8, portraitScale: 0.8,
    wheelPos: PICKUP_WHEELS.map(([x, z]) => [x * PICKUP_SCALE, z * PICKUP_SCALE]) };
  return root;
}

// ---------------------------------------------------------------- Spider-Mobile (Spider-Man)

const SPIDER_WHEELS = [[0.84, 1.05], [-0.84, 1.05], [0.88, -0.98], [-0.88, -0.98]];

// A kart-sized open-top roadster in red and blue: web hood with a spider badge, a
// spider-signal headlight, web shooters on the nose and a rear wing.
function buildSpiderMobile(charIndex) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const red = mat(0xd0202a, { rough: 0.3, metal: 0.25 });
  const blue = mat(0x1e4fd8, { rough: 0.3, metal: 0.25 });
  const black = mat(0x140a0a, { rough: 0.5 });
  const dark = mat(0x23232b, { rough: 0.7 });
  const chrome = mat(0xdfe3ea, { rough: 0.15, metal: 1 });
  const tire = mat(0x1b1b1f, { rough: 0.9 });

  // Wheels: blue rims, red hubs, rears a bit bigger
  const wheels = [];
  const steerPivots = [];
  SPIDER_WHEELS.forEach(([x, z], i) => {
    const r = i >= 2 ? 0.44 : 0.4;
    const pivot = new THREE.Group();
    pivot.position.set(x, r, z);
    const wheel = new THREE.Group();
    const t = mesh(G.cyl(r, r, 0.34, 18), tire);
    t.rotation.z = Math.PI / 2;
    wheel.add(t);
    const rim = mesh(G.cyl(r * 0.62, r * 0.62, 0.36, 12), blue);
    rim.rotation.z = Math.PI / 2;
    wheel.add(rim);
    const hub = mesh(G.cyl(r * 0.25, r * 0.25, 0.38, 10), red);
    hub.rotation.z = Math.PI / 2;
    wheel.add(hub);
    pivot.add(wheel);
    body.add(pivot);
    wheels.push(wheel);
    if (i < 2) steerPivots.push(pivot);
  });

  // Chassis and floor
  body.add(mesh(G.box(1.3, 0.16, 2.9), dark, 0, 0.3, 0));
  // Nose: red with a web-covered hood and the spider badge
  const nose = mesh(G.box(1.25, 0.34, 1.25), red, 0, 0.55, 1.15);
  body.add(nose);
  const hood = new THREE.Mesh(new THREE.PlaneGeometry(1.22, 1.22), spiderMaterial("web"));
  hood.rotation.x = -Math.PI / 2;
  hood.position.set(0, 0.725, 1.15);
  body.add(hood);
  const badge = spiderEmblem(0.5, black);
  badge.rotation.x = -Math.PI / 2;
  badge.position.set(0, 0.735, 1.18);
  body.add(badge);
  body.add(mesh(G.box(1.28, 0.1, 0.1), blue, 0, 0.42, 1.78)); // front lip
  // Spider-signal: a big round lamp with a spider across it
  const lamp = mesh(G.cyl(0.19, 0.19, 0.08, 20), mat(0xfff6c0, { emissive: 0xfff2a0, ei: 0.9 }), 0, 0.55, 1.79);
  lamp.rotation.x = Math.PI / 2;
  body.add(lamp);
  const lampRing = mesh(G.torus(0.19, 0.03, 6, 20), chrome, 0, 0.55, 1.82);
  body.add(lampRing);
  const signal = spiderEmblem(0.26, black);
  signal.position.set(0, 0.55, 1.84);
  body.add(signal);
  // Web shooters on the nose corners
  for (const sd of [-1, 1]) {
    const gun = mesh(G.cyl(0.07, 0.09, 0.45, 10), chrome, sd * 0.5, 0.78, 1.45);
    gun.rotation.x = Math.PI / 2;
    body.add(gun);
    body.add(mesh(G.cyl(0.045, 0.045, 0.02, 10), black, sd * 0.5, 0.78, 1.68).rotateX(Math.PI / 2));
    body.add(mesh(G.box(0.12, 0.1, 0.2), blue, sd * 0.5, 0.72, 1.3));
  }
  // Cockpit sides (open top, so Spider-Man stays in view), blue side pods
  for (const sd of [-1, 1]) {
    body.add(mesh(G.box(0.16, 0.42, 1.5), red, sd * 0.6, 0.55, -0.05));
    body.add(mesh(G.box(0.2, 0.26, 1.7), blue, sd * 0.76, 0.46, 0.05));
    // Blue fenders over each wheel
    for (const [x, z] of SPIDER_WHEELS.filter(([wx]) => Math.sign(wx) === sd)) {
      const f = mesh(G.box(0.4, 0.08, 0.95), blue, x, z > 0 ? 0.88 : 0.96, z);
      body.add(f);
    }
  }
  // Seat and engine deck with twin pipes
  body.add(mesh(G.box(0.85, 0.7, 0.18), black, 0, 0.8, -0.62));
  body.add(mesh(G.box(1.2, 0.36, 0.75), red, 0, 0.55, -1.12));
  body.add(mesh(G.box(0.7, 0.14, 0.5), chrome, 0, 0.8, -1.1)); // engine
  // Rear wing on red struts, with a spider on top
  for (const sd of [-1, 1]) body.add(mesh(G.box(0.08, 0.5, 0.2), red, sd * 0.45, 0.95, -1.35));
  body.add(mesh(G.box(1.7, 0.07, 0.45), blue, 0, 1.22, -1.38));
  const wingSpider = spiderEmblem(0.4, black);
  wingSpider.rotation.x = -Math.PI / 2;
  wingSpider.position.set(0, 1.26, -1.38);
  body.add(wingSpider);
  for (const sd of [-1, 1]) body.add(mesh(G.box(0.05, 0.3, 0.5), red, sd * 0.86, 1.18, -1.38)); // wing end plates
  const exhausts = [];
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff9a2a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const sd of [-1, 1]) {
    const pipe = mesh(G.cyl(0.08, 0.1, 0.4, 10), chrome, sd * 0.28, 0.6, -1.55);
    pipe.rotation.x = Math.PI / 2 - 0.2;
    body.add(pipe);
    const flame = new THREE.Mesh(G.cone(0.16, 0.9, 10), flameMat.clone());
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(sd * 0.28, 0.68, -2.08);
    flame.visible = false;
    body.add(flame);
    exhausts.push(flame);
  }
  // Steering wheel and driver
  const sw = mesh(G.torus(0.2, 0.035, 6, 16), black, 0, 0.95, 0.32);
  sw.rotation.x = -0.9;
  body.add(sw);
  const driver = buildDriver(charIndex);
  driver.position.set(0, 0, -0.05);
  body.add(driver);

  root.userData = { body, wheels, steerPivots, exhausts, driver, wheelR: 0.4, steeringWheel: sw, wheelPos: SPIDER_WHEELS };
  return root;
}

// ---------------------------------------------------------------- Bumblebee (transformer)

// Seconds for a full car-to-robot transformation.
export const TRANSFORM_TIME = 1.1;

// Every part has a car pose and a robot pose; T (0 car, 1 robot) moves them in a staggered
// sequence, each with a little spin on the way so it looks mechanical.
const _q = new THREE.Quaternion(), _spin = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
export function poseTransformer(ud, T) {
  const tr = ud.transform;
  if (tr.T === T) return;
  tr.T = T;
  for (const p of tr.parts) {
    let u = Math.max(0, Math.min(1, (T - p.delay) / (1 - tr.maxDelay)));
    u = u * u * (3 - 2 * u);
    p.obj.position.lerpVectors(p.car.pos, p.bot.pos, u);
    _q.slerpQuaternions(p.car.quat, p.bot.quat, u);
    _spin.setFromAxisAngle(_up, Math.sin(u * Math.PI) * p.twist);
    p.obj.quaternion.multiplyQuaternions(_spin, _q);
    p.obj.scale.lerpVectors(p.car.scale, p.bot.scale, u);
  }
}

// A yellow muscle car with black racing stripes that folds out into a robot about 2.7
// units tall: rear quarters become legs (wheels at the knees), front fenders become arms
// (wheels on the shoulders), the cabin becomes the torso with the hood across the chest,
// the doors fold up into wings and the head pops out last.
function buildTransformer(charIndex) {
  const c = CHARACTERS[charIndex];
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const yellow = mat(c.color, { rough: 0.3, metal: 0.3 });
  const black = mat(0x16161a, { rough: 0.45 });
  const dark = mat(0x2a2d33, { rough: 0.6, metal: 0.4 });
  const chrome = mat(0xdfe3ea, { rough: 0.15, metal: 1 });
  const glass = mat(0x1c2a3a, { rough: 0.1, metal: 0.6 });
  const tire = mat(0x1b1b1f, { rough: 0.9 });
  const parts = [];
  const e = (x, y, z, order) => new THREE.Euler(x, y, z, order);
  // car/bot: [position, euler, scale]
  const part = (car, bot, delay, twist = 0) => {
    const obj = new THREE.Group();
    const pose = ([pos, rot, sc]) => ({ pos: new THREE.Vector3(...pos), quat: new THREE.Quaternion().setFromEuler(rot || e(0, 0, 0)), scale: new THREE.Vector3(...(sc || [1, 1, 1])) });
    const p = { obj, car: pose(car), bot: pose(bot), delay, twist };
    parts.push(p);
    body.add(obj);
    return obj;
  };
  const wheels = [];
  const steerPivots = [];
  const addWheel = (parent, x, y, z, r, steer) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const wheel = new THREE.Group();
    const t = mesh(G.cyl(r, r, 0.3, 18), tire);
    t.rotation.z = Math.PI / 2;
    wheel.add(t);
    const rim = mesh(G.cyl(r * 0.62, r * 0.62, 0.32, 10), mat(0x8d939c, { metal: 0.8, rough: 0.3 }));
    rim.rotation.z = Math.PI / 2;
    wheel.add(rim);
    for (let i = 0; i < 5; i++) {
      const sp = mesh(G.box(0.34, r * 1.1, 0.07), black);
      sp.rotation.x = (i / 5) * Math.PI;
      wheel.add(sp);
    }
    pivot.add(wheel);
    parent.add(pivot);
    wheels.push(wheel);
    if (steer) steerPivots.push(pivot);
  };
  const stripes = (parent, len, y, z = 0) => {
    for (const sd of [-1, 1]) parent.add(mesh(G.box(0.14, 0.02, len), black, sd * 0.13, y, z));
  };
  const up = Math.PI / 2;

  // Rear quarters -> legs (rear wheels end up at the knees, feet fold out)
  for (const sd of [-1, 1]) {
    const leg = part([[sd * 0.62, 0.62, -1.15]], [[sd * 0.36, 0.62, 0], e(up, 0, 0)], 0, sd * 0.4);
    leg.add(mesh(G.box(0.34, 0.55, 1.2), yellow));
    leg.add(mesh(G.box(0.3, 0.12, 0.45), black, 0, 0.05, 0.54)); // foot
    addWheel(leg, sd * 0.24, -0.2, -0.05, 0.42, false);
  }
  // Front fenders -> arms (front wheels on the shoulders, fists at the ends)
  for (const sd of [-1, 1]) {
    const arm = part([[sd * 0.62, 0.62, 1.15]], [[sd * 0.86, 1.62, 0.05], e(up, 0, sd * 0.12)], 0.12, -sd * 0.5);
    arm.add(mesh(G.box(0.3, 0.5, 1.1), yellow));
    arm.add(mesh(G.box(0.26, 0.3, 0.2), dark, 0, 0, 0.6)); // fist / front corner
    addWheel(arm, sd * 0.22, -0.2, 0, 0.4, true);
  }
  // Chassis -> spine
  const floor = part([[0, 0.32, -0.1]], [[0, 1.62, -0.34], e(up, 0, 0), [0.7, 1, 0.5]], 0.1);
  floor.add(mesh(G.box(1.3, 0.14, 3.0), dark));
  // Front bumper, grille and headlights -> pelvis
  const nose = part([[0, 0.6, 1.72]], [[0, 1.14, 0.06], e(0, 0, 0), [0.72, 0.9, 1.2]], 0.18, 0.6);
  nose.add(mesh(G.box(1.54, 0.36, 0.34), yellow));
  nose.add(mesh(G.box(1.0, 0.18, 0.04), black, 0, 0.02, 0.18));
  for (const sd of [-1, 1]) nose.add(mesh(G.box(0.2, 0.1, 0.04), mat(0xfff6c0, { emissive: 0xfff2a0, ei: 0.9 }), sd * 0.6, 0.04, 0.18));
  nose.add(mesh(G.box(1.56, 0.08, 0.36), black, 0, -0.18, 0.02)); // splitter
  // Cabin -> torso (windshield ends up on the chest, roof on the back)
  const cabin = part([[0, 1.02, -0.2]], [[0, 1.78, -0.1], e(-up, 0, 0)], 0.22);
  cabin.add(mesh(G.box(1.28, 0.3, 1.15), glass));
  const roof = mesh(G.box(1.34, 0.08, 0.9), yellow, 0, 0.18, -0.05);
  cabin.add(roof);
  stripes(cabin, 0.9, 0.23, -0.05);
  // Hood -> chest plate, stripes running down it
  const hood = part([[0, 0.86, 1.15]], [[0, 1.82, 0.2], e(up, 0, 0), [0.92, 1, 0.78]], 0.3, -0.4);
  hood.add(mesh(G.box(1.5, 0.1, 1.1), yellow));
  stripes(hood, 1.1, 0.06);
  hood.add(mesh(G.box(0.3, 0.1, 0.4), dark, 0, 0.07, 0.1)); // hood scoop
  // Doors -> back wings
  for (const sd of [-1, 1]) {
    const door = part([[sd * 0.8, 0.75, 0.0]], [[sd * 0.55, 2.25, -0.5], e(-Math.PI / 2 + 0.35, 0, -sd * 0.5, "ZYX"), [1, 1, 0.8]], 0.34, sd * 0.8);
    door.add(mesh(G.box(0.07, 0.42, 1.0), yellow));
    door.add(mesh(G.box(0.02, 0.16, 0.6), glass, sd * 0.04, 0.12, 0.05));
    door.add(mesh(G.box(0.02, 0.04, 0.14), chrome, sd * 0.045, -0.02, -0.3)); // handle
  }
  // Trunk, spoiler, taillights and exhausts -> backpack (flames become jets)
  const exhausts = [];
  const trunk = part([[0, 0.7, -1.64]], [[0, 1.55, -0.55], e(-up, 0, 0), [0.8, 0.8, 0.8]], 0.26, 0.5);
  trunk.add(mesh(G.box(1.5, 0.4, 0.5), yellow));
  trunk.add(mesh(G.box(1.46, 0.06, 0.28), black, 0, 0.32, -0.1)); // spoiler
  for (const sd of [-1, 1]) {
    trunk.add(mesh(G.box(0.06, 0.14, 0.12), black, sd * 0.55, 0.24, -0.1));
    trunk.add(mesh(G.box(0.34, 0.1, 0.04), mat(0xd01a22, { emissive: 0x9a0a10, ei: 0.8 }), sd * 0.52, 0.06, -0.26));
  }
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff9a2a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const sd of [-1, 1]) {
    const pipe = mesh(G.cyl(0.07, 0.07, 0.2, 10), chrome, sd * 0.35, -0.16, -0.3);
    pipe.rotation.x = Math.PI / 2;
    trunk.add(pipe);
    const flame = new THREE.Mesh(G.cone(0.16, 0.9, 10), flameMat.clone());
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(sd * 0.35, -0.16, -0.82);
    flame.visible = false;
    trunk.add(flame);
    exhausts.push(flame);
  }
  // Head: tucked away (and shrunk) inside the car, pops up last
  const headPart = part([[0, 0.62, 0.7], null, [0.01, 0.01, 0.01]], [[0, 2.66, 0.02]], 0.4);
  const head = new THREE.Group();
  headPart.add(head);
  const helmet = mesh(G.box(0.5, 0.46, 0.46), yellow);
  head.add(helmet);
  head.add(mesh(G.box(0.36, 0.26, 0.06), mat(0x3a3f47, { metal: 0.6, rough: 0.35 }), 0, -0.04, 0.23)); // face
  for (const sd of [-1, 1]) {
    head.add(mesh(G.box(0.12, 0.05, 0.03), mat(0x5ad6ff, { emissive: 0x3ac8ff, ei: 1.2 }), sd * 0.09, 0.02, 0.27)); // eyes
    const horn = mesh(G.cone(0.05, 0.3, 6), black, sd * 0.2, 0.33, -0.02); // antennae
    horn.rotation.z = -sd * 0.35;
    head.add(horn);
    head.add(mesh(G.box(0.06, 0.2, 0.24), black, sd * 0.27, 0, 0)); // ear plates
  }
  head.add(mesh(G.box(0.18, 0.06, 0.03), chrome, 0, -0.14, 0.27)); // mouth plate
  // raceview leans the driver and turns its head with the steering; here the head
  // group is the only thing that follows it.
  const driver = new THREE.Group();
  driver.userData.head = head;
  body.add(driver);
  const sw = new THREE.Object3D();
  body.add(sw);

  const transform = { parts, T: -1, maxDelay: 0.4 };
  const ud = { body, wheels, steerPivots, exhausts, driver, wheelR: 0.42, steeringWheel: sw, transform,
    wheelPos: [[0.86, 1.15], [-0.86, 1.15], [0.86, -1.2], [-0.86, -1.2]] };
  root.userData = ud;
  poseTransformer(ud, 0);
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

// ---------------------------------------------------------------- Mario Kart items

// Blue Shell: a spiky blue shell with white wings
export function buildBlueShell() {
  const g = new THREE.Group();
  const shell = mesh(G.sphere(0.72, 18, 12), mat(0x2f6ae8, { rough: 0.35, emissive: 0x0a2a8a, ei: 0.4 }));
  shell.scale.set(1, 0.8, 1);
  g.add(shell);
  const rim = mesh(G.torus(0.7, 0.1, 8, 22), mat(0xf5f0dc));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = -0.14;
  g.add(rim);
  const spike = mat(0xffffff, { rough: 0.4 });
  const top = mesh(G.cone(0.14, 0.4, 8), spike, 0, 0.72, 0);
  g.add(top);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const s = mesh(G.cone(0.12, 0.34, 8), spike, Math.cos(a) * 0.45, 0.42, Math.sin(a) * 0.45);
    s.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
    g.add(s);
  }
  const wingMat = mat(0xffffff, { rough: 0.5 });
  for (const side of [-1, 1]) {
    const wing = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const f = mesh(G.box(0.7 - i * 0.14, 0.06, 0.2), wingMat, side * (0.35 - i * 0.04), 0.1 + i * 0.13, -i * 0.05);
      f.rotation.z = side * (0.35 + i * 0.25);
      wing.add(f);
    }
    wing.position.set(side * 0.72, 0.1, -0.1);
    g.add(wing);
    g.userData[side < 0 ? "wingL" : "wingR"] = wing;
  }
  return g;
}

// Bob-omb: a black bomb with eyes, a wind-up key and little feet
export function buildBomb() {
  const g = new THREE.Group();
  g.add(mesh(G.sphere(0.62, 16, 12), mat(0x1c1c24, { rough: 0.45, metal: 0.2 }), 0, 0.1, 0));
  const white = mat(0xffffff, { rough: 0.4 });
  for (const x of [-0.2, 0.2]) {
    const eye = mesh(G.sphere(0.13, 10, 8), white, x, 0.28, 0.52);
    eye.scale.set(0.8, 1.3, 0.5);
    g.add(eye);
  }
  const fuse = mesh(G.cyl(0.08, 0.1, 0.18, 8), mat(0xd9d2b0), 0, 0.76, 0);
  g.add(fuse);
  g.add(mesh(G.sphere(0.08, 8, 6), mat(0xffb020, { emissive: 0xff6000, ei: 1.2 }), 0, 0.9, 0));
  const key = mat(0xc9c9d2, { rough: 0.3, metal: 0.8 });
  const stem = mesh(G.cyl(0.05, 0.05, 0.3, 6), key, 0, 0.12, -0.72);
  stem.rotation.x = Math.PI / 2;
  g.add(stem);
  for (const x of [-0.18, 0.18]) {
    const loop = mesh(G.torus(0.16, 0.05, 6, 12), key, x, 0.12, -0.88);
    loop.rotation.y = Math.PI / 2;
    g.add(loop);
  }
  const foot = mat(0xf2a81d, { rough: 0.6 });
  for (const x of [-0.25, 0.25]) {
    const f = mesh(G.sphere(0.18, 10, 8), foot, x, -0.48, 0.1);
    f.scale.set(1, 0.6, 1.4);
    g.add(f);
  }
  return g;
}

// Fire Flower fireball
export function buildFireball() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(G.sphere(0.32, 12, 10), mat(0xffd84a, { emissive: 0xffa000, ei: 1.4, rough: 0.6 }));
  g.add(core);
  const shell = new THREE.Mesh(G.sphere(0.46, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff5a10, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  g.add(shell);
  return g;
}

// Boomerang Flower's boomerang: a spinning V
export function buildBoomerang() {
  const g = new THREE.Group();
  const wood = mat(0x3a7ad9, { rough: 0.45 });
  const tip = mat(0xffffff, { rough: 0.5 });
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.add(mesh(G.box(0.26, 0.1, 1.15), wood, 0, 0, 0.5));
    arm.add(mesh(G.box(0.27, 0.11, 0.25), tip, 0, 0, 1.0));
    arm.rotation.y = side * 0.75;
    g.add(arm);
  }
  return g;
}

// Bullet Bill: the kart turns into one while it lasts (facing +z like the kart)
export function buildBulletBill() {
  const g = new THREE.Group();
  const black = mat(0x16161c, { rough: 0.35, metal: 0.3 });
  const body = mesh(G.cyl(1.05, 1.05, 2.4, 20), black, 0, 1.1, -0.1);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const nose = mesh(new THREE.SphereGeometry(1.05, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), black, 0, 1.1, 1.1);
  nose.rotation.x = Math.PI / 2;
  g.add(nose);
  const cap = mesh(G.cyl(1.15, 1.15, 0.35, 20), mat(0x55555f, { rough: 0.3, metal: 0.8 }), 0, 1.1, -1.45);
  cap.rotation.x = Math.PI / 2;
  g.add(cap);
  const white = mat(0xffffff, { rough: 0.4 });
  const pupil = mat(0x111111);
  for (const x of [-0.42, 0.42]) {
    const eye = mesh(G.sphere(0.3, 12, 10), white, x, 1.55, 1.25);
    eye.scale.set(0.8, 1.2, 0.5);
    g.add(eye);
    g.add(mesh(G.sphere(0.12, 8, 6), pupil, x * 0.9, 1.55, 1.4));
    // An angry brow
    const brow = mesh(G.box(0.46, 0.1, 0.12), white, x, 1.95, 1.18);
    brow.rotation.z = x > 0 ? 0.35 : -0.35;
    g.add(brow);
  }
  for (const x of [-1.15, 1.15]) g.add(mesh(G.sphere(0.28, 10, 8), white, x, 0.95, -0.3));
  return g;
}

// Piranha Plant in a pot, riding on the front bumper. userData.jaw opens and closes.
export function buildPiranha() {
  const g = new THREE.Group();
  g.add(mesh(G.cyl(0.36, 0.28, 0.42, 12), mat(0xc8642a, { rough: 0.7 }), 0, 0.21, 0));
  const green = mat(0x2f9a3a, { rough: 0.6 });
  g.add(mesh(G.cyl(0.08, 0.1, 0.6, 8), green, 0, 0.7, 0));
  for (const side of [-1, 1]) {
    const leaf = mesh(G.sphere(0.24, 10, 6), green, side * 0.26, 0.5, 0);
    leaf.scale.set(1.3, 0.3, 0.7);
    leaf.rotation.z = side * 0.4;
    g.add(leaf);
  }
  const head = new THREE.Group();
  head.position.set(0, 1.15, 0.05);
  const red = mat(0xe02828, { rough: 0.45 });
  const spot = mat(0xffffff, { rough: 0.5 });
  const lower = mesh(new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), red);
  head.add(lower);
  const jaw = new THREE.Group(); // the top half, hinged at the back
  jaw.position.z = -0.45;
  const upper = mesh(new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), red, 0, 0, 0.45);
  jaw.add(upper);
  for (const [x, y, z] of [[0, 0.44, 0.45], [0.3, 0.3, 0.6], [-0.3, 0.3, 0.6], [0.35, 0.3, 0.2], [-0.35, 0.3, 0.2]]) jaw.add(mesh(G.sphere(0.09, 8, 6), spot, x, y, z));
  const lip = mat(0xfff4e0, { rough: 0.5 });
  const lipU = mesh(G.torus(0.48, 0.05, 6, 20), lip, 0, 0, 0.45);
  lipU.rotation.x = Math.PI / 2;
  jaw.add(lipU);
  const lipL = mesh(G.torus(0.48, 0.05, 6, 20), lip);
  lipL.rotation.x = Math.PI / 2;
  head.add(lipL);
  for (let i = 0; i < 6; i++) {
    const a = -0.9 + (i / 5) * 1.8;
    const tooth = mesh(G.cone(0.05, 0.14, 5), spot, Math.sin(a) * 0.4, -0.06, 0.45 + Math.cos(a) * 0.4);
    tooth.rotation.x = Math.PI;
    jaw.add(tooth);
  }
  head.add(jaw);
  g.add(head);
  g.userData = { jaw, head };
  return g;
}

// Boo: a shy ghost that floats over a kart while it's invisible
export function buildBoo() {
  const g = new THREE.Group();
  const ghost = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, transparent: true, opacity: 0.8, emissive: 0xbbbbff, emissiveIntensity: 0.25 });
  const body = new THREE.Mesh(G.sphere(0.8, 18, 14), ghost);
  g.add(body);
  const tail = new THREE.Mesh(G.cone(0.35, 0.6, 10), ghost);
  tail.position.set(0, -0.35, -0.8);
  tail.rotation.x = -Math.PI / 2 - 0.4;
  g.add(tail);
  for (const x of [-0.85, 0.85]) {
    const arm = new THREE.Mesh(G.sphere(0.25, 10, 8), ghost);
    arm.position.set(x, 0, 0.3);
    arm.scale.set(0.7, 1, 0.7);
    g.add(arm);
  }
  const black = mat(0x111111);
  for (const x of [-0.25, 0.25]) {
    const eye = mesh(G.sphere(0.1, 8, 6), black, x, 0.22, 0.72);
    eye.scale.set(0.8, 1.6, 0.5);
    g.add(eye);
  }
  const mouth = mesh(new THREE.SphereGeometry(0.26, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat(0x7a1020), 0, -0.05, 0.62);
  mouth.scale.set(1.2, 1, 0.6);
  g.add(mouth);
  g.add(mesh(G.sphere(0.12, 8, 6), mat(0xff6f8a), 0, -0.2, 0.7));
  return g;
}
