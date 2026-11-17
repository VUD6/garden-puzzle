// Plain Node script, no test framework/dependency. Run with: node tests/generator-caps.test.js
// Scans levels 1-200 and asserts the two generation caps hold everywhere,
// including on milestone levels: at most 1 pre-placed gingerbread per level
// (every start type, "rich" included - see js/levelstart.js), and the
// single-cell-region cap (levels 1-5 uncapped, 6+ at most 1 per board and
// only on a level that's a multiple of 4, otherwise zero - see
// Garden.state.singleCellRegionCap in js/state.js). Also re-confirms
// uniqueness/solvability is unaffected by either cap.
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
require('../js/state.js');

const { state: State, solver: Solver, generator: Generator } = globalThis.Garden;

let failures = 0;
let checks = 0;

function assert(condition, message) {
  checks++;
  if (!condition) {
    failures++;
    console.error('FAIL: ' + message);
  }
}

const MAX_LEVEL = 200;
let milestonesChecked = 0;
let cappedLevelsWithExactlyOne = 0;

for (let level = 1; level <= MAX_LEVEL; level++) {
  const built = State.buildLevel(level);
  const isMilestone = globalThis.Garden.levelstart.isMilestoneLevel(level);
  if (isMilestone) milestonesChecked++;

  // --- At most 1 pre-placed gingerbread, every level, every start type,
  // including milestones (which are always "rich") ---
  assert(
    built.givenFlowers.length <= 1,
    `level ${level} (${built.startType}${isMilestone ? ', milestone' : ''}): at most 1 pre-placed gingerbread (got ${built.givenFlowers.length})`
  );

  // --- Single-cell-region cap ---
  const cap = State.singleCellRegionCap(level);
  const singleCellCount = Generator.countSingleCellRegions(built.size, built.regionOf);
  if (level <= State.SINGLE_CELL_REGION_FREE_MAX_LEVEL) {
    assert(cap === Infinity, `level ${level}: onboarding levels (<=${State.SINGLE_CELL_REGION_FREE_MAX_LEVEL}) are uncapped`);
  } else if (level % State.SINGLE_CELL_REGION_INTERVAL === 0) {
    assert(cap === 1, `level ${level}: every ${State.SINGLE_CELL_REGION_INTERVAL}th level from 6 on allows at most 1 single-cell region`);
    if (singleCellCount === 1) cappedLevelsWithExactlyOne++;
    assert(singleCellCount <= 1, `level ${level}: at most 1 single-cell region (got ${singleCellCount})`);
  } else {
    assert(cap === 0, `level ${level}: every other level from 6 on must have zero single-cell regions`);
    assert(singleCellCount === 0, `level ${level}: zero single-cell regions (got ${singleCellCount}) - every region needs 2+ cells`);
  }

  // --- Uniqueness/solvability unaffected by either cap ---
  assert(Solver.hasUniqueSolution(built.size, built.regionOf), `level ${level}: still has a unique solution`);
}

assert(milestonesChecked > 0, `sanity: scanned at least one milestone level in 1-${MAX_LEVEL} (found ${milestonesChecked})`);
assert(
  cappedLevelsWithExactlyOne > 0,
  `sanity: at least one level actually used its allowed single-cell region, not just zero every time (found ${cappedLevelsWithExactlyOne})`
);

console.log(`${checks} checks run, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
