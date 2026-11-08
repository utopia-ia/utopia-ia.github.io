// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 UtopiaIA
// The two orbs of the conversation mode (voice.js), on a 2D canvas: the user's (teal into violet, the colours of
// Claw's loading galaxy) follows the microphone's waveform while they speak; the answer's (brass, the chat's own
// accent) appears when Elffuss thinks and follows the waveform of the voice reading the answer. A ring of particles
// orbits each one and is pushed out by the loudness; the outline is the waveform itself, wrapped around the circle.
//
// With prefers-reduced-motion: no orbiting, no travel between places; each orb is a still disc that only grows a little
// and brightens with the loudness.
//
//   const orbs = createOrbs(canvas, { reduced });
//   orbs.set({ phase, user: { level, wave }, bot: { level, wave } });   level() 0..1, wave(n) n samples -1..1
//   orbs.start(); orbs.stop();

const TAU = Math.PI * 2;
const USER = { core: [214, 255, 246], mid: [84, 219, 196], edge: [130, 115, 255], spark: [[84, 219, 196], [130, 115, 255], [209, 160, 107]] };
const BOT = { core: [255, 244, 222], mid: [240, 210, 164], edge: [201, 140, 92], spark: [[240, 210, 164], [255, 198, 120], [150, 130, 255]] };
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function particles(n, seed) {
  let s = seed;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  return Array.from({ length: n }, () => ({ a: r() * TAU, d: 0.9 + r() * 0.65, v: (0.08 + r() * 0.28) * (r() < 0.5 ? -1 : 1), z: 0.6 + r() * 1.6, tw: r() * TAU, c: Math.floor(r() * 2.9) }));
}

/** Where each orb goes, as fractions of the canvas, by phase: the one who is talking is big and in the middle. */
function layout(phase, w, h) {
  const m = Math.min(w, h);
  const portrait = h > w * 1.05;
  const botTurn = phase === 'thinking' || phase === 'speaking';
  const big = m * (portrait ? 0.26 : 0.24), small = m * 0.07;
  if (!botTurn) return { user: { x: w / 2, y: h * 0.56, r: big, a: 1 }, bot: { x: w / 2, y: h * 0.46, r: small * 0.6, a: 0 } };
  // The answer's orb big, the user's small underneath, with room between them for the halo.
  return { user: { x: w / 2, y: h * 0.86, r: small, a: 0.85 }, bot: { x: w / 2, y: h * 0.47, r: big * 0.78, a: 1 } };
}

export function createOrbs(canvas, { reduced = false } = {}) {
  const g = canvas.getContext('2d');
  const src = { phase: 'listening', user: null, bot: null };
  const st = {
    user: { x: 0, y: 0, r: 0, a: 0, lvl: 0, ring: new Float32Array(96), parts: particles(reduced ? 0 : 120, 11) },
    bot: { x: 0, y: 0, r: 0, a: 0, lvl: 0, ring: new Float32Array(96), parts: particles(reduced ? 0 : 120, 29) },
  };
  let raf = 0, alive = false, placed = false, last = 0;

  function size() {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = canvas.clientWidth || 320, h = canvas.clientHeight || 320;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  function drawOrb(o, pal, t, dt, input, kind) {
    if (o.a < 0.01 || o.r < 1) return;
    const thinking = kind === 'bot' && src.phase === 'thinking';
    const paused = src.phase === 'paused' || src.phase === 'error';
    let lvl = input?.level ? input.level() : 0;
    if (thinking) lvl = 0.12 + 0.06 * Math.sin(t * 2.2);
    o.lvl += (lvl - o.lvl) * Math.min(1, dt * (lvl > o.lvl ? 18 : 6));
    const L = o.lvl;
    const n = o.ring.length;
    // The outline: the waveform now, wrapped around and eased so it flows instead of flickering.
    const wave = !reduced && input?.wave ? input.wave(n) : null;
    // Smoothed around the circle (a raw waveform wrapped round is a star), so the outline breathes in a few soft lobes.
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = wave ? wave[i] : 0;
    for (let i = 0; i < n; i++) {
      let target = 0;
      for (let k = -6; k <= 6; k++) target += raw[(i + k + n) % n];
      target /= 13;
      if (thinking && !reduced) target = 0.25 * Math.sin(i * 0.13 + t * 2.4) * Math.sin(t * 1.3 + i * 0.07);
      o.ring[i] += (target - o.ring[i]) * Math.min(1, dt * 10);
    }
    const R = o.r * (1 + (reduced ? 0.08 : 0.16) * L);
    const alpha = o.a * (paused ? 0.45 : 1);
    g.save();
    g.globalCompositeOperation = 'lighter';
    // Halo.
    const halo = g.createRadialGradient(o.x, o.y, R * 0.2, o.x, o.y, R * (1.9 + L * 0.8));
    halo.addColorStop(0, rgba(pal.mid, 0.28 * alpha * (0.6 + L)));
    halo.addColorStop(0.5, rgba(pal.edge, 0.10 * alpha * (0.6 + L)));
    halo.addColorStop(1, rgba(pal.edge, 0));
    g.fillStyle = halo;
    g.beginPath(); g.arc(o.x, o.y, R * (1.9 + L * 0.8), 0, TAU); g.fill();
    // Body: a soft sphere, lit from above.
    g.globalCompositeOperation = 'source-over';
    const body = g.createRadialGradient(o.x - R * 0.28, o.y - R * 0.34, R * 0.08, o.x, o.y, R);
    body.addColorStop(0, rgba(pal.core, 0.95 * alpha));
    body.addColorStop(0.45, rgba(pal.mid, 0.9 * alpha));
    body.addColorStop(1, rgba(pal.edge, 0.85 * alpha));
    g.fillStyle = body;
    g.beginPath();
    if (reduced) g.arc(o.x, o.y, R, 0, TAU);
    else {
      for (let i = 0; i <= n; i++) {
        const k = i % n, a = (k / n) * TAU + t * 0.15;
        const rr = R * (1 + 0.16 * o.ring[k] * (0.4 + L));
        const x = o.x + Math.cos(a) * rr, y = o.y + Math.sin(a) * rr;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
    }
    g.fill();
    if (!reduced) {
      // Two thin rings of the same waveform, a little apart, for depth.
      g.globalCompositeOperation = 'lighter';
      for (const [k, c, off] of [[1.12, pal.mid, 1.7], [1.24, pal.edge, -1.1]]) {
        g.strokeStyle = rgba(c, (0.25 + 0.5 * L) * alpha);
        g.lineWidth = 1.4;
        g.beginPath();
        for (let i = 0; i <= n; i++) {
          const q = i % n, a = (q / n) * TAU - t * 0.1 * off;
          const rr = R * k * (1 + 0.2 * o.ring[(q + 7) % n] * (0.3 + L));
          const x = o.x + Math.cos(a) * rr, y = o.y + Math.sin(a) * rr;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      }
      // The particles: they orbit, twinkle, and the voice pushes them out.
      for (const p of o.parts) {
        p.a += p.v * dt * (1 + L * 3);
        const d = R * Math.min(1.6, p.d + L * 0.3 * p.z);
        const x = o.x + Math.cos(p.a) * d, y = o.y + Math.sin(p.a) * d * 0.92;
        const tw = 0.45 + 0.55 * Math.sin(t * (1.4 + p.z) + p.tw);
        g.fillStyle = rgba(pal.spark[p.c], (0.25 + 0.6 * tw) * alpha * (0.5 + L));
        g.beginPath(); g.arc(x, y, (0.5 + p.z * 0.6) * (0.8 + 0.5 * L), 0, TAU); g.fill();
      }
    } else {
      // A level ring instead of motion.
      g.strokeStyle = rgba(pal.core, (0.3 + 0.6 * L) * alpha);
      g.lineWidth = 2 + 3 * L;
      g.beginPath(); g.arc(o.x, o.y, R * 1.12, 0, TAU); g.stroke();
    }
    g.restore();
  }

  function frame(now) {
    if (!alive) return;
    const t = now / 1000;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    last = now;
    const { w, h } = size();
    const target = layout(src.phase, w, h);
    for (const k of ['user', 'bot']) {
      const o = st[k], to = target[k];
      // Reduced motion: the orbs are where they belong at once; otherwise they glide there.
      const e = reduced || !placed ? 1 : Math.min(1, dt * 5);
      o.x += (to.x - o.x) * e; o.y += (to.y - o.y) * e; o.r += (to.r - o.r) * e; o.a += (to.a - o.a) * (reduced || !placed ? 1 : Math.min(1, dt * 4));
    }
    placed = true;
    g.clearRect(0, 0, w, h);
    drawOrb(st.bot, BOT, t, dt, src.bot, 'bot');
    drawOrb(st.user, USER, t, dt, src.user, 'user');
    raf = requestAnimationFrame(frame);
  }

  return {
    set(o) { Object.assign(src, o); },
    start() { if (alive) return; alive = true; last = 0; raf = requestAnimationFrame(frame); },
    stop() { alive = false; cancelAnimationFrame(raf); },
    get running() { return alive; },
  };
}
