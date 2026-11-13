// Plain Node script, no test framework/dependency. Run with: node tests/state.test.js
// Covers the double-tap control scheme and board save/restore, using a tiny
// in-memory localStorage polyfill (Node has no localStorage global).
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

function findCell(grid, predicate) {
  for (let r = 0; r < grid.size; r++) {
    for (let c = 0; c < grid.size; c++) {
      const cell = grid.cells[r][c];
      if (predicate(cell)) return cell;
    }
  }
  return null;
}

async function main() {
  // --- Pre-placed flower is locked and untappable ---
  resetStorage();
  const game1 = State.createGame({ onChange: () => {} });
  const snap1 = game1.getSnapshot();
  const given = findCell(snap1.grid, (c) => c.state === Grid.CellState.FLOWER);
  assert(given && given.locked, 'exactly one locked pre-placed flower exists at level start');
  game1.tapCell(given.row, given.col);
  assert(given.state === Grid.CellState.FLOWER, 'tapping the pre-placed flower does nothing');

  // --- Single tap on empty places a white X immediately (no delay) ---
  const emptyCell = findCell(snap1.grid, (c) => c.state === Grid.CellState.EMPTY);
  game1.tapCell(emptyCell.row, emptyCell.col);
  assert(emptyCell.state === Grid.CellState.X, 'single tap on empty cell places X immediately');

  // --- An X with no further taps just persists (it was never "tapped as an X") ---
  await wait(State.DOUBLE_TAP_WINDOW_MS + 100);
  assert(emptyCell.state === Grid.CellState.X, 'X persists untouched; it only clears when a tap actually lands on it');

  // --- A later single tap landing on that X clears it, after waiting out the window ---
  game1.tapCell(emptyCell.row, emptyCell.col);
  await wait(State.DOUBLE_TAP_WINDOW_MS + 100);
  assert(emptyCell.state === Grid.CellState.EMPTY, 'a single tap on an existing X clears it once the double-tap window passes with no follow-up');

  // --- Rapid double tap on the same cell promotes X to a flower attempt ---
  game1.tapCell(emptyCell.row, emptyCell.col); // tap 1: empty -> X
  assert(emptyCell.state === Grid.CellState.X, 'tap 1 of a double tap places X');
  game1.tapCell(emptyCell.row, emptyCell.col); // quick second tap -> promote
  assert(
    emptyCell.state === Grid.CellState.FLOWER || emptyCell.state === Grid.CellState.WRONG,
    'tap 2 within the window promotes X to a flower attempt (correct or wrong)'
  );

  // --- A locked WRONG cell cannot be changed further ---
  if (emptyCell.state === Grid.CellState.WRONG) {
    game1.tapCell(emptyCell.row, emptyCell.col);
    assert(emptyCell.state === Grid.CellState.WRONG, 'a wrong (red X) cell stays locked');
  }

  // --- Single tap on a flower clears it immediately ---
  resetStorage();
  const game2 = State.createGame({ onChange: () => {} });
  const snap2 = game2.getSnapshot();
  const plainCell = findCell(snap2.grid, (c) => c.state === Grid.CellState.EMPTY);
  game2.tapCell(plainCell.row, plainCell.col); // -> X
  game2.tapCell(plainCell.row, plainCell.col); // quick -> promote attempt
  if (plainCell.state === Grid.CellState.FLOWER) {
    game2.tapCell(plainCell.row, plainCell.col); // single tap on a flower -> clear
    assert(plainCell.state === Grid.CellState.EMPTY, 'single tap on a flower clears it immediately');
  }

  // --- Save/restore across a fresh createGame() call for the same level ---
  resetStorage();
  const game3 = State.createGame({ onChange: () => {} });
  const snap3 = game3.getSnapshot();
  const level3 = snap3.level;
  const markCell = findCell(snap3.grid, (c) => c.state === Grid.CellState.EMPTY);
  game3.tapCell(markCell.row, markCell.col); // -> X, persisted

  const savedRaw = Platform.loadBoard(level3);
  assert(
    savedRaw && savedRaw.cells[markCell.row][markCell.col].state === Grid.CellState.X,
    'board is persisted to storage after a move'
  );

  const game4 = State.createGame({ onChange: () => {} }); // simulates a reload
  const snap4 = game4.getSnapshot();
  assert(snap4.grid.cells[markCell.row][markCell.col].state === Grid.CellState.X, 'reload restores the X mark from storage');
  assert(snap4.lives === 3, 'reload restores lives (3, unchanged)');

  // --- Retry clears the saved board and rebuilds the same deterministic level ---
  game4.retryLevel();
  assert(Platform.loadBoard(level3) === null, 'retrying a level clears its saved board');
  const snap5 = game4.getSnapshot();
  assert(snap5.grid.cells[markCell.row][markCell.col].state === Grid.CellState.EMPTY, 'retry rebuilds a fresh board (mark is gone)');

  console.log(`${checks} checks run, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
