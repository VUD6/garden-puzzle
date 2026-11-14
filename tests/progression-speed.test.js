// Plain Node script, no test framework/dependency. Run with: node tests/progression-speed.test.js
// Covers the level -> grid size progression and guards 8x8 generation speed.
require('../js/rng.js');
require('../js/grid.js');
require('../js/rules.js');
require('../js/solver.js');
require('../js/generator.js');

function makeMemoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

globalThis.localStorage = makeMemoryStorage();
require('../js/platform.js');
require('../js/state.js');

const { state: State } = globalThis.Garden;

let failures = 0;
let checks = 0;

function assert(condition, message) {
  checks++;
  if (!condition) {
    failures++;
    console.error('FAIL: ' + message);
  }
}

// --- Grid size progression: 1-2:4, 3-5:5, 6-9:6, 10-14:7, 15+:8 ---
const EXPECTED = {
  1: 4, 2: 4,
  3: 5, 4: 5, 5: 5,
  6: 6, 7: 6, 8: 6, 9: 6,
  10: 7, 11: 7, 12: 7, 13: 7, 14: 7,
  15: 8, 16: 8, 50: 8, 1000: 8,
};

for (const level of Object.keys(EXPECTED)) {
  const expectedSize = EXPECTED[level];
  const actualSize = State.gridSizeForLevel(Number(level));
  assert(actualSize === expectedSize, `level ${level}: grid size is ${expectedSize} (got ${actualSize})`);
}

// --- Exactly one pre-placed locked flower at every size in the progression ---
for (const level of [1, 3, 6, 10, 15]) {
  const built = State.buildLevel(level);
  assert(built.givenIndex >= 0 && built.givenIndex < built.solution.length, `level ${level}: has a valid pre-placed flower index`);
}

// --- 8x8 generation must be fast (well under 1 second), across many real seeds ---
const SPEED_LIMIT_MS = 1000;
let maxMs = 0;
for (let level = 15; level < 15 + 60; level++) {
  const t0 = Date.now();
  State.buildLevel(level);
  const dt = Date.now() - t0;
  if (dt > maxMs) maxMs = dt;
  assert(dt < SPEED_LIMIT_MS, `level ${level} (8x8) generates in under ${SPEED_LIMIT_MS}ms (took ${dt}ms)`);
}
console.log(`(info) slowest 8x8 build among levels 15-74: ${maxMs}ms`);

console.log(`${checks} checks run, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
