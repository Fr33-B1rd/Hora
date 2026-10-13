// The background: the page's dot grid, alive. A slow wave of light travels out
// from where the sun is in its day; the pointer bends the grid like a lens; at
// night a scattering of the dots are stars; and while the assistant is working,
// quick rings run out across the field. One canvas, no libraries. It stops when
// the tab is hidden and draws a still frame for anyone who asks for less motion.

const GAP = 22, LENS = 150, TAU = Math.PI * 2;
// A repeatable pseudo-random number for a grid cell, so the same dots are always the stars.
export const cellNoise = (i, j) => { const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return n - Math.floor(n); };

// How one dot looks at one moment. Kept apart from the drawing so it can be tested.
//   dot: {x, y, noise}; scene: {t seconds, sunX, sunY, pointer {x,y}|null, night, busySince seconds|null}
export function dotAt(dot, scene) {
  const dx = dot.x - scene.sunX, dy = dot.y - scene.sunY, fromSun = Math.hypot(dx, dy);
  // The slow wave from the sun: a crest every 260 px, moving outward, fading with distance.
  const reach = Math.max(0, 1 - fromSun / 1500);
  const wave = Math.max(0, Math.sin(fromSun / 260 * TAU - scene.t * 0.55)) ** 3 * reach;
  let x = dot.x, y = dot.y, size = 1 + wave * 1.1, light = 0.5 + wave * 1.6, tint = wave * 0.8;
  if (scene.night && dot.noise > 0.955) {            // a star: steadier, brighter, with its own slow twinkle
    const twinkle = 0.5 + 0.5 * Math.sin(scene.t * (0.6 + dot.noise * 2.2) + dot.noise * 90);
    size += 0.5 + twinkle * 0.9; light += 1.2 + twinkle * 2.2;
  }
  if (scene.busySince != null) {                      // working: quick rings, one every 0.9 s
    const ring = ((scene.t - scene.busySince) * 520) % 468, off = Math.abs(fromSun % 468 - ring);
    const hit = Math.max(0, 1 - Math.min(off, 468 - off) / 46);
    size += hit * 1.4; light += hit * 2.6; tint = Math.max(tint, hit);
  }
  if (scene.pointer) {                                // the lens: dots are pushed outward and grow
    const px = dot.x - scene.pointer.x, py = dot.y - scene.pointer.y, d = Math.hypot(px, py);
    if (d < LENS) { const pull = (1 - d / LENS) ** 2; x += (px / (d || 1)) * pull * 13; y += (py / (d || 1)) * pull * 13; size += pull * 1.9; light += pull * 2.4; tint = Math.max(tint, pull * 0.9); }
  }
  return { x, y, size, light: Math.min(light, 5), tint: Math.min(tint, 1) };
}

export function createAtmosphere(canvas, read, { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches } = {}) {
  const ctx = canvas.getContext('2d');
  let width = 0, height = 0, dots = [], pointer = null, busySince = null, frame = 0, last = 0, colours = null, colourKey = '';
  function resize() {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    width = innerWidth; height = innerHeight;
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    dots = [];
    for (let j = 0, y = GAP / 2; y < height; j++, y += GAP) for (let i = 0, x = GAP / 2; x < width; i++, x += GAP) dots.push({ x, y, noise: cellNoise(i, j) });
    if (reduced) draw(0);
  }
  function palette(state) {
    const key = state.theme + state.phase;
    if (key !== colourKey) {
      const style = getComputedStyle(document.documentElement);
      colours = { ink: style.getPropertyValue('--ink').trim() || '#0c0d0c', signal: style.getPropertyValue('--signal').trim() || '#c8f135', base: state.theme === 'dark' ? 0.075 : 0.085 };
      colourKey = key;
    }
    return colours;
  }
  function draw(t) {
    const state = read(), c = palette(state);
    if (state.busy && busySince == null) busySince = t; else if (!state.busy) busySince = null;
    const scene = { t, sunX: state.sunX * width, sunY: state.phase === 'night' ? -120 : 30, pointer, night: state.phase === 'night', busySince };
    ctx.clearRect(0, 0, width, height);
    // Two passes, so the context changes colour twice per frame instead of once per dot.
    ctx.fillStyle = c.ink;
    const tinted = [];
    for (const dot of dots) {
      const d = dotAt(dot, scene);
      if (d.tint > 0.25) tinted.push(d);
      ctx.globalAlpha = Math.min(0.9, c.base * d.light);
      ctx.fillRect(d.x - d.size / 2, d.y - d.size / 2, d.size, d.size);
    }
    ctx.fillStyle = c.signal;
    for (const d of tinted) { ctx.globalAlpha = Math.min(0.85, d.tint * (state.theme === 'dark' ? 0.75 : 0.95)); ctx.fillRect(d.x - d.size / 2, d.y - d.size / 2, d.size, d.size); }
    ctx.globalAlpha = 1;
  }
  function loop(ms) {
    frame = requestAnimationFrame(loop);
    if (ms - last < 33) return;               // about thirty frames a second is plenty for something this slow
    last = ms; draw(ms / 1000);
  }
  const onMove = event => { pointer = { x: event.clientX, y: event.clientY }; };
  const onLeave = () => { pointer = null; };
  const onVisibility = () => { cancelAnimationFrame(frame); if (!document.hidden && !reduced) frame = requestAnimationFrame(loop); };
  addEventListener('resize', resize);
  if (!reduced) { addEventListener('pointermove', onMove, { passive: true }); document.addEventListener('pointerleave', onLeave); document.addEventListener('visibilitychange', onVisibility); }
  resize();
  if (!reduced) frame = requestAnimationFrame(loop);
  document.documentElement.classList.add('has-atmosphere');
  return { redraw: () => { colourKey = ''; if (reduced) draw(0); }, stop() { cancelAnimationFrame(frame); removeEventListener('resize', resize); removeEventListener('pointermove', onMove); } };
}
