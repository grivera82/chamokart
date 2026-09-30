// The Custom racer's look: every choice a player makes in the editor, as a small plain object
// that travels with them (online rooms, spectators, the boards and their ghosts), so everyone
// sees exactly their creation. Shared with server.mjs, so it must stay import-free.

export const CUSTOM = 7; // CHARACTERS index of the Custom racer

// Each option: [id, label]. The first one is the fallback.
export const LOOK_OPTIONS = {
  head: [["human", "Human"], ["skull", "Skull"], ["robot", "Robot"], ["alien", "Alien"], ["cat", "Cat"], ["bear", "Bear"], ["frog", "Frog"], ["pumpkin", "Pumpkin"]],
  eyes: [["round", "Classic"], ["big", "Cute"], ["angry", "Angry"], ["sleepy", "Sleepy"], ["cool", "Shades"], ["goggles", "Goggles"], ["visor", "Visor"], ["glow", "Glowing"], ["cyclops", "Cyclops"]],
  mouth: [["smile", "Smile"], ["grin", "Grin"], ["mustache", "Mustache"], ["beard", "Beard"], ["fangs", "Fangs"], ["tongue", "Tongue"], ["none", "None"]],
  hair: [["none", "None"], ["short", "Short"], ["spiky", "Spiky"], ["mohawk", "Mohawk"], ["afro", "Afro"], ["long", "Long"], ["ponytail", "Ponytail"]],
  hat: [["none", "None"], ["cap", "Cap"], ["backcap", "Backwards cap"], ["cowboy", "Cowboy"], ["sombrero", "Sombrero"], ["crown", "Crown"], ["helmet", "Helmet"], ["beanie", "Beanie"], ["tophat", "Top hat"], ["flowers", "Flowers"], ["horns", "Horns"], ["halo", "Halo"], ["propeller", "Propeller"], ["party", "Party hat"]],
  outfit: [["tee", "T-shirt"], ["stripes", "Stripes"], ["jersey", "Jersey"], ["suit", "Suit"], ["hoodie", "Hoodie"], ["hero", "Superhero"]],
  extra: [["none", "None"], ["cape", "Cape"], ["scarf", "Scarf"], ["wings", "Wings"], ["jetpack", "Jetpack"], ["guitar", "Guitar"]],
  finish: [["gloss", "Gloss"], ["matte", "Matte"], ["metal", "Metallic"], ["chrome", "Chrome"], ["neon", "Neon"]],
  decal: [["none", "None"], ["flames", "Flames"], ["stripes", "Racing stripes"], ["number", "Number"], ["stars", "Stars"], ["checker", "Checkers"], ["lightning", "Lightning"], ["hearts", "Hearts"]],
  spoiler: [["none", "None"], ["small", "Small"], ["big", "Big wing"]],
  flag: [["none", "None"], ["vzla", "Venezuela"], ["mex", "Mexico"], ["col", "Colombia"], ["usa", "USA"], ["pr", "Puerto Rico"], ["esp", "Spain"], ["arg", "Argentina"], ["per", "Peru"], ["pirate", "Pirate"], ["checker", "Checkered"], ["rainbow", "Rainbow"]],
};

export const LOOK_COLORS = ["skin", "eyeColor", "hairColor", "hatColor", "shirt", "shirt2", "extraColor", "paint", "trim", "decalColor", "rims", "glow", "boost"];
export const STAT_KEYS = ["speed", "accel", "weight", "handling"];
export const STAT_POINTS = 12; // like every other racer
export const STAT_MIN = 1;
export const STAT_MAX = 5;

// A Día de Muertos calavera: what the Custom slot looks like until someone makes their own,
// and how the CPU racer in that slot always looks.
export const DEFAULT_LOOK = {
  head: "skull", skin: 0xf5f1e6, eyes: "glow", eyeColor: 0x38e0c8, mouth: "none",
  hair: "none", hairColor: 0x2a1a10, hat: "flowers", hatColor: 0xff4f9a,
  outfit: "suit", shirt: 0x8e44ad, shirt2: 0x38e0c8, number: 7, extra: "none", extraColor: 0xffd23f,
  paint: 0x8e44ad, trim: 0x38e0c8, finish: "gloss", decal: "none", decalColor: 0xffffff,
  rims: 0xb8bcc8, spoiler: "none", glow: -1, boost: 0x6ac8ff, flag: "none",
  stats: { speed: 4, accel: 3, weight: 3, handling: 2 },
};

const isColor = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffff;

// A clean, complete look from anything (a saved one, a network message), or null if it's junk.
export function cleanLook(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const [key, opts] of Object.entries(LOOK_OPTIONS)) out[key] = opts.some(([id]) => id === raw[key]) ? raw[key] : DEFAULT_LOOK[key];
  for (const key of LOOK_COLORS) out[key] = isColor(raw[key]) ? raw[key] : key === "glow" && raw.glow === -1 ? -1 : DEFAULT_LOOK[key];
  out.number = Number.isInteger(raw.number) && raw.number >= 0 && raw.number <= 99 ? raw.number : DEFAULT_LOOK.number;
  out.stats = cleanStats(raw.stats) || { ...DEFAULT_LOOK.stats };
  return out;
}

export function cleanStats(s) {
  if (!s || typeof s !== "object") return null;
  const out = {};
  let total = 0;
  for (const k of STAT_KEYS) {
    const v = s[k];
    if (!Number.isInteger(v) || v < STAT_MIN || v > STAT_MAX) return null;
    out[k] = v;
    total += v;
  }
  return total === STAT_POINTS ? out : null;
}

// Stable text key (for caching models and portraits)
export const lookKey = (look) => (look ? JSON.stringify(look) : "");

// A random creation (the editor's 🎲 button). rnd: () => [0, 1)
export function randomLook(rnd = Math.random) {
  const pick = (key) => LOOK_OPTIONS[key][Math.floor(rnd() * LOOK_OPTIONS[key].length)][0];
  const color = () => Math.floor(rnd() * 0xffffff);
  const skins = [0xf3d3b6, 0xe2a36f, 0xc98b5c, 0x8d5a3b, 0x5a3a24, 0x7ad04a, 0x6ac8ff, 0xf5f1e6, 0xb8bcc8, 0xff8a1a];
  const look = {};
  for (const key of Object.keys(LOOK_OPTIONS)) look[key] = pick(key);
  for (const key of LOOK_COLORS) look[key] = color();
  look.skin = skins[Math.floor(rnd() * skins.length)];
  look.glow = rnd() < 0.5 ? -1 : color();
  look.number = Math.floor(rnd() * 100);
  look.stats = { ...DEFAULT_LOOK.stats };
  return look;
}
