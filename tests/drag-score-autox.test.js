// Plain Node script, no test framework/dependency. Run with: node tests/drag-score-autox.test.js
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

function findCell(grid, predicate) {
  for (let r = 0; r < grid.size; r++) {
    for (let c = 0; c < grid.size; c++) {
      const cell = grid.cells[r][c];
      if (predicate(cell)) return cell;
    }
  }
  return null;
}

// Brute-force solver (independent of generator.js internals) used to find a
// guaranteed-correct and a guaranteed-wrong cell for a given level's board.
function solveBruteForce(grid) {
  const size = grid.size;
  const regionOf = [];
  for (let r = 0; r < size; r++) {
    regionOf.push(grid.cells[r].map((c) => c.region));
  }
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
  return solution; // column chosen per row
}

// --- Drag primitives: markCellX / clearCellX ---
resetStorage();
let game = State.createGame({ onChange: () => {} });
let snap = game.getSnapshot();

const given = findCell(snap.grid, (c) => c.state === Grid.CellState.FLOWER);
game.markCellX(given.row, given.col);
assert(given.state === Grid.CellState.FLOWER, 'markCellX never touches the locked pre-placed flower');
game.clearCellX(given.row, given.col);
assert(given.state === Grid.CellState.FLOWER, 'clearCellX never touches the locked pre-placed flower');

const emptyCell = findCell(snap.grid, (c) => c.state === Grid.CellState.EMPTY);
game.markCellX(emptyCell.row, emptyCell.col);
assert(emptyCell.state === Grid.CellState.X, 'markCellX turns an empty cell into a white X');
game.markCellX(emptyCell.row, emptyCell.col); // already X now, should no-op
assert(emptyCell.state === Grid.CellState.X, 'markCellX is a no-op on a cell that is already X');
game.clearCellX(emptyCell.row, emptyCell.col);
assert(emptyCell.state === Grid.CellState.EMPTY, 'clearCellX turns an X back to empty');
game.clearCellX(emptyCell.row, emptyCell.col); // already empty, no-op
assert(emptyCell.state === Grid.CellState.EMPTY, 'clearCellX is a no-op on an already-empty cell');

// --- Scoring ---
resetStorage();
game = State.createGame({ onChange: () => {} });
snap = game.getSnapshot();
assert(snap.totalScore === 0 && snap.levelScore === 0, 'fresh game starts with zero score');

let solution = solveBruteForce(snap.grid);
let correctRow = -1;
let correctCol = -1;
for (let r = 0; r < snap.grid.size; r++) {
  if (snap.grid.cells[r][solution[r]].state !== Grid.CellState.FLOWER) {
    correctRow = r;
    correctCol = solution[r];
    break;
  }
}
const cellToSolve = snap.grid.cells[correctRow][correctCol];
game.tapCell(correctRow, correctCol); // -> X
game.tapCell(correctRow, correctCol); // double tap -> correct flower
assert(cellToSolve.state === Grid.CellState.FLOWER, 'sanity: the brute-forced solution cell is accepted as correct');

const afterScoreSnap = game.getSnapshot();
assert(afterScoreSnap.levelScore === State.POINTS_PER_FLOWER, 'levelScore increases by POINTS_PER_FLOWER on a correct placement');
assert(afterScoreSnap.totalScore === State.POINTS_PER_FLOWER, 'totalScore increases by POINTS_PER_FLOWER on a correct placement');
assert(Platform.loadTotalScore() === State.POINTS_PER_FLOWER, 'totalScore is persisted to storage immediately');

// --- perfect vs done ---
assert(afterScoreSnap.perfect === true, 'perfect stays true with no mistakes made');
let wrongRow = -1;
let wrongCol = -1;
for (let r = 0; r < snap.grid.size; r++) {
  if (r === correctRow || snap.grid.cells[r][0].locked) continue;
  for (let c = 0; c < snap.grid.size; c++) {
    if (c !== solution[r]) {
      wrongRow = r;
      wrongCol = c;
      break;
    }
  }
  if (wrongRow !== -1) break;
}
if (wrongRow !== -1) {
  game.tapCell(wrongRow, wrongCol);
  game.tapCell(wrongRow, wrongCol);
  const afterMistakeSnap = game.getSnapshot();
  assert(afterMistakeSnap.perfect === false, 'perfect becomes false after a mistake');
}

// --- Auto-X ---
resetStorage();
game = State.createGame({ onChange: () => {} });
game.setAutoXEnabled(true);
snap = game.getSnapshot();
solution = solveBruteForce(snap.grid);

let autoRow = -1;
let autoCol = -1;
for (let r = 0; r < snap.grid.size; r++) {
  if (snap.grid.cells[r][solution[r]].state !== Grid.CellState.FLOWER) {
    autoRow = r;
    autoCol = solution[r];
    break;
  }
}
game.tapCell(autoRow, autoCol);
game.tapCell(autoRow, autoCol);

const afterAutoX = game.getSnapshot();
let rowAllNonEmpty = true;
for (let c = 0; c < afterAutoX.grid.size; c++) {
  if (afterAutoX.grid.cells[autoRow][c].state === Grid.CellState.EMPTY) rowAllNonEmpty = false;
}
assert(rowAllNonEmpty, 'auto-X fills the rest of the flower\'s row with X when enabled');

let colAllNonEmpty = true;
for (let r = 0; r < afterAutoX.grid.size; r++) {
  if (afterAutoX.grid.cells[r][autoCol].state === Grid.CellState.EMPTY) colAllNonEmpty = false;
}
assert(colAllNonEmpty, 'auto-X fills the rest of the flower\'s column with X when enabled');

let foundUntouchedFarCell = false;
for (let r = 0; r < afterAutoX.grid.size; r++) {
  for (let c = 0; c < afterAutoX.grid.size; c++) {
    const cell = afterAutoX.grid.cells[r][c];
    const farFromFlower = Math.abs(r - autoRow) > 1 || Math.abs(c - autoCol) > 1;
    const differentRowCol = r !== autoRow && c !== autoCol;
    const differentRegion = cell.region !== afterAutoX.grid.cells[autoRow][autoCol].region;
    if (farFromFlower && differentRowCol && differentRegion && cell.state === Grid.CellState.EMPTY) {
      foundUntouchedFarCell = true;
    }
  }
}
// Not asserted strictly (small grids may leave no such cell) - informational only.
if (!foundUntouchedFarCell) {
  console.log('(info) no far/unrelated empty cell existed to double-check auto-X scope on this level; not a failure.');
}

console.log(`${checks} checks run, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
