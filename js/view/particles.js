// Pooled GPU point particles (sparks, smoke, confetti...).
import * as THREE from "three";
import { glowTexture } from "./textures.js?v=8";

export class Particles {
  constructor(scene, max = 2500, additive = true) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.base = new Float32Array(max * 4); // r g b size0
    this.grav = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("size", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    const m = new THREE.ShaderMaterial({
      uniforms: { map: { value: glowTexture() }, scale: { value: 600 } },
      vertexShader: `
        attribute float size; attribute vec4 color; varying vec4 vC;
        uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        uniform sampler2D map; varying vec4 vC;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a * t.a); if (gl_FragColor.a < 0.01) discard; }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  setScale(h) {
    this.points.material.uniforms.scale.value = h;
  }

  emit(x, y, z, vx, vy, vz, r, g, b, size, life, opts = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.base[i * 4] = r; this.base[i * 4 + 1] = g; this.base[i * 4 + 2] = b; this.base[i * 4 + 3] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = opts.gravity ?? 0;
    this.grow[i] = opts.grow ?? 0;
    this.drag[i] = opts.drag ?? 1.5;
  }

  burst(x, y, z, n, speed, color, size, life, opts = {}) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const sp = speed * (0.4 + Math.random() * 0.6);
      let col = c;
      if (opts.rainbow) col = new THREE.Color().setHSL(Math.random(), 0.9, 0.6);
      this.emit(x, y, z, Math.cos(a) * s * sp, Math.abs(u) * sp * (opts.up ?? 1) + (opts.lift ?? 0), Math.sin(a) * s * sp, col.r, col.g, col.b, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), opts);
    }
  }

  update(dt) {
    const { pos, vel, col, size, life, maxLife, base, grav, grow, drag } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) {
        if (col[i * 4 + 3] !== 0) {
          col[i * 4 + 3] = 0;
          size[i] = 0;
        }
        continue;
      }
      life[i] -= dt;
      const d = Math.exp(-drag[i] * dt);
      vel[i * 3] *= d; vel[i * 3 + 1] = vel[i * 3 + 1] * d - grav[i] * dt; vel[i * 3 + 2] *= d;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      const t = Math.max(0, life[i] / maxLife[i]);
      col[i * 4] = base[i * 4]; col[i * 4 + 1] = base[i * 4 + 1]; col[i * 4 + 2] = base[i * 4 + 2];
      col[i * 4 + 3] = Math.min(1, t * 1.8);
      size[i] = base[i * 4 + 3] * (1 + grow[i] * (1 - t));
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }

  dispose() {
    this.points.parent?.remove(this.points);
    this.geo.dispose();
    this.points.material.dispose();
  }
}
