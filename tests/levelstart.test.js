// Plain Node script, no test framework/dependency. Run with: node tests/levelstart.test.js
// Covers the level start-type schedule (js/levelstart.js): the exact
// gift/none/rich/notes table for levels 1-60, determinism, that it never
// perturbs level generation (regionOf/solution stay bit-for-bit identical to
// the pre-existing buildLevel algorithm), the none/notes/rich shape rules,
// unique-solution preservation, and the milestone helper-charge reward
// (granted once, only through Garden.helpers.addCharges).
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

function resetStorage() {
  globalThis.localStorage = makeMemoryStorage();
}

resetStorage();
require('../js/platform.js');
require('../js/helpers.js');
require('../js/state.js');

const { rng: Rng, grid: Grid, generator: Generator, levelstart: LevelStart, state: State, platform: Platform, helpers: Helpers } =
  globalThis.Garden;
const { START_TYPES } = LevelStart;

let failures = 0;
let checks = 0;

function assert(condition, message) {
  checks++;
  if (!condition) {
    failures++;
    console.error('FAIL: ' + message);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function gridSizeForLevel(level) {
  return State.gridSizeForLevel(level);
}

// --- Exact schedule table, levels 1-60 (pins the real deterministic output -
// a future tweak to the rng/weights would be caught here, same convention
// as tests/progression-speed.test.js's EXPECTED size table). ---
const EXPECTED_TYPE = {
  1: 'gift', 2: 'gift', 3: 'gift', 4: 'gift', 5: 'gift', 6: 'gift', 7: 'gift', 8: 'gift', 9: 'gift',
  10: 'rich', 11: 'gift', 12: 'rich', 13: 'gift', 14: 'rich', 15: 'none', 16: 'notes', 17: 'notes',
  18: 'rich', 19: 'gift', 20: 'rich', 21: 'gift', 22: 'gift', 23: 'rich', 24: 'rich', 25: 'none',
  26: 'rich', 27: 'rich', 28: 'rich', 29: 'notes', 30: 'rich', 31: 'gift', 32: 'gift', 33: 'gift',
  34: 'notes', 35: 'none', 36: 'notes', 37: 'rich', 38: 'gift', 39: 'rich', 40: 'rich', 41: 'gift',
  42: 'notes', 43: 'rich', 44: 'rich', 45: 'none', 46: 'rich', 47: 'rich', 48: 'rich', 49: 'notes',
  50: 'rich', 51: 'notes', 52: 'gift', 53: 'gift', 54: 'rich', 55: 'none', 56: 'gift', 57: 'gift',
  58: 'rich', 59: 'gift', 60: 'rich',
};
const EXPECTED_MILESTONE_LEVELS = new Set([10, 20, 30, 40, 50, 60]);
const EXPECTED_NONE_LEVELS = new Set([15, 25, 35, 45, 55]);

for (const level of Object.keys(EXPECTED_TYPE)) {
  const n = Number(level);
  assert(
    LevelStart.startTypeForLevel(n) === EXPECTED_TYPE[level],
    `level ${level}: start type is ${EXPECTED_TYPE[level]} (got ${LevelStart.startTypeForLevel(n)})`
  );
  assert(
    LevelStart.levelKind(n) === (EXPECTED_MILESTONE_LEVELS.has(n) ? 'milestone' : 'normal'),
    `level ${level}: level kind is ${EXPECTED_MILESTONE_LEVELS.has(n) ? 'milestone' : 'normal'}`
  );
}

// --- Levels 1-9 are always gift, every multiple of 10 is a milestone
// (rich), every other multiple of 5 is none - as broad schedule-shape
// invariants, independent of the pinned table above. ---
for (let level = 1; level <= 9; level++) {
  assert(LevelStart.startTypeForLevel(level) === START_TYPES.GIFT, `level ${level} (<=9): always gift`);
}
for (let level = 10; level <= 200; level += 10) {
  assert(LevelStart.startTypeForLevel(level) === START_TYPES.RICH, `level ${level}: milestone is always rich`);
  assert(LevelStart.levelKind(level) === 'milestone', `level ${level}: is a milestone`);
}
for (let level = 15; level <= 200; level += 10) {
  assert(LevelStart.startTypeForLevel(level) === START_TYPES.NONE, `level ${level}: every other multiple of 5 is none`);
  assert(LevelStart.levelKind(level) === 'normal', `level ${level}: a none level is not a milestone`);
}

// --- Determinism: buildLevelStart(level, solution, size) is pure given the
// same inputs, for a sample spanning every start type. ---
for (const level of [1, 10, 15, 16, 18, 29, 40]) {
  const size = gridSizeForLevel(level);
  const solution = Generator.generateLevel(size, Rng.createRng(level)).solution;
  const a = LevelStart.buildLevelStart(level, solution, size);
  const b = LevelStart.buildLevelStart(level, solution, size);
  assert(a.type === b.type, `level ${level}: start type identical across two calls`);
  assert(JSON.stringify(a.givenFlowers) === JSON.stringify(b.givenFlowers), `level ${level}: given flowers identical across two calls`);
  assert(JSON.stringify(a.crossCells) === JSON.stringify(b.crossCells), `level ${level}: cross cells identical across two calls`);
}

// --- Generation untouched BY START-TYPE LOGIC specifically: State.buildLevel's
// regionOf/solution must stay bit-for-bit identical to calling
// Generator.generateLevel directly with the exact same single-cell-region
// cap buildLevel itself applies (Garden.state.singleCellRegionCap) - i.e.
// levelstart.js's own random draws (which type, how many given/crosses)
// never perturb generation, even though the single-cell-region cap (a
// separate, deliberate generation change - see tests/generator.test.js and
// the dedicated cap-scan test below) does. Across a sample of levels
// spanning every grid size. ---
const GENERATION_SAMPLE = [1, 2, 3, 5, 6, 9, 10, 13, 15, 16, 20, 25, 34, 40, 50, 60, 70, 80];
for (const level of GENERATION_SAMPLE) {
  const size = gridSizeForLevel(level);
  const expected = Generator.generateLevel(size, Rng.createRng(level), undefined, State.singleCellRegionCap(level));
  const built = State.buildLevel(level);
  assert(built.size === size, `level ${level}: buildLevel size matches today's algorithm`);
  assert(
    JSON.stringify(built.regionOf) === JSON.stringify(expected.regionOf),
    `level ${level}: buildLevel regionOf identical to today's algorithm (untouched by start-type logic)`
  );
  assert(
    JSON.stringify(built.solution) === JSON.stringify(expected.solution),
    `level ${level}: buildLevel solution identical to today's algorithm (untouched by start-type logic)`
  );
}

// --- none: zero pre-placed cells of any kind ---
for (const level of [15, 25, 35, 45, 55, 65, 75]) {
  const built = State.buildLevel(level);
  assert(built.startType === START_TYPES.NONE, `level ${level}: is a none level`);
  assert(built.givenFlowers.length === 0, `level ${level} (none): zero pre-placed flowers`);
  assert(built.crossCells.length === 0, `level ${level} (none): zero pre-placed crosses`);
}

// --- notes: 0-1 given, 5-10 crosses, crosses never on a solution cell ---
let notesSamplesChecked = 0;
for (let level = 10; level <= 300 && notesSamplesChecked < 15; level++) {
  const built = State.buildLevel(level);
  if (built.startType !== START_TYPES.NOTES) continue;
  notesSamplesChecked++;
  const solutionKeys = new Set(built.solution.map((p) => p.row + ',' + p.col));
  assert(built.givenFlowers.length <= 1, `level ${level} (notes): at most 1 pre-placed flower`);
  assert(
    built.crossCells.length >= 5 && built.crossCells.length <= 10,
    `level ${level} (notes): 5-10 pre-placed crosses (got ${built.crossCells.length})`
  );
  assert(
    built.crossCells.every((pos) => !solutionKeys.has(pos.row + ',' + pos.col)),
    `level ${level} (notes): every pre-placed cross is on a non-solution cell`
  );
}
assert(notesSamplesChecked >= 10, `found enough 'notes' levels to sample (${notesSamplesChecked})`);

// --- "fewer if fewer eligible cells exist" - a direct unit test of the
// sampling helper itself, since every real board size offers at least 12
// non-solution cells (comfortably more than the max of 10 ever requested),
// so this fallback path is never reachable through real level sizes. ---
const smallPool = [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }];
const over = LevelStart.pickWithoutReplacement(smallPool, 10, Rng.createRng(1));
assert(over.length === 3, 'pickWithoutReplacement caps at the pool size when asked for more than exists');

// --- rich: 0 given flowers (never more than 1 pre-placed gingerbread,
// which "gift" already provides), 8-12 crosses instead, never on a
// solution cell - a distinct, generous-feeling start that doesn't blow the
// per-level gingerbread cap. ---
let richSamplesChecked = 0;
for (let level = 1; level <= 300 && richSamplesChecked < 15; level++) {
  const built = State.buildLevel(level);
  if (built.startType !== START_TYPES.RICH) continue;
  richSamplesChecked++;
  const solutionKeys = new Set(built.solution.map((p) => p.row + ',' + p.col));
  assert(built.givenFlowers.length === 0, `level ${level} (rich): zero pre-placed flowers`);
  assert(
    built.crossCells.length >= LevelStart.RICH_CROSS_MIN && built.crossCells.length <= LevelStart.RICH_CROSS_MAX,
    `level ${level} (rich): ${LevelStart.RICH_CROSS_MIN}-${LevelStart.RICH_CROSS_MAX} pre-placed crosses (got ${built.crossCells.length})`
  );
  assert(
    built.crossCells.every((pos) => !solutionKeys.has(pos.row + ',' + pos.col)),
    `level ${level} (rich): every pre-placed cross is on a non-solution cell`
  );
}
assert(richSamplesChecked >= 10, `found enough 'rich' levels to sample (${richSamplesChecked})`);

// --- Unique solution still holds with the final start set, across every
// grid size in the progression (the start set never touches regionOf, so
// this is really re-confirming the existing invariant flows through the
// refactor unmodified). ---
const Solver = globalThis.Garden.solver;
for (const level of [1, 3, 6, 10, 15, 30, 55]) {
  const built = State.buildLevel(level);
  assert(Solver.hasUniqueSolution(built.size, built.regionOf), `level ${level}: still has a unique solution`);
}

// --- Milestone reward: +1 charge of each helper, granted only on a
// milestone level's first-ever completion, only through Helpers.addCharges,
// never re-granted on replay. milestoneReward is a one-shot field delivered
// only through the onChange payload at the moment the level is won (same as
// winFill/scoreGain/mistake/helperPlant) - a later getSnapshot() call does
// NOT carry it, so it must be captured via onChange, not polled for.
async function testMilestoneReward() {
  resetStorage();
  Helpers.addCharges('finder', 30); // headroom regardless of board size/given count
  Platform.saveProgress(10); // first milestone level
  let lastEmitted = null;
  let game = State.createGame({ onChange: (snap) => { lastEmitted = snap; } });
  assert(lastEmitted.levelKind === 'milestone', 'level 10 is a milestone');

  const randomBefore = Helpers.getCharges('random');
  const snowmanBefore = Helpers.getCharges('snowman');

  let guard = 0;
  while (lastEmitted.status === 'playing' && guard < 50) {
    guard++;
    game.useHelper('finder');
    if (lastEmitted.status !== 'playing') break;
    await wait(State.HELPER_LOCK_MS + 30);
  }

  assert(lastEmitted.status === 'won', 'level 10 solved via Finder');
  assert(
    lastEmitted.milestoneReward && lastEmitted.milestoneReward.amount === State.MILESTONE_HELPER_REWARD,
    `first-ever completion grants the milestone reward (amount ${State.MILESTONE_HELPER_REWARD})`
  );
  assert(
    Helpers.getCharges('random') === randomBefore + State.MILESTONE_HELPER_REWARD,
    'random helper charges increased by exactly the milestone reward amount'
  );
  assert(
    Helpers.getCharges('snowman') === snowmanBefore + State.MILESTONE_HELPER_REWARD,
    'snowman helper charges increased by exactly the milestone reward amount'
  );

  // --- Replay (Retry) never re-grants it ---
  Helpers.addCharges('finder', 30);
  const randomAfterFirstWin = Helpers.getCharges('random');
  const snowmanAfterFirstWin = Helpers.getCharges('snowman');

  game.retryLevel();
  guard = 0;
  while (lastEmitted.status === 'playing' && guard < 50) {
    guard++;
    game.useHelper('finder');
    if (lastEmitted.status !== 'playing') break;
    await wait(State.HELPER_LOCK_MS + 30);
  }

  assert(lastEmitted.status === 'won', 'level 10 solved again via Finder after retry');
  assert(lastEmitted.milestoneReward === null, 'replaying an already-completed milestone level grants no reward');
  assert(Helpers.getCharges('random') === randomAfterFirstWin, 'random charges unchanged on replay');
  assert(Helpers.getCharges('snowman') === snowmanAfterFirstWin, 'snowman charges unchanged on replay');

  // --- A non-milestone level's first completion grants no milestone reward ---
  resetStorage();
  Helpers.addCharges('finder', 30);
  Platform.saveProgress(11); // gift, not a milestone
  lastEmitted = null;
  game = State.createGame({ onChange: (snap) => { lastEmitted = snap; } });
  assert(lastEmitted.levelKind === 'normal', 'level 11 is not a milestone');
  guard = 0;
  while (lastEmitted.status === 'playing' && guard < 50) {
    guard++;
    game.useHelper('finder');
    if (lastEmitted.status !== 'playing') break;
    await wait(State.HELPER_LOCK_MS + 30);
  }
  assert(lastEmitted.status === 'won', 'level 11 solved via Finder');
  assert(lastEmitted.milestoneReward === null, 'a non-milestone level grants no milestone reward on completion');
}

testMilestoneReward().then(function () {
  console.log(`${checks} checks run, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
});
