// VFD Pet — a high-resolution pixel cat for Spicetify.
// Source file. tools/build.js inlines the sprite sheet and animation map and
// writes the single-file extension to Extensions/vfdPet.js.
//
// The pure logic is exported (module.exports) so Node can test it without a DOM.
(function vfdPet() {
  "use strict";

  // -----------------------------------------------------------------------
  // Pure logic (tested in tests/logic.test.js)
  // -----------------------------------------------------------------------
  const DEFAULT_SETTINGS = Object.freeze({
    variant: "miel",
    scale: 1.5,
    speed: 130,
    follow: true,
    sleepOnBar: true,
    autoActions: true,
    reactToPlayer: true,
    reducedMotion: false,
  });

  const VARIANTS = Object.freeze({
    miel: { label: "Miel", filter: "none", swatch: "#f0b45e" },
    noche: { label: "Noche", filter: "grayscale(1) brightness(0.44) contrast(1.3)", swatch: "#3b3b4d" },
    menta: { label: "Menta", filter: "hue-rotate(120deg) saturate(0.78) brightness(1.04)", swatch: "#7fd8c4" },
    fresa: { label: "Fresa", filter: "hue-rotate(-38deg) saturate(1.15)", swatch: "#ef8b9b" },
  });

  const IDLE_ACTIONS = Object.freeze([
    { name: "sit", weight: 4 },
    { name: "groom", weight: 3 },
    { name: "yawn", weight: 2 },
    { name: "stretch", weight: 2 },
    { name: "scratchSelf", weight: 2 },
    { name: "sleep", weight: 2 },
    { name: "idle", weight: 3 },
  ]);

  const DIRECTIONS = Object.freeze(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);

  // px/s² and px/s. Reaches the default 130 px/s in ~0.2 s.
  const MOTION = Object.freeze({ accel: 700, decel: 520, minSpeed: 30 });

  function clamp(value, lo, hi) {
    if (!Number.isFinite(value)) return lo;
    return Math.min(hi, Math.max(lo, value));
  }

  function distance(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
  }

  function direction8(dx, dy) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
    if (dx === 0 && dy === 0) return null;
    const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
    // 0 = east, PI/2 = south (screen coordinates).
    return ["E", "SE", "S", "SW", "W", "NW", "N", "NE"][(octant + 8) % 8];
  }

  function stepToward(x, y, tx, ty, maxStep) {
    if (![x, y, tx, ty, maxStep].every(Number.isFinite) || maxStep < 0) {
      throw new RangeError(`stepToward: invalid input x=${x} y=${y} tx=${tx} ty=${ty} maxStep=${maxStep}`);
    }
    const dx = tx - x;
    const dy = ty - y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0 || dist <= maxStep) {
      return { x: tx, y: ty, distance: dist, moved: dist, arrived: true };
    }
    return {
      x: x + (dx / dist) * maxStep,
      y: y + (dy / dist) * maxStep,
      distance: dist,
      moved: maxStep,
      arrived: false,
    };
  }

  function clampToViewport(x, y, viewport, pet, pad = 4) {
    const vw = Number(viewport && viewport.width) || 0;
    const vh = Number(viewport && viewport.height) || 0;
    const pw = Number(pet && pet.width) || 0;
    const ph = Number(pet && pet.height) || 0;
    if (vw <= 0 || vh <= 0 || pw <= 0 || ph <= 0) {
      throw new RangeError(`clampToViewport: invalid viewport/pet ${JSON.stringify({ viewport, pet })}`);
    }
    const left = pw / 2 + pad;
    const right = vw - pw / 2 - pad;
    const top = ph / 2 + pad;
    const bottom = vh - ph / 2 - pad;
    return {
      x: left > right ? vw / 2 : clamp(x, left, right),
      y: top > bottom ? vh / 2 : clamp(y, top, bottom),
    };
  }

  function normalizeRect(rect) {
    if (!rect) return null;
    const left = Number(rect.left);
    const top = Number(rect.top);
    const right = Number(rect.right);
    const bottom = Number(rect.bottom);
    const width = Number.isFinite(rect.width) ? Number(rect.width) : right - left;
    const height = Number.isFinite(rect.height) ? Number(rect.height) : bottom - top;
    if (![left, top, right, bottom, width, height].every(Number.isFinite)) return null;
    if (width <= 0 || height <= 0 || right <= left || bottom <= top) return null;
    return { left, top, right, bottom, width, height };
  }

  // Sleep on the progress bar when it exists, otherwise on a safe "couch" at
  // the bottom right. Unlike the original oneko extension this never assumes
  // Spotify's DOM is present, so a theme update cannot throw here.
  function pickSleepSpot(input) {
    const viewport = (input && input.viewport) || { width: 0, height: 0 };
    const pet = (input && input.pet) || { width: 64, height: 64 };
    const reserveBottom = Number.isFinite(input && input.reserveBottom) ? input.reserveBottom : 90;
    const catW = pet.width;
    const catH = pet.height;
    const pad = Math.max(4, Math.round(catW / 4));
    const vw = Number(viewport.width);
    const vh = Number(viewport.height);
    if (!(vw > 0) || !(vh > 0)) {
      throw new RangeError(`pickSleepSpot: invalid viewport ${JSON.stringify(viewport)}`);
    }
    const fit = (x, y) => ({
      x: clamp(x, catW / 2 + pad, vw - catW / 2 - pad),
      y: clamp(y, catH / 2 + pad, vh - catH / 2 - pad),
    });

    const fad = normalizeRect(input && input.fullAppDisplay);
    if (fad) {
      const spot = fit(fad.right - catW / 2, fad.top - catH / 2 - 2);
      return { ...spot, source: "fad" };
    }

    const bar = normalizeRect(input && input.progressBar);
    if (bar) {
      let x = bar.right - catW / 2;
      let y = bar.top - catH / 2 + 2;
      const remaining = normalizeRect(input && input.remainingTime);
      const elapsed = normalizeRect(input && input.elapsedTime);
      if (remaining && remaining.left < bar.right && remaining.top < bar.bottom && bar.top - remaining.bottom < 32) {
        x = remaining.left - catW / 2;
        if (elapsed && remaining.left - elapsed.right < 32) x = elapsed.left - catW / 2;
      }
      const spot = fit(x, y);
      return { ...spot, source: remaining ? "progress-time" : "progress" };
    }

    const spot = fit(vw - catW / 2 - pad, vh - reserveBottom - catH / 2);
    return { ...spot, source: "couch" };
  }

  function advanceFrame(index, count, loop) {
    if (!Number.isInteger(count) || count <= 0) {
      throw new RangeError(`advanceFrame: invalid frame count ${count}`);
    }
    if (!Number.isFinite(index) || index < 0) return 0;
    if (loop) return (Math.floor(index) + 1) % count;
    return Math.min(Math.floor(index) + 1, count - 1);
  }

  function pickWeighted(rng, items) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new RangeError("pickWeighted: items must be a non-empty array");
    }
    let total = 0;
    for (const item of items) {
      if (!item || !Number.isFinite(item.weight) || item.weight <= 0) {
        throw new RangeError(`pickWeighted: invalid weight ${JSON.stringify(item)}`);
      }
      total += item.weight;
    }
    const r = clamp(typeof rng === "function" ? rng() : 0, 0, 0.999999999);
    let cursor = r * total;
    for (const item of items) {
      cursor -= item.weight;
      if (cursor < 0) return item;
    }
    return items[items.length - 1];
  }

  function chooseIdleAction(rng, options = {}) {
    const allowSleep = options.allowSleep !== false;
    const pool = IDLE_ACTIONS.filter((item) => allowSleep || item.name !== "sleep");
    return pickWeighted(rng, pool).name;
  }

  // "Bailar" picks one of the dances in the sheet (dance, danceJump, ...).
  function pickDance(rng, animations) {
    const names = Object.keys(animations || {}).filter((name) => /^dance/.test(name));
    if (names.length === 0) throw new RangeError("pickDance: the sheet has no dance animation");
    return pickWeighted(rng, names.map((name) => ({ name, weight: 1 }))).name;
  }

  function idleDelay(rng, min = 10000, max = 26000) {
    if (!(max >= min)) throw new RangeError(`idleDelay: max ${max} < min ${min}`);
    const r = clamp(typeof rng === "function" ? rng() : 0, 0, 0.999999999);
    return Math.round(min + r * (max - min));
  }

  function sanitizeSettings(raw, defaults = DEFAULT_SETTINGS, variants = VARIANTS) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const out = { ...defaults };
    if (typeof src.variant === "string" && Object.prototype.hasOwnProperty.call(variants, src.variant)) {
      out.variant = src.variant;
    }
    if (Number.isFinite(src.scale)) out.scale = Math.round(src.scale * 4) / 4;
    if (Number.isFinite(src.speed)) out.speed = src.speed;
    out.scale = clamp(out.scale, 1, 3);
    out.speed = clamp(out.speed, 40, 260);
    for (const key of ["follow", "sleepOnBar", "autoActions", "reactToPlayer", "reducedMotion"]) {
      if (typeof src[key] === "boolean") out[key] = src[key];
    }
    return out;
  }

  function parseStored(raw, fallback) {
    if (typeof raw !== "string" || raw.length === 0) return fallback;
    try {
      const value = JSON.parse(raw);
      if (fallback !== null && typeof value !== typeof fallback) return fallback;
      if (fallback !== null && Array.isArray(fallback) !== Array.isArray(value)) return fallback;
      return value;
    } catch {
      return fallback;
    }
  }

  function animationForDirection(direction, moving) {
    if (!moving) return "idle";
    if (!DIRECTIONS.includes(direction)) return "idle";
    return `walk${direction}`;
  }

  // Speed eases in on start and follows an "arrive" curve before the target,
  // so the cat neither starts nor stops at full speed. minSpeed avoids an
  // endless crawl when the remaining distance tends to zero.
  function nextSpeed(current, maxSpeed, remaining, dt, motion = MOTION) {
    if (![current, maxSpeed, remaining, dt].every(Number.isFinite) || maxSpeed < 0 || dt < 0) {
      throw new RangeError(`nextSpeed: invalid input current=${current} maxSpeed=${maxSpeed} remaining=${remaining} dt=${dt}`);
    }
    const brake = Math.sqrt(2 * motion.decel * Math.max(0, remaining));
    const desired = Math.min(maxSpeed, Math.max(motion.minSpeed, brake));
    const seconds = dt / 1000;
    if (current < desired) return Math.min(desired, current + motion.accel * seconds);
    return Math.max(desired, current - motion.decel * seconds);
  }

  // Walk cycles advance with the distance travelled instead of time, so the
  // paws keep pace with the movement at any speed and during ease in/out.
  function advanceByDistance(frame, carry, moved, stride, count) {
    if (!Number.isInteger(count) || count <= 0 || !(stride > 0)) {
      throw new RangeError(`advanceByDistance: invalid stride ${stride} or frame count ${count}`);
    }
    const total = (Number.isFinite(carry) ? carry : 0) + (Number.isFinite(moved) && moved > 0 ? moved : 0);
    const steps = Math.floor(total / stride);
    return { frame: (Math.max(0, Math.floor(frame)) + steps) % count, carry: total - steps * stride };
  }

  function frameDuration(data, index) {
    if (Array.isArray(data.durations) && Number.isFinite(data.durations[index])) return data.durations[index];
    return 1000 / data.fps;
  }

  function animationLength(data) {
    let total = 0;
    for (let i = 0; i < data.frames.length; i += 1) total += frameDuration(data, i);
    return total;
  }

  // Positions snap to device pixels: sub-pixel offsets would resample the
  // pixel art, whole CSS pixels would stutter on high-DPI screens.
  function snapToDevice(value, ratio) {
    const r = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    return Math.round(value * r) / r;
  }

  function uniqueFrameCount(animations) {
    const seen = new Set();
    for (const data of Object.values(animations || {})) {
      for (const [col, row] of data.frames) seen.add(`${col},${row}`);
    }
    return seen.size;
  }

  function framePosition(col, row, frameWidth, frameHeight, scale = 1) {
    return { x: -col * frameWidth * scale, y: -row * frameHeight * scale };
  }

  function isDiagonal(direction) {
    return direction === "NE" || direction === "SE" || direction === "SW" || direction === "NW";
  }

  const api = {
    DEFAULT_SETTINGS,
    VARIANTS,
    IDLE_ACTIONS,
    DIRECTIONS,
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
    uniqueFrameCount,
    framePosition,
    isDiagonal,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  // -----------------------------------------------------------------------
  // Spicetify runtime
  // -----------------------------------------------------------------------
  if (typeof Spicetify === "undefined" || typeof document === "undefined") return;

  const SPRITE_META = {"frameWidth":80,"frameHeight":80,"columns":8,"rows":11,"animations":{"idle":{"frames":[[0,0],[1,0]],"fps":4,"loop":true,"durations":[2600,150]},"blink":{"frames":[[0,0],[1,0]],"fps":8,"loop":false,"durations":[60,150]},"alert":{"frames":[[2,0],[3,0]],"fps":4,"loop":true,"durations":[550,700]},"sit":{"frames":[[4,0],[5,0],[6,0],[7,0],[4,0]],"fps":2,"loop":false,"durations":[700,900,450,1100,600]},"walkN":{"frames":[[0,1],[1,1],[2,1],[3,1],[4,1],[5,1],[6,1],[7,1]],"fps":8,"loop":true,"stride":5},"walkNE":{"frames":[[0,2],[1,2],[2,2],[3,2]],"fps":8,"loop":true,"stride":11},"walkE":{"frames":[[0,2],[1,2],[2,2],[3,2]],"fps":8,"loop":true,"stride":11},"walkSE":{"frames":[[0,2],[1,2],[2,2],[3,2]],"fps":8,"loop":true,"stride":11},"walkS":{"frames":[[4,2],[5,2],[6,2],[7,2],[0,3],[1,3],[2,3],[3,3]],"fps":8,"loop":true,"stride":5},"walkSW":{"frames":[[4,3],[5,3],[6,3],[7,3]],"fps":8,"loop":true,"stride":11},"walkW":{"frames":[[4,3],[5,3],[6,3],[7,3]],"fps":8,"loop":true,"stride":11},"walkNW":{"frames":[[4,3],[5,3],[6,3],[7,3]],"fps":8,"loop":true,"stride":11},"sleep":{"frames":[[0,4],[1,4],[2,4],[3,4]],"fps":2,"loop":true,"durations":[650,650,650,1100]},"tired":{"frames":[[6,0],[7,0]],"fps":2,"loop":true},"scratchSelf":{"frames":[[4,4],[5,4],[6,4],[3,0]],"fps":8,"loop":false},"scratchWallN":{"frames":[[2,0],[3,0],[2,0]],"fps":6,"loop":false},"scratchWallE":{"frames":[[0,2],[7,4],[0,2]],"fps":6,"loop":false},"scratchWallS":{"frames":[[0,0],[1,0],[0,0]],"fps":6,"loop":false},"scratchWallW":{"frames":[[4,3],[0,5],[4,3]],"fps":6,"loop":false},"drag":{"frames":[[1,5],[2,5]],"fps":6,"loop":true},"happy":{"frames":[[3,5],[4,5],[5,5],[1,0]],"fps":6,"loop":false,"durations":[110,150,220,300]},"groom":{"frames":[[6,5],[7,5],[0,6],[1,6],[2,6],[3,6],[4,6],[5,6],[6,6],[6,5]],"fps":8,"loop":false,"durations":[150,110,110,150,150,150,150,110,150,200]},"yawn":{"frames":[[1,0],[7,6],[0,7],[0,7],[1,0]],"fps":4,"loop":false,"durations":[200,220,650,350,250]},"stretch":{"frames":[[4,3],[1,7],[2,7],[1,7]],"fps":3,"loop":false,"durations":[250,300,900,350]},"dance":{"frames":[[2,0],[3,7],[4,7],[5,7],[6,7],[7,7],[0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[6,8],[1,0]],"fps":6,"loop":true,"durations":[200,160,180,120,240,240,160,180,120,240,240,160,220,240]},"danceJump":{"frames":[[7,8],[0,9],[1,9],[2,9],[3,9]],"fps":6,"loop":true,"durations":[140,110,300,120,180]},"lieDown":{"frames":[[1,0],[7,0],[4,9]],"fps":4,"loop":false,"durations":[180,420,300]},"wakeUp":{"frames":[[3,4],[6,0],[4,0],[0,0]],"fps":4,"loop":false,"durations":[250,300,300,200]},"getUp":{"frames":[[5,9],[6,9],[7,9],[0,10],[1,10]],"fps":10,"loop":false,"durations":[80,80,80,80,100]},"sitDown":{"frames":[[1,10],[0,10],[7,9],[6,9],[5,9]],"fps":10,"loop":false,"durations":[80,80,80,80,120]}},"source":"tools/import_sprites.py"};
  const SPRITE_URI = "data:image/png;base64,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";
  if (!SPRITE_META || !SPRITE_META.animations || !SPRITE_META.animations.idle || !SPRITE_URI) {
    console.error("vfdPet: sprite data missing; run `npm run build` before installing.");
    return;
  }

  const FRAME_COUNT = uniqueFrameCount(SPRITE_META.animations);
  const STORAGE_SETTINGS = "vfdpet:settings:v1";
  const STORAGE_STATE = "vfdpet:state:v1";
  const STOP_DISTANCE = 52;
  const SIT_DELAY_MS = 1200;

  const state = {
    mounted: false,
    el: null,
    menu: null,
    size: { width: 0, height: 0 },
    pos: { x: 0, y: 0 },
    target: { x: 0, y: 0 },
    lastPointer: { x: 0, y: 0 },
    settings: null,
    mode: "idle",
    standingSince: 0,
    speed: 0,
    moved: 0,
    walkCarry: 0,
    anim: "idle",
    animData: null,
    animLoop: true,
    animUntil: 0,
    animOnEnd: null,
    frame: 0,
    frameAt: 0,
    lastTick: 0,
    lastInteraction: 0,
    nextIdleAt: 0,
    lastIdleReset: 0,
    sleeping: false,
    sleepPending: false,
    sleepTarget: null,
    pendingSleep: false,
    dragging: false,
    dragMoved: false,
    dragStart: null,
    grabOffset: { x: 0, y: 0 },
    affection: 0,
    action: null,
    raf: 0,
    modalOpen: false,
    lastModalCheck: 0,
    pauseAt: 0,
    yawned: false,
    settingsOverlay: null,
  };

  let saveTimer = 0;
  let resizeTimer = 0;
  let menuOutsideHandler = null;
  let menuKeyHandler = null;

  // -- storage ------------------------------------------------------------
  function storageGet(key) {
    try {
      if (Spicetify.LocalStorage && typeof Spicetify.LocalStorage.get === "function") {
        return Spicetify.LocalStorage.get(key);
      }
      return window.localStorage.getItem(key);
    } catch (err) {
      console.warn("vfdPet: storage read failed", err);
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      if (Spicetify.LocalStorage && typeof Spicetify.LocalStorage.set === "function") {
        Spicetify.LocalStorage.set(key, value);
      } else {
        window.localStorage.setItem(key, value);
      }
    } catch (err) {
      console.warn("vfdPet: storage write failed", err);
    }
  }

  function storageRemove(key) {
    try {
      if (Spicetify.LocalStorage && typeof Spicetify.LocalStorage.remove === "function") {
        Spicetify.LocalStorage.remove(key);
      } else {
        window.localStorage.removeItem(key);
      }
    } catch {
      /* best effort */
    }
  }

  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch {
      return false;
    }
  }

  function loadSettings() {
    const raw = storageGet(STORAGE_SETTINGS);
    const settings = sanitizeSettings(parseStored(raw, null));
    if (!raw && prefersReducedMotion()) settings.reducedMotion = true;
    return settings;
  }

  function loadStoredState() {
    const raw = parseStored(storageGet(STORAGE_STATE), null);
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 300);
  }

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (!state.settings) return;
    storageSet(STORAGE_SETTINGS, JSON.stringify(state.settings));
    storageSet(STORAGE_STATE, JSON.stringify({
      x: Math.round(state.pos.x),
      y: Math.round(state.pos.y),
      sleeping: state.sleeping || state.sleepPending,
      affection: state.affection,
    }));
  }

  // -- rendering ----------------------------------------------------------
  function setFrame(name, index) {
    if (!state.el) return;
    const data = SPRITE_META.animations[name] || SPRITE_META.animations.idle;
    const frame = data.frames[Math.max(0, Math.min(index, data.frames.length - 1))] || data.frames[0];
    const pos = framePosition(frame[0], frame[1], SPRITE_META.frameWidth, SPRITE_META.frameHeight, state.settings.scale);
    state.el.style.backgroundPosition = `${pos.x}px ${pos.y}px`;
  }

  function renderPosition() {
    if (!state.el) return;
    const ratio = window.devicePixelRatio;
    const x = snapToDevice(state.pos.x - state.size.width / 2, ratio);
    const y = snapToDevice(state.pos.y - state.size.height / 2, ratio);
    state.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  function applySettings() {
    if (!state.el || !state.settings) return;
    const scale = state.settings.scale;
    const width = SPRITE_META.frameWidth * scale;
    const height = SPRITE_META.frameHeight * scale;
    state.size = { width, height };
    state.el.style.width = `${width}px`;
    state.el.style.height = `${height}px`;
    state.el.style.backgroundSize = `${SPRITE_META.columns * SPRITE_META.frameWidth * scale}px ${SPRITE_META.rows * SPRITE_META.frameHeight * scale}px`;
    const variant = VARIANTS[state.settings.variant] || VARIANTS.miel;
    const shadow = "drop-shadow(0 3px 4px rgba(0,0,0,.35))";
    state.el.style.filter = variant.filter === "none" ? shadow : `${variant.filter} ${shadow}`;
    // A bigger cat must not end up half outside the window, and a sleeping cat
    // must stay centred on the bar after a scale change.
    if (state.sleeping) {
      const spot = computeSleepSpot();
      const vp = viewport();
      state.pos = clampToViewport(spot.x, spot.y, vp, state.size);
      state.target = { ...state.pos };
    } else if (state.sleepPending && state.sleepTarget) {
      const spot = computeSleepSpot();
      const vp = viewport();
      state.sleepTarget = clampToViewport(spot.x, spot.y, vp, state.size);
      state.target = { ...state.sleepTarget };
    } else {
      const vp = viewport();
      state.pos = clampToViewport(state.pos.x, state.pos.y, vp, state.size);
      state.target = clampToViewport(state.target.x, state.target.y, vp, state.size);
    }
    setFrame(state.anim, state.frame);
    renderPosition();
  }

  function ensureStyles() {
    if (document.getElementById("vfd-pet-style")) return;
    const style = document.createElement("style");
    style.id = "vfd-pet-style";
    style.textContent = `
      #vfd-pet {
        position: fixed; left: 0; top: 0; margin: 0; padding: 0; border: 0;
        background-color: transparent; background-repeat: no-repeat;
        image-rendering: pixelated; image-rendering: crisp-edges;
        user-select: none; -webkit-user-drag: none; touch-action: none;
        cursor: grab; will-change: transform; z-index: 2147482000;
      }
      #vfd-pet.vfdpet-dragging { cursor: grabbing; }
      #vfd-pet:focus-visible { outline: 2px solid var(--spice-button, #1db954); outline-offset: 4px; border-radius: 10px; }
      #vfd-pet-menu {
        position: fixed; z-index: 2147482100; min-width: 196px; padding: 6px;
        border-radius: 10px; background: var(--spice-main-elevated, #282828);
        color: var(--spice-text, #fff); box-shadow: 0 10px 34px rgba(0,0,0,.5);
        border: 1px solid rgba(255,255,255,.08);
        font: 13px/1.4 var(--spice-font-family, "Segoe UI", sans-serif);
      }
      #vfd-pet-menu button {
        display: block; width: 100%; padding: 8px 10px; border: 0; border-radius: 6px;
        background: transparent; color: inherit; cursor: pointer; text-align: left;
        font: inherit;
      }
      #vfd-pet-menu button:hover, #vfd-pet-menu button:focus-visible {
        background: var(--spice-button, #1db954); color: var(--spice-button-text, #000);
        outline: none;
      }
      #vfd-pet-menu .vfdpet-sep { height: 1px; margin: 5px 6px; background: rgba(255,255,255,.12); }
      .vfdpet-panel {
        display: flex; flex-direction: column; gap: 12px; min-width: 0;
        max-width: 420px; color: var(--spice-text, #fff);
        font: 13px/1.45 var(--spice-font-family, "Segoe UI", sans-serif);
      }
      .vfdpet-panel h3 { margin: 0 0 2px; font-size: 15px; }
      .vfdpet-hint { margin: 0; color: var(--spice-subtext, #b3b3b3); font-size: 12px; }
      .vfdpet-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
      .vfdpet-row label { flex: 1; }
      .vfdpet-row output { min-width: 42px; text-align: right; color: var(--spice-subtext, #b3b3b3); font-variant-numeric: tabular-nums; }
      .vfdpet-variants { display: flex; gap: 10px; flex-wrap: wrap; }
      .vfdpet-variant {
        display: flex; flex-direction: column; align-items: center; gap: 4px;
        padding: 6px; border: 2px solid transparent; border-radius: 12px;
        background: var(--spice-main, #121212); color: inherit; cursor: pointer;
        font: inherit; font-size: 11px;
      }
      .vfdpet-variant.selected { border-color: var(--spice-button, #1db954); }
      .vfdpet-variant:focus-visible { outline: 2px solid var(--spice-button, #1db954); outline-offset: 2px; }
      .vfdpet-swatch {
        width: 56px; height: 56px; border-radius: 9px;
        background-repeat: no-repeat;
        image-rendering: pixelated; background-color: rgba(255,255,255,.04);
      }
      .vfdpet-panel input[type="range"] { width: 160px; accent-color: var(--spice-button, #1db954); }
      .vfdpet-panel input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--spice-button, #1db954); }
      .vfdpet-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .vfdpet-btn {
        padding: 8px 11px; border-radius: 999px; border: 1px solid rgba(255,255,255,.16);
        background: transparent; color: inherit; cursor: pointer; font: inherit;
      }
      .vfdpet-btn:hover, .vfdpet-btn:focus-visible {
        background: var(--spice-button, #1db954); color: var(--spice-button-text, #000);
        border-color: transparent; outline: none;
      }
      .vfdpet-stats { color: var(--spice-subtext, #b3b3b3); font-size: 12px; font-variant-numeric: tabular-nums; }
      .vfdpet-overlay {
        position: fixed; inset: 0; z-index: 2147482200; display: grid; place-items: center;
        background: rgba(0,0,0,.6); padding: 24px;
      }
      .vfdpet-dialog {
        width: min(480px, 100%); max-height: 90vh; overflow: auto; padding: 18px 20px;
        border-radius: 14px; background: var(--spice-main-elevated, #282828);
        color: var(--spice-text, #fff); box-shadow: 0 20px 60px rgba(0,0,0,.55);
      }
      .vfdpet-dialog header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
      .vfdpet-dialog h2 { margin: 0; font-size: 16px; }
      .vfdpet-close {
        border: 0; background: transparent; color: inherit; cursor: pointer;
        font-size: 20px; line-height: 1; padding: 4px 8px; border-radius: 8px;
      }
      .vfdpet-close:hover { background: rgba(255,255,255,.08); }
      .vfdpet-close:focus-visible { outline: 2px solid var(--spice-button, #1db954); outline-offset: 2px; }
    `;
    document.head.appendChild(style);
  }

  function buildDom() {
    ensureStyles();
    const el = document.createElement("div");
    el.id = "vfd-pet";
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", "Michi, mascota de VFD Pet. Clic para acariciar, doble clic para dormir, clic derecho para más acciones.");
    el.title = "Clic: acariciar · Doble clic: dormir · Clic derecho: acciones";
    el.style.backgroundImage = `url("${SPRITE_URI}")`;
    document.body.appendChild(el);
    state.el = el;
    applySettings();
    bindPetEvents();
    state.mounted = true;
  }

  function initPosition() {
    const stored = loadStoredState();
    state.settings = loadSettings();
    const frameW = SPRITE_META.frameWidth;
    const frameH = SPRITE_META.frameHeight;
    state.size = { width: frameW * state.settings.scale, height: frameH * state.settings.scale };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
      state.pos = clampToViewport(stored.x, stored.y, viewport, state.size);
    } else {
      const spot = pickSleepSpot({ viewport, pet: state.size, progressBar: null });
      state.pos = { x: spot.x, y: spot.y };
    }
    state.target = { ...state.pos };
    state.lastPointer = { x: viewport.width / 2, y: viewport.height / 2 };
    state.affection = stored && Number.isFinite(stored.affection) ? Math.max(0, Math.floor(stored.affection)) : 0;
    state.pendingSleep = !!(stored && stored.sleeping);
    const now = performance.now();
    state.lastTick = now;
    state.lastInteraction = now;
    state.nextIdleAt = now + 5000;
    state.lastIdleReset = now;
  }

  // -- Spotify measurements ----------------------------------------------
  function queryRect(selector) {
    try {
      const node = document.querySelector(selector);
      return node ? normalizeRect(node.getBoundingClientRect()) : null;
    } catch {
      return null;
    }
  }

  function firstRect(selectors) {
    for (const selector of selectors) {
      const rect = queryRect(selector);
      if (rect) return rect;
    }
    return null;
  }

  function reserveBottom() {
    const bar = firstRect([".Root__now-playing-bar", ".main-nowPlayingBar-container", "[data-testid='now-playing-bar']"]);
    if (bar && bar.height > 40) return Math.max(70, window.innerHeight - bar.top + 10);
    return 90;
  }

  function computeSleepSpot() {
    if (!state.settings.sleepOnBar) {
      return { x: state.pos.x, y: state.pos.y, source: "here" };
    }
    return pickSleepSpot({
      viewport: { width: window.innerWidth, height: window.innerHeight },
      pet: state.size,
      progressBar: firstRect([
        ".main-nowPlayingBar-center .playback-progressbar",
        ".playback-progressbar",
        "[data-testid='progress-bar']",
        "[data-testid='playback-progressbar']",
      ]),
      remainingTime: firstRect([
        ".main-playbackBarRemainingTime-container",
        "[data-testid='playback-remaining-time']",
      ]),
      elapsedTime: firstRect([
        ".playback-bar__progress-time-elapsed",
        "[data-testid='playback-position']",
      ]),
      fullAppDisplay: firstRect(["#fad-progress"]),
      reserveBottom: reserveBottom(),
    });
  }

  function viewport() {
    return { width: window.innerWidth, height: window.innerHeight };
  }

  function setPosition(x, y) {
    state.pos = clampToViewport(x, y, viewport(), state.size);
    renderPosition();
  }

  // -- animation state ----------------------------------------------------
  function play(name, options = {}) {
    const known = Object.prototype.hasOwnProperty.call(SPRITE_META.animations, name);
    const actual = known ? name : "idle";
    const data = SPRITE_META.animations[actual];
    const now = performance.now();
    if (state.anim === actual && !options.restart) {
      if (options.loop !== undefined) state.animLoop = options.loop;
      if (options.duration) state.animUntil = now + options.duration;
      if (options.onEnd) state.animOnEnd = options.onEnd;
      return;
    }
    state.anim = actual;
    state.animData = data;
    state.frame = 0;
    state.frameAt = now;
    state.moved = 0;
    state.walkCarry = 0;
    state.animLoop = options.loop !== undefined ? options.loop : data.loop;
    state.animUntil = options.duration ? now + options.duration : 0;
    state.animOnEnd = options.onEnd || null;
    setFrame(actual, 0);
  }

  function playWalk(direction, options = {}) {
    const name = animationForDirection(direction, true);
    const next = SPRITE_META.animations[name];
    const current = state.animData;
    // walkE -> walkNE (or a mirrored cycle) keeps the leg phase instead of
    // restarting the cycle every time the direction crosses an octant.
    const sameCycle = !options.restart && state.anim !== name && current && current.stride && next && next.stride
      && current.frames.length === next.frames.length;
    if (!sameCycle) {
      play(name, options);
      return;
    }
    const frame = state.frame;
    const carry = state.walkCarry;
    play(name, options);
    state.frame = frame;
    state.walkCarry = carry;
    setFrame(name, frame);
  }

  // Pose change that blocks chasing until it ends; `then` replaces the default
  // return to idle (getting up hands over to walking instead).
  function playTransition(name, then) {
    const duration = animationLength(SPRITE_META.animations[name]);
    state.mode = "action";
    state.action = { name, started: performance.now(), duration, then };
    play(name, { restart: true });
  }

  function finishAnim() {
    const callback = state.animOnEnd;
    state.animOnEnd = null;
    state.animUntil = 0;
    if (callback) callback();
  }

  function animate(now) {
    if (!state.animData) return;
    const data = state.animData;
    if (data.stride) {
      const step = advanceByDistance(state.frame, state.walkCarry, state.moved, data.stride * state.settings.scale, data.frames.length);
      state.moved = 0;
      state.walkCarry = step.carry;
      if (step.frame !== state.frame) {
        state.frame = step.frame;
        setFrame(state.anim, state.frame);
      }
      if (state.animUntil && now >= state.animUntil) finishAnim();
      return;
    }
    const frameMs = Math.max(state.settings.reducedMotion ? 250 : 0, frameDuration(data, state.frame));
    if (now - state.frameAt >= frameMs) {
      state.frameAt = now;
      if (state.frame + 1 < data.frames.length) {
        state.frame += 1;
        setFrame(state.anim, state.frame);
      } else if (state.animLoop) {
        state.frame = 0;
        setFrame(state.anim, 0);
      } else if (state.animOnEnd) {
        finishAnim();
      }
    }
    if (state.animUntil && now >= state.animUntil) finishAnim();
  }

  function setIdle(withDelay = true) {
    state.mode = "idle";
    state.action = null;
    state.sleeping = false;
    state.sleepPending = false;
    state.sleepTarget = null;
    state.speed = 0;
    play("idle");
    if (withDelay) state.nextIdleAt = performance.now() + idleDelay(Math.random);
  }

  // -- movement and actions ----------------------------------------------
  function moveToward(target, dt, speedFactor = 1, stopAt = 0) {
    const maxSpeed = state.settings.speed * speedFactor * (state.settings.reducedMotion ? 0.7 : 1);
    const remaining = distance(state.pos.x, state.pos.y, target.x, target.y) - stopAt;
    state.speed = nextSpeed(state.speed, maxSpeed, remaining, dt);
    const before = state.pos;
    const next = stepToward(state.pos.x, state.pos.y, target.x, target.y, (state.speed * dt) / 1000);
    state.pos = clampToViewport(next.x, next.y, viewport(), state.size);
    state.moved += distance(before.x, before.y, state.pos.x, state.pos.y);
    renderPosition();
    return distance(state.pos.x, state.pos.y, target.x, target.y);
  }

  function startSleep() {
    if (state.sleeping || state.sleepPending) return;
    const spot = computeSleepSpot();
    state.sleepTarget = { x: spot.x, y: spot.y };
    state.target = { x: spot.x, y: spot.y };
    state.sleepPending = true;
    state.sleeping = false;
    state.mode = "sleepPending";
    state.action = null;
    state.lastInteraction = performance.now();
    if (distance(state.pos.x, state.pos.y, spot.x, spot.y) < 4) {
      enterSleep();
      return;
    }
    const dir = direction8(spot.x - state.pos.x, spot.y - state.pos.y);
    if (dir) playWalk(dir, { loop: true, restart: true });
    scheduleSave();
  }

  function enterSleep() {
    state.sleeping = true;
    state.sleepPending = false;
    state.sleepTarget = null;
    state.mode = "sleep";
    state.action = null;
    state.speed = 0;
    play("lieDown", {
      restart: true,
      onEnd: () => {
        if (state.sleeping) play("sleep", { loop: true, restart: true });
      },
    });
    scheduleSave();
  }

  function wake() {
    if (!state.sleeping && !state.sleepPending) return;
    const wasAsleep = state.sleeping;
    state.sleeping = false;
    state.sleepPending = false;
    state.sleepTarget = null;
    state.mode = "idle";
    state.speed = 0;
    state.target = { ...state.lastPointer };
    state.lastInteraction = performance.now();
    // nextIdleAt went stale while asleep; an auto action would cut the transition.
    state.nextIdleAt = performance.now() + idleDelay(Math.random);
    const alert = () => play("alert", { loop: false, duration: 900, onEnd: () => setIdle(), restart: true });
    // Only a cat that was lying asleep gets up; one still walking to the bar
    // just looks around. Getting up runs as an action so chasing the cursor
    // does not cut it short.
    if (wasAsleep) {
      const duration = animationLength(SPRITE_META.animations.wakeUp) + 900;
      state.mode = "action";
      state.action = { name: "wakeUp", started: performance.now(), duration };
      play("wakeUp", { restart: true, onEnd: alert });
    } else {
      alert();
    }
    scheduleSave();
  }

  function toggleSleep() {
    if (state.sleeping || state.sleepPending) wake();
    else startSleep();
  }

  function pet() {
    if (state.sleeping || state.sleepPending) wake();
    state.affection += 1;
    state.mode = "action";
    state.action = { name: "happy", started: performance.now(), duration: 600 };
    play("happy", { restart: true, onEnd: () => setIdle() });
    state.lastInteraction = performance.now();
    scheduleSave();
    if (state.affection % 25 === 0 && typeof Spicetify.showNotification === "function") {
      try {
        Spicetify.showNotification(`Michi te quiere: ${state.affection} mimos`);
      } catch {
        /* optional */
      }
    }
  }

  function runAction(name, options = {}) {
    if (!Object.prototype.hasOwnProperty.call(SPRITE_META.animations, name)) return;
    if (state.sleeping || state.sleepPending) wake();
    const data = SPRITE_META.animations[name];
    const natural = animationLength(data) + 160;
    const duration = Number.isFinite(options.duration) ? options.duration : (data.loop ? 6000 : natural);
    state.mode = "action";
    state.action = { name, started: performance.now(), duration };
    state.lastInteraction = performance.now();
    play(name, {
      restart: true,
      loop: data.loop,
      duration: data.loop ? duration : 0,
      onEnd: () => setIdle(),
    });
  }

  // -- world update -------------------------------------------------------
  function refreshModalVisibility() {
    if (!state.el) return;
    let open = false;
    try {
      open = !!document.querySelector("[role='dialog'], .GenericModal, .main-trackCreditsModal-container");
    } catch {
      open = false;
    }
    state.modalOpen = open;
    state.el.style.visibility = open ? "hidden" : "visible";
  }

  function updateModalVisibility(now) {
    if (now - state.lastModalCheck < 500) return;
    state.lastModalCheck = now;
    refreshModalVisibility();
    if (state.modalOpen) closeMenu();
  }

  function update(now, dt) {
    if (!state.mounted) return;
    if (state.dragging) {
      animate(now);
      return;
    }
    updateModalVisibility(now);

    if (state.sleeping) {
      animate(now);
      return;
    }

    if (state.sleepPending) {
      const left = distance(state.pos.x, state.pos.y, state.sleepTarget.x, state.sleepTarget.y);
      if (left <= 3) {
        enterSleep();
        animate(now);
        return;
      }
      moveToward(state.sleepTarget, dt, 1.15);
      const dir = direction8(state.sleepTarget.x - state.pos.x, state.sleepTarget.y - state.pos.y);
      if (dir) playWalk(dir, { loop: true });
      if (distance(state.pos.x, state.pos.y, state.sleepTarget.x, state.sleepTarget.y) <= 3) enterSleep();
      animate(now);
      return;
    }

    if (state.mode === "action") {
      if (state.action && now - state.action.started >= state.action.duration) {
        if (state.action.then) state.action.then();
        else setIdle();
      }
      animate(now);
      return;
    }

    if (state.pauseAt && !state.yawned && now - state.pauseAt > 20000 && state.mode === "idle" && !state.sleeping) {
      state.yawned = true;
      runAction("yawn");
      return;
    }

    const dist = distance(state.pos.x, state.pos.y, state.target.x, state.target.y);
    const stop = Math.max(STOP_DISTANCE, state.size.width * 0.55);
    if (state.settings.follow && dist > stop) {
      // A sitting cat gets up first; one that only just stopped walks on.
      if (state.mode === "idle") {
        playTransition("getUp", () => {
          state.action = null;
          state.mode = "chase";
        });
        animate(now);
        return;
      }
      state.mode = "chase";
      const dir = direction8(state.target.x - state.pos.x, state.target.y - state.pos.y);
      if (dir) playWalk(dir, { loop: true });
      moveToward(state.target, dt, 1, stop);
      animate(now);
      return;
    }

    // On arrival it stands for a moment (walk frames only advance with
    // distance, so the last one holds) and sits down unless the cursor moves.
    if (state.mode === "chase") {
      state.mode = "standing";
      state.standingSince = now;
      state.speed = 0;
    }
    if (state.mode === "standing" && now - state.standingSince >= SIT_DELAY_MS) playTransition("sitDown");
    if (state.mode === "idle" && state.settings.autoActions && !state.settings.reducedMotion && now >= state.nextIdleAt) {
      const action = chooseIdleAction(Math.random, { allowSleep: true });
      if (action === "sleep") startSleep();
      else if (action === "idle") setIdle();
      else runAction(action);
    }
    animate(now);
  }

  function loop(now) {
    if (!state.mounted) return;
    state.raf = requestAnimationFrame(loop);
    if (document.hidden) {
      state.lastTick = now;
      return;
    }
    // Runs on every display frame: movement and walk cycles need it to look
    // smooth. Decisions are time-based (nextIdleAt, modal check every 500 ms),
    // so the frame rate does not change behaviour.
    if (!state.lastTick) state.lastTick = now;
    const dt = Math.min(100, now - state.lastTick);
    if (dt <= 0) return;
    state.lastTick = now;
    update(now, dt);
  }

  function handleResize() {
    if (!state.mounted) return;
    if (state.sleeping) {
      const spot = computeSleepSpot();
      state.pos = { x: spot.x, y: spot.y };
    } else if (state.sleepPending) {
      const spot = computeSleepSpot();
      state.sleepTarget = { x: spot.x, y: spot.y };
      state.target = { x: spot.x, y: spot.y };
    } else {
      state.pos = clampToViewport(state.pos.x, state.pos.y, viewport(), state.size);
      state.target = clampToViewport(state.target.x, state.target.y, viewport(), state.size);
    }
    renderPosition();
  }

  // -- events -------------------------------------------------------------
  function bindPetEvents() {
    const el = state.el;

    el.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (typeof el.setPointerCapture === "function") {
        try {
          el.setPointerCapture(event.pointerId);
        } catch {
          /* optional */
        }
      }
      state.dragging = true;
      state.dragMoved = false;
      state.dragStart = {
        x: event.clientX,
        y: event.clientY,
        px: state.pos.x,
        py: state.pos.y,
        at: performance.now(),
      };
      state.grabOffset = { x: event.clientX - state.pos.x, y: event.clientY - state.pos.y };
      state.mode = "drag";
      state.action = null;
      state.speed = 0;
      state.lastInteraction = performance.now();
      el.classList.add("vfdpet-dragging");
      play("drag", { loop: true, restart: true });
    });

    window.addEventListener("pointermove", (event) => {
      state.lastPointer = { x: event.clientX, y: event.clientY };
      if (state.dragging && state.dragStart) {
        const dx = event.clientX - state.dragStart.x;
        const dy = event.clientY - state.dragStart.y;
        if (Math.hypot(dx, dy) > 5) state.dragMoved = true;
        const spot = clampToViewport(
          event.clientX - state.grabOffset.x,
          event.clientY - state.grabOffset.y,
          viewport(),
          state.size,
        );
        state.pos = spot;
        state.target = { ...spot };
        renderPosition();
        return;
      }
      state.target = { x: event.clientX, y: event.clientY };
      state.lastInteraction = performance.now();
      if (state.mode === "idle" && performance.now() - state.lastIdleReset > 500) {
        state.lastIdleReset = performance.now();
        state.nextIdleAt = performance.now() + idleDelay(Math.random);
      }
    }, { passive: true });

    const endDrag = (event) => {
      if (!state.dragging) return;
      state.dragging = false;
      if (typeof el.releasePointerCapture === "function") {
        try {
          el.releasePointerCapture(event.pointerId);
        } catch {
          /* optional */
        }
      }
      el.classList.remove("vfdpet-dragging");
      const wasMoved = state.dragMoved;
      const held = state.dragStart ? performance.now() - state.dragStart.at : 0;
      state.dragStart = null;
      if (!wasMoved && held < 500) {
        pet();
      } else {
        state.mode = "idle";
        play("alert", { loop: false, duration: 800, onEnd: () => setIdle(), restart: true });
      }
      scheduleSave();
    };

    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);

    el.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleSleep();
    });

    el.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openMenu(event.clientX, event.clientY);
    });

    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        pet();
      } else if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        toggleSleep();
      } else if (event.key === "Escape") {
        closeMenu();
      }
    });

    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(handleResize, 120);
    });

    window.addEventListener("pointermove", (event) => {
      if (state.menu && !state.menu.contains(event.target)) closeMenu();
    }, { passive: true });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) persist();
      else state.lastTick = 0;
    });

    window.addEventListener("pagehide", persist);
    window.addEventListener("blur", closeMenu);
  }

  // -- context menu -------------------------------------------------------
  function menuItem(menu, label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = label;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      action();
    });
    menu.appendChild(button);
  }

  function openMenu(x, y) {
    closeMenu();
    const menu = document.createElement("div");
    menu.id = "vfd-pet-menu";
    menu.setAttribute("role", "menu");
    menuItem(menu, "Acariciar", pet);
    menuItem(menu, state.sleeping || state.sleepPending ? "Despertar" : "Dormir", toggleSleep);
    menuItem(menu, "Acicalarse", () => runAction("groom"));
    menuItem(menu, "Bailar", () => runAction(pickDance(Math.random, SPRITE_META.animations)));
    menuItem(menu, "Estirarse", () => runAction("stretch"));
    const sep = document.createElement("div");
    sep.className = "vfdpet-sep";
    menu.appendChild(sep);
    menuItem(menu, "Ajustes…", openSettings);
    menu.style.visibility = "hidden";
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${clamp(x, 8, window.innerWidth - rect.width - 8)}px`;
    menu.style.top = `${clamp(y, 8, window.innerHeight - rect.height - 8)}px`;
    menu.style.visibility = "visible";
    state.menu = menu;

    menuOutsideHandler = (event) => {
      if (!menu.contains(event.target)) closeMenu();
    };
    menuKeyHandler = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
      }
    };
    setTimeout(() => {
      if (state.menu === menu && menuOutsideHandler) {
        document.addEventListener("pointerdown", menuOutsideHandler, true);
      }
    }, 0);
    document.addEventListener("keydown", menuKeyHandler);
    const first = menu.querySelector("button");
    if (first) first.focus({ preventScroll: true });
  }

  function closeMenu() {
    if (!state.menu) return;
    state.menu.remove();
    state.menu = null;
    if (menuOutsideHandler) {
      document.removeEventListener("pointerdown", menuOutsideHandler, true);
      menuOutsideHandler = null;
    }
    if (menuKeyHandler) {
      document.removeEventListener("keydown", menuKeyHandler);
      menuKeyHandler = null;
    }
  }

  // -- settings panel -----------------------------------------------------
  function makeRow(labelText, control, hintText) {
    const row = document.createElement("div");
    row.className = "vfdpet-row";
    const label = document.createElement("label");
    const title = document.createElement("div");
    title.textContent = labelText;
    label.appendChild(title);
    if (hintText) {
      const hint = document.createElement("div");
      hint.className = "vfdpet-hint";
      hint.textContent = hintText;
      label.appendChild(hint);
    }
    row.appendChild(label);
    row.appendChild(control);
    return row;
  }

  function makeRange(key, min, max, step, format) {
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.alignItems = "center";
    wrap.style.gap = "8px";
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(state.settings[key]);
    const output = document.createElement("output");
    output.textContent = format(state.settings[key]);
    input.addEventListener("input", () => {
      state.settings[key] = Number(input.value);
      output.textContent = format(state.settings[key]);
      applySettings();
      scheduleSave();
    });
    wrap.appendChild(input);
    wrap.appendChild(output);
    return wrap;
  }

  function makeToggle(key) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!state.settings[key];
    input.addEventListener("change", () => {
      state.settings[key] = input.checked;
      if (key === "follow" && !input.checked && state.mode === "chase") setIdle();
      if (key === "reducedMotion" && input.checked) setIdle();
      applySettings();
      scheduleSave();
    });
    return input;
  }

  function makeButton(label, action, className = "vfdpet-btn") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      action();
    });
    return button;
  }

  function buildSettingsPanel() {
    const panel = document.createElement("div");
    panel.className = "vfdpet-panel";

    const intro = document.createElement("p");
    intro.className = "vfdpet-hint";
    intro.textContent = "Michi vive en esta ventana. Los ajustes se guardan en este equipo.";
    panel.appendChild(intro);

    const variants = document.createElement("div");
    variants.className = "vfdpet-variants";
    for (const [key, meta] of Object.entries(VARIANTS)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "vfdpet-variant" + (state.settings.variant === key ? " selected" : "");
      button.setAttribute("aria-pressed", state.settings.variant === key ? "true" : "false");
      button.dataset.variant = key;
      const swatch = document.createElement("span");
      swatch.className = "vfdpet-swatch";
      swatch.style.backgroundImage = `url("${SPRITE_URI}")`;
      swatch.style.backgroundSize = `${SPRITE_META.columns * 100}% ${SPRITE_META.rows * 100}%`;
      swatch.style.filter = meta.filter === "none" ? "none" : meta.filter;
      const label = document.createElement("span");
      label.textContent = meta.label;
      button.appendChild(swatch);
      button.appendChild(label);
      button.addEventListener("click", () => {
        state.settings.variant = key;
        applySettings();
        for (const node of variants.querySelectorAll(".vfdpet-variant")) {
          const selected = node.dataset.variant === key;
          node.classList.toggle("selected", selected);
          node.setAttribute("aria-pressed", selected ? "true" : "false");
        }
        scheduleSave();
      });
      if (Spicetify.Tippy && Spicetify.TippyProps) {
        try {
          Spicetify.Tippy(button, { ...Spicetify.TippyProps, content: `Variante ${meta.label}` });
        } catch {
          /* optional */
        }
      }
      variants.appendChild(button);
    }
    panel.appendChild(variants);

    panel.appendChild(makeRow("Tamaño", makeRange("scale", 1, 3, 0.25, (v) => `${Number(v).toFixed(2)}×`), `${SPRITE_META.frameWidth} px de arte, hasta ${SPRITE_META.frameWidth * 3} px en pantalla.`));
    panel.appendChild(makeRow("Velocidad", makeRange("speed", 40, 260, 10, (v) => `${v} px/s`), "Cuánto tarda en alcanzar el cursor."));

    panel.appendChild(makeRow("Seguir al cursor", makeToggle("follow"), "Si lo desactivas, se queda donde está."));
    panel.appendChild(makeRow("Dormir en la barra", makeToggle("sleepOnBar"), "Si no encuentra la barra, usa la esquina inferior derecha."));
    panel.appendChild(makeRow("Acciones automáticas", makeToggle("autoActions"), "Se acicala, se estira o duerme cuando lo dejas quieto."));
    panel.appendChild(makeRow("Reaccionar a Spotify", makeToggle("reactToPlayer"), "Se despierta al cambiar de pista y bosteza si pausas."));
    panel.appendChild(makeRow("Reducir movimiento", makeToggle("reducedMotion"), "Baja las animaciones a 4 fps y desactiva las automáticas."));

    const actions = document.createElement("div");
    actions.className = "vfdpet-actions";
    actions.appendChild(makeButton("Acariciar", pet));
    actions.appendChild(makeButton(state.sleeping || state.sleepPending ? "Despertar" : "Dormir", toggleSleep));
    actions.appendChild(makeButton("Centrar", () => {
      centerPet();
      scheduleSave();
    }));
    actions.appendChild(makeButton("Restablecer", resetPet));
    panel.appendChild(actions);

    const stats = document.createElement("div");
    stats.className = "vfdpet-stats";
    stats.textContent = `Mimos: ${state.affection} · ${FRAME_COUNT} frames · ${Object.keys(SPRITE_META.animations).length} animaciones`;
    panel.appendChild(stats);

    const hint = document.createElement("p");
    hint.className = "vfdpet-hint";
    hint.textContent = "Atajos: michi · clic: acariciar · doble clic: dormir · derecho: menú.";
    panel.appendChild(hint);
    return panel;
  }

  function closeSettings() {
    if (state.settingsOverlay) {
      state.settingsOverlay.remove();
      state.settingsOverlay = null;
    }
    if (Spicetify.PopupModal && typeof Spicetify.PopupModal.hide === "function") {
      try {
        Spicetify.PopupModal.hide();
      } catch {
        /* optional */
      }
    }
    refreshModalVisibility();
  }

  function showFallbackModal(title, content) {
    closeSettings();
    const overlay = document.createElement("div");
    overlay.className = "vfdpet-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    const dialog = document.createElement("div");
    dialog.className = "vfdpet-dialog";
    const header = document.createElement("header");
    const heading = document.createElement("h2");
    heading.textContent = title;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "vfdpet-close";
    close.setAttribute("aria-label", "Cerrar");
    close.textContent = "×";
    header.appendChild(heading);
    header.appendChild(close);
    dialog.appendChild(header);
    dialog.appendChild(content);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    state.settingsOverlay = overlay;
    refreshModalVisibility();
    const closeModal = () => {
      overlay.remove();
      if (state.settingsOverlay === overlay) state.settingsOverlay = null;
      document.removeEventListener("keydown", onKey);
      refreshModalVisibility();
    };
    const onKey = (event) => {
      if (event.key === "Escape") closeModal();
    };
    close.addEventListener("click", closeModal);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeModal();
    });
    document.addEventListener("keydown", onKey);
    close.focus({ preventScroll: true });
  }

  function openSettings() {
    closeMenu();
    const panel = buildSettingsPanel();
    if (Spicetify.PopupModal && typeof Spicetify.PopupModal.display === "function") {
      try {
        Spicetify.PopupModal.display({ title: "VFD Pet", content: panel, isLarge: false });
        return;
      } catch (err) {
        console.warn("vfdPet: PopupModal failed, using fallback", err);
      }
    }
    showFallbackModal("VFD Pet", panel);
  }

  function centerPet() {
    state.pos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    state.target = { ...state.pos };
    renderPosition();
  }

  function resetPet() {
    state.settings = sanitizeSettings(null, DEFAULT_SETTINGS, VARIANTS);
    if (prefersReducedMotion()) state.settings.reducedMotion = true;
    state.affection = 0;
    state.sleeping = false;
    state.sleepPending = false;
    state.pendingSleep = false;
    state.mode = "idle";
    storageRemove(STORAGE_SETTINGS);
    storageRemove(STORAGE_STATE);
    applySettings();
    const spot = pickSleepSpot({ viewport: viewport(), pet: state.size, progressBar: null });
    state.pos = { x: spot.x, y: spot.y };
    state.target = { ...state.pos };
    renderPosition();
    play("idle", { restart: true });
    persist();
    closeSettings();
    openSettings();
  }

  // -- player hooks and keyboard -----------------------------------------
  function bindPlayer() {
    const player = Spicetify.Player;
    if (!player || typeof player.addEventListener !== "function") return;
    player.addEventListener("onplaypause", () => {
      if (!state.settings.reactToPlayer) return;
      let playing = true;
      try {
        playing = typeof player.isPlaying === "function" ? !!player.isPlaying() : !!(player.data && player.data.isPlaying);
      } catch {
        playing = true;
      }
      if (playing) {
        state.pauseAt = 0;
        state.yawned = false;
        if (state.mode === "idle" && !state.sleeping) {
          play("alert", { loop: false, duration: 700, onEnd: () => setIdle(), restart: true });
        }
      } else {
        state.pauseAt = performance.now();
        state.yawned = false;
      }
    });
    player.addEventListener("songchange", () => {
      if (!state.settings.reactToPlayer || state.sleeping || state.dragging) return;
      if (state.mode === "idle") {
        play("alert", { loop: false, duration: 600, onEnd: () => setIdle(), restart: true });
      }
    });
  }

  function bindKeys() {
    const mousetrap = Spicetify.Mousetrap;
    if (!mousetrap || typeof mousetrap.bind !== "function") return;
    const open = (event) => {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      openSettings();
    };
    try {
      mousetrap.bind(["m i c h i", "v f d p e t"], open);
    } catch (err) {
      console.warn("vfdPet: could not bind michi shortcut", err);
    }
  }

  function waitFor(check, label, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const started = performance.now();
      const tick = () => {
        let ready = false;
        try {
          ready = !!check();
        } catch {
          ready = false;
        }
        if (ready) {
          resolve();
          return;
        }
        if (performance.now() - started > timeout) {
          reject(new Error(`timeout after ${timeout} ms waiting for ${label}`));
          return;
        }
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  function getState() {
    return {
      mounted: state.mounted,
      pos: { ...state.pos },
      target: { ...state.target },
      size: { ...state.size },
      mode: state.mode,
      anim: state.anim,
      frame: state.frame,
      sleeping: state.sleeping,
      sleepPending: state.sleepPending,
      dragging: state.dragging,
      affection: state.affection,
      settings: { ...state.settings },
      modalOpen: state.modalOpen,
      animations: Object.keys(SPRITE_META.animations).length,
      frames: FRAME_COUNT,
    };
  }

  function destroy() {
    state.mounted = false;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    clearTimeout(saveTimer);
    clearTimeout(resizeTimer);
    closeMenu();
    closeSettings();
    if (state.el) state.el.remove();
    state.el = null;
    const style = document.getElementById("vfd-pet-style");
    if (style) style.remove();
    delete document.documentElement.dataset.vfdPet;
    if (window.__vfdPet) delete window.__vfdPet;
  }

  // -- boot ---------------------------------------------------------------
  async function start() {
    document.documentElement.dataset.vfdPet = "loaded";
    await waitFor(() => document.body, "document.body", 10000);
    initPosition();
    buildDom();
    play("idle", { restart: true });
    state.lastTick = performance.now();
    state.raf = requestAnimationFrame(loop);
    bindPlayer();
    waitFor(() => Spicetify.Mousetrap && typeof Spicetify.Mousetrap.bind === "function", "Spicetify.Mousetrap", 15000)
      .then(bindKeys)
      .catch((err) => console.info("vfdPet: keyboard shortcuts unavailable:", err.message));
    if (state.pendingSleep) {
      setTimeout(() => {
        if (!state.sleeping && !state.sleepPending) startSleep();
      }, 1200);
    }
    document.documentElement.dataset.vfdPet = "mounted";
    window.__vfdPet = {
      getState,
      meta: SPRITE_META,
      actions: {
        pet,
        toggleSleep,
        startSleep,
        wake,
        runAction,
        openSettings,
        centerPet,
        resetPet,
        destroy,
      },
    };
    console.info(`vfdPet: mounted (${FRAME_COUNT} frames, ${Object.keys(SPRITE_META.animations).length} animations)`);
  }

  start().catch((err) => {
    document.documentElement.dataset.vfdPet = "error";
    console.error("vfdPet: start failed", err);
  });


})();
