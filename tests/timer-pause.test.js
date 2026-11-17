// Plain Node script, no test framework/dependency. Run with: node tests/timer-pause.test.js
// Covers the active-play timer fix (js/state.js's pauseTimer/resumeTimer):
// elapsedSeconds (used for the star rating and best time) only counts time
// while nothing has it paused - time spent with the tab hidden/backgrounded
// or an overlay (Settings, "How to play") open must never be charged
// against the player. Uses a monkey-patched Date.now so the test controls
// time directly rather than waiting on real delays.
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

const { grid: Grid, state: State, platform: Platform } = globalThis.Garden;

let failures = 0;
let checks = 0;

function assert(condition, message) {
  checks++;
  if (!condition) {
    failures++;
    console.error('FAIL: ' + message);
  }
}

// Recomputes the level's unique solution independently of state.js's own
// solutionList, so these tests check against a value they derived themselves.
function solveBruteForce(grid) {
  const size = grid.size;
  const regionOf = [];
  for (let r = 0; r < size; r++) regionOf.push(grid.cells[r].map((c) => c.region));
  const colUsed = new Array(size).fill(false);
  const regionUsed = new Array(size).fill(false);
  const colsChosen = new Array(size).fill(-1);
  let solution = null;
  (function backtrack(row) {
    if (solution) return;
    if (row === size) {
      solution = colsChosen.slice();
      return;
    }
    for (let col = 0; col < size; col++) {
      if (colUsed[col]) continue;
      const region = regionOf[row][col];
      if (regionUsed[region]) continue;
      if (row > 0 && Math.abs(colsChosen[row - 1] - col) <= 1) continue;
      colUsed[col] = true;
      regionUsed[region] = true;
      colsChosen[row] = col;
      backtrack(row + 1);
      colUsed[col] = false;
      regionUsed[region] = false;
      if (solution) return;
    }
  })(0);
  return solution;
}

function solveLevel(game, grid, solution) {
  for (let row = 0; row < grid.size; row++) {
    const cell = grid.cells[row][solution[row]];
    if (cell.state === Grid.CellState.FLOWER) continue; // the pre-placed given flower
    game.tapCell(row, solution[row]);
    game.tapCell(row, solution[row]);
  }
}

function withFakeClock(fn) {
  const realDateNow = Date.now;
  let fakeNow = 1700000000000;
  Date.now = () => fakeNow;
  try {
    fn(function advance(ms) {
      fakeNow += ms;
    });
  } finally {
    Date.now = realDateNow;
  }
}

// --- Baseline: with nothing ever paused, elapsedSeconds matches real active time ---
withFakeClock(function (advance) {
  resetStorage();
  let lastEmitted = null;
  const game = State.createGame({ onChange: (snap) => { lastEmitted = snap; } });
  const snap = game.getSnapshot();
  const solution = solveBruteForce(snap.grid);

  advance(4000);
  solveLevel(game, snap.grid, solution);

  assert(lastEmitted.status === 'won', 'baseline: level solved');
  assert(lastEmitted.elapsedSeconds === 4, `baseline: elapsedSeconds matches the 4s of uninterrupted play (got ${lastEmitted.elapsedSeconds})`);
});

// --- Time paused (tab hidden) is never counted ---
withFakeClock(function (advance) {
  resetStorage();
  let lastEmitted = null;
  const game = State.createGame({ onChange: (snap) => { lastEmitted = snap; } });
  const snap = game.getSnapshot();
  const solution = solveBruteForce(snap.grid);

  advance(2000); // 2s active
  game.pauseTimer('visibility'); // tab hidden
  advance(100000); // 100s hidden - must not count
  game.resumeTimer('visibility'); // tab visible again
  advance(3000); // 3s active

  solveLevel(game, snap.grid, solution);

  assert(lastEmitted.status === 'won', 'hidden-time test: level solved');
  assert(
    lastEmitted.elapsedSeconds === 5,
    `hidden-time test: only the 2s + 3s active segments count, not the 100s hidden (got ${lastEmitted.elapsedSeconds})`
  );
});

// --- Overlapping pause reasons: resuming one (e.g. Settings closed) while
// another (tab still hidden) is still active must not restart the clock ---
withFakeClock(function (advance) {
  resetStorage();
  let lastEmitted = null;
  const game = State.createGame({ onChange: (snap) => { lastEmitted = snap; } });
  const snap = game.getSnapshot();
  const solution = solveBruteForce(snap.grid);

  advance(1000); // 1s active
  game.pauseTimer('visibility'); // tab goes hidden
  game.pauseTimer('settings'); // Settings also opened while hidden
  advance(50000); // 50s while both reasons are active - must not count
  game.resumeTimer('settings'); // Settings closed, but tab is still hidden
  advance(20000); // 20s more - still must not count, 'visibility' still paused
  game.resumeTimer('visibility'); // tab visible again - only now does it resume
  advance(2000); // 2s active

  solveLevel(game, snap.grid, solution);

  assert(lastEmitted.status === 'won', 'overlapping-pause test: level solved');
  assert(
    lastEmitted.elapsedSeconds === 3,
    `overlapping-pause test: only the 1s + 2s active segments count (got ${lastEmitted.elapsedSeconds})`
  );
});

// --- "How to play"/Settings open is treated the same as a hidden tab ---
withFakeClock(function (advance) {
  resetStorage();
  let lastEmitted = null;
  const game = State.createGame({ onChange: (snap) => { lastEmitted = snap; } });
  const snap = game.getSnapshot();
  const solution = solveBruteForce(snap.grid);

  advance(1000);
  game.pauseTimer('tutorial'); // "How to play" opened mid-level
  advance(60000);
  game.resumeTimer('tutorial');
  advance(1000);

  solveLevel(game, snap.grid, solution);

  assert(lastEmitted.status === 'won', 'overlay-pause test: level solved');
  assert(
    lastEmitted.elapsedSeconds === 2,
    `overlay-pause test: time spent with an overlay open never counts (got ${lastEmitted.elapsedSeconds})`
  );
});

// --- No idle timeout: a long, uninterrupted, fully active session still
// keeps counting the whole time - pausing only ever happens via an explicit
// pauseTimer() call, never automatically after inactivity. ---
withFakeClock(function (advance) {
  resetStorage();
  let lastEmitted = null;
  const game = State.createGame({ onChange: (snap) => { lastEmitted = snap; } });
  const snap = game.getSnapshot();
  const solution = solveBruteForce(snap.grid);

  advance(600000); // 10 minutes with no taps at all, never paused
  solveLevel(game, snap.grid, solution);

  assert(lastEmitted.status === 'won', 'no-idle-timeout test: level solved');
  assert(
    lastEmitted.elapsedSeconds === 600,
    `no-idle-timeout test: a long idle-but-visible stretch still counts in full (got ${lastEmitted.elapsedSeconds})`
  );
});

// --- Best-time schema migration: pre-existing best times (recorded under
// the old, unpaused timer) are wiped exactly once, without touching
// progress, total score, or helper charges. ---
(function () {
  resetStorage();
  // Simulate pre-migration storage: old best times already present (saved
  // the old way, so no garden.bestTimeLevels index either), no
  // schema-version key yet - as if written by a build before this fix.
  globalThis.localStorage.setItem('garden.bestTime.1', '9999');
  globalThis.localStorage.setItem('garden.bestTime.5', '500');
  globalThis.localStorage.setItem('garden.bestTimeLevels', JSON.stringify([1, 5]));
  globalThis.localStorage.setItem('garden.currentLevel', '7');
  globalThis.localStorage.setItem('garden.totalScore', '1234');
  globalThis.localStorage.setItem('garden.helperCharges', JSON.stringify({ finder: 3, random: 2, snowman: 1 }));

  // Platform is already loaded (required at the top of this file); calling
  // its exported migrateBestTimes() again runs the exact same migration the
  // module runs once on load, against whatever localStorage is current now.
  Platform.migrateBestTimes();

  assert(Platform.loadBestTime(1) === null, 'migration: a pre-existing best time is wiped (level 1)');
  assert(Platform.loadBestTime(5) === null, 'migration: a pre-existing best time is wiped (level 5)');
  assert(Platform.loadProgress() === 7, 'migration: progress (current level) is untouched');
  assert(Platform.loadTotalScore() === 1234, 'migration: total score is untouched');
  assert(
    JSON.stringify(Platform.loadHelperCharges()) === JSON.stringify({ finder: 3, random: 2, snowman: 1 }),
    'migration: helper charges are untouched'
  );

  // A fresh best time recorded after migration survives a second migration
  // call (idempotent - already-current schema version is a no-op).
  Platform.saveBestTime(9, 42);
  Platform.migrateBestTimes();
  assert(Platform.loadBestTime(9) === 42, 'migration: re-running the migration after it already ran does not wipe new best times');
})();

console.log(`${checks} checks run, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
