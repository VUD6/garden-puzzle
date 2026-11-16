// Plain Node script, no test framework/dependency. Run with: node tests/menu-router.test.js
// Covers the Step 3 logic: the router's screen switching/loading-fade/hang
// protection, the menu's "Играть" vs "Продолжить" decision and daily-lock
// visibility, and the first-launch tutorial gate the Play button relies on.
require('../js/grid.js');

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
require('../js/menu.js');
require('../js/router.js');

const { grid: Grid, menu: Menu, router: Router, platform: Platform } = globalThis.Garden;

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

function makeFakeDom() {
  function fakeEl() {
    return { hidden: false, classList: { add() {}, remove() {} } };
  }
  return { loadingScreen: fakeEl(), menuScreen: fakeEl(), gameScreen: fakeEl() };
}

function emptyBoard(size) {
  const cells = [];
  for (let row = 0; row < size; row++) {
    const rowCells = [];
    for (let col = 0; col < size; col++) rowCells.push({ state: Grid.CellState.EMPTY, locked: false });
    cells.push(rowCells);
  }
  return { lives: 3, levelScore: 0, cells, awardedCells: [] };
}

async function main() {
  // --- Menu: hasProgress() ---
  assert(Menu.hasProgress(null) === false, 'no save -> no progress');
  assert(Menu.hasProgress({ cells: [] }) === false, 'empty board -> no progress');

  const onlyGiven = emptyBoard(4);
  onlyGiven.cells[0][1] = { state: Grid.CellState.FLOWER, locked: true }; // pre-placed, never awarded
  assert(Menu.hasProgress(onlyGiven) === false, 'only the pre-placed flower -> no progress');

  const withMark = emptyBoard(4);
  withMark.cells[2][2] = { state: Grid.CellState.X, locked: false };
  assert(Menu.hasProgress(withMark) === true, 'a plain X mark counts as progress');

  const withWrong = emptyBoard(4);
  withWrong.cells[1][3] = { state: Grid.CellState.WRONG, locked: true };
  assert(Menu.hasProgress(withWrong) === true, 'a red X (wrong) counts as progress');

  const withPlayerFlower = emptyBoard(4);
  withPlayerFlower.cells[3][0] = { state: Grid.CellState.FLOWER, locked: true };
  withPlayerFlower.awardedCells = ['3,0'];
  assert(Menu.hasProgress(withPlayerFlower) === true, 'a player-planted (awarded) flower counts as progress');

  // --- A "notes"-type level's pre-placed crosses (js/levelstart.js) are
  // locked, unlike a player's own X - they must never register as progress.
  const onlyGivenCross = emptyBoard(4);
  onlyGivenCross.cells[1][1] = { state: Grid.CellState.X, locked: true };
  onlyGivenCross.cells[2][3] = { state: Grid.CellState.X, locked: true };
  assert(Menu.hasProgress(onlyGivenCross) === false, 'only pre-placed (locked) crosses -> no progress');

  // --- A "rich"-type level's multiple pre-placed flowers, same as the
  // single pre-placed flower case: none of them are in awardedCells.
  const onlyGivenRich = emptyBoard(4);
  onlyGivenRich.cells[0][1] = { state: Grid.CellState.FLOWER, locked: true };
  onlyGivenRich.cells[2][3] = { state: Grid.CellState.FLOWER, locked: true };
  assert(Menu.hasProgress(onlyGivenRich) === false, 'only multiple pre-placed flowers (rich start) -> no progress');

  // --- Menu: shouldShowDailyLock() ---
  assert(Menu.shouldShowDailyLock(1) === true, 'daily lock shows before level 15 (level 1)');
  assert(Menu.shouldShowDailyLock(14) === true, 'daily lock shows just before unlock (level 14)');
  assert(Menu.shouldShowDailyLock(15) === false, 'daily lock hides once unlocked (level 15)');
  assert(Menu.shouldShowDailyLock(20) === false, 'daily lock stays hidden past unlock (level 20)');

  // --- First launch -> tutorial gate (the condition the Play button checks) ---
  resetStorage();
  assert(Platform.loadTutorialDone() === false, 'fresh storage: tutorial not done, so Play would run it first');
  Platform.saveTutorialDone(true);
  assert(Platform.loadTutorialDone() === true, 'after finishing: Play would skip straight to the game');

  // --- Router: showScreen toggles menu vs game ---
  let dom = makeFakeDom();
  let router = Router.createRouter(dom, { fadeMs: 20, hangTimeoutMs: 5000 });
  router.showScreen('menu');
  assert(dom.menuScreen.hidden === false && dom.gameScreen.hidden === true, 'showScreen("menu") reveals menu, hides game');
  router.showScreen('game');
  assert(dom.menuScreen.hidden === true && dom.gameScreen.hidden === false, 'showScreen("game") reveals game, hides menu');

  // --- Router: leaveLoading reveals the menu immediately and hides loading after the fade ---
  dom = makeFakeDom();
  router = Router.createRouter(dom, { fadeMs: 20, hangTimeoutMs: 5000 });
  router.leaveLoading();
  assert(dom.menuScreen.hidden === false, 'leaveLoading reveals the menu right away (fade does not delay it)');
  assert(dom.loadingScreen.hidden === false, 'loading screen is still in the DOM mid-fade');
  await wait(40);
  assert(dom.loadingScreen.hidden === true, 'loading screen is hidden once the fade finishes');

  // --- Router: leaveLoading is idempotent ---
  dom = makeFakeDom();
  router = Router.createRouter(dom, { fadeMs: 10, hangTimeoutMs: 5000 });
  router.leaveLoading();
  router.leaveLoading(); // should not throw or double-schedule anything odd
  await wait(30);
  assert(dom.loadingScreen.hidden === true, 'calling leaveLoading twice still ends with loading hidden');

  // --- Router: hang protection forces the menu even if leaveLoading is never called ---
  dom = makeFakeDom();
  router = Router.createRouter(dom, { fadeMs: 10, hangTimeoutMs: 30 });
  await wait(80);
  assert(dom.menuScreen.hidden === false, 'hang-protection timeout reveals the menu on its own');
  assert(dom.loadingScreen.hidden === true, 'hang-protection timeout also hides the loading screen');

  console.log(`${checks} checks run, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
