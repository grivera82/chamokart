// Share card: a 1080×1080 picture of a result (a race win, a cup, a record lap) to post in the
// group chat. It draws a snapshot of the race, the player's racer, the result, the track map
// and the game's address.
const SIZE = 1080;

const loadImage = (src) =>
  new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

// Shrink the font until the text fits in maxW.
function fitText(g, text, family, size, maxW, weight = "") {
  let s = size;
  do g.font = `${weight} ${s}px ${family}`;
  while (g.measureText(text).width > maxW && (s -= 4) > 16);
  return s;
}

function outlined(g, text, x, y, fill, stroke, width) {
  g.lineJoin = "round";
  g.lineWidth = width;
  g.strokeStyle = stroke;
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
}

/**
 * card: { shot (data URL of the race), portrait (data URL), map (canvas), accent (css colour),
 *         title ("YOU WIN!"), big ("1st" or "1:23.456"), sub ("Mars Aliens · 150cc"),
 *         badge (optional, "#2 in the world"), name (the player's name) }
 * Resolves with a PNG Blob.
 */
export async function drawShareCard(card) {
  await document.fonts?.load?.("80px 'Lilita One'").catch?.(() => {});
  const c = document.createElement("canvas");
  c.width = c.height = SIZE;
  const g = c.getContext("2d");
  const display = "'Lilita One', 'Arial Black', Impact, sans-serif";
  const body = "Nunito, system-ui, sans-serif";
  const [shot, portrait] = await Promise.all([loadImage(card.shot), loadImage(card.portrait)]);

  // Background: the race snapshot, cropped to a square, darkened towards the bottom
  g.fillStyle = "#1d1530";
  g.fillRect(0, 0, SIZE, SIZE);
  if (shot) {
    const s = Math.max(SIZE / shot.width, SIZE / shot.height);
    const w = shot.width * s, h = shot.height * s;
    g.drawImage(shot, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
  }
  const shade = g.createLinearGradient(0, 0, 0, SIZE);
  shade.addColorStop(0, "rgba(20,8,40,0.55)");
  shade.addColorStop(0.35, "rgba(20,8,40,0.1)");
  shade.addColorStop(0.55, "rgba(20,8,40,0.35)");
  shade.addColorStop(1, "rgba(20,8,40,0.92)");
  g.fillStyle = shade;
  g.fillRect(0, 0, SIZE, SIZE);

  // Logo (like the title screen): yellow KART over a red CHAOS plate
  g.save();
  g.translate(70, 60);
  g.rotate(-0.05);
  g.textBaseline = "top";
  g.font = `92px ${display}`;
  outlined(g, "KART", 18, 0, "#ffd23f", "#1d1530", 14);
  g.font = `70px ${display}`;
  const plate = g.measureText("CHAOS").width + 56;
  g.fillStyle = "#e23b3b";
  g.strokeStyle = "#1d1530";
  g.lineWidth = 8;
  roundRect(g, 10, 96, plate, 84, 16);
  g.fill();
  g.stroke();
  outlined(g, "CHAOS", 38, 102, "#fff", "#1d1530", 10);
  g.restore();

  // Track map, top right
  if (card.map) {
    const w = 300, h = 230, x = SIZE - w - 60, y = 60;
    g.save();
    g.shadowColor = "rgba(0,0,0,0.45)";
    g.shadowBlur = 24;
    roundRect(g, x, y, w, h, 22);
    g.fillStyle = "#fff";
    g.fill();
    g.restore();
    g.save();
    roundRect(g, x + 6, y + 6, w - 12, h - 12, 18);
    g.clip();
    g.drawImage(card.map, x + 6, y + 6, w - 12, h - 12);
    g.restore();
  }

  // The racer, on a white card, bottom left
  const px = 60, py = SIZE - 540, ps = 330;
  g.save();
  g.shadowColor = "rgba(0,0,0,0.5)";
  g.shadowBlur = 30;
  roundRect(g, px, py, ps, ps, 40);
  g.fillStyle = card.accent || "#ffd23f";
  g.fill();
  g.restore();
  g.lineWidth = 10;
  g.strokeStyle = "#1d1530";
  roundRect(g, px, py, ps, ps, 40);
  g.stroke();
  if (portrait) g.drawImage(portrait, px + 10, py + 10, ps - 20, ps - 20);
  if (card.name) {
    g.textAlign = "center";
    g.textBaseline = "middle";
    const s = fitText(g, card.name, body, 42, ps - 70, "900");
    roundRect(g, px + 20, py + ps - 34, ps - 40, s + 24, 16);
    g.fillStyle = "#1d1530";
    g.fill();
    g.fillStyle = "#fff";
    g.fillText(card.name, px + ps / 2, py + ps - 34 + (s + 24) / 2 + 2);
  }

  // The result, to the right of the racer
  const tx = px + ps + 50, tw = SIZE - tx - 60;
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  fitText(g, card.title, display, 84, tw);
  outlined(g, card.title, tx, py + 90, "#ffd23f", "#1d1530", 14);
  fitText(g, card.big, display, 170, tw);
  outlined(g, card.big, tx, py + 250, "#fff", "#1d1530", 18);
  if (card.badge) {
    g.font = `800 38px ${body}`;
    const bw = Math.min(tw, g.measureText(card.badge).width + 44);
    roundRect(g, tx, py + 280, bw, 58, 29);
    g.fillStyle = "#e23b3b";
    g.fill();
    g.fillStyle = "#fff";
    g.textBaseline = "middle";
    g.fillText(card.badge, tx + 22, py + 311, tw - 44);
    g.textBaseline = "alphabetic";
  }

  // Footer: where it happened, and where to play
  g.textAlign = "left";
  const sub = card.sub || "";
  fitText(g, sub, body, 44, SIZE - 120, "800");
  g.fillStyle = "rgba(255,255,255,0.92)";
  g.fillText(sub, 60, SIZE - 88);
  g.font = `800 34px ${body}`;
  g.fillStyle = "#ffd23f";
  g.fillText("kartchaos.com  ·  Can you beat me?", 60, SIZE - 40);

  return new Promise((resolve) => c.toBlob(resolve, "image/png"));
}
