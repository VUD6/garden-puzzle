// Plain Node script, no test framework/dependency. Run with: node tests/helpers.test.js
// Covers the Helpers step: per-helper charge storage (grant-once, never
// negative, corruption-tolerant), Finder/Random/Snowman behavior, the
// Snowman level-10 lock (by highest level reached, not current level),
// cross-placement eligibility rules, double-spend protection, zero-effect
// on score/lives/mistakes/stars, a helper-planted flower triggering a win,
// and that old seed-era storage keys are simply ignored.
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

function resetStorage() {
  globalThis.localStorage = makeMemoryStorage();
}

resetStorage();
require('../js/platform.js');
require('../js/helpers.js');
require('../js/state.js');

const { grid: Grid, state: State, platform: Platform, helpers: Helpers, rng: Rng } = globalThis.Garden;

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

// Recomputes the level's unique solution straight from the generated region
// data (independent of state.js's internal solutionList), so tests verify
// targeting against a value they derived themselves.
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

function findLowestUnplantedRow(grid, solCols) {
  for (let row = 0; row < grid.size; row++) {
    if (grid.cells[row][solCols[row]].state !== Grid.CellState.FLOWER) return row;
  }
  return -1;
}

function gridSnapshot(grid) {
  return grid.cells.map((row) => row.map((c) => ({ state: c.state, locked: c.locked })));
}

async function solveLevelWithFinderOnly(game) {
  let snap = game.getSnapshot();
  let guard = 0;
  while (snap.status === 'playing' && guard < 50) {
    guard++;
    const used = game.useHelper('finder');
    if (used) {
      snap = game.getSnapshot();
      if (snap.status !== 'playing') break;
    }
    await wait(State.HELPER_LOCK_MS + 30);
    snap = game.getSnapshot();
  }
  return game.getSnapshot();
}

async function main() {
  // --- Starting charges: 5 per helper, granted once on first-ever launch ---
  resetStorage();
  Helpers.HELPER_IDS.forEach(function (id) {
    assert(Helpers.getCharges(id) === Helpers.STARTING_CHARGES, id + ' starts with ' + Helpers.STARTING_CHARGES + ' charges');
  });
  assert(globalThis.localStorage.getItem('garden.helperCharges') !== null, 'the starting grant is persisted immediately, not just returned');

  // --- spendCharge: exactly once per call, never goes negative ---
  resetStorage();
  for (let i = 0; i < Helpers.STARTING_CHARGES; i++) {
    assert(Helpers.spendCharge('finder') === true, 'spendCharge succeeds while charges remain (use ' + (i + 1) + ')');
  }
  assert(Helpers.getCharges('finder') === 0, 'all 5 starting charges can be spent down to 0');
  assert(Helpers.spendCharge('finder') === false, 'spendCharge fails at 0 charges');
  assert(Helpers.getCharges('finder') === 0, 'a failed spend never goes negative');

  // --- addCharges never goes negative and other helpers are untouched ---
  resetStorage();
  Helpers.addCharges('snowman', 2);
  assert(Helpers.getCharges('snowman') === Helpers.STARTING_CHARGES + 2, 'addCharges adds on top of the starting grant');
  assert(Helpers.getCharges('finder') === Helpers.STARTING_CHARGES, 'addCharges on one helper never affects another');

  // --- Corrupted charge storage defaults to 0, not a fresh grant ---
  resetStorage();
  globalThis.localStorage.setItem('garden.helperCharges', 'not json at all {{{');
  assert(Helpers.getCharges('finder') === 0, 'unparsable charge storage defaults to 0 for every helper, not a fresh 5-charge grant');

  // --- Old seed-era storage keys are simply ignored (no migration) ---
  resetStorage();
  globalThis.localStorage.setItem('garden.seeds', '999');
  assert(Helpers.getCharges('finder') === Helpers.STARTING_CHARGES, 'a leftover garden.seeds key from before this step has no effect on the fresh charge grant');
  assert(typeof Platform.loadSeeds === 'undefined', 'the old seeds API no longer exists on platform.js');

  // --- Snowman is locked below level 10, unlocked at/above it, by the highest level reached ---
  resetStorage();
  assert(Helpers.isUnlocked('snowman') === false, 'snowman starts locked (highest level reached defaults to 1)');
  assert(Helpers.isUnlocked('finder') === true, 'finder is never locked');
  assert(Helpers.isUnlocked('random') === true, 'random is never locked');
  Platform.saveHighestLevel(9);
  assert(Helpers.isUnlocked('snowman') === false, 'snowman stays locked at level 9');
  Platform.saveHighestLevel(10);
  assert(Helpers.isUnlocked('snowman') === true, 'snowman unlocks once the highest level reached hits 10');
  // "Highest level reached", not "current level": viewing/saving progress on
  // an earlier level again must never re-lock it.
  Platform.saveProgress(3);
  assert(Helpers.isUnlocked('snowman') === true, 'snowman stays unlocked when the current level drops back below 10 - only the highest-ever level matters');

  // --- startLevel/nextLevel keep platform.highestLevel monotonically non-decreasing ---
  resetStorage();
  let game = State.createGame({ onChange: () => {} });
  for (let i = 0; i < 9; i++) game.nextLevel();
  assert(game.getSnapshot().level === 10, 'sanity: advanced to level 10 via nextLevel()');
  assert(Platform.loadHighestLevel() === 10, 'reaching level 10 in a real game updates the highest-level record');
  assert(game.getSnapshot().helpers.snowman.locked === false, "snowman's snapshot reports unlocked once level 10 is actually reached");

  // --- Finder: deterministic lowest-row target, same as the old hint system ---
  resetStorage();
  game = State.createGame({ onChange: () => {} });
  let snap = game.getSnapshot();
  let solCols = solveBruteForce(snap.grid);

  let expectedRow = findLowestUnplantedRow(snap.grid, solCols);
  let used = game.useHelper('finder');
  assert(used === true, 'finder succeeds when charges and an unplanted solution flower are available');
  let targetCell = snap.grid.cells[expectedRow][solCols[expectedRow]];
  assert(targetCell.state === Grid.CellState.FLOWER && targetCell.locked, 'finder plants a locked flower at the lowest-row unplanted solution cell (row ' + expectedRow + ')');

  await wait(State.HELPER_LOCK_MS + 30);
  const expectedRow2 = findLowestUnplantedRow(snap.grid, solCols);
  assert(expectedRow2 > expectedRow, 'the next finder target has a strictly higher row than the previous one');
  game.useHelper('finder');
  const targetCell2 = snap.grid.cells[expectedRow2][solCols[expectedRow2]];
  assert(targetCell2.state === Grid.CellState.FLOWER && targetCell2.locked, 'a second finder use (after the lock clears) plants the next lowest-row flower');

  // --- Charge cost: deducts exactly 1, persists it ---
  resetStorage();
  game = State.createGame({ onChange: () => {} });
  const chargesBefore = game.getSnapshot().helpers.finder.charges;
  game.useHelper('finder');
  const chargesAfter = game.getSnapshot().helpers.finder.charges;
  assert(chargesBefore - chargesAfter === 1, 'finder deducts exactly 1 charge (got ' + (chargesBefore - chargesAfter) + ')');
  assert(Helpers.getCharges('finder') === chargesAfter, 'the deduction is persisted immediately');

  // --- Double-spend protection: a rapid repeated tap spends once, per helper ---
  resetStorage();
  game = State.createGame({ onChange: () => {} });
  const beforeRapid = game.getSnapshot().helpers.finder.charges;
  const firstCall = game.useHelper('finder');
  const secondCallImmediately = game.useHelper('finder'); // same tick - must be rejected
  const afterRapid = game.getSnapshot().helpers.finder.charges;
  assert(firstCall === true, 'the first of two rapid finder calls succeeds');
  assert(secondCallImmediately === false, 'an immediate second finder call is rejected (double-spend lock)');
  assert(beforeRapid - afterRapid === 1, 'only one charge was spent despite two rapid calls (got ' + (beforeRapid - afterRapid) + ')');
  await wait(State.HELPER_LOCK_MS + 30);
  assert(game.useHelper('finder') === true, 'a finder call succeeds again once its lock window has passed');

  // --- A helper's lock is per-helper, not global ---
  resetStorage();
  game = State.createGame({ onChange: () => {} });
  assert(game.useHelper('finder') === true, 'finder succeeds');
  const snowmanRightAfterFinder = game.canUseHelper('snowman');
  assert(snowmanRightAfterFinder === false, 'sanity: snowman is locked below level 10 regardless, so this only checks finder did not block it for the wrong reason');
  Platform.saveHighestLevel(10);
  assert(game.canUseHelper('snowman') === true, "using finder does not lock snowman's own 400ms window");

  // --- Insufficient charges blocks the helper (no board/charge change) ---
  resetStorage();
  game = State.createGame({ onChange: () => {} });
  for (let i = 0; i < Helpers.STARTING_CHARGES; i++) game.useHelper('finder');
  await Promise.resolve();
  // Drain via spendCharge directly in case the board ran out of solution
  // flowers before all 5 charges were used (a 4x4 level only needs 3 more
  // after the given flower) - this test only cares about the 0-charge path.
  while (Helpers.getCharges('finder') > 0) Helpers.spendCharge('finder');
  snap = game.getSnapshot();
  assert(snap.helpers.finder.canUse === false, 'canUse is false once charges reach 0');
  const boardBefore = JSON.stringify(gridSnapshot(snap.grid));
  await wait(State.HELPER_LOCK_MS + 30);
  const blockedResult = game.useHelper('finder');
  const boardAfter = JSON.stringify(gridSnapshot(snap.grid));
  assert(blockedResult === false, 'useHelper() returns false at 0 charges');
  assert(boardBefore === boardAfter, 'a 0-charge finder attempt never changes the board');

  // --- A helper never affects score, mistakes, or lives ---
  resetStorage();
  game = State.createGame({ onChange: () => {} });
  snap = game.getSnapshot();
  const livesBefore = snap.lives;
  const levelScoreBefore = snap.levelScore;
  game.useHelper('finder');
  let afterSnap = game.getSnapshot();
  assert(afterSnap.lives === livesBefore, 'finder does not cost a life');
  assert(afterSnap.levelScore === levelScoreBefore, 'finder earns no points (+0, not +10)');

  await wait(State.HELPER_LOCK_MS + 30);
  Platform.saveHighestLevel(10);
  game.useHelper('random');
  afterSnap = game.getSnapshot();
  assert(afterSnap.lives === livesBefore, 'random does not cost a life, regardless of its roll');
  assert(afterSnap.levelScore === levelScoreBefore, 'random earns no points, regardless of its roll');

  // --- Completing a level entirely via Finder: win triggered, 0 score, perfect ---
  resetStorage();
  let onChangeSnap = null;
  game = State.createGame({ onChange: (s) => { onChangeSnap = s; } });
  const finalSnap = await solveLevelWithFinderOnly(game);
  assert(finalSnap.status === 'won', 'a level can be fully solved using only Finder');
  assert(onChangeSnap.helperPlant !== null && onChangeSnap.helperPlant !== undefined, 'the winning change carries the helper-planted position (last flower was placed by Finder)');
  assert(finalSnap.levelScore === 0, 'a finder-only win earns 0 level score');
  assert(finalSnap.perfect === true, 'a finder-only win keeps all lives (no mistakes made)');
  assert(onChangeSnap.rating === 3, 'zero mistakes, finder-only win rates 3 stars (got ' + onChangeSnap.rating + ')');

  // --- Finder/helper state survives reload: locked flower + charges persist ---
  resetStorage();
  game = State.createGame({ onChange: () => {} });
  snap = game.getSnapshot();
  solCols = solveBruteForce(snap.grid);
  const finderRow = findLowestUnplantedRow(snap.grid, solCols);
  game.useHelper('finder');
  const chargesBeforeReload = game.getSnapshot().helpers.finder.charges;

  const reloadedGame = State.createGame({ onChange: () => {} });
  const reloadedSnap = reloadedGame.getSnapshot();
  const reloadedCell = reloadedSnap.grid.cells[finderRow][solCols[finderRow]];
  assert(reloadedCell.state === Grid.CellState.FLOWER && reloadedCell.locked, 'the finder-planted flower is restored, locked, after a reload');
  assert(reloadedSnap.helpers.finder.charges === chargesBeforeReload, 'the charge balance is unaffected by the reload (no refund, no re-grant)');

  // --- Retry does not refund charges already spent this attempt ---
  resetStorage();
  game = State.createGame({ onChange: () => {} });
  const chargesBeforeFinderAndRetry = game.getSnapshot().helpers.finder.charges;
  game.useHelper('finder');
  const chargesAfterFinder = game.getSnapshot().helpers.finder.charges;
  game.retryLevel();
  const chargesAfterRetry = game.getSnapshot().helpers.finder.charges;
  assert(chargesAfterFinder < chargesBeforeFinderAndRetry, 'sanity: finder actually spent a charge');
  assert(chargesAfterRetry === chargesAfterFinder, 'Retry does not refund a charge already spent on a helper');

  // --- Snowman: places up to 3 crosses, never on solution/locked/already-marked cells ---
  resetStorage();
  Platform.saveHighestLevel(10);
  game = State.createGame({ onChange: () => {} });
  snap = game.getSnapshot();
  solCols = solveBruteForce(snap.grid);
  const solutionKeySet = new Set(solCols.map((col, row) => row + ',' + col));
  const beforeSnowman = gridSnapshot(snap.grid);

  const snowmanUsed = game.useHelper('snowman');
  assert(snowmanUsed === true, 'snowman succeeds on a mostly-empty board');
  const afterSnowman = gridSnapshot(snap.grid);
  let crossesPlaced = 0;
  for (let row = 0; row < snap.grid.size; row++) {
    for (let col = 0; col < snap.grid.size; col++) {
      if (beforeSnowman[row][col].state === afterSnowman[row][col].state) continue;
      crossesPlaced++;
      assert(afterSnowman[row][col].state === Grid.CellState.X, 'every cell snowman changes becomes a plain X (row ' + row + ', col ' + col + ')');
      assert(afterSnowman[row][col].locked === false, 'a snowman cross is never locked (row ' + row + ', col ' + col + ')');
      assert(!solutionKeySet.has(row + ',' + col), 'a snowman cross never lands on a solution cell (row ' + row + ', col ' + col + ')');
      assert(beforeSnowman[row][col].state === Grid.CellState.EMPTY, 'a snowman cross only ever lands on a previously-empty cell (row ' + row + ', col ' + col + ')');
    }
  }
  assert(crossesPlaced > 0 && crossesPlaced <= State.SNOWMAN_CROSS_COUNT, 'snowman places between 1 and ' + State.SNOWMAN_CROSS_COUNT + ' crosses (got ' + crossesPlaced + ')');

  // --- Zero eligible cells: the helper does nothing and spends no charge ---
  resetStorage();
  Platform.saveHighestLevel(10);
  game = State.createGame({ onChange: () => {} });
  snap = game.getSnapshot();
  solCols = solveBruteForce(snap.grid);
  const solutionKeys2 = new Set(solCols.map((col, row) => row + ',' + col));
  // Mark every non-solution empty cell with a plain X by hand, exhausting
  // every eligible cross cell on the board.
  for (let row = 0; row < snap.grid.size; row++) {
    for (let col = 0; col < snap.grid.size; col++) {
      if (solutionKeys2.has(row + ',' + col)) continue;
      if (snap.grid.cells[row][col].state === Grid.CellState.EMPTY) game.markCellX(row, col);
    }
  }
  assert(game.getSnapshot().helpers.snowman.canUse === false, 'snowman reports unusable once zero eligible cross cells remain');
  const chargesBeforeEmptySnowman = game.getSnapshot().helpers.snowman.charges;
  const boardBeforeEmptySnowman = JSON.stringify(gridSnapshot(snap.grid));
  const emptySnowmanResult = game.useHelper('snowman');
  assert(emptySnowmanResult === false, 'useHelper(snowman) returns false when no eligible cell exists');
  assert(game.getSnapshot().helpers.snowman.charges === chargesBeforeEmptySnowman, 'no charge is spent when snowman has nothing to place');
  assert(JSON.stringify(gridSnapshot(snap.grid)) === boardBeforeEmptySnowman, 'the board is unchanged when snowman has nothing to place');

  // --- Random: deterministic by (level, per-attempt use counter) - reproducible after reload and Retry ---
  resetStorage();
  game = State.createGame({ onChange: () => {} });
  const levelUnderTest = game.getSnapshot().level;
  const randomUsed = game.useHelper('random');
  assert(randomUsed === true, 'random succeeds on a fresh attempt');
  const snapshotAfterFirstRandom = gridSnapshot(game.getSnapshot().grid);

  // A brand-new, independent game at the same level, with its own fresh
  // use counter (0), must produce the exact same first-use outcome -
  // proving the roll depends only on (level, useCount), nothing else.
  resetStorage();
  let gameTwin = State.createGame({ onChange: () => {} });
  while (gameTwin.getSnapshot().level !== levelUnderTest) gameTwin.nextLevel();
  gameTwin.useHelper('random');
  assert(
    JSON.stringify(gridSnapshot(gameTwin.getSnapshot().grid)) === JSON.stringify(snapshotAfterFirstRandom),
    "two independent games at the same level produce an identical first Random outcome - it's a pure function of (level, use count)"
  );

  // Reload (a new game instance restoring the saved board) shows exactly
  // what was already committed - nothing is re-rolled by loading it again.
  resetStorage();
  game = State.createGame({ onChange: () => {} });
  while (game.getSnapshot().level !== levelUnderTest) game.nextLevel();
  game.useHelper('random');
  const afterFirstRandomUse = gridSnapshot(game.getSnapshot().grid);
  const reloadedRandomGame = State.createGame({ onChange: () => {} });
  assert(
    JSON.stringify(gridSnapshot(reloadedRandomGame.getSnapshot().grid)) === JSON.stringify(afterFirstRandomUse),
    'reloading restores the exact already-decided Random outcome rather than re-rolling it'
  );

  // Retry resets the per-attempt use counter back to 0, so the very next
  // Random use (use index 0 again) reproduces the SAME outcome as the
  // first use did the first time - Retry cannot be used to re-roll it.
  // (Retry itself doesn't touch the double-spend lock window, so this
  // waits it out first - otherwise the second call would be rejected for
  // an unrelated reason.)
  await wait(State.HELPER_LOCK_MS + 30);
  game.retryLevel();
  game.useHelper('random');
  const afterRetryRandomUse = gridSnapshot(game.getSnapshot().grid);
  assert(
    JSON.stringify(afterRetryRandomUse) === JSON.stringify(afterFirstRandomUse),
    'Retry resets the use counter, so the first Random use after Retry reproduces the exact same outcome as the first use before it'
  );

  // --- Random's cross outcome also only ever lands on eligible cells ---
  // Search a small range of levels for one whose very first Random roll
  // (use count 0) is a cross, so this check exercises that branch
  // specifically rather than hoping for it by chance.
  function findCrossRollLevel(maxLevel) {
    for (let lvl = 1; lvl <= maxLevel; lvl++) {
      const rng = Rng.createRng(State.randomRollSeed(lvl, 0));
      if (rng() < 0.5) return lvl;
    }
    return null;
  }
  const crossLevel = findCrossRollLevel(60);
  assert(crossLevel !== null, 'sanity: at least one of the first 60 levels rolls a cross outcome on its first Random use');
  if (crossLevel !== null) {
    resetStorage();
    game = State.createGame({ onChange: () => {} });
    while (game.getSnapshot().level !== crossLevel) game.nextLevel();
    snap = game.getSnapshot();
    solCols = solveBruteForce(snap.grid);
    const solutionKeys3 = new Set(solCols.map((col, row) => row + ',' + col));
    const beforeRandomCross = gridSnapshot(snap.grid);

    game.useHelper('random');
    const afterRandomCross = gridSnapshot(snap.grid);
    let randomCrossCount = 0;
    for (let row = 0; row < snap.grid.size; row++) {
      for (let col = 0; col < snap.grid.size; col++) {
        if (beforeRandomCross[row][col].state === afterRandomCross[row][col].state) continue;
        randomCrossCount++;
        assert(!solutionKeys3.has(row + ',' + col), "random's cross outcome never lands on a solution cell (level " + crossLevel + ')');
        assert(afterRandomCross[row][col].state === Grid.CellState.X, "random's cross outcome marks a plain X (level " + crossLevel + ')');
      }
    }
    assert(
      randomCrossCount >= 4 && randomCrossCount <= 5,
      "random's cross outcome places 4 or 5 crosses (got " + randomCrossCount + ' on level ' + crossLevel + ')'
    );
  }

  console.log(`${checks} checks run, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
