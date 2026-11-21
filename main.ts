// SOLMARA — a travel poster for a place that isn't there.
// Deterministic Node stdlib renderer: hand-rolled canvas + PNG encoder.
// Run: node main.ts  ->  writes /output/entry.png (1024x1024, <= 1 MiB).

import * as zlib from "node:zlib";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

const W = 1024;
const H = 1024;
const HORIZON = 650;

type RGB = [number, number, number];

const buf = new Uint8Array(W * H * 3);

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function setPx(x: number, y: number, c: RGB): void {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = c[0];
  buf[i + 1] = c[1];
  buf[i + 2] = c[2];
}

function blendPx(x: number, y: number, c: RGB, a: number): void {
  if (x < 0 || x >= W || y < 0 || y >= H || a <= 0) return;
  if (a >= 1) {
    setPx(x, y, c);
    return;
  }
  const i = (y * W + x) * 3;
  buf[i] = clamp255(buf[i] * (1 - a) + c[0] * a);
  buf[i + 1] = clamp255(buf[i + 1] * (1 - a) + c[1] * a);
  buf[i + 2] = clamp255(buf[i + 2] * (1 - a) + c[2] * a);
}

function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(W, Math.round(x + w));
  const y1 = Math.min(H, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      setPx(xx, yy, c);
    }
  }
}

function hline(x0: number, x1: number, y: number, c: RGB, a: number): void {
  const xa = Math.round(Math.min(x0, x1));
  const xb = Math.round(Math.max(x0, x1));
  const yy = Math.round(y);
  for (let x = xa; x <= xb; x++) blendPx(x, yy, c, a);
}

// Bresenham with INTEGER endpoints only (fractional endpoints smear strokes).
function line(x0: number, y0: number, x1: number, y1: number, c: RGB, a: number): void {
  let ax = Math.round(x0);
  let ay = Math.round(y0);
  const bx = Math.round(x1);
  const by = Math.round(y1);
  const dx = Math.abs(bx - ax);
  const dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    blendPx(ax, ay, c, a);
    if (ax === bx && ay === by) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      ax += sx;
    }
    if (e2 <= dx) {
      err += dx;
      ay += sy;
    }
  }
}

function fillCircle(cx: number, cy: number, r: number, c: RGB, a: number): void {
  const rr = Math.round(r);
  const ccx = Math.round(cx);
  const ccy = Math.round(cy);
  for (let y = ccy - rr; y <= ccy + rr; y++) {
    const dy = y - ccy;
    const half = Math.floor(Math.sqrt(Math.max(0, rr * rr - dy * dy)));
    for (let x = ccx - half; x <= ccx + half; x++) {
      blendPx(x, y, c, a);
    }
  }
}

function fillTriangle(
  x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB, a: number
): void {
  const xs = [Math.round(x0), Math.round(x1), Math.round(x2)];
  const ys = [Math.round(y0), Math.round(y1), Math.round(y2)];
  const minY = Math.max(0, Math.min(ys[0], ys[1], ys[2]));
  const maxY = Math.min(H - 1, Math.max(ys[0], ys[1], ys[2]));
  for (let y = minY; y <= maxY; y++) {
    const pts: number[] = [];
    for (let e = 0; e < 3; e++) {
      const ax = xs[e];
      const ay = ys[e];
      const bx = xs[(e + 1) % 3];
      const by = ys[(e + 1) % 3];
      if ((ay <= y && by > y) || (by <= y && ay > y)) {
        pts.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
      }
    }
    if (pts.length < 2) continue;
    const xa = Math.round(Math.min(pts[0], pts[1]));
    const xb = Math.round(Math.max(pts[0], pts[1]));
    for (let x = xa; x <= xb; x++) blendPx(x, y, c, a);
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mix(c1: RGB, c2: RGB, t: number): RGB {
  return [
    clamp255(lerp(c1[0], c2[0], t)),
    clamp255(lerp(c1[1], c2[1], t)),
    clamp255(lerp(c1[2], c2[2], t)),
  ];
}

// Deterministic pseudo-random (LCG) for stars and ripples.
let seed = 20261121;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

// ---------------------------------------------------------------- sky
const SKY_STOPS: Array<[number, RGB]> = [
  [0, [43, 26, 78]], // deep violet
  [260, [110, 52, 110]], // magenta dusk
  [470, [198, 82, 76]], // rose
  [650, [245, 165, 74]], // warm sunset orange at the horizon
];

function skyAt(y: number): RGB {
  for (let i = 0; i < SKY_STOPS.length - 1; i++) {
    const [y0, c0] = SKY_STOPS[i];
    const [y1, c1] = SKY_STOPS[i + 1];
    if (y >= y0 && y <= y1) return mix(c0, c1, (y - y0) / (y1 - y0));
  }
  return SKY_STOPS[SKY_STOPS.length - 1][1];
}

for (let y = 0; y < HORIZON; y++) {
  const c = skyAt(y);
  for (let x = 0; x < W; x++) setPx(x, y, c);
}

// faint stars in the upper violet sky
for (let i = 0; i < 46; i++) {
  const sx = Math.floor(rnd() * W);
  const sy = Math.floor(rnd() * 250);
  const a = 0.25 + rnd() * 0.45;
  setPx(sx, sy, mix(skyAt(sy), [247, 234, 208], a));
  if (rnd() > 0.6) setPx(sx + 1, sy, mix(skyAt(sy), [247, 234, 208], a * 0.7));
}

// ------------------------------------------------- second sun (upper right)
const MOON: RGB = [253, 243, 208];
fillCircle(880, 300, 72, [253, 243, 208], 0.14); // soft halo
fillCircle(880, 300, 62, [253, 243, 208], 0.25);
fillCircle(880, 300, 52, MOON, 1);

// ------------------------------------------------------------- headlands
const HEADLAND: RGB = [36, 22, 64];
fillTriangle(0, HORIZON, 112, 606, 292, HORIZON, HEADLAND, 1);
fillTriangle(1024, HORIZON, 918, 612, 758, HORIZON, HEADLAND, 1);

// ---------------------------------------------------------------- water
const WATER_TOP: RGB = [47, 138, 148];
const WATER_BOT: RGB = [23, 78, 92];
for (let y = HORIZON; y < H; y++) {
  const c = mix(WATER_TOP, WATER_BOT, (y - HORIZON) / (H - HORIZON));
  for (let x = 0; x < W; x++) setPx(x, y, c);
}

// golden reflection path under the ring / sun
const GOLD: RGB = [240, 190, 90];
for (let y = HORIZON + 6; y < 1005; y += 2) {
  const t = (y - HORIZON) / 350;
  const w =
    58 + 42 * Math.sin((y - HORIZON) * 0.045) + 16 * Math.sin((y - HORIZON) * 0.11 + 1.7);
  const a = 0.55 * (1 - t * 0.55);
  hline(512 - w, 512 + w, y, GOLD, a);
  hline(512 - w * 0.55, 512 + w * 0.55, y + 1, [250, 214, 130], a * 0.7);
}

// thin ripple lines
for (let i = 0; i < 42; i++) {
  const ry = HORIZON + 18 + Math.floor(rnd() * 330);
  const rx = Math.floor(rnd() * (W - 200));
  const len = 40 + Math.floor(rnd() * 130);
  hline(rx, rx + len, ry, [150, 205, 205], 0.28 + rnd() * 0.2);
}

// ------------------------------------------------------------ stone ring
const RING_CX = 512;
const RING_CY = 432;
const R_OUT = 215;
const R_IN = 138;
for (let y = RING_CY - R_OUT; y <= RING_CY + R_OUT; y++) {
  for (let x = RING_CX - R_OUT; x <= RING_CX + R_OUT; x++) {
    const dx = x - RING_CX;
    const dy = y - RING_CY;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < R_IN || d > R_OUT) continue;
    const t = (d - R_IN) / (R_OUT - R_IN);
    let b = 1.0 - 0.22 * (dy / R_OUT); // sunlit top, shaded bottom
    if (t < 0.15) b *= 0.72 + 0.28 * (t / 0.15); // dark inner rim
    if (t > 0.9) b *= 0.92; // soft outer edge
    const base: RGB = [206, 164, 110];
    setPx(x, y, [
      clamp255(base[0] * b),
      clamp255(base[1] * b),
      clamp255(base[2] * b),
    ]);
  }
}
// thin darker outline on the ring's inner edge for definition
for (let aDeg = 0; aDeg < 360; aDeg += 1) {
  const a = (aDeg * Math.PI) / 180;
  const x = Math.round(RING_CX + (R_IN + 1) * Math.cos(a));
  const y = Math.round(RING_CY + (R_IN + 1) * Math.sin(a));
  blendPx(x, y, [120, 88, 58], 0.5);
}

// ------------------------------------------------- setting sun (in the ring)
const SUN_CX = 512;
const SUN_CY = 540;
const SUN_R = 110;
for (let y = SUN_CY - SUN_R; y <= SUN_CY + SUN_R; y++) {
  const dy = y - SUN_CY;
  const half = Math.floor(Math.sqrt(Math.max(0, SUN_R * SUN_R - dy * dy)));
  for (let x = SUN_CX - half; x <= SUN_CX + half; x++) {
    const d = Math.sqrt((x - SUN_CX) * (x - SUN_CX) + dy * dy) / SUN_R;
    const c = mix([255, 233, 168], [246, 168, 60], d);
    setPx(x, y, c);
  }
}

// -------------------------------------------------------------- sailboats
function sailboat(cx: number, cy: number, s: number): void {
  const HULL: RGB = [28, 35, 64];
  const SAIL: RGB = [250, 246, 236];
  // hull (trapezoid)
  fillTriangle(cx - 38 * s, cy, cx + 38 * s, cy, cx + 27 * s, cy + 14 * s, HULL, 1);
  fillTriangle(cx - 38 * s, cy, cx - 27 * s, cy + 14 * s, cx + 27 * s, cy + 14 * s, HULL, 1);
  // mast
  line(cx, cy - 52 * s, cx, cy, HULL, 1);
  // sails: two white triangles either side of the mast
  fillTriangle(cx - 3, cy - 50 * s, cx - 3, cy - 6, cx - 33 * s, cy - 6, SAIL, 1);
  fillTriangle(cx + 3, cy - 50 * s, cx + 3, cy - 6, cx + 30 * s, cy - 6, SAIL, 1);
}
sailboat(265, 815, 1.0);
sailboat(765, 890, 1.15);

// ----------------------------------------------------------------- birds
const BIRD: RGB = [29, 18, 56];
function bird(x: number, y: number, s: number): void {
  line(x - 11 * s, y + 5 * s, x, y, BIRD, 1);
  line(x, y, x + 11 * s, y + 5 * s, BIRD, 1);
  line(x - 11 * s, y + 6 * s, x, y + 1, BIRD, 1);
  line(x, y + 1, x + 11 * s, y + 6 * s, BIRD, 1);
}
bird(268, 300, 1);
bird(332, 342, 0.8);
bird(700, 252, 1);
bird(748, 272, 0.85);

// ------------------------------------------------------- bitmap font: SOLMARA
const GLYPHS: Record<string, string[]> = {
  S: [
    "0111100",
    "1000001",
    "1000000",
    "1000000",
    "0111100",
    "0000001",
    "0000001",
    "1000001",
    "0111100",
  ],
  O: [
    "0111100",
    "1000001",
    "1000001",
    "1000001",
    "1000001",
    "1000001",
    "1000001",
    "1000001",
    "0111100",
  ],
  L: [
    "1000000",
    "1000000",
    "1000000",
    "1000000",
    "1000000",
    "1000000",
    "1000000",
    "1000000",
    "1111111",
  ],
  M: [
    "1000001",
    "1100011",
    "1010101",
    "1010101",
    "1001001",
    "1000001",
    "1000001",
    "1000001",
    "1000001",
  ],
  A: [
    "0001000",
    "0010100",
    "0100010",
    "1000001",
    "1000001",
    "1111111",
    "1000001",
    "1000001",
    "1000001",
  ],
  R: [
    "1111100",
    "1000001",
    "1000001",
    "1000001",
    "1111100",
    "1010000",
    "1001000",
    "1000100",
    "1000010",
  ],
};

const CELL = 12;
const LETTER_W = 7 * CELL; // 84
const LETTER_H = 9 * CELL; // 108
const GAP = 16;
const NAME = "SOLMARA";
const NAME_W = NAME.length * LETTER_W + (NAME.length - 1) * GAP; // 684
const NAME_X = Math.round((W - NAME_W) / 2); // 170
const NAME_Y = 62;
const CREAM: RGB = [247, 234, 208];
const SHADOW: RGB = [29, 18, 56];

function drawName(x0: number, y0: number, c: RGB): void {
  for (let li = 0; li < NAME.length; li++) {
    const g = GLYPHS[NAME[li]];
    const gx = x0 + li * (LETTER_W + GAP);
    for (let r = 0; r < 9; r++) {
      for (let col = 0; col < 7; col++) {
        if (g[r][col] === "1") {
          fillRect(gx + col * CELL, y0 + r * CELL, CELL, CELL, c);
        }
      }
    }
  }
}
drawName(NAME_X + 7, NAME_Y + 9, SHADOW); // drop shadow
drawName(NAME_X, NAME_Y, CREAM);

// thin gold rule under the name
fillRect(NAME_X, NAME_Y + LETTER_H + 16, NAME_W, 4, [217, 164, 65]);

// ------------------------------------------------------------ cream border
const B: RGB = [242, 230, 200];
const INSET = 28;
const BT = 3;
fillRect(INSET, INSET, W - 2 * INSET, BT, B);
fillRect(INSET, H - INSET - BT, W - 2 * INSET, BT, B);
fillRect(INSET, INSET, BT, H - 2 * INSET, B);
fillRect(W - INSET - BT, INSET, BT, H - 2 * INSET, B);

// ------------------------------------------------------------ PNG encoding
const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 3)] = 0; // filter: none
  Buffer.from(buf.buffer, y * W * 3, W * 3).copy(raw, y * (1 + W * 3) + 1);
}
const idat = zlib.deflateSync(raw, { level: 9 });
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type RGB
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

fs.mkdirSync("/output", { recursive: true });
fs.writeFileSync("/output/entry.png", png);
fs.writeFileSync("/tmp/entry-check.png", png);
const sha = createHash("sha256").update(png).digest("hex");
console.log(`wrote /output/entry.png  ${png.length} bytes  sha256=${sha}`);
