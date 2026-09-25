// Track geometry + spatial queries. Pure math, no rendering dependencies,
// so the whole race simulation can run in Node for testing.

export const SPACING = 2; // world units between centerline samples
export const CURB = 1.6; // drivable curb strip beyond the road edge
export const TRACK_SCALE = 1.2; // control points are authored small; scale up the layout
const RAMP_LEN = 12; // world units of ramp incline
const RAMP_HEIGHT = 1.8;

function catmullRom(p0, p1, p2, p3, t, alpha = 0.5) {
  // Centripetal Catmull-Rom on arbitrary component arrays, knots from xz distance.
  const d = (a, b) => Math.max(1e-4, Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), alpha));
  const t0 = 0;
  const t1 = t0 + d(p0, p1);
  const t2 = t1 + d(p1, p2);
  const t3 = t2 + d(p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const out = [];
  for (let k = 0; k < p0.length; k++) {
    const A1 = ((t1 - tt) / (t1 - t0)) * p0[k] + ((tt - t0) / (t1 - t0)) * p1[k];
    const A2 = ((t2 - tt) / (t2 - t1)) * p1[k] + ((tt - t1) / (t2 - t1)) * p2[k];
    const A3 = ((t3 - tt) / (t3 - t2)) * p2[k] + ((tt - t2) / (t3 - t2)) * p3[k];
    const B1 = ((t2 - tt) / (t2 - t0)) * A1 + ((tt - t0) / (t2 - t0)) * A2;
    const B2 = ((t3 - tt) / (t3 - t1)) * A2 + ((tt - t1) / (t3 - t1)) * A3;
    out.push(((t2 - tt) / (t2 - t1)) * B1 + ((tt - t1) / (t2 - t1)) * B2);
  }
  return out;
}

export class Track {
  constructor(def) {
    this.def = def;
    this.boundary = def.boundary;
    this.shoulder = def.shoulder;
    this.build();
  }

  build() {
    const def = this.def;
    // [x, z, y, w] control points
    const S = def.scale ?? TRACK_SCALE;
    const P = def.points.map((p) => [p[0] * S, p[1] * S, (p[2] || 0) * 1.1, p[3] || def.width]);
    const n = P.length;
    // Dense polyline
    const dense = [];
    for (let i = 0; i < n; i++) {
      const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
      const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const steps = Math.max(8, Math.ceil(segLen / 0.5));
      for (let s = 0; s < steps; s++) dense.push(catmullRom(p0, p1, p2, p3, s / steps));
    }
    // Arc length
    const cum = [0];
    for (let i = 1; i <= dense.length; i++) {
      const a = dense[i - 1], b = dense[i % dense.length];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = cum[dense.length];
    const N = Math.round(total / SPACING);
    this.N = N;
    this.length = total;
    this.spacing = total / N;
    const px = new Float32Array(N), pz = new Float32Array(N), py = new Float32Array(N), hw = new Float32Array(N);
    let j = 0;
    for (let i = 0; i < N; i++) {
      const target = (i / N) * total;
      while (cum[j + 1] < target) j++;
      const a = dense[j], b = dense[(j + 1) % dense.length];
      const t = (target - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
      px[i] = a[0] + (b[0] - a[0]) * t;
      pz[i] = a[1] + (b[1] - a[1]) * t;
      py[i] = a[2] + (b[2] - a[2]) * t;
      hw[i] = (a[3] + (b[3] - a[3]) * t) / 2;
    }
    this.px = px; this.pz = pz; this.py = py; this.hw = hw;

    // Tangents / right vectors
    const tx = new Float32Array(N), tz = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      const dx = px[b] - px[a], dz = pz[b] - pz[a];
      const l = Math.hypot(dx, dz) || 1;
      tx[i] = dx / l; tz[i] = dz / l;
    }
    this.tx = tx; this.tz = tz;

    // Signed curvature (positive = turning right), smoothed.
    const curv = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 2 + N) % N, b = (i + 2) % N;
      curv[i] = (tx[a] * tz[b] - tz[a] * tx[b]) / (4 * this.spacing);
    }
    this.curv = smooth(curv, 3);

    // Features
    this.gap = new Uint8Array(N);
    this.bump = new Float32Array(N);
    this.lip = new Uint8Array(N); // launch sample (end of a ramp)
    this.gaps = [];
    this.ramps = [];
    const rampSamples = Math.round(RAMP_LEN / this.spacing);
    const addRamp = (end) => {
      for (let k = 0; k <= rampSamples; k++) {
        const i = (end - rampSamples + k + N) % N;
        this.bump[i] = Math.max(this.bump[i], (k / rampSamples) * RAMP_HEIGHT);
      }
      this.lip[end % N] = 1;
      this.ramps.push(end % N);
    };
    for (const g of def.gaps || []) {
      const start = Math.round(g.at * N);
      const len = Math.max(2, Math.round(g.len / this.spacing));
      for (let k = 0; k < len; k++) this.gap[(start + k) % N] = 1;
      this.gaps.push({ start, end: (start + len) % N, len });
      addRamp(start - 1);
    }
    for (const r of def.ramps || []) addRamp(Math.round(r.at * N));

    this.boosts = (def.boosts || []).map((b) => ({ i: Math.round(b.at * N) % N, lat: b.lat, len: 3, half: 3.2 }));

    // AI racing line: lateral offset toward the inside of upcoming turns.
    const line = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let c = 0;
      for (let k = -6; k <= 14; k++) c += this.curv[(i + k + N) % N];
      c /= 21;
      const inside = Math.max(-1, Math.min(1, c * 38));
      line[i] = inside * hw[i] * 0.55;
    }
    this.line = smooth(line, 8);

    // Spatial hash for global lookups
    this.cell = 24;
    this.grid = new Map();
    for (let i = 0; i < N; i++) {
      const key = this.key(Math.floor(px[i] / this.cell), Math.floor(pz[i] / this.cell));
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push(i);
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < N; i++) {
      minX = Math.min(minX, px[i]); maxX = Math.max(maxX, px[i]);
      minZ = Math.min(minZ, pz[i]); maxZ = Math.max(maxZ, pz[i]);
      minY = Math.min(minY, py[i]); maxY = Math.max(maxY, py[i]);
    }
    this.bounds = { minX, maxX, minZ, maxZ, minY, maxY };
  }

  key(cx, cz) {
    return cx * 73856093 + cz * 19349663;
  }

  wrap(i) {
    const N = this.N;
    return ((i % N) + N) % N;
  }

  // Signed shortest delta in samples from a to b
  delta(a, b) {
    const N = this.N;
    let d = b - a;
    if (d > N / 2) d -= N;
    else if (d < -N / 2) d += N;
    return d;
  }

  wallDist(i) {
    return this.hw[i] + CURB + this.shoulder;
  }

  nearestGlobal(x, z, maxR = 3) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = -1, bd = Infinity;
    for (let r = 0; r <= maxR; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const list = this.grid.get(this.key(cx + dx, cz + dz));
          if (!list) continue;
          for (const i of list) {
            const d = (x - this.px[i]) ** 2 + (z - this.pz[i]) ** 2;
            if (d < bd) { bd = d; best = i; }
          }
        }
      }
      if (best >= 0 && r >= 1) break;
    }
    if (best < 0) {
      for (let i = 0; i < this.N; i++) {
        const d = (x - this.px[i]) ** 2 + (z - this.pz[i]) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  }

  // Query the track around (x,z). hint = last known sample index (or -1).
  query(x, z, hint, out = {}) {
    const N = this.N;
    let best = -1, bd = Infinity;
    if (hint >= 0) {
      for (let k = -14; k <= 14; k++) {
        const i = (hint + k + N) % N;
        const d = (x - this.px[i]) ** 2 + (z - this.pz[i]) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    if (best < 0 || bd > (this.hw[best] + 30) ** 2) best = this.nearestGlobal(x, z);
    // Pick the segment around best, project.
    const a = (best - 1 + N) % N, b = (best + 1) % N;
    let i0 = best, i1 = b;
    const fx = this.px[b] - this.px[best], fz = this.pz[b] - this.pz[best];
    const along = (x - this.px[best]) * fx + (z - this.pz[best]) * fz;
    if (along < 0) { i0 = a; i1 = best; }
    const sx = this.px[i1] - this.px[i0], sz = this.pz[i1] - this.pz[i0];
    const sl2 = sx * sx + sz * sz || 1;
    let t = ((x - this.px[i0]) * sx + (z - this.pz[i0]) * sz) / sl2;
    t = Math.max(0, Math.min(1, t));
    const cx = this.px[i0] + sx * t, cz = this.pz[i0] + sz * t;
    let ttx = this.tx[i0] + (this.tx[i1] - this.tx[i0]) * t;
    let ttz = this.tz[i0] + (this.tz[i1] - this.tz[i0]) * t;
    const tl = Math.hypot(ttx, ttz) || 1;
    ttx /= tl; ttz /= tl;
    const rx = -ttz, rz = ttx;
    out.idx = i0;
    out.t = t;
    out.s = i0 + t;
    out.cx = cx;
    out.cz = cz;
    out.tx = ttx;
    out.tz = ttz;
    out.rx = rx;
    out.rz = rz;
    out.lateral = (x - cx) * rx + (z - cz) * rz;
    out.hw = this.hw[i0] + (this.hw[i1] - this.hw[i0]) * t;
    out.baseY = this.py[i0] + (this.py[i1] - this.py[i0]) * t;
    out.height = out.baseY + this.bump[i0] + (this.bump[i1] - this.bump[i0]) * t;
    if (this.bump[i0] > 0 && this.bump[i1] === 0) out.height = out.baseY + this.bump[i0]; // sharp lip
    out.slope = (this.py[i1] - this.py[i0] + this.bump[i1] - this.bump[i0]) / this.spacing;
    out.gap = this.gap[i0] === 1 || (this.gap[i1] === 1 && t > 0.5);
    out.wall = out.hw + CURB + this.shoulder;
    const al = Math.abs(out.lateral);
    out.onRoad = al <= out.hw + CURB;
    out.curb = al > out.hw && al <= out.hw + CURB;
    out.ground = !out.gap && (this.boundary === "wall" || al <= out.wall + 0.4);
    return out;
  }

  // World position of sample i with lateral offset
  pointAt(i, lateral = 0, out = {}) {
    i = this.wrap(Math.round(i));
    out.x = this.px[i] + -this.tz[i] * lateral;
    out.z = this.pz[i] + this.tx[i] * lateral;
    out.y = this.py[i] + this.bump[i];
    out.yaw = Math.atan2(this.tx[i], this.tz[i]);
    return out;
  }

  // Fractional sample -> interpolated point
  pointAtS(s, lateral = 0, out = {}) {
    const N = this.N;
    s = ((s % N) + N) % N;
    const i0 = Math.floor(s), i1 = (i0 + 1) % N, t = s - i0;
    const tx = this.tx[i0] + (this.tx[i1] - this.tx[i0]) * t;
    const tz = this.tz[i0] + (this.tz[i1] - this.tz[i0]) * t;
    out.x = this.px[i0] + (this.px[i1] - this.px[i0]) * t - tz * lateral;
    out.z = this.pz[i0] + (this.pz[i1] - this.pz[i0]) * t + tx * lateral;
    out.y = this.py[i0] + (this.py[i1] - this.py[i0]) * t;
    out.yaw = Math.atan2(tx, tz);
    return out;
  }

  // Heading change (radians, + = right) over the next `ahead` samples from i.
  turnAhead(i, from, to) {
    let c = 0;
    for (let k = from; k <= to; k++) c += this.curv[(i + k) % this.N];
    return c * this.spacing;
  }

  gapAt(i) {
    return this.gaps.find((g) => {
      const d = this.delta(g.start, i);
      return d >= -2 && d < g.len + 2;
    });
  }
}

function smooth(arr, radius) {
  const N = arr.length;
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let k = -radius; k <= radius; k++) s += arr[(i + k + N) % N];
    out[i] = s / (2 * radius + 1);
  }
  return out;
}
