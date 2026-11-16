// Plain Node script, no test framework/dependency. Run with: node tests/ios-zoom-guard.test.js
// Covers the iOS double-tap-zoom bug fix's JS-level guard (js/input.js's
// attachDoubleTapZoomGuard, reused by js/tutorial.js): it must preventDefault()
// a touchend only when it's a *second* touchend on the *same* cell within the
// double-tap window, and otherwise never call it, and must never itself call
// into any game logic (it only ever touches the event it's handed).
//
// What this file CANNOT verify: the actual native iOS double-tap-to-zoom (or
// pinch-zoom) behavior - that requires a real iPhone/iPad (or at minimum a
// real WebKit engine under iOS, which Node has no equivalent of). This test
// only proves the guard's own preventDefault()-timing logic is correct in
// isolation; the "double-tap logic staying intact" requirement is instead
// proven by the rest of the Node suite (tests/state.test.js's double-tap
// sequence, tests/drag-score-win.test.js's drag-to-mark) continuing to pass
// completely unmodified - the guard never calls tapCell/markCellX/clearCellX
// or any other game-logic function, only event.preventDefault().
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
require('../js/input.js');

const { input: Input, state: State } = globalThis.Garden;

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

// A fake "cell" element: closest('.cell') just returns itself, matching how
// real .cell-mark/.cell-pattern children resolve to their ancestor .cell.
function makeCellEl(row, col) {
  const el = { dataset: { row: String(row), col: String(col) } };
  el.closest = function (selector) {
    return selector === '.cell' ? el : null;
  };
  return el;
}

// Fake board element: just enough of the EventTarget API for
// attachDoubleTapZoomGuard to attach to and for this test to drive directly
// (no real DOM/browser available in Node).
function makeFakeBoard() {
  const handlers = {};
  return {
    addEventListener: function (type, handler) {
      handlers[type] = handler;
    },
    dispatchTouchEnd: function (targetEl) {
      let prevented = false;
      handlers.touchend({ target: targetEl, preventDefault: function () { prevented = true; } });
      return prevented;
    },
  };
}

async function main() {
  // --- Second touchend on the SAME cell within the window: prevented ---
  let board = makeFakeBoard();
  Input.attachDoubleTapZoomGuard(board);
  const cellA = makeCellEl(1, 2);

  assert(board.dispatchTouchEnd(cellA) === false, 'first touchend on a cell is never prevented');
  assert(
    board.dispatchTouchEnd(cellA) === true,
    `a second touchend on the same cell within ${State.DOUBLE_TAP_WINDOW_MS}ms IS prevented (this is what stops iOS double-tap-zoom)`
  );

  // --- A third touchend on the SAME cell right after a prevented pair:
  // still within the window of the *second* touchend, so it's prevented too
  // (correct for a rapid triple-tap - zoom should stay blocked throughout). ---
  assert(board.dispatchTouchEnd(cellA) === true, 'a third rapid touchend on the same cell is prevented too (still within the window of the second)');

  // --- Only once a touchend on that cell falls outside the window does
  // tracking reset to "first tap" again. ---
  await wait(State.DOUBLE_TAP_WINDOW_MS + 100);
  assert(board.dispatchTouchEnd(cellA) === false, 'after the window lapses, the next touchend is treated as a fresh first tap');

  // --- Two fast touchends on DIFFERENT cells: never prevented (not a
  // double-tap on the same target - e.g. a quick drag's end plus the next
  // tap's end landing on a different cell). ---
  board = makeFakeBoard();
  Input.attachDoubleTapZoomGuard(board);
  const cellB = makeCellEl(0, 0);
  const cellC = makeCellEl(3, 3);
  assert(board.dispatchTouchEnd(cellB) === false, 'first touchend on cell B is never prevented');
  assert(board.dispatchTouchEnd(cellC) === false, 'a fast second touchend on a DIFFERENT cell (C) is never prevented');

  // --- Two touchends on the SAME cell but farther apart than the window:
  // not a double-tap, never prevented. ---
  board = makeFakeBoard();
  Input.attachDoubleTapZoomGuard(board);
  const cellD = makeCellEl(2, 2);
  assert(board.dispatchTouchEnd(cellD) === false, 'first touchend on cell D is never prevented');
  await wait(State.DOUBLE_TAP_WINDOW_MS + 100);
  assert(
    board.dispatchTouchEnd(cellD) === false,
    `a second touchend on the same cell AFTER the ${State.DOUBLE_TAP_WINDOW_MS}ms window is never prevented`
  );

  // --- A touchend whose target isn't inside any .cell (e.g. the board's own
  // frame/gap padding) never throws and is never prevented. ---
  board = makeFakeBoard();
  Input.attachDoubleTapZoomGuard(board);
  const outsideEl = { closest: function () { return null; } };
  assert(board.dispatchTouchEnd(outsideEl) === false, 'a touchend outside any cell is never prevented');
  assert(board.dispatchTouchEnd(outsideEl) === false, 'two outside-any-cell touchends in a row are still never prevented');

  console.log(`${checks} checks run, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
