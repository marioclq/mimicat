const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PET = path.join(ROOT, "assets", "pet");
const meta = JSON.parse(fs.readFileSync(path.join(PET, "animations.json"), "utf8"));
const sheet = fs.readFileSync(path.join(PET, "spritesheet.png"));
const built = fs.readFileSync(path.join(ROOT, "Extensions", "vfdPet.js"), "utf8");
const source = fs.readFileSync(path.join(ROOT, "src", "vfdPet.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

const REQUIRED = [
  "idle", "blink", "alert", "sit",
  "walkN", "walkNE", "walkE", "walkSE", "walkS", "walkSW", "walkW", "walkNW",
  "sleep", "tired", "scratchSelf", "scratchWallN", "scratchWallE", "scratchWallS", "scratchWallW",
  "drag", "happy", "groom", "yawn", "stretch", "dance",
];

function pngInfo(buffer) {
  assert.equal(buffer.toString("ascii", 1, 4), "PNG");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25],
  };
}

test("sprite sheet is an 80x80 grid with transparency", () => {
  const info = pngInfo(sheet);
  assert.equal(meta.frameWidth, 80);
  assert.equal(meta.frameHeight, 80);
  assert.equal(info.width, meta.columns * meta.frameWidth);
  assert.equal(info.height, meta.rows * meta.frameHeight);
  const rgba = info.colorType === 6;
  const indexedWithAlpha = info.colorType === 3 && sheet.includes(Buffer.from("tRNS"));
  assert.ok(rgba || indexedWithAlpha, `PNG colour type ${info.colorType} has no alpha`);
});

test("animation map covers the required animations and the pose transitions", () => {
  for (const name of [...REQUIRED, "lieDown", "wakeUp", "getUp", "sitDown", "danceJump"]) {
    const data = meta.animations[name];
    assert.ok(data, `missing ${name}`);
    assert.ok(data.frames.length > 0, `${name} has no frames`);
    assert.ok(data.fps > 0, `${name} has no fps`);
    assert.equal(typeof data.loop, "boolean");
  }
});

test("every frame is in range and the sheet has no unused rows", () => {
  const seen = new Set();
  for (const [name, data] of Object.entries(meta.animations)) {
    for (const [col, row] of data.frames) {
      assert.ok(Number.isInteger(col) && col >= 0 && col < meta.columns, `${name} col ${col}`);
      assert.ok(Number.isInteger(row) && row >= 0 && row < meta.rows, `${name} row ${row}`);
      seen.add(row * meta.columns + col);
    }
  }
  // Frames are shared between animations; cells are packed from the top-left.
  assert.ok(seen.size > (meta.rows - 1) * meta.columns, `only ${seen.size} cells used in ${meta.rows} rows`);
  assert.equal(Math.max(...seen), seen.size - 1, "used cells must be contiguous from the first one");
});

test("walk cycles advance by stride and timed animations have one duration per frame", () => {
  for (const [name, data] of Object.entries(meta.animations)) {
    if (name.startsWith("walk")) assert.ok(data.stride > 0, `${name} has no stride`);
    if (data.durations !== undefined) {
      assert.equal(data.durations.length, data.frames.length, `${name} durations`);
      assert.ok(data.durations.every((ms) => ms > 0), `${name} has a non-positive duration`);
    }
  }
});

test("walking east and west use different (mirrored) frames", () => {
  const key = (name) => JSON.stringify(meta.animations[name].frames);
  assert.notEqual(key("walkE"), key("walkW"));
  assert.equal(key("walkNE"), key("walkE"));
  assert.equal(key("walkSE"), key("walkE"));
  assert.equal(key("walkNW"), key("walkW"));
  assert.equal(key("walkSW"), key("walkW"));
});

test("walking up and down have their own back and front views", () => {
  const key = (name) => JSON.stringify(meta.animations[name].frames);
  for (const side of ["walkE", "walkW"]) {
    assert.notEqual(key("walkN"), key(side));
    assert.notEqual(key("walkS"), key(side));
  }
  assert.notEqual(key("walkN"), key("walkS"));
});

test("build inlines the exact sprite sheet and leaves no placeholders", () => {
  assert.match(built, /data:image\/png;base64,/);
  assert.equal(built.includes("__SPRITE_META__"), false);
  assert.equal(built.includes("__SPRITE_URI__"), false);
  assert.match(source, /\/\*__SPRITE_META__\*\/ null/);
  assert.match(source, /\/\*__SPRITE_URI__\*\/ ""/);
  const match = built.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
  assert.ok(match, "base64 data URI not found");
  const decoded = Buffer.from(match[1], "base64");
  assert.equal(decoded.equals(sheet), true, "inlined PNG differs from assets/pet/spritesheet.png");
});

test("extension stays inside the 300 KiB budget", () => {
  assert.ok(Buffer.byteLength(built) < 300 * 1024, `extension is ${Buffer.byteLength(built)} B`);
});

test("manifest points at real files and has Marketplace metadata", () => {
  assert.equal(manifest.name, "VFD Pet");
  assert.ok(manifest.description.length > 20);
  assert.ok(Array.isArray(manifest.tags) && manifest.tags.length >= 3);
  for (const key of ["main", "preview", "readme"]) {
    assert.ok(fs.existsSync(path.join(ROOT, manifest[key])), `${key} does not exist: ${manifest[key]}`);
  }
  assert.equal(manifest.main, "Extensions/vfdPet.js");
});

test("preview images exist with the expected formats", () => {
  const png = fs.readFileSync(path.join(ROOT, "assets", "preview", "preview.png"));
  const info = pngInfo(png);
  assert.equal(info.width, 640);
  assert.equal(info.height, 360);
  const gif = fs.readFileSync(path.join(ROOT, "assets", "preview", "preview.gif"));
  assert.equal(gif.toString("ascii", 0, 6), "GIF89a");
  const contact = pngInfo(fs.readFileSync(path.join(PET, "contact-sheet.png")));
  assert.equal(contact.width, 640);
  assert.ok(contact.height > 0);
});

test("license and attribution notices are present", () => {
  const license = fs.readFileSync(path.join(ROOT, "LICENSE"), "utf8");
  const notice = fs.readFileSync(path.join(ROOT, "LICENSE-NOTICE.md"), "utf8");
  assert.match(license, /MIT License/);
  assert.match(license, /Permission is hereby granted/);
  assert.match(notice, /adryd/);
  assert.match(notice, /kyrie25/);
  assert.match(notice, /original/i);
});
