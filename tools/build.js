#!/usr/bin/env node
// Build the single-file Spicetify extension: inline the sprite sheet and the
// animation map into src/vfdPet.js and write Extensions/vfdPet.js.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PET_DIR = path.join(ROOT, "assets", "pet");
const SRC = path.join(ROOT, "src", "vfdPet.js");
const OUT_DIR = path.join(ROOT, "Extensions");
const OUT = path.join(OUT_DIR, "vfdPet.js");
const META_PATH = path.join(PET_DIR, "animations.json");
const SHEET_PATH = path.join(PET_DIR, "spritesheet.png");

const REQUIRED = [
  "idle", "blink", "alert", "sit",
  "walkN", "walkNE", "walkE", "walkSE", "walkS", "walkSW", "walkW", "walkNW",
  "sleep", "tired", "scratchSelf", "scratchWallN", "scratchWallE", "scratchWallS", "scratchWallW",
  "drag", "happy", "groom", "yawn", "stretch", "dance",
  "lieDown", "wakeUp", "getUp", "sitDown",
];

function fail(message) {
  console.error(`build: ${message}`);
  process.exit(1);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    fail(`cannot read ${path.relative(ROOT, file)}: ${err.message}`);
  }
}

function validateMeta(meta) {
  for (const key of ["frameWidth", "frameHeight", "columns", "rows"]) {
    if (!Number.isInteger(meta[key]) || meta[key] <= 0) fail(`invalid ${key}: ${meta[key]}`);
  }
  if (!meta.animations || typeof meta.animations !== "object") fail("animations is missing");
  const total = meta.columns * meta.rows;
  for (const name of REQUIRED) {
    if (!meta.animations[name]) fail(`missing animation "${name}"`);
  }
  for (const [name, data] of Object.entries(meta.animations)) {
    if (!Array.isArray(data.frames) || data.frames.length === 0) fail(`animation "${name}" has no frames`);
    if (!Number.isFinite(data.fps) || data.fps <= 0) fail(`animation "${name}" has invalid fps`);
    if (typeof data.loop !== "boolean") fail(`animation "${name}" has invalid loop`);
    if (data.durations !== undefined) {
      if (!Array.isArray(data.durations) || data.durations.length !== data.frames.length) {
        fail(`animation "${name}" needs one duration per frame (${data.frames.length})`);
      }
      if (!data.durations.every((ms) => Number.isFinite(ms) && ms > 0)) fail(`animation "${name}" has invalid durations`);
    }
    if (data.stride !== undefined && !(Number.isFinite(data.stride) && data.stride > 0)) {
      fail(`animation "${name}" has invalid stride: ${data.stride}`);
    }
    for (const [col, row] of data.frames) {
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= meta.columns || row >= meta.rows) {
        fail(`animation "${name}" has out-of-range frame [${col},${row}]`);
      }
      if (row * meta.columns + col >= total) fail(`animation "${name}" frame [${col},${row}] is outside the sheet`);
    }
  }
}

function pngSize(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") fail("spritesheet.png is not a PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length };
}

function main() {
  const meta = readJson(META_PATH);
  validateMeta(meta);
  const png = pngSize(SHEET_PATH);
  const expectedW = meta.columns * meta.frameWidth;
  const expectedH = meta.rows * meta.frameHeight;
  if (png.width !== expectedW || png.height !== expectedH) {
    fail(`sheet is ${png.width}x${png.height}, expected ${expectedW}x${expectedH}`);
  }

  const source = fs.readFileSync(SRC, "utf8");
  const metaMarker = "/*__SPRITE_META__*/ null";
  const uriMarker = '/*__SPRITE_URI__*/ ""';
  if (!source.includes(metaMarker)) fail(`marker not found: ${metaMarker}`);
  if (!source.includes(uriMarker)) fail(`marker not found: ${uriMarker}`);

  const dataUri = `data:image/png;base64,${fs.readFileSync(SHEET_PATH).toString("base64")}`;
  const built = source
    .replace(metaMarker, JSON.stringify(meta))
    .replace(uriMarker, JSON.stringify(dataUri));

  if (built.includes("__SPRITE_META__") || built.includes("__SPRITE_URI__")) {
    fail("unreplaced build marker remains in output");
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, built, "utf8");

  const outBytes = fs.statSync(OUT).size;
  const frameCount = new Set(Object.values(meta.animations).flatMap((data) => data.frames.map((f) => f.join(",")))).size;
  const budget = 300 * 1024;
  console.log(`sheet: ${png.width}x${png.height} (${png.bytes} B)`);
  console.log(`frames: ${frameCount} in ${Object.keys(meta.animations).length} animations`);
  console.log(`extension: ${path.relative(ROOT, OUT)} (${outBytes} B, budget ${budget} B)`);
  if (outBytes > budget) fail(`extension is over budget: ${outBytes} > ${budget}`);
  if (!fs.existsSync(path.join(ROOT, "assets", "preview", "preview.png"))) {
    console.warn("build: assets/preview/preview.png is missing");
  }
}

main();
