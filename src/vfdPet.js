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

  // Spotify 1.2.89 keeps closed [role='dialog'] containers in the DOM (0x0,
  // nothing rendered); only one that takes up space and is not hidden is an
  // open modal the pet should hide behind.
  function isOpenDialog(rect, visibility) {
    if (!rect || visibility === "hidden" || visibility === "collapse") return false;
    return rect.width > 0 && rect.height > 0;
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
    isOpenDialog,
    uniqueFrameCount,
    framePosition,
    isDiagonal,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  // -----------------------------------------------------------------------
  // Spicetify runtime
  // -----------------------------------------------------------------------
  if (typeof Spicetify === "undefined" || typeof document === "undefined") return;

  const SPRITE_META = /*__SPRITE_META__*/ null;
  const SPRITE_URI = /*__SPRITE_URI__*/ "";
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
      const candidates = document.querySelectorAll("[role='dialog'], .GenericModal, .main-trackCreditsModal-container");
      open = [...candidates].some((node) => isOpenDialog(node.getBoundingClientRect(), getComputedStyle(node).visibility));
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
