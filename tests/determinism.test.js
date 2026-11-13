// Plain Node script, no test framework/dependency. Run with: node tests/determinism.test.js
// Requirement: level N must look identical (beds, colors, pre-placed flower)
// for every player and every reload, because it's derived from a PRNG seeded
// by the level number - never Math.random.
require('../js/rng.js');
require('../js/grid.js');
require('../js/rules.js');
require('../js/solver.js');
require('../js/generator.js');
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

function regionsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let r = 0; r < a.length; r++) {
    if (a[r].length !== b[r].length) return false;
    for (let c = 0; c < a[r].length; c++) {
      if (a[r][c] !== b[r][c]) return false;
    }
  }
  return true;
}

const LEVELS = [1, 2, 3, 4, 5, 8, 13, 21, 34, 50];

for (const level of LEVELS) {
  const a = State.buildLevel(level);
  const b = State.buildLevel(level);

  assert(a.size === b.size, `level ${level}: size identical across two builds`);
  assert(regionsEqual(a.regionOf, b.regionOf), `level ${level}: regionOf (beds/colors) identical across two builds`);
  assert(JSON.stringify(a.solution) === JSON.stringify(b.solution), `level ${level}: solution identical across two builds`);
  assert(a.givenIndex === b.givenIndex, `level ${level}: pre-placed flower index identical across two builds`);
}

// Sanity: different levels should (almost always) differ from each other -
// guards against a seeding bug that collapses every level to the same puzzle.
const sizes = new Set();
const serialized = new Set();
for (const level of LEVELS) {
  const built = State.buildLevel(level);
  sizes.add(built.size);
  serialized.add(JSON.stringify(built.regionOf) + '|' + JSON.stringify(built.solution));
}
assert(serialized.size === LEVELS.length, 'different level numbers produce different puzzles');

console.log(`${checks} checks run, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
