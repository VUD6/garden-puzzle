// Plain Node script, no test framework/dependency. Run with: node tests/win-streak.test.js
// Covers the win streak (js/state.js's finishLevel/attemptFlower) and the
// best-stars-per-level / total-stars counter (js/platform.js): streak
// increments on genuine progress, a loss resets it to 0, leaving and
// returning (a fresh game instance) never resets it, the bonus every 5th
// win exactly once (idempotent - a replay of an already-completed level
// neither extends nor re-grants it), the bonus-helper rule (fewest
// charges, tie to finder, Snowman excluded while locked), the total-stars
// sum, and the migration that establishes it.
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

const { grid: Grid, state: State, platform: Platform, helpers: Helpers } = globalThis.Garden;

let failures = 0;
let checks = 0;

function assert(condition, message) {
  checks++;
  if (!condition) {
    failures++;
    console.error('FAIL: ' + message);
  }
}

// Brute-force solver (independent of generator.js internals), same approach
// as tests/drag-score-win.test.js.
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

// Solves the current level by direct taps, with `mistakesToMake` wrong
// taps injected first (burns a life per mistake) - mistakesToMake >= 3
// loses the level instead of winning it, same convention as
// tests/drag-score-win.test.js's solveLevel.
function solveLevel(game, mistakesToMake) {
  const grid = game.getSnapshot().grid;
  const solution = solveBruteForce(grid);
  let madeMistakes = 0;
  for (let row = 0; row < grid.size; row++) {
    const cell = grid.cells[row][solution[row]];
    if (cell.state === Grid.CellState.FLOWER) continue; // pre-placed given flower

    if (madeMistakes < mistakesToMake) {
      for (let col = 0; col < grid.size; col++) {
        if (col === solution[row]) continue;
        const wrongCell = grid.cells[row][col];
        if (wrongCell.locked) continue;
        game.tapCell(row, col);
        game.tapCell(row, col);
        madeMistakes++;
        break;
      }
    }

    game.tapCell(row, solution[row]);
    game.tapCell(row, solution[row]);
  }
  return game.getSnapshot();
}

// --- Streak increments on genuine wins, 1..10, bonus exactly at 5 and 10 ---
(function () {
  resetStorage();
  let lastEmitted = null;
  let game = State.createGame({ onChange: (s) => { lastEmitted = s; } });

  for (let win = 1; win <= 10; win++) {
    solveLevel(game, 0);
    assert(lastEmitted.status === 'won', `win ${win}: level solved`);
    assert(lastEmitted.streak === win, `win ${win}: streak is ${win} (got ${lastEmitted.streak})`);
    if (win % 5 === 0) {
      assert(lastEmitted.streakBonus !== null, `win ${win}: a multiple of 5 grants a streak bonus`);
      assert(lastEmitted.streakBonus.amount === State.WIN_STREAK_BONUS_AMOUNT, `win ${win}: bonus amount matches WIN_STREAK_BONUS_AMOUNT`);
      assert(lastEmitted.winsUntilStreakBonus === 5, `win ${win}: right after a bonus, 5 more wins remain until the next one`);
    } else {
      assert(lastEmitted.streakBonus === null, `win ${win}: not a multiple of 5, no bonus`);
      assert(lastEmitted.winsUntilStreakBonus === 5 - (win % 5), `win ${win}: winsUntilStreakBonus counts down correctly (got ${lastEmitted.winsUntilStreakBonus})`);
    }
    assert(Platform.loadWinStreak() === win, `win ${win}: persisted streak matches (got ${Platform.loadWinStreak()})`);
    game.nextLevel();
  }
})();

// --- A loss resets the streak to 0; a later win restarts from 1 ---
(function () {
  resetStorage();
  let lastEmitted = null;
  let game = State.createGame({ onChange: (s) => { lastEmitted = s; } });

  solveLevel(game, 0);
  game.nextLevel();
  solveLevel(game, 0);
  assert(Platform.loadWinStreak() === 2, 'sanity: streak is 2 before the loss');

  game.nextLevel();
  const lostSnap = solveLevel(game, 3); // 3 mistakes = all lives spent = a loss
  assert(lostSnap.status === 'lost', 'sanity: this attempt actually lost');
  assert(Platform.loadWinStreak() === 0, 'a loss resets the streak to 0');

  game.retryLevel();
  solveLevel(game, 0);
  assert(lastEmitted.streak === 1, `a win after a loss restarts the streak at 1 (got ${lastEmitted.streak})`);
})();

// --- Leaving and returning (a fresh game instance) never resets the streak ---
(function () {
  resetStorage();
  let game = State.createGame({ onChange: () => {} });
  solveLevel(game, 0);
  assert(Platform.loadWinStreak() === 1, 'sanity: streak is 1 after the first win');
  game.nextLevel(); // advance to a NOT-yet-completed level before "leaving"

  // Simulates leaving to the menu and coming back - a brand new game
  // instance for the same saved progress, nothing more.
  let lastEmitted = null;
  const returningGame = State.createGame({ onChange: (s) => { lastEmitted = s; } });
  solveLevel(returningGame, 0);
  assert(lastEmitted.streak === 2, `a fresh game instance never resets the streak (got ${lastEmitted.streak})`);
})();

// --- Re-winning an already-completed level neither extends nor resets the
// streak (can't be farmed for free bonus charges), and never double-grants
// a bonus - the exact idempotency a reload/double-tap also relies on ---
(function () {
  resetStorage();
  let lastEmitted = null;
  let game = State.createGame({ onChange: (s) => { lastEmitted = s; } });

  solveLevel(game, 0);
  assert(lastEmitted.streak === 1, 'sanity: first win of level 1 sets streak to 1');

  game.retryLevel();
  solveLevel(game, 0); // re-winning the SAME level (already completed)
  assert(lastEmitted.status === 'won', 'the replay still wins the level');
  assert(lastEmitted.streak === null, 'replaying an already-completed level reports no streak change at all');
  assert(lastEmitted.streakBonus === null, 'replaying an already-completed level never grants a bonus');
  assert(Platform.loadWinStreak() === 1, 'the persisted streak is unaffected by the replay (still 1, not 2)');

  // Calling finishLevel's underlying guard twice in a row (simulating a
  // double-tap / reload) is exactly this same path - already proven above
  // to grant nothing extra.
})();

// --- Bonus-helper rule: fewest charges, tie favors finder, Snowman
// excluded entirely while locked (below level 10) ---
(function () {
  resetStorage();
  Helpers.addCharges('finder', 10); // finder=15, random=5, snowman=5 (locked, irrelevant anyway)
  let lastEmitted = null;
  let game = State.createGame({ onChange: (s) => { lastEmitted = s; } });
  assert(Helpers.isUnlocked('snowman') === false, 'sanity: snowman starts locked');

  for (let win = 1; win <= 5; win++) {
    solveLevel(game, 0);
    // Don't advance after the 5th win - nextLevel() emits a plain snapshot
    // with no streakBonus field at all, which would clobber lastEmitted
    // right before we need to inspect this exact win's result.
    if (win < 5) game.nextLevel();
  }
  assert(lastEmitted.streakBonus !== null, 'win 5 grants a bonus');
  assert(lastEmitted.streakBonus.helperId === 'random', `locked snowman: the bonus goes to random, the fewest of the two eligible helpers (got ${lastEmitted.streakBonus.helperId})`);
})();

(function () {
  resetStorage();
  Platform.saveHighestLevel(10); // snowman unlocked throughout
  Helpers.addCharges('finder', 10);
  Helpers.addCharges('random', 10); // finder=15, random=15, snowman=5 - snowman now clearly fewest
  let lastEmitted = null;
  let game = State.createGame({ onChange: (s) => { lastEmitted = s; } });
  assert(Helpers.isUnlocked('snowman') === true, 'sanity: snowman is unlocked');

  for (let win = 1; win <= 5; win++) {
    solveLevel(game, 0);
    // Don't advance after the 5th win - nextLevel() emits a plain snapshot
    // with no streakBonus field at all, which would clobber lastEmitted
    // right before we need to inspect this exact win's result.
    if (win < 5) game.nextLevel();
  }
  assert(lastEmitted.streakBonus.helperId === 'snowman', `unlocked snowman: the bonus goes to snowman once it is genuinely fewest (got ${lastEmitted.streakBonus.helperId})`);
})();

(function () {
  resetStorage(); // everyone tied at STARTING_CHARGES (5) - ties favor finder
  let lastEmitted = null;
  let game = State.createGame({ onChange: (s) => { lastEmitted = s; } });
  for (let win = 1; win <= 5; win++) {
    solveLevel(game, 0);
    // Don't advance after the 5th win - nextLevel() emits a plain snapshot
    // with no streakBonus field at all, which would clobber lastEmitted
    // right before we need to inspect this exact win's result.
    if (win < 5) game.nextLevel();
  }
  assert(lastEmitted.streakBonus.helperId === 'finder', `an exact tie favors finder (got ${lastEmitted.streakBonus.helperId})`);
})();

// --- Best stars per level and the total-stars sum ---
(function () {
  resetStorage();
  let lastEmitted = null;
  let game = State.createGame({ onChange: (s) => { lastEmitted = s; } });
  const level1 = game.getSnapshot().level;

  solveLevel(game, 0); // flawless, fast - 3 stars
  const firstRating = lastEmitted.rating;
  assert(Platform.loadBestStars(level1) === firstRating, `best stars for level ${level1} match the rating just earned (got ${Platform.loadBestStars(level1)})`);
  assert(Platform.loadTotalStars() === firstRating, `total stars equals the single level's rating so far (got ${Platform.loadTotalStars()})`);

  game.nextLevel();
  solveLevel(game, 0);
  const level2 = game.getSnapshot().level;
  const secondRating = lastEmitted.rating;
  assert(
    Platform.loadTotalStars() === firstRating + secondRating,
    `total stars sums both levels' best stars (got ${Platform.loadTotalStars()}, expected ${firstRating + secondRating})`
  );

  // A worse replay (more mistakes -> lower or equal rating) never lowers
  // the recorded best or the total.
  game.retryLevel();
  solveLevel(game, 3); // loses, but let's also check a replayed WIN with mistakes
  game.retryLevel();
  solveLevel(game, 1); // a win with 1 mistake - rating can only be <= firstRating... replaying level 2 here
  assert(Platform.loadBestStars(level2) >= secondRating, 'best stars for a level never decreases after a worse replay');
  assert(Platform.loadTotalStars() === firstRating + Platform.loadBestStars(level2), 'total stars stays consistent with the (unchanged-or-improved) per-level bests');
})();

// --- Stars migration: nothing to recover (never recorded before), just
// establishes totalStars at 0 once, idempotently ---
(function () {
  resetStorage();
  Platform.migrateStars();
  assert(Platform.loadTotalStars() === 0, 'a fresh install starts total stars at 0');

  Platform.saveBestStars(5, 3);
  assert(Platform.loadTotalStars() === 3, 'sanity: saveBestStars updates the running total');

  Platform.migrateStars(); // idempotent - must not reset the total back to 0
  assert(Platform.loadTotalStars() === 3, 'running the migration again after it already ran does not reset total stars');
})();

console.log(`${checks} checks run, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
