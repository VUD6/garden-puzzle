// Deterministic seeded PRNG (mulberry32). Returns a () => [0,1) function with
// the same signature as Math.random, so it drops straight into generator.js.
// No DOM dependency - safe to run in Node.
(function (root) {
  function createRng(seed) {
    let state = seed >>> 0;
    return function () {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const Rng = { createRng };

  root.Garden = root.Garden || {};
  root.Garden.rng = Rng;
})(typeof window !== 'undefined' ? window : globalThis);
