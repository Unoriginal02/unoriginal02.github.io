/* ============================================================
   DITHERPUNK — Seeded RNG
   Shared by the main thread and the worker (importScripts).

   Every random-driven stage (noise, glitch, pixel sort) draws
   from a stream derived from the global seed, so a saved preset
   or an undo step reproduces the exact same image.
   ============================================================ */

'use strict';

// ── mulberry32 — small, fast, good enough for visual noise ──
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Derive an independent stream from (seed, salt) ──────────
// Each effect in the stack passes its own salt so reordering the
// stack doesn't reshuffle every other effect's randomness.
function hashSeed(seed, salt) {
  let h = (seed >>> 0) ^ 0x9E3779B9;
  const s = String(salt);
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function makeStream(seed, salt) {
  return makeRng(hashSeed(seed, salt));
}

// Random 32-bit seed for the "new seed" / randomize actions
function randomSeed() {
  return (Math.random() * 0xFFFFFFFF) >>> 0;
}

// Expose in both contexts (window in the page, self in the worker)
if (typeof self !== 'undefined') {
  self.makeRng = makeRng;
  self.hashSeed = hashSeed;
  self.makeStream = makeStream;
  self.randomSeed = randomSeed;
}
