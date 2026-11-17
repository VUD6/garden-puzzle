// Plain Node script, no test framework/dependency. Run with: node tests/snowman-spread.test.js
// Covers Snowman's spread-placement fix (Garden.state.pickSpreadCrossCells):
// it must prefer cells in different rows, different columns, and different
// bed regions, never adjacent (including diagonally) to another cross it
// just chose, using true randomness (Math.random) rather than row order -
// relaxing those preferences one at a time whenever too few cells satisfy
// the full combination. Tested in isolation (not through a live game) so
// these checks are independent of any particular board/level.
require('../js/rng.js');
require('../js/grid.js');
require('../js/rules.js');
require('../js/solver.js');
require('../js/generator.js');
require('../js/levelstart.js');

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
require('../js/helpers.js');
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

function adjacent(a, b) {
  return Math.abs(a.row - b.row) <= 1 && Math.abs(a.col - b.col) <= 1;
}

function allDistinct(values) {
  return new Set(values).size === values.length;
}

// A generous pool spanning an 8x8 board, one cell per (row, col) with a
// region id spread out too - plenty of room to satisfy every preference at
// once, so the strict (unrelaxed) constraint level should always succeed.
function buildGenerousPool() {
  const pool = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      pool.push({ row, col, region: (row + col) % 8 });
    }
  }
  return pool;
}

// --- On a generous pool, every pick satisfies the full preference set:
// distinct rows, distinct columns, distinct regions, never adjacent - run
// many times since the picker uses true (unseeded) randomness. ---
for (let trial = 0; trial < 200; trial++) {
  const chosen = State.pickSpreadCrossCells(buildGenerousPool(), 3);
  assert(chosen.length === 3, `trial ${trial}: picks exactly 3 cells from a generous pool (got ${chosen.length})`);
  assert(allDistinct(chosen.map((c) => c.row)), `trial ${trial}: the 3 picks are in distinct rows`);
  assert(allDistinct(chosen.map((c) => c.col)), `trial ${trial}: the 3 picks are in distinct columns`);
  assert(allDistinct(chosen.map((c) => c.region)), `trial ${trial}: the 3 picks are in distinct regions`);
  for (let i = 0; i < chosen.length; i++) {
    for (let j = i + 1; j < chosen.length; j++) {
      assert(!adjacent(chosen[i], chosen[j]), `trial ${trial}: pick ${i} and pick ${j} are not adjacent (incl. diagonally)`);
    }
  }
}

// --- True randomness, not row order: across many trials on the generous
// pool, the picks vary - they are not always the first 3 cells in row-major
// order (the old, now-fixed behavior). ---
const seenFirstPicks = new Set();
for (let trial = 0; trial < 100; trial++) {
  const chosen = State.pickSpreadCrossCells(buildGenerousPool(), 3);
  seenFirstPicks.add(chosen[0].row + ',' + chosen[0].col);
}
assert(seenFirstPicks.size > 1, `picks vary across trials - not deterministic row order (saw ${seenFirstPicks.size} distinct first picks)`);
assert(!seenFirstPicks.has('0,0') || seenFirstPicks.size > 1, 'sanity: not always starting from the top-left cell');

// --- Relaxation: when only 3 cells exist at all, two of them sharing a row
// and being adjacent to each other, the picker still returns all 3 rather
// than stopping early once the strict constraints can't all be satisfied. ---
const tinyPool = [
  { row: 0, col: 0, region: 0 },
  { row: 0, col: 1, region: 0 }, // same row AND region AND adjacent to the first
  { row: 5, col: 5, region: 1 },
];
const tinyChosen = State.pickSpreadCrossCells(tinyPool, 3);
assert(tinyChosen.length === 3, `relaxation: all 3 available cells are returned even though they can't all satisfy every preference (got ${tinyChosen.length})`);

// --- Fewer eligible cells than requested: returns as many as exist, never throws ---
const scarcePool = [{ row: 2, col: 2, region: 0 }, { row: 6, col: 6, region: 1 }];
const scarceChosen = State.pickSpreadCrossCells(scarcePool, 3);
assert(scarceChosen.length === 2, `scarce pool: returns exactly the 2 cells that exist, not 3 (got ${scarceChosen.length})`);

// --- Empty pool: returns an empty list, never throws ---
const emptyChosen = State.pickSpreadCrossCells([], 3);
assert(Array.isArray(emptyChosen) && emptyChosen.length === 0, 'empty pool: returns an empty list');

// --- Requesting fewer than the pool offers still returns exactly that many ---
const twoFromGenerous = State.pickSpreadCrossCells(buildGenerousPool(), 2);
assert(twoFromGenerous.length === 2, `requesting 2 from a generous pool returns exactly 2 (got ${twoFromGenerous.length})`);

console.log(`${checks} checks run, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
