// Plain Node script, no test framework/dependency. Run with: node tests/ios-zoom-guard.test.js
// Covers the iOS double-tap-zoom bug fix's JS half (js/zoomguard.js):
//   Part 1 - the guard's own logic in isolation (same-target/different-
//     target, within/outside the window, guarded/unguarded screens, text
//     inputs).
//   Part 2 - a headless check that the double-tap-to-plant/single-tap-X/
//     tap-to-clear/drag-to-mark game logic (js/state.js) is unaffected
//     whether or not a touchend (with the guard's preventDefault()) also
//     fires alongside the pointer-event-driven taps that already drive it
//     in js/input.js - i.e. "via both touch events and pointer events".
//
// What this file CANNOT verify: the actual native iOS double-tap-to-zoom
// (or pinch-zoom) behavior itself - that requires a real iPhone/iPad (or at
// minimum a real WebKit/iOS engine), neither of which exists in this
// environment. This only proves the guard's own preventDefault()-timing
// logic is correct in isolation, and that interleaving it with the real
// game logic never changes the resulting board state.
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
require('../js/zoomguard.js');

const { grid: Grid, state: State, zoomGuard: ZoomGuard } = globalThis.Garden;

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

// A fake element: .closest(selector) matches if any comma-separated part of
// `selector` is in this element's own ancestry list - mirrors how a real
// .cell inside .board inside .game-screen matches all three.
function makeFakeElement(ancestry) {
  const el = {};
  el.closest = function (selector) {
    const parts = selector.split(',').map((s) => s.trim());
    return parts.some((p) => ancestry.indexOf(p) !== -1) ? el : null;
  };
  return el;
}

function fakeTouchEnd(target) {
  let prevented = false;
  return {
    event: { target, preventDefault: function () { prevented = true; } },
    wasPrevented: function () { return prevented; },
  };
}

// === Part 1: js/zoomguard.js's own logic, in isolation ===

(function testZoomGuardLogic() {
  const gameCellA = makeFakeElement(['.cell', '.game-screen']);
  const gameCellB = makeFakeElement(['.cell', '.game-screen']);
  const menuButton = makeFakeElement(['button', '.menu-screen']);
  const settingsButton = makeFakeElement(['button', '.settings-overlay']); // NOT guarded

  // --- isGuardedTarget / zoomGuardKey ---
  assert(ZoomGuard.isGuardedTarget(gameCellA) === true, 'a board cell inside .game-screen is a guarded target');
  assert(ZoomGuard.isGuardedTarget(settingsButton) === false, 'a button inside .settings-overlay is NOT a guarded target (accessibility carve-out)');
  assert(ZoomGuard.zoomGuardKey(gameCellA) === gameCellA, "a cell's guard key is the cell itself");
  assert(ZoomGuard.zoomGuardKey(menuButton) === menuButton, "a button's guard key is the button itself");

  // --- Double-tap guard: same target within the window IS prevented ---
  let handle = ZoomGuard.createDoubleTapZoomGuard();
  let first = fakeTouchEnd(gameCellA);
  assert(handle(first.event) === false, 'first touchend on a cell is never prevented');
  let second = fakeTouchEnd(gameCellA);
  assert(handle(second.event) === true, 'a second touchend on the SAME cell within the window IS prevented');
  assert(second.wasPrevented() === true, 'preventDefault() was actually called on the second event');

  // --- Different target: never prevented, even if fast ---
  handle = ZoomGuard.createDoubleTapZoomGuard();
  assert(handle(fakeTouchEnd(gameCellA).event) === false, 'first touchend on cell A is never prevented');
  assert(handle(fakeTouchEnd(gameCellB).event) === false, 'a fast touchend on a DIFFERENT cell (B) is never prevented');

  // --- Outside the guarded screens: never prevented, even same target twice ---
  handle = ZoomGuard.createDoubleTapZoomGuard();
  assert(handle(fakeTouchEnd(settingsButton).event) === false, 'first touchend on a settings button is never prevented');
  assert(handle(fakeTouchEnd(settingsButton).event) === false, 'a second touchend on that same settings button is still never prevented (not a guarded screen)');

  // --- Outside the time window: not prevented ---
  (async function () {
    handle = ZoomGuard.createDoubleTapZoomGuard();
    assert(handle(fakeTouchEnd(gameCellA).event) === false, 'first touchend on the cell is never prevented');
    await wait(ZoomGuard.DOUBLE_TAP_ZOOM_WINDOW_MS + 100);
    assert(handle(fakeTouchEnd(gameCellA).event) === false, 'a second touchend on the same cell AFTER the window is never prevented');
  })();

  // --- Pinch guard ---
  const handleGesture = ZoomGuard.createPinchGuard();
  const guardedEvent = { target: gameCellA, prevented: false };
  guardedEvent.preventDefault = function () { guardedEvent.prevented = true; };
  handleGesture(guardedEvent);
  assert(guardedEvent.prevented === true, 'pinch gesture inside the game screen is prevented');

  const unguardedEvent = { target: settingsButton, prevented: false };
  unguardedEvent.preventDefault = function () { unguardedEvent.prevented = true; };
  handleGesture(unguardedEvent);
  assert(unguardedEvent.prevented === false, 'pinch gesture inside the settings overlay is left alone (accessibility)');
})();

// === Part 2: double-tap/tap/clear/drag game logic, with and without a
// touchend (+ the zoom guard) firing alongside the pointer-event-driven
// taps that already drive js/input.js/js/tutorial.js in a real browser ===

async function runTapSequence(withTouchSimulation) {
  resetStorage();
  const game = State.createGame({ onChange: () => {} });
  const snap = game.getSnapshot();

  const handleTouchEnd = ZoomGuard.createDoubleTapZoomGuard();
  const gameScreenEl = makeFakeElement(['.game-screen']);

  // input.js only ever calls tapCell/markCellX/clearCellX off pointer
  // events (pointerdown/pointerup) - a touchend, if the browser also fires
  // one for the same physical touch, is an entirely separate event the
  // zoom guard listens for; simulating it here (when requested) must never
  // change what the pointer-event-driven calls below already did.
  function simulateTouchEndOn(cellEl) {
    if (!withTouchSimulation) return;
    const fake = fakeTouchEnd(makeFakeElement(['.cell', '.game-screen']));
    handleTouchEnd(fake.event);
  }

  // --- Single tap on empty -> X, immediately ---
  const emptyCell = findCell(snap.grid, (c) => c.state === Grid.CellState.EMPTY);
  game.tapCell(emptyCell.row, emptyCell.col); // pointerup -> tapCell, as input.js's endDrag does
  simulateTouchEndOn(gameScreenEl);
  assert(emptyCell.state === Grid.CellState.X, 'single tap on empty cell places X immediately' + (withTouchSimulation ? ' (touch)' : ' (pointer)'));

  // --- Double tap within the window -> flower attempt ---
  game.tapCell(emptyCell.row, emptyCell.col); // 2nd tap, fast
  simulateTouchEndOn(gameScreenEl);
  assert(
    emptyCell.state === Grid.CellState.FLOWER || emptyCell.state === Grid.CellState.WRONG,
    'a second tap within the double-tap window promotes X to a flower attempt' + (withTouchSimulation ? ' (touch)' : ' (pointer)')
  );

  // --- Single tap on an X, no quick follow-up -> clears after the window ---
  const anotherEmpty = findCell(
    snap.grid,
    (c) => c.state === Grid.CellState.EMPTY && !(c.row === emptyCell.row && c.col === emptyCell.col)
  );
  game.tapCell(anotherEmpty.row, anotherEmpty.col); // -> X
  simulateTouchEndOn(gameScreenEl);
  await wait(State.DOUBLE_TAP_WINDOW_MS + 100);
  game.tapCell(anotherEmpty.row, anotherEmpty.col); // single tap on that X, no follow-up
  simulateTouchEndOn(gameScreenEl);
  await wait(State.DOUBLE_TAP_WINDOW_MS + 100);
  assert(
    anotherEmpty.state === Grid.CellState.EMPTY,
    'a single tap on an X with no quick follow-up clears it after the window' + (withTouchSimulation ? ' (touch)' : ' (pointer)')
  );

  // --- Drag-to-mark / drag-to-clear (markCellX/clearCellX) ---
  const dragCell = findCell(
    snap.grid,
    (c) => c.state === Grid.CellState.EMPTY && !(c.row === anotherEmpty.row && c.col === anotherEmpty.col)
  );
  game.markCellX(dragCell.row, dragCell.col); // drag passing over an empty cell
  simulateTouchEndOn(gameScreenEl);
  assert(dragCell.state === Grid.CellState.X, 'drag-to-mark places an X on an empty cell' + (withTouchSimulation ? ' (touch)' : ' (pointer)'));
  game.clearCellX(dragCell.row, dragCell.col); // drag passing over an X
  simulateTouchEndOn(gameScreenEl);
  assert(dragCell.state === Grid.CellState.EMPTY, 'drag-to-clear removes an X' + (withTouchSimulation ? ' (touch)' : ' (pointer)'));

  // --- The pre-placed flower is never touched by any of the above ---
  const given = findCell(snap.grid, (c) => c.state === Grid.CellState.FLOWER && c.locked);
  game.tapCell(given.row, given.col);
  simulateTouchEndOn(gameScreenEl);
  assert(given.state === Grid.CellState.FLOWER, 'the pre-placed flower stays untouched' + (withTouchSimulation ? ' (touch)' : ' (pointer)'));

  return { emptyState: emptyCell.state, dragCellFinal: dragCell.state };
}

async function main() {
  const pointerOnlyResult = await runTapSequence(false);
  const withTouchResult = await runTapSequence(true);

  assert(
    pointerOnlyResult.emptyState === withTouchResult.emptyState,
    'double-tap-to-plant reaches the same outcome whether or not a touchend also fires alongside the pointer events'
  );
  assert(
    pointerOnlyResult.dragCellFinal === withTouchResult.dragCellFinal,
    'drag-to-mark/clear reaches the same outcome whether or not a touchend also fires alongside the pointer events'
  );

  // Let Part 1's async (outside-the-window) assertion finish before exiting.
  await wait(ZoomGuard.DOUBLE_TAP_ZOOM_WINDOW_MS + 200);

  console.log(`${checks} checks run, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
