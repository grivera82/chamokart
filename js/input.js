// Keyboard, gamepad and touch input merged into one control state.
const KEYS = {
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  drift: ["Space", "ShiftLeft", "ShiftRight", "KeyK"],
  item: ["KeyE", "KeyX", "KeyJ", "KeyL"],
  back: ["KeyC", "KeyQ"],
  pause: ["Escape", "KeyP"],
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.autoAccel = false;
    this.touch = { steer: 0, drift: false, item: false, brake: false, active: false };
    this.tilt = { on: false, steer: 0, listening: false };
    this.pad = { steer: 0, throttle: 0, brake: 0, drift: false, item: false, back: false, pause: false, up: false, down: false, confirm: false, cancel: false };
    this.prevPad = { ...this.pad };
    this.listeners = new Set();
    this.enabled = true;
    window.addEventListener("keydown", (e) => {
      const slider = e.target instanceof HTMLInputElement && e.target.type === "range";
      if ((e.target instanceof HTMLInputElement && !slider) || e.target instanceof HTMLTextAreaElement) return;
      if (slider) {
        // Volume sliders: left/right adjust natively, everything else drives the menu.
        if (!e.repeat) this.fire("key", e.code);
        return;
      }
      if (this.enabled && Object.values(KEYS).some((l) => l.includes(e.code)) && !e.metaKey && !e.ctrlKey) {
        if (e.code === "Space" || e.code.startsWith("Arrow")) {
          // Only swallow while racing; menus handle their own keys.
          if (this.racing) e.preventDefault();
        }
      }
      if (!e.repeat) this.fire("key", e.code);
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  fire(type, code) {
    for (const fn of this.listeners) fn(type, code);
  }

  down(action) {
    // Driving the CX-9 or Bumblebee, D is their special move instead of steering.
    return KEYS[action].some((k) => this.keys.has(k) && !(this.specialKey && k === "KeyD"));
  }

  isKey(action, code) {
    return KEYS[action].includes(code);
  }

  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    this.prevPad = { ...this.pad };
    if (!gp) {
      this.pad = { steer: 0, throttle: 0, brake: 0, drift: false, item: false, back: false, pause: false, up: false, down: false, confirm: false, cancel: false };
      return;
    }
    const b = (i) => !!gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5);
    let steer = gp.axes[0] || 0;
    if (Math.abs(steer) < 0.15) steer = 0;
    if (b(14)) steer = -1;
    if (b(15)) steer = 1;
    const stickY = gp.axes[1] || 0;
    this.pad = {
      steer,
      throttle: b(0) ? 1 : 0,
      brake: b(1) ? 1 : 0,
      drift: b(5) || b(7),
      item: b(4) || b(6) || b(3),
      back: b(2),
      pause: b(9),
      up: b(12) || stickY < -0.6,
      down: b(13) || stickY > 0.6,
      left: b(14) || steer < -0.6,
      right: b(15) || steer > 0.6,
      confirm: b(0),
      cancel: b(1),
      stickDown: stickY > 0.5,
    };
    // Menu navigation edges
    const edge = (k) => this.pad[k] && !this.prevPad[k];
    if (edge("up")) this.fire("key", "ArrowUp");
    if (edge("down")) this.fire("key", "ArrowDown");
    if (edge("left")) this.fire("pad", "ArrowLeft");
    if (edge("right")) this.fire("pad", "ArrowRight");
    if (edge("confirm")) this.fire("pad", "confirm");
    if (edge("cancel")) this.fire("pad", "cancel");
    if (edge("pause")) this.fire("key", "Escape");
  }

  // Current driving controls
  controls() {
    const kLeft = this.down("left") ? 1 : 0;
    const kRight = this.down("right") ? 1 : 0;
    let steer = kRight - kLeft;
    if (this.pad.steer) steer = this.pad.steer;
    if (this.tilt.on && this.tilt.steer) steer = this.tilt.steer;
    if (this.touch.active && this.touch.steer) steer = this.touch.steer;
    let throttle = this.down("up") || this.pad.throttle ? 1 : 0;
    const brake = this.down("down") || this.pad.brake || this.touch.brake ? 1 : 0;
    let auto = false;
    if ((this.autoAccel || this.touchMode || this.touch.active) && !brake && !throttle) {
      throttle = 1;
      auto = true;
    }
    return {
      throttle,
      auto,
      brake,
      steer,
      drift: this.down("drift") || this.pad.drift || this.touch.drift,
      item: this.down("item") || this.pad.item || this.touch.item,
      itemBack: this.down("down") || this.pad.brake > 0 || this.pad.stickDown || this.touch.brake,
      lookBack: this.down("back") || this.pad.back,
    };
  }

  // Tilt steering: hold the phone like a steering wheel (portrait or landscape).
  // Resolves false when motion sensors are missing or access was denied. On iOS this
  // must be called straight from a tap: requestPermission() needs the user gesture.
  async enableTilt(on) {
    this.tilt.on = on;
    this.tilt.steer = 0;
    if (!on || this.tilt.listening) return true;
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return false;
    if (typeof DOE.requestPermission === "function") {
      try {
        if ((await DOE.requestPermission()) !== "granted") return false;
      } catch {
        return false;
      }
    }
    window.addEventListener("deviceorientation", (e) => this.onTilt(e));
    this.tilt.listening = true;
    return true;
  }

  onTilt(e) {
    if (!this.tilt.on || e.beta == null || e.gamma == null) return;
    const r = Math.PI / 180;
    const b = e.beta * r, g = e.gamma * r;
    // "Up" (against gravity) in the device's screen plane, from the W3C Z-X'-Y'' angles.
    const ux = -Math.sin(g) * Math.cos(b), uy = Math.sin(b);
    // Rotate into screen coordinates for the current orientation.
    const a = (typeof window.orientation === "number" ? window.orientation : screen.orientation?.angle || 0) * r;
    const sx = ux * Math.cos(a) - uy * Math.sin(a);
    const sy = ux * Math.sin(a) + uy * Math.cos(a);
    let target = 0;
    if (Math.hypot(sx, sy) > 0.25) {
      // Wheel angle: 0 when level, positive when turned clockwise. 4° dead zone, full lock at 28°.
      const deg = Math.atan2(-sx, sy) / r;
      target = Math.sign(deg) * Math.min(1, Math.max(0, Math.abs(deg) - 4) / 24);
    } // else the phone is lying flat: no usable wheel angle, go straight
    this.tilt.steer += (target - this.tilt.steer) * 0.5;
    if (Math.abs(this.tilt.steer) < 0.02) this.tilt.steer = 0;
    if (!this.touch.steer && this.knob) this.knob.style.transform = `translateX(${this.tilt.steer * 45}px)`;
  }

  // Touch controls: left-half drag steers, buttons on the right.
  bindTouch(root) {
    const stick = root.querySelector("#touch-stick");
    const knob = root.querySelector("#touch-knob");
    this.knob = knob;
    let stickId = null, cx = 0;
    const setSteer = (x) => {
      const d = Math.max(-1, Math.min(1, (x - cx) / 55));
      this.touch.steer = Math.abs(d) < 0.08 ? 0 : d;
      knob.style.transform = `translateX(${d * 45}px)`;
    };
    stick.addEventListener("pointerdown", (e) => {
      stickId = e.pointerId;
      const r = stick.getBoundingClientRect();
      cx = r.left + r.width / 2;
      stick.setPointerCapture(e.pointerId);
      this.touch.active = true;
      setSteer(e.clientX);
    });
    stick.addEventListener("pointermove", (e) => {
      if (e.pointerId === stickId) setSteer(e.clientX);
    });
    const end = (e) => {
      if (e.pointerId !== stickId) return;
      stickId = null;
      this.touch.steer = 0;
      knob.style.transform = "";
    };
    stick.addEventListener("pointerup", end);
    stick.addEventListener("pointercancel", end);
    for (const [id, key] of [["touch-drift", "drift"], ["touch-item", "item"], ["touch-brake", "brake"]]) {
      const el = root.querySelector("#" + id);
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        this.touch[key] = true;
        this.touch.active = true;
        el.classList.add("down");
      });
      const up = () => {
        this.touch[key] = false;
        el.classList.remove("down");
      };
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    }
  }
}

export const input = new Input();
