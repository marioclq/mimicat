const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_SETTINGS,
  VARIANTS,
  clamp,
  distance,
  direction8,
  stepToward,
  clampToViewport,
  normalizeRect,
  pickSleepSpot,
  advanceFrame,
  pickWeighted,
  chooseIdleAction,
  pickDance,
  idleDelay,
  sanitizeSettings,
  parseStored,
  animationForDirection,
  MOTION,
  nextSpeed,
  advanceByDistance,
  frameDuration,
  animationLength,
  snapToDevice,
  isOpenDialog,
  uniqueFrameCount,
  framePosition,
  isDiagonal,
} = require("../Extensions/vfdPet.js");

test("clamp keeps values in range and turns NaN into the lower bound", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
  assert.equal(clamp(NaN, 2, 10), 2);
});

test("distance is euclidean", () => {
  assert.equal(distance(0, 0, 3, 4), 5);
  assert.equal(distance(2, 2, 2, 2), 0);
});

test("direction8 maps the eight screen octants", () => {
  assert.equal(direction8(1, 0), "E");
  assert.equal(direction8(1, 1), "SE");
  assert.equal(direction8(0, 1), "S");
  assert.equal(direction8(-1, 1), "SW");
  assert.equal(direction8(-1, 0), "W");
  assert.equal(direction8(-1, -1), "NW");
  assert.equal(direction8(0, -1), "N");
  assert.equal(direction8(1, -1), "NE");
  assert.equal(direction8(0, 0), null);
  assert.equal(direction8(10, 1), "E");
  assert.equal(direction8(1, 10), "S");
});

test("stepToward moves at most maxStep and reports arrival", () => {
  assert.deepEqual(stepToward(0, 0, 10, 0, 4), { x: 4, y: 0, distance: 10, moved: 4, arrived: false });
  assert.deepEqual(stepToward(0, 0, 10, 0, 20), { x: 10, y: 0, distance: 10, moved: 10, arrived: true });
  assert.deepEqual(stepToward(3, 4, 3, 4, 0), { x: 3, y: 4, distance: 0, moved: 0, arrived: true });
  assert.throws(() => stepToward(0, 0, 1, 1, -1), RangeError);
});

test("clampToViewport keeps the pet fully inside the window", () => {
  const viewport = { width: 100, height: 100 };
  const pet = { width: 20, height: 20 };
  assert.deepEqual(clampToViewport(50, 50, viewport, pet, 4), { x: 50, y: 50 });
  assert.deepEqual(clampToViewport(-20, 120, viewport, pet, 4), { x: 14, y: 86 });
  assert.throws(() => clampToViewport(0, 0, { width: 0, height: 100 }, pet), RangeError);
});

test("normalizeRect rejects empty and non-finite rectangles", () => {
  assert.deepEqual(normalizeRect({ left: 1, top: 2, right: 11, bottom: 22, width: 10, height: 20 }), {
    left: 1, top: 2, right: 11, bottom: 22, width: 10, height: 20,
  });
  assert.deepEqual(normalizeRect({ left: 1, top: 2, right: 11, bottom: 22 }), {
    left: 1, top: 2, right: 11, bottom: 22, width: 10, height: 20,
  });
  assert.equal(normalizeRect({ left: 1, top: 2, right: 1, bottom: 22 }), null);
  assert.equal(normalizeRect({ left: NaN, top: 2, right: 11, bottom: 22 }), null);
  assert.equal(normalizeRect(null), null);
});

const viewport = { width: 1000, height: 800 };
const pet = { width: 64, height: 64 };

test("pickSleepSpot prefers Full App Display", () => {
  const spot = pickSleepSpot({
    viewport,
    pet,
    fullAppDisplay: { left: 100, top: 100, right: 500, bottom: 120, width: 400, height: 20 },
    progressBar: { left: 100, top: 700, right: 900, bottom: 710, width: 800, height: 10 },
  });
  assert.equal(spot.source, "fad");
  assert.equal(spot.x, 500 - 32);
  assert.equal(spot.y, 100 - 32 - 2);
});

test("pickSleepSpot sleeps on the progress bar and resolves the time labels", () => {
  const base = {
    viewport,
    pet,
    progressBar: { left: 100, top: 700, right: 900, bottom: 710, width: 800, height: 10 },
  };
  const plain = pickSleepSpot(base);
  assert.equal(plain.source, "progress");
  assert.equal(plain.x, 900 - 32);
  assert.equal(plain.y, 700 - 32 + 2);

  const withTime = pickSleepSpot({
    ...base,
    remainingTime: { left: 850, top: 688, right: 890, bottom: 704, width: 40, height: 16 },
  });
  assert.equal(withTime.source, "progress-time");
  assert.equal(withTime.x, 850 - 32);

  const withElapsed = pickSleepSpot({
    ...base,
    remainingTime: { left: 850, top: 688, right: 890, bottom: 704, width: 40, height: 16 },
    elapsedTime: { left: 700, top: 688, right: 830, bottom: 704, width: 130, height: 16 },
  });
  assert.equal(withElapsed.x, 700 - 32);
});

test("pickSleepSpot falls back to the couch when the player bar is absent", () => {
  const spot = pickSleepSpot({ viewport, pet, reserveBottom: 90 });
  assert.equal(spot.source, "couch");
  assert.equal(spot.x, 1000 - 32 - 16);
  assert.equal(spot.y, 800 - 90 - 32);
  assert.throws(() => pickSleepSpot({ viewport: { width: 0, height: 0 }, pet }), RangeError);
});

test("advanceFrame loops or stops on the last frame", () => {
  assert.equal(advanceFrame(0, 3, true), 1);
  assert.equal(advanceFrame(2, 3, true), 0);
  assert.equal(advanceFrame(0, 3, false), 1);
  assert.equal(advanceFrame(2, 3, false), 2);
  assert.equal(advanceFrame(-1, 3, true), 0);
  assert.throws(() => advanceFrame(0, 0, true), RangeError);
});

test("pickWeighted respects weights and boundaries", () => {
  const items = [{ name: "a", weight: 1 }, { name: "b", weight: 3 }];
  assert.equal(pickWeighted(() => 0, items).name, "a");
  assert.equal(pickWeighted(() => 0.25, items).name, "b");
  assert.equal(pickWeighted(() => 1, items).name, "b");
  assert.throws(() => pickWeighted(() => 0, []), RangeError);
  assert.throws(() => pickWeighted(() => 0, [{ name: "a", weight: 0 }]), RangeError);
});

test("chooseIdleAction can exclude sleep", () => {
  for (const r of [0, 0.1, 0.5, 0.9, 0.999]) {
    const action = chooseIdleAction(() => r, { allowSleep: false });
    assert.notEqual(action, "sleep");
    assert.ok(["sit", "groom", "yawn", "stretch", "scratchSelf", "idle"].includes(action));
  }
});

test("idleDelay stays inside its bounds", () => {
  assert.equal(idleDelay(() => 0, 1000, 2000), 1000);
  assert.equal(idleDelay(() => 1, 1000, 2000), 2000);
  assert.throws(() => idleDelay(() => 0, 2000, 1000), RangeError);
});

test("sanitizeSettings merges, clamps and drops unknown values", () => {
  const clean = sanitizeSettings({
    variant: "noche",
    scale: 1.6,
    speed: 1,
    follow: false,
    sleepOnBar: "yes",
    nonsense: true,
  });
  assert.equal(clean.variant, "noche");
  assert.equal(clean.scale, 1.5);
  assert.equal(clean.speed, 40);
  assert.equal(clean.follow, false);
  assert.equal(clean.sleepOnBar, true);
  assert.equal("nonsense" in clean, false);
  assert.deepEqual(sanitizeSettings(null), { ...DEFAULT_SETTINGS });
  assert.equal(sanitizeSettings({ variant: "desconocido" }).variant, "miel");
  assert.equal(sanitizeSettings({ scale: 99 }).scale, 3);
});

test("parseStored returns a fallback on invalid JSON or type mismatch", () => {
  assert.deepEqual(parseStored('{"a":1}', null), { a: 1 });
  assert.equal(parseStored('"hola"', "fallback"), "hola");
  assert.equal(parseStored("42", "fallback"), "fallback");
  assert.equal(parseStored("no-json", "fallback"), "fallback");
  assert.equal(parseStored("", "fallback"), "fallback");
  assert.equal(parseStored(null, "fallback"), "fallback");
});

test("animationForDirection only walks for known directions", () => {
  for (const dir of ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]) {
    assert.equal(animationForDirection(dir, true), `walk${dir}`);
  }
  assert.equal(animationForDirection("N", false), "idle");
  assert.equal(animationForDirection("X", true), "idle");
});

test("nextSpeed eases in from rest instead of jumping to full speed", () => {
  const first = nextSpeed(0, 130, 500, 16);
  assert.ok(first > 0 && first < 130, `first frame speed ${first}`);
  let speed = 0;
  for (let i = 0; i < 60; i += 1) speed = nextSpeed(speed, 130, 500, 16);
  assert.equal(speed, 130);
});

test("nextSpeed brakes before the target but never crawls below minSpeed", () => {
  const far = nextSpeed(130, 130, 400, 16);
  const near = nextSpeed(130, 130, 4, 16);
  assert.equal(far, 130);
  assert.ok(near < 130, `near speed ${near}`);
  let speed = 130;
  for (let i = 0; i < 60; i += 1) speed = nextSpeed(speed, 130, 0, 16);
  assert.equal(speed, MOTION.minSpeed);
  assert.throws(() => nextSpeed(0, 130, NaN, 16), RangeError);
});

test("advanceByDistance steps the walk cycle by distance, not time", () => {
  assert.deepEqual(advanceByDistance(0, 0, 0, 16, 4), { frame: 0, carry: 0 });
  assert.deepEqual(advanceByDistance(0, 10, 10, 16, 4), { frame: 1, carry: 4 });
  assert.deepEqual(advanceByDistance(3, 0, 32, 16, 4), { frame: 1, carry: 0 });
  assert.deepEqual(advanceByDistance(2, 5, -3, 16, 4), { frame: 2, carry: 5 });
  assert.throws(() => advanceByDistance(0, 0, 10, 0, 4), RangeError);
});

test("frame durations override fps and add up to the animation length", () => {
  const timed = { frames: [[0, 0], [1, 0]], fps: 4, durations: [2600, 150] };
  const plain = { frames: [[0, 0], [1, 0], [2, 0]], fps: 4 };
  assert.equal(frameDuration(timed, 0), 2600);
  assert.equal(frameDuration(plain, 2), 250);
  assert.equal(animationLength(timed), 2750);
  assert.equal(animationLength(plain), 750);
});

test("snapToDevice rounds to physical pixels", () => {
  assert.equal(snapToDevice(10.3, 1), 10);
  assert.equal(snapToDevice(10.3, 2), 10.5);
  assert.ok(Math.abs(snapToDevice(10.6, 1.5) - 32 / 3) < 1e-9);
  assert.equal(snapToDevice(10.6, undefined), 11);
});

test("pickDance chooses among every dance in the sheet", () => {
  const animations = { idle: {}, dance: {}, danceJump: {}, walkE: {} };
  assert.equal(pickDance(() => 0, animations), "dance");
  assert.equal(pickDance(() => 0.99, animations), "danceJump");
  assert.throws(() => pickDance(() => 0, { idle: {} }), RangeError);
});

test("isOpenDialog ignores closed dialogs that Spotify keeps in the DOM", () => {
  assert.equal(isOpenDialog({ width: 0, height: 0 }, "visible"), false);
  assert.equal(isOpenDialog({ width: 480, height: 300 }, "hidden"), false);
  assert.equal(isOpenDialog({ width: 480, height: 300 }, "visible"), true);
  assert.equal(isOpenDialog(null, "visible"), false);
});

test("uniqueFrameCount counts shared frames once", () => {
  const animations = {
    idle: { frames: [[0, 0], [1, 0], [0, 0]] },
    walkW: { frames: [[1, 0], [2, 0]] },
  };
  assert.equal(uniqueFrameCount(animations), 3);
  assert.equal(uniqueFrameCount({}), 0);
});

test("framePosition scales the sprite sheet offsets", () => {
  assert.deepEqual(framePosition(2, 3, 64, 64, 1), { x: -128, y: -192 });
  assert.deepEqual(framePosition(2, 3, 64, 64, 1.5), { x: -192, y: -288 });
});

test("isDiagonal recognises only the four diagonal directions", () => {
  for (const dir of ["NE", "SE", "SW", "NW"]) assert.equal(isDiagonal(dir), true);
  for (const dir of ["N", "E", "S", "W", ""]) assert.equal(isDiagonal(dir), false);
});

test("public defaults stay immutable", () => {
  assert.equal(Object.isFrozen(DEFAULT_SETTINGS), true);
  assert.equal(Object.isFrozen(VARIANTS), true);
  assert.deepEqual(Object.keys(VARIANTS), ["miel", "noche", "menta", "fresa"]);
});
