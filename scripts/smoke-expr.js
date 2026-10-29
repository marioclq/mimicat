// Evaluated inside Spotify by scripts/smoke.ps1 through scripts/cdp.js.
(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (let i = 0; i < 40 && !window.__vfdPet; i += 1) await wait(100);

  const marker = document.documentElement.dataset.vfdPet || null;
  const pet = window.__vfdPet;
  if (!pet) {
    return { ok: false, marker, problems: ["window.__vfdPet is missing"] };
  }

  const state = pet.getState();
  const meta = pet.meta || {};
  const el = document.getElementById("vfd-pet");
  const problems = [];

  if (marker !== "mounted") problems.push(`dataset.vfdPet=${marker}`);
  if (!state.mounted) problems.push("state.mounted is false");
  if (!el) problems.push("#vfd-pet is missing");
  const metaFrames = new Set(Object.values(meta.animations || {}).flatMap((a) => a.frames.map((f) => f.join(",")))).size;
  if (!(state.frames > 0) || state.frames !== metaFrames) problems.push(`frames=${state.frames}, meta has ${metaFrames}`);
  if (state.animations !== 30) problems.push(`animations=${state.animations}, expected 30`);
  if (meta.frameWidth !== 80 || meta.frameHeight !== 80) {
    problems.push(`frame=${meta.frameWidth}x${meta.frameHeight}, expected 80x80`);
  }
  if (!meta.animations || !meta.animations[state.anim]) {
    problems.push(`current animation "${state.anim}" is not in the sheet`);
  }
  if (el) {
    const bg = String(el.style.backgroundImage || "");
    if (!bg.startsWith('url("data:image/png;base64,')) problems.push("background is not an inline PNG data URI");
    const expected = meta.frameWidth * state.settings.scale;
    if (Math.abs(state.size.width - expected) > 0.01) {
      problems.push(`size ${state.size.width} does not match ${meta.frameWidth} * ${state.settings.scale}`);
    }
    if (el.style.width !== `${state.size.width}px`) problems.push(`element width=${el.style.width}`);
  }
  if (state.pos.x < 0 || state.pos.x > innerWidth || state.pos.y < 0 || state.pos.y > innerHeight) {
    problems.push(`pet is outside the viewport (${state.pos.x}, ${state.pos.y})`);
  }

  return {
    ok: problems.length === 0,
    marker,
    problems,
    viewport: { width: innerWidth, height: innerHeight },
    state: {
      mode: state.mode,
      anim: state.anim,
      frame: state.frame,
      sleeping: state.sleeping,
      frames: state.frames,
      animations: state.animations,
      size: state.size,
      pos: state.pos,
      settings: state.settings,
    },
    background: el ? String(el.style.backgroundImage).slice(0, 34) : null,
  };
})()
