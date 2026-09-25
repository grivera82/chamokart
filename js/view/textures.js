// Procedurally painted canvas textures (no image assets needed).
import * as THREE from "three";

let anisotropy = 4;
export function setAnisotropy(a) {
  anisotropy = a;
}

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function tex(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  return t;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function noise(ctx, w, h, amount, seed, alpha = 0.12, size = 2) {
  const r = rng(seed);
  for (let i = 0; i < amount; i++) {
    const v = Math.floor(r() * 255);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * r()})`;
    ctx.fillRect(r() * w, r() * h, size * (0.5 + r()), size * (0.5 + r()));
  }
}

const cache = new Map();
function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

export function roadTexture(theme) {
  return cached("road" + theme, () => {
    const c = canvas(256, 256);
    const g = c.getContext("2d");
    if (theme === "neon") {
      const cols = ["#ff3b6b", "#ff9a3b", "#ffe53b", "#3bff8a", "#3bc8ff", "#8a5bff", "#ff5bd6"];
      cols.forEach((col, i) => {
        g.fillStyle = col;
        g.fillRect((i * 256) / cols.length, 0, 256 / cols.length + 1, 256);
      });
      g.fillStyle = "rgba(10,0,30,0.45)";
      g.fillRect(0, 0, 256, 256);
      g.fillStyle = "rgba(255,255,255,0.8)";
      for (let y = 0; y < 256; y += 64) g.fillRect(0, y, 256, 3);
      g.fillStyle = "#fff";
      g.fillRect(0, 0, 6, 256);
      g.fillRect(250, 0, 6, 256);
      return tex(c);
    }
    const base = { meadow: "#5b5d66", desert: "#7a6a5c", snow: "#6c7280", beach: "#6f6a66" }[theme] || "#5b5d66";
    g.fillStyle = base;
    g.fillRect(0, 0, 256, 256);
    noise(g, 256, 256, 5000, 7, 0.18, 2);
    // Subtle tire marks
    g.fillStyle = "rgba(0,0,0,0.06)";
    g.fillRect(70, 0, 22, 256);
    g.fillRect(164, 0, 22, 256);
    // Edge lines
    g.fillStyle = theme === "desert" ? "#f3d27a" : "#f4f4f4";
    g.fillRect(6, 0, 6, 256);
    g.fillRect(244, 0, 6, 256);
    // Center dashes
    g.fillStyle = "rgba(255,255,255,0.75)";
    g.fillRect(125, 0, 6, 110);
    if (theme === "snow") {
      g.fillStyle = "rgba(255,255,255,0.35)";
      const r = rng(3);
      for (let i = 0; i < 60; i++) g.fillRect(r() * 256, r() * 256, 3 + r() * 8, 2 + r() * 4);
    }
    return tex(c);
  });
}

export function curbTexture(theme) {
  return cached("curb" + theme, () => {
    const c = canvas(64, 128);
    const g = c.getContext("2d");
    const [a, b] = {
      meadow: ["#e8322f", "#f7f7f7"],
      desert: ["#e27b1b", "#f7efe1"],
      snow: ["#2f6fe8", "#f7f7f7"],
      beach: ["#16b3b0", "#fff7df"],
      neon: ["#ff2bd6", "#20e7ff"],
    }[theme] || ["#e8322f", "#f7f7f7"];
    g.fillStyle = a;
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = b;
    g.fillRect(0, 64, 64, 64);
    noise(g, 64, 128, 300, 5, 0.1, 2);
    return tex(c);
  });
}

export function groundTexture(theme) {
  return cached("ground" + theme, () => {
    const c = canvas(256, 256);
    const g = c.getContext("2d");
    const pal = {
      meadow: ["#ffffff", [[80, 150, 60], [100, 170, 70], [70, 130, 50]]],
      desert: ["#ffffff", [[230, 190, 130], [215, 170, 110], [240, 205, 150]]],
      snow: ["#ffffff", [[240, 245, 255], [220, 230, 245], [250, 250, 255]]],
      beach: ["#ffffff", [[245, 222, 170], [235, 210, 155], [250, 232, 190]]],
      neon: ["#ffffff", [[30, 20, 60], [40, 30, 80], [20, 10, 40]]],
    }[theme] || ["#fff", [[90, 160, 70]]];
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 256, 256);
    const r = rng(11);
    // Neutral-ish detail: we multiply this with vertex colors, so keep it light.
    for (let i = 0; i < 9000; i++) {
      const v = 200 + Math.floor(r() * 55);
      g.fillStyle = `rgb(${v},${v},${v})`;
      const s = 1 + r() * 3;
      g.fillRect(r() * 256, r() * 256, s, s);
    }
    if (theme === "meadow") {
      for (let i = 0; i < 1400; i++) {
        const v = 170 + Math.floor(r() * 60);
        g.strokeStyle = `rgba(${v - 40},${v},${v - 60},0.7)`;
        g.beginPath();
        const x = r() * 256, y = r() * 256;
        g.moveTo(x, y);
        g.lineTo(x + (r() - 0.5) * 3, y - 3 - r() * 4);
        g.stroke();
      }
    }
    void pal;
    return tex(c);
  });
}

export function checkerTexture() {
  return cached("checker", () => {
    const c = canvas(128, 32);
    const g = c.getContext("2d");
    for (let x = 0; x < 16; x++)
      for (let y = 0; y < 4; y++) {
        g.fillStyle = (x + y) % 2 ? "#111" : "#fafafa";
        g.fillRect(x * 8, y * 8, 8, 8);
      }
    return tex(c);
  });
}

export function boostTexture() {
  return cached("boost", () => {
    const c = canvas(128, 128);
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, "#ff8a00");
    grad.addColorStop(1, "#ffd000");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = "rgba(255,255,255,0.95)";
    for (let k = 0; k < 2; k++) {
      const y = k * 64;
      g.beginPath();
      g.moveTo(20, y + 50);
      g.lineTo(64, y + 14);
      g.lineTo(108, y + 50);
      g.lineTo(108, y + 64);
      g.lineTo(64, y + 30);
      g.lineTo(20, y + 64);
      g.closePath();
      g.fill();
    }
    g.strokeStyle = "#fff";
    g.lineWidth = 6;
    g.strokeRect(3, -10, 122, 148);
    return tex(c);
  });
}

export function rampTexture() {
  return cached("ramp", () => {
    const c = canvas(128, 128);
    const g = c.getContext("2d");
    g.fillStyle = "#1e2a44";
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = "#ffd23f";
    for (let i = -128; i < 256; i += 32) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + 16, 0);
      g.lineTo(i + 16 + 128, 128);
      g.lineTo(i + 128, 128);
      g.closePath();
      g.fill();
    }
    return tex(c);
  });
}

export function itemBoxTexture() {
  return cached("itembox", () => {
    const c = canvas(128, 128);
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 128, 128);
    grad.addColorStop(0, "rgba(255,90,200,0.9)");
    grad.addColorStop(0.35, "rgba(255,220,80,0.9)");
    grad.addColorStop(0.7, "rgba(80,220,255,0.9)");
    grad.addColorStop(1, "rgba(160,90,255,0.9)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.fillRect(8, 8, 112, 112);
    g.lineWidth = 8;
    g.strokeStyle = "rgba(255,255,255,0.95)";
    g.strokeRect(4, 4, 120, 120);
    g.font = "bold 88px Arial Black, Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 6;
    g.strokeStyle = "#5a2a8a";
    g.strokeText("?", 64, 70);
    g.fillStyle = "#fff";
    g.fillText("?", 64, 70);
    return tex(c, false);
  });
}

export function bannerTexture(text, bg = "#e23b3b", fg = "#fff") {
  return cached("banner" + text + bg, () => {
    const c = canvas(1024, 128);
    const g = c.getContext("2d");
    g.fillStyle = bg;
    g.fillRect(0, 0, 1024, 128);
    for (let x = 0; x < 64; x++) {
      g.fillStyle = x % 2 ? "#111" : "#fff";
      g.fillRect(x * 16, 0, 16, 12);
      g.fillStyle = x % 2 ? "#fff" : "#111";
      g.fillRect(x * 16, 116, 16, 12);
    }
    g.font = "900 78px 'Arial Black', Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 10;
    g.strokeStyle = "#222";
    g.strokeText(text, 512, 66);
    g.fillStyle = fg;
    g.fillText(text, 512, 66);
    return tex(c, false);
  });
}

export function wallTexture(theme) {
  return cached("wall" + theme, () => {
    const c = canvas(256, 64);
    const g = c.getContext("2d");
    if (theme === "desert") {
      g.fillStyle = "#8a5a33";
      g.fillRect(0, 0, 256, 64);
      for (let x = 0; x < 256; x += 32) {
        g.fillStyle = x % 64 ? "#a06b3d" : "#94623a";
        g.fillRect(x + 2, 4, 28, 56);
      }
      noise(g, 256, 64, 800, 9, 0.2, 2);
    } else if (theme === "snow") {
      g.fillStyle = "#f4f8ff";
      g.fillRect(0, 0, 256, 64);
      g.fillStyle = "#cfe0f5";
      for (let x = 0; x < 256; x += 16) g.fillRect(x, 40 + Math.sin(x) * 6, 16, 30);
      noise(g, 256, 64, 400, 9, 0.08, 3);
    } else {
      // Tire / barrier stripes
      for (let x = 0; x < 256; x += 64) {
        g.fillStyle = "#f2f2f2";
        g.fillRect(x, 0, 32, 64);
        g.fillStyle = "#e23b3b";
        g.fillRect(x + 32, 0, 32, 64);
      }
      g.fillStyle = "rgba(0,0,0,0.25)";
      g.fillRect(0, 56, 256, 8);
      g.fillStyle = "rgba(255,255,255,0.3)";
      g.fillRect(0, 4, 256, 4);
    }
    return tex(c);
  });
}

export function glowTexture() {
  return cached("glow", () => {
    const c = canvas(64, 64);
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.6)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return tex(c, false);
  });
}

export function shadowTexture() {
  return cached("shadow", () => {
    const c = canvas(64, 64);
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    grad.addColorStop(0, "rgba(0,0,0,0.55)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return tex(c, false);
  });
}

export function labelTexture(text, color = "#fff") {
  const c = canvas(256, 64);
  const g = c.getContext("2d");
  g.font = "bold 34px Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const w = Math.min(250, g.measureText(text).width + 28);
  g.fillStyle = "rgba(10,10,30,0.6)";
  const x = 128 - w / 2;
  g.beginPath();
  g.roundRect(x, 10, w, 44, 22);
  g.fill();
  g.fillStyle = color;
  g.fillText(text, 128, 33);
  return tex(c, false);
}

// Shirt print: black wordmark on a transparent background.
export function shirtLogoTexture(text) {
  return cached("logo" + text, () => {
    const c = canvas(512, 128);
    const g = c.getContext("2d");
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.letterSpacing = "6px";
    let size = 104;
    g.font = `900 ${size}px Arial, Helvetica, sans-serif`;
    while (g.measureText(text).width > 470 && size > 20) g.font = `900 ${--size}px Arial, Helvetica, sans-serif`;
    g.fillStyle = "#111";
    g.fillText(text, 256, 66);
    return tex(c, false);
  });
}

export function waterTexture() {
  return cached("water", () => {
    const c = canvas(256, 256);
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 256, 256);
    const r = rng(21);
    g.strokeStyle = "rgba(160,220,255,0.9)";
    g.lineWidth = 2;
    for (let i = 0; i < 90; i++) {
      const x = r() * 256, y = r() * 256, l = 8 + r() * 20;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + l / 2, y - 3, x + l, y);
      g.stroke();
    }
    return tex(c);
  });
}
