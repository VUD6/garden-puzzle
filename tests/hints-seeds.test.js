// Plain Node script, no test framework/dependency. Run with: node tests/hints-seeds.test.js
// Covers Step 4 (hints and soft currency): the starting-seed grant, seed
// rewards only on a level's first-ever completion (by star rating), hint
// target selection, hint cost/lock/eligibility, and save/restore.
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Recomputes the level's unique solution straight from the generated region
// data (independent of state.js's internal solutionList), so tests verify
// hint targeting against a value they derived themselves.
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

function findMistakeCell(grid, solCols) {
  for (let row = 0; row < grid.size; row++) {
    for (let col = 0; col < grid.size; col++) {
      if (solCols[row] === col) continue; // a solution cell, not a mistake
      const cell = grid.cells[row][col];
      if (!cell.locked && cell.state === Grid.CellState.EMPTY) return { row, col };
    }
  }
  return null;
}

async function solveLevelWithHintsOnly(game) {
  let snap = game.getSnapshot();
  let guard = 0;
  while (snap.status === 'playing' && guard < 50) {
    guard++;
    const used = game.useHint();
    if (used) {
      snap = game.getSnapshot();
      if (snap.status !== 'playing') break;
    }
    await wait(State.HINT_LOCK_MS + 30);
    snap = game.getSnapshot();
  }
  return game.getSnapshot();
}

async function main() {
  // --- Starting balance: granted once, on first-ever launch ---
  resetStorage();
  assert(Platform.loadSeeds() === Platform.STARTING_SEEDS, 'first-ever call grants the starting balance (' + Platform.STARTING_SEEDS + ')');
  assert(globalThis.localStorage.getItem('garden.seeds') === String(Platform.STARTING_SEEDS), 'the grant is persisted immediately, not just returned');
  Platform.saveSeeds(0);
  assert(Platform.loadSeeds() === 0, 'a balance that has dropped to 0 is not mistaken for "never granted" and re-topped-up');
  globalThis.localStorage.setItem('garden.seeds', 'not-a-number');
  assert(Platform.loadSeeds() === 0, 'a corrupted stored value defaults to 0, not a fresh grant');

  // --- Hint target selection: lowest unplanted row, in order, across hints ---
  resetStorage();
  Platform.saveSeeds(1000);
  let game = State.createGame({ onChange: () => {} });
  let snap = game.getSnapshot();
  let solCols = solveBruteForce(snap.grid);

  let expectedRow = findLowestUnplantedRow(snap.grid, solCols);
  let used = game.useHint();
  assert(used === true, 'a hint succeeds when seeds and an unplanted solution flower are available');
  let hintedCell = snap.grid.cells[expectedRow][solCols[expectedRow]];
  assert(
    hintedCell.state === Grid.CellState.FLOWER && hintedCell.locked,
    'the hint plants a locked flower at the lowest-row unplanted solution cell (row ' + expectedRow + ')'
  );

  await wait(State.HINT_LOCK_MS + 30);
  const expectedRow2 = findLowestUnplantedRow(snap.grid, solCols);
  assert(expectedRow2 > expectedRow, 'the next hint target has a strictly higher row than the previous one');
  game.useHint();
  const hintedCell2 = snap.grid.cells[expectedRow2][solCols[expectedRow2]];
  assert(hintedCell2.state === Grid.CellState.FLOWER && hintedCell2.locked, 'a second hint (after the lock clears) plants the next lowest-row flower');

  // --- Hint cost: deducts exactly HINT_COST once, and persists it ---
  resetStorage();
  Platform.saveSeeds(1000);
  game = State.createGame({ onChange: () => {} });
  const seedsBefore = game.getSnapshot().seeds;
  game.useHint();
  const seedsAfter = game.getSnapshot().seeds;
  assert(seedsBefore - seedsAfter === State.HINT_COST, 'a hint deducts exactly HINT_COST seeds (got ' + (seedsBefore - seedsAfter) + ')');
  assert(Platform.loadSeeds() === seedsAfter, 'the deduction is persisted immediately');

  // --- Double-spend protection: a rapid repeated call charges once ---
  resetStorage();
  Platform.saveSeeds(1000);
  game = State.createGame({ onChange: () => {} });
  const beforeRapid = game.getSnapshot().seeds;
  const firstCall = game.useHint();
  const secondCallImmediately = game.useHint(); // same tick - must be rejected
  const afterRapid = game.getSnapshot().seeds;
  assert(firstCall === true, 'the first of two rapid hint calls succeeds');
  assert(secondCallImmediately === false, 'an immediate second hint call is rejected (double-spend lock)');
  assert(beforeRapid - afterRapid === State.HINT_COST, 'only one charge happened despite two rapid calls (got ' + (beforeRapid - afterRapid) + ')');
  await wait(State.HINT_LOCK_MS + 30);
  const thirdCallAfterWait = game.useHint();
  assert(thirdCallAfterWait === true, 'a hint call succeeds again once the lock window has passed');

  // --- Insufficient balance blocks the hint (no board/seed change) ---
  resetStorage();
  Platform.saveSeeds(State.HINT_COST - 1);
  game = State.createGame({ onChange: () => {} });
  snap = game.getSnapshot();
  assert(snap.canUseHint === false, 'canUseHint is false when the balance is below HINT_COST');
  const boardBefore = JSON.stringify(snap.grid.cells.map((row) => row.map((c) => c.state)));
  const blockedResult = game.useHint();
  const boardAfter = JSON.stringify(snap.grid.cells.map((row) => row.map((c) => c.state)));
  assert(blockedResult === false, 'useHint() returns false when the balance is insufficient');
  assert(boardBefore === boardAfter, 'an insufficient-balance hint attempt never changes the board');
  assert(game.getSnapshot().seeds === State.HINT_COST - 1, 'an insufficient-balance hint attempt never changes the seed balance');

  // --- A hint never affects score, mistakes, or lives ---
  resetStorage();
  Platform.saveSeeds(1000);
  game = State.createGame({ onChange: () => {} });
  snap = game.getSnapshot();
  const livesBefore = snap.lives;
  const levelScoreBefore = snap.levelScore;
  game.useHint();
  const afterHintSnap = game.getSnapshot();
  assert(afterHintSnap.lives === livesBefore, 'a hint does not cost a life');
  assert(afterHintSnap.levelScore === levelScoreBefore, 'a hint earns no points (+0, not +10)');

  // --- Completing a level entirely via hints: 0 mistakes -> 3 stars, full seed reward, win triggered ---
  resetStorage();
  Platform.saveSeeds(1000);
  let onChangeSnap = null;
  game = State.createGame({ onChange: (s) => { onChangeSnap = s; } });
  const levelUnderTest = game.getSnapshot().level;
  const finalSnap = await solveLevelWithHintsOnly(game);
  assert(finalSnap.status === 'won', 'a level can be fully solved using only hints');
  assert(onChangeSnap.hint !== null && onChangeSnap.hint !== undefined, 'the winning change carries the hint position (last flower was hinted)');
  assert(finalSnap.levelScore === 0, 'a hint-only win earns 0 level score');
  assert(finalSnap.perfect === true, 'a hint-only win keeps all lives (no mistakes made)');
  assert(onChangeSnap.rating === 3, 'zero mistakes, hint-only win rates 3 stars (got ' + onChangeSnap.rating + ')');
  assert(onChangeSnap.seedGain === State.SEED_REWARD_BY_RATING[3], '3-star first-ever completion grants the 3-star seed reward (' + State.SEED_REWARD_BY_RATING[3] + ')');
  const seedsAfterWin = finalSnap.seeds;

  // --- No re-award on replay/reload after a win (same guard as total score) ---
  game = State.createGame({ onChange: (s) => { onChangeSnap = s; } }); // simulates a reload before "Next level"
  assert(game.getSnapshot().level === levelUnderTest, 'replaying lands back on the same, already-completed level');
  snap = game.getSnapshot();
  solCols = solveBruteForce(snap.grid);
  for (let row = 0; row < snap.grid.size; row++) {
    const cell = snap.grid.cells[row][solCols[row]];
    if (cell.state === Grid.CellState.FLOWER) continue;
    game.tapCell(row, solCols[row]);
    game.tapCell(row, solCols[row]);
  }
  assert(onChangeSnap.status === 'won', 'the replayed level can be won again');
  assert(onChangeSnap.seedGain === null, 'replaying an already-completed level grants no seed reward');
  assert(Platform.loadSeeds() === seedsAfterWin, 'replaying an already-completed level does not change the seed balance (stayed ' + seedsAfterWin + ')');

  // --- 1 mistake -> 2 stars, 2 mistakes -> 1 star (seed reward matches rating) ---
  for (const mistakeCount of [1, 2]) {
    resetStorage();
    Platform.saveSeeds(1000);
    onChangeSnap = null;
    game = State.createGame({ onChange: (s) => { onChangeSnap = s; } });
    snap = game.getSnapshot();
    solCols = solveBruteForce(snap.grid);

    for (let i = 0; i < mistakeCount; i++) {
      const mistakeCell = findMistakeCell(snap.grid, solCols);
      game.tapCell(mistakeCell.row, mistakeCell.col);
      game.tapCell(mistakeCell.row, mistakeCell.col);
    }

    for (let row = 0; row < snap.grid.size; row++) {
      const cell = snap.grid.cells[row][solCols[row]];
      if (cell.state === Grid.CellState.FLOWER) continue;
      game.tapCell(row, solCols[row]);
      game.tapCell(row, solCols[row]);
    }

    const expectedRating = mistakeCount === 1 ? 2 : 1;
    assert(onChangeSnap.status === 'won', mistakeCount + '-mistake run still wins the level');
    assert(onChangeSnap.rating === expectedRating, mistakeCount + ' mistake(s) rates ' + expectedRating + ' star(s) (got ' + onChangeSnap.rating + ')');
    assert(
      onChangeSnap.seedGain === State.SEED_REWARD_BY_RATING[expectedRating],
      expectedRating + '-star first-ever completion grants ' + State.SEED_REWARD_BY_RATING[expectedRating] + ' seeds (got ' + onChangeSnap.seedGain + ')'
    );
  }

  // --- Hint state survives reload: locked flower + seed balance persist ---
  resetStorage();
  Platform.saveSeeds(1000);
  game = State.createGame({ onChange: () => {} });
  snap = game.getSnapshot();
  solCols = solveBruteForce(snap.grid);
  const hintRow = findLowestUnplantedRow(snap.grid, solCols);
  game.useHint();
  const seedsBeforeReload = game.getSnapshot().seeds;

  const reloadedGame = State.createGame({ onChange: () => {} });
  const reloadedSnap = reloadedGame.getSnapshot();
  const reloadedCell = reloadedSnap.grid.cells[hintRow][solCols[hintRow]];
  assert(reloadedCell.state === Grid.CellState.FLOWER && reloadedCell.locked, 'the hinted flower is restored, locked, after a reload');
  assert(reloadedSnap.seeds === seedsBeforeReload, 'the seed balance is unaffected by the reload (no refund, no re-grant)');

  // --- Retry does not refund hint spending ---
  resetStorage();
  Platform.saveSeeds(1000);
  game = State.createGame({ onChange: () => {} });
  const seedsBeforeHintAndRetry = game.getSnapshot().seeds;
  game.useHint();
  const seedsAfterHint = game.getSnapshot().seeds;
  game.retryLevel();
  const seedsAfterRetry = game.getSnapshot().seeds;
  assert(seedsAfterHint < seedsBeforeHintAndRetry, 'sanity: the hint actually spent seeds');
  assert(seedsAfterRetry === seedsAfterHint, 'Retry does not refund seeds already spent on a hint');

  console.log(`${checks} checks run, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
