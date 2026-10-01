// Turntable scene for the character select screen + portrait renderer.
import * as THREE from "three";
import { buildKart, mat, poseTransformer, TRANSFORM_TIME } from "./models.js?v=24";
import { CHARACTERS } from "../data.js?v=19";
import { lookKey } from "../look.js?v=3";

function lights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6a5a8a, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(4, 8, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 });
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffd0f0, 1.2);
  rim.position.set(-5, 4, -6);
  scene.add(rim);
}

export class Showroom {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xff8a5a);
    const bg = new THREE.Mesh(
      new THREE.SphereGeometry(60, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: { a: { value: new THREE.Color(0xffd23f) }, b: { value: new THREE.Color(0xe23b3b) }, c: { value: new THREE.Color(0x7b2a8a) } },
        vertexShader: `varying vec3 p; void main(){ p = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
        fragmentShader: `uniform vec3 a; uniform vec3 b; uniform vec3 c; varying vec3 p;
          void main(){ float h = p.y*0.5+0.5; vec3 col = h > 0.5 ? mix(b, a, (h-0.5)*2.0) : mix(c, b, h*2.0);
          float rays = step(0.5, fract(atan(p.x, p.z)*3.0/3.14159 + 0.0)); col = mix(col, col*1.08, rays*0.6);
          gl_FragColor = vec4(col,1.0);} `,
      })
    );
    this.scene.add(bg);
    lights(this.scene);
    const table = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 0.5, 48), mat(0xffffff, { rough: 0.4 }));
    table.position.y = -0.25;
    table.receiveShadow = true;
    this.scene.add(table);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.45, 0.12, 8, 64), mat(0xffd23f, { metal: 0.5, rough: 0.3 }));
    ring.rotation.x = Math.PI / 2;
    this.scene.add(ring);
    this.table = new THREE.Group();
    this.scene.add(this.table);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.camera.position.set(0, 3.1, 8.2);
    this.camera.lookAt(0, 0.9, 0);
    this.angle = 0.6;
    this.spinRate = 0.7;
    this.zoom = this.zoomT = 0; // 1: close-up of the driver
    this.key = "";
  }

  setKart(char, kart, look) {
    const key = char + ":" + kart + ":" + (CHARACTERS[char].custom ? lookKey(look) : "");
    if (key === this.key) return;
    const hop = !this.key.startsWith(char + ":" + kart + ":"); // editing a look doesn't bounce the table
    this.key = key;
    this.table.traverse((o) => {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) if (!m.userData?.shared) m.dispose();
    });
    this.table.clear();
    const m = buildKart(char, kart, look);
    m.traverse((o) => (o.castShadow = true));
    if (m.userData.showroomScale) m.scale.setScalar(m.userData.showroomScale); // the full-size cars outgrow the turntable
    this.table.add(m);
    this.model = m;
    if (hop) this.hop = 0.35;
    this.xformClock = 0;
    this.xformT = 0;
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    // Push the kart to the right on wide screens and phones held sideways (the panel sits on the left).
    // In the look editor on a phone held upright, the panel is at the bottom: lift the kart up.
    if (this.editing && w <= 600 && h > w) this.camera.setViewOffset(w, h, 0, h * 0.22, w, h);
    else if (w > 860) this.camera.setViewOffset(w, h, -w * 0.2, 0, w, h);
    else if (w > h && h <= 500) this.camera.setViewOffset(w, h, -w * 0.25, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    this.angle += dt * this.spinRate;
    this.table.rotation.y = this.angle;
    this.model?.userData.tick?.(dt, performance.now() / 1000);
    // Ease the camera between the whole kart and a close-up of the driver (the look editor)
    this.zoomT += (this.zoom - this.zoomT) * Math.min(1, dt * 5);
    const z = this.zoomT;
    this.camera.position.set(0, 3.1 - z * 0.3, 8.2 - z * 2.8);
    this.camera.lookAt(0, 0.9 + z * 0.55, -z * 0.2);
    // Bumblebee shows off: 2.5 s as a car, then transforms, 2.5 s as a robot, and back
    const ud = this.model?.userData;
    if (ud?.transform) {
      this.xformClock += dt;
      const robot = Math.floor(this.xformClock / (2.5 + TRANSFORM_TIME)) % 2 === 1;
      this.xformT = Math.max(0, Math.min(1, this.xformT + (robot ? dt : -dt) / TRANSFORM_TIME));
      poseTransformer(ud, this.xformT);
    }
    if (this.hop > 0) {
      this.hop -= dt;
      this.table.position.y = Math.sin(Math.max(0, this.hop) / 0.35 * Math.PI) * 0.5;
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

// A portrait of one racer (the Custom racer as `look`), as a data URL.
export function renderPortrait(renderer, char, look, size = 160) {
  return renderPortraits(renderer, size, [[char, look]])[0];
}

// Render a small portrait (data URL) for every character using the main renderer.
export function renderPortraits(renderer, size = 160, which = CHARACTERS.map((c, i) => [i, null])) {
  const scene = new THREE.Scene();
  lights(scene);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  cam.position.set(2.2, 2.3, 4.2);
  cam.lookAt(0, 1.05, 0.2);
  const prevSize = renderer.getSize(new THREE.Vector2());
  const prevRatio = renderer.getPixelRatio();
  const prevShadow = renderer.shadowMap.enabled;
  renderer.shadowMap.enabled = false;
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);
  const urls = [];
  for (const [i, look] of which) {
    const m = buildKart(i, 0, look);
    m.rotation.y = 0.25;
    if (m.userData.portraitScale) m.scale.setScalar(m.userData.portraitScale); // keep Lucas's head in frame
    scene.add(m);
    renderer.render(scene, cam);
    urls.push(renderer.domElement.toDataURL("image/png"));
    scene.remove(m);
  }
  renderer.setClearColor(0x000000, 1);
  renderer.shadowMap.enabled = prevShadow;
  renderer.setPixelRatio(prevRatio);
  renderer.setSize(prevSize.x, prevSize.y, false);
  return urls;
}
