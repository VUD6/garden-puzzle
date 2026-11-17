// Plain Node script, no test framework/dependency. Run with: node tests/daily-challenge.test.js
// Covers the daily challenge (js/daily-challenge.js): date -> puzzle
// determinism/variety/range, the 15+ unlock level matching the menu's own
// constant, unlimited attempts that never touch progression/win streak, the
// once-per-day idempotent reward (points/stars/helper charges), midnight
// rollover and the backwards-clock tamper guard (both via the injectable
// Garden.platform.now() clock, no waiting for real days), and migration
// from a save that predates this feature.
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
require('../js/rng.js');
require('../js/grid.js');
require('../js/rules.js');
require('../js/solver.js');
require('../js/generator.js');
require('../js/levelstart.js');
require('../js/platform.js');
require('../js/helpers.js');
require('../js/state.js');
require('../js/checkin.js');
require('../js/menu.js');
require('../js/daily-challenge.js');

const {
  grid: Grid,
  rules: Rules,
  solver: Solver,
  platform: Platform,
  helpers: Helpers,
  state: State,
  checkin: Checkin,
  menu: Menu,
  dailyChallenge: DailyChallenge,
} = globalThis.Garden;

let failures = 0;
let checks = 0;

function assert(condition, message) {
  checks++;
  if (!condition) {
    failures++;
    console.error('FAIL: ' + message);
  }
}

function setNow(dateString) {
  Platform.now = function () {
    return new Date(dateString + 'T12:00:00');
  };
}

function freshGame() {
  resetStorage();
}

function nonSolutionCells(built) {
  const solutionKeys = new Set(built.solution.map((p) => p.row + ',' + p.col));
  const cells = [];
  for (let row = 0; row < built.size; row++) {
    for (let col = 0; col < built.size; col++) {
      if (!solutionKeys.has(row + ',' + col)) cells.push({ row, col });
    }
  }
  return cells;
}

// Solves today's puzzle via the exact same double-tap gesture a player
// uses - tapping each solution cell twice in a row (X, then promote to
// flower) - winning on the very last one, exactly like tests/state.test.js's
// own double-tap sequences. Returns the actual 'won' snapshot emitted by
// that final tap (the last entry pushed into `emitted`, which the caller's
// onChange must push every snapshot into) - NOT a fresh game.getSnapshot()
// call afterward, since transient fields like `rating`/`elapsedSeconds`
// only ever ride along on that one emit, not on the base snapshot shape.
function winChallenge(game, dateKey, emitted) {
  const built = DailyChallenge.buildChallengeLevel(dateKey);
  built.solution.forEach(function (pos) {
    game.tapCell(pos.row, pos.col);
    game.tapCell(pos.row, pos.col);
  });
  return emitted[emitted.length - 1];
}

// Loses exactly one life by double-tapping a non-solution cell (promotes to
// a WRONG red X). Returns the cell used, in case a caller wants a fresh one
// next time (a locked WRONG cell can't be re-used).
function loseOneLife(game, dateKey, usedCells) {
  const built = DailyChallenge.buildChallengeLevel(dateKey);
  const candidates = nonSolutionCells(built).filter(
    (c) => !usedCells.has(c.row + ',' + c.col)
  );
  const cell = candidates[0];
  usedCells.add(cell.row + ',' + cell.col);
  game.tapCell(cell.row, cell.col);
  game.tapCell(cell.row, cell.col);
  return cell;
}

function main() {
  // --- Date -> difficulty level: deterministic, varied, in range ---
  freshGame();
  const sampleDates = [];
  for (let i = 0; i < 60; i++) {
    sampleDates.push(Checkin.advanceDateKey('2024-01-01', i));
  }

  const levelsByDate = {};
  sampleDates.forEach(function (d) {
    levelsByDate[d] = DailyChallenge.difficultyLevelForDate(d);
  });

  assert(
    DailyChallenge.difficultyLevelForDate('2024-06-15') === DailyChallenge.difficultyLevelForDate('2024-06-15'),
    'same date always gives the same difficulty level'
  );

  const distinctLevels = new Set(Object.values(levelsByDate));
  assert(distinctLevels.size > 1, `different dates give different levels (saw ${distinctLevels.size} distinct values across 60 dates)`);
  Object.keys(levelsByDate).forEach(function (d) {
    const lvl = levelsByDate[d];
    assert(
      lvl >= DailyChallenge.DIFFICULTY_MIN_LEVEL && lvl <= DailyChallenge.DIFFICULTY_MAX_LEVEL,
      `${d}: difficulty level ${lvl} is within [${DailyChallenge.DIFFICULTY_MIN_LEVEL}, ${DailyChallenge.DIFFICULTY_MAX_LEVEL}]`
    );
  });

  // Two dates that land on the exact same difficulty level must still get a
  // different puzzle (the generation seed is a distinct transform, not just
  // the 16-way difficulty pick) - find one such colliding pair in the sample.
  const byLevel = {};
  Object.keys(levelsByDate).forEach(function (d) {
    const lvl = levelsByDate[d];
    (byLevel[lvl] = byLevel[lvl] || []).push(d);
  });
  const collidingLevel = Object.keys(byLevel).find((lvl) => byLevel[lvl].length >= 2);
  assert(collidingLevel !== undefined, 'the 60-date sample contains at least one same-difficulty-level collision to check');
  if (collidingLevel !== undefined) {
    const [dateA, dateB] = byLevel[collidingLevel];
    assert(
      DailyChallenge.generationSeedForDate(dateA) !== DailyChallenge.generationSeedForDate(dateB),
      `dates ${dateA} and ${dateB} share difficulty level ${collidingLevel} but still get different generation seeds`
    );
    const builtA = DailyChallenge.buildChallengeLevel(dateA);
    const builtB = DailyChallenge.buildChallengeLevel(dateB);
    assert(JSON.stringify(builtA.regionOf) !== JSON.stringify(builtB.regionOf), 'same-difficulty-level dates still produce different boards');
  }

  // --- Unlock level matches the menu's own constant exactly ---
  assert(DailyChallenge.UNLOCK_LEVEL === 15, 'daily challenge unlocks exactly at level 15');
  assert(
    DailyChallenge.UNLOCK_LEVEL === Menu.DAILY_CHALLENGE_UNLOCK_LEVEL,
    'the two independent copies of the unlock level (menu.js and daily-challenge.js) agree'
  );

  // --- buildChallengeLevel: respects the existing generator caps and shape ---
  ['2024-02-10', '2024-07-04', '2024-11-23'].forEach(function (d) {
    const built = DailyChallenge.buildChallengeLevel(d);
    assert(built.size === 8, `${d}: challenge board is always 8x8 (got ${built.size})`);
    assert(built.givenFlowers.length === 0, `${d}: no pre-placed flowers (at most 1 gingerbread cap trivially respected)`);
    assert(built.crossCells.length === 0, `${d}: no pre-placed crosses`);
    assert(built.solution.length === 8, `${d}: solution has exactly 8 flowers`);
    assert(built.startType === 'none', `${d}: start type is 'none'`);
    assert(Solver.hasUniqueSolution(built.size, built.regionOf), `${d}: the generated board has a unique solution`);
    const singleCellCount = globalThis.Garden.generator.countSingleCellRegions(built.size, built.regionOf);
    const cap = State.singleCellRegionCap(built.difficultyLevel);
    assert(singleCellCount <= (cap === Infinity ? built.size : cap), `${d}: single-cell-region cap respected (count=${singleCellCount}, cap=${cap})`);
  });

  // --- Unlimited attempts until win: losing never touches progression/streak ---
  freshGame();
  Platform.saveProgress(20);
  Platform.saveHighestLevel(20);
  Platform.saveWinStreak(3);
  setNow('2024-05-01');
  const todayA = Checkin.getTodayKey();

  const game1 = State.createGame({ onChange: function () {} });
  DailyChallenge.start(game1);
  let snap1 = game1.getSnapshot();
  assert(snap1.mode === 'challenge', 'start() switches the game into challenge mode');
  assert(snap1.level >= 15 && snap1.level <= 30, 'challenge pseudo-level is in the 15-30 range');

  const usedCells1 = new Set();
  for (let attempt = 0; attempt < 3; attempt++) {
    for (let life = 0; life < State.MAX_LIVES; life++) loseOneLife(game1, todayA, usedCells1);
    snap1 = game1.getSnapshot();
    assert(snap1.status === 'lost', `attempt ${attempt + 1}: losing all 3 lives ends the attempt`);
    game1.retryLevel();
    snap1 = game1.getSnapshot();
    assert(snap1.status === 'playing' && snap1.lives === State.MAX_LIVES, `attempt ${attempt + 1}: retry grants a fresh attempt with full lives`);
  }
  assert(Platform.loadWinStreak() === 3, 'repeated challenge losses never touch the win streak');
  assert(Platform.loadProgress() === 20, 'challenge play never touches saved progress');
  assert(Platform.loadHighestLevel() === 20, 'challenge play never touches the highest-level watermark');

  // --- Back button costs nothing: exitChallenge restores normal mode/level ---
  game1.exitChallenge();
  assert(game1.getSnapshot().mode === 'normal', 'exitChallenge switches back to normal mode');
  assert(game1.getSnapshot().level === 20, 'exitChallenge reloads the real saved progress level');

  // --- start()/canStart() refuse to (re-)open a locked or already-done challenge,
  // regardless of caller - not just when gated by the menu button's own disabled
  // state (this is the exact bug this guard fixes: a stale/bypassed button click,
  // or any other direct call, must never be able to start a completed/locked
  // challenge). ---
  freshGame();
  Platform.saveProgress(10); // below the level-15 unlock
  Platform.saveHighestLevel(10);
  setNow('2024-05-10');

  const lockedGame = State.createGame({ onChange: function () {} });
  const lockedModeBefore = lockedGame.getSnapshot().mode;
  assert(DailyChallenge.canStart() === false, 'canStart() is false below the unlock level');
  assert(DailyChallenge.start(lockedGame) === false, 'start() refuses below the unlock level');
  assert(lockedGame.getSnapshot().mode === lockedModeBefore, 'a refused start() never touches the game instance at all');

  Platform.saveProgress(20);
  Platform.saveHighestLevel(20);
  const todayLocked = Checkin.getTodayKey();
  assert(DailyChallenge.canStart() === true, 'canStart() is true once unlocked and not yet won today');

  const doneGame = State.createGame({ onChange: function () {} });
  const doneSnapshots = [];
  const unlockedGame = State.createGame({ onChange: function (s) { doneSnapshots.push(s); } });
  DailyChallenge.start(unlockedGame);
  winChallenge(unlockedGame, todayLocked, doneSnapshots);
  DailyChallenge.creditIfFirstWinToday(doneSnapshots[doneSnapshots.length - 1].levelScore, doneSnapshots[doneSnapshots.length - 1].rating);
  assert(DailyChallenge.isDoneToday() === true, 'the challenge is now done for today, set up for the next checks');

  const doneModeBefore = doneGame.getSnapshot().mode;
  assert(DailyChallenge.canStart() === false, 'canStart() is false once already won today');
  assert(DailyChallenge.start(doneGame) === false, 'start() refuses to re-open an already-won-today challenge');
  assert(doneGame.getSnapshot().mode === doneModeBefore, 'a refused start() never touches a completely unrelated game instance either');

  // --- Reward on first win: points, stars, helper charges - exactly once ---
  freshGame();
  Platform.saveProgress(20);
  Platform.saveHighestLevel(20);
  setNow('2024-05-02');
  const todayB = Checkin.getTodayKey();

  const chargesBefore = {};
  Helpers.HELPER_IDS.forEach(function (id) { chargesBefore[id] = Helpers.getCharges(id); });
  const totalScoreBefore = Platform.loadTotalScore();
  const totalStarsBefore = Platform.loadTotalStars();

  const snapshots = [];
  const game2 = State.createGame({
    onChange: function (snap) {
      snapshots.push(DailyChallenge.handleSnapshot(snap));
    },
  });
  DailyChallenge.start(game2);
  const lastSnapshot = winChallenge(game2, todayB, snapshots);
  const wonSnapshot = lastSnapshot;
  assert(wonSnapshot.status === 'won', 'the challenge can actually be won by solving it');
  assert(lastSnapshot.challengeReward !== null, 'the first win of the day grants a reward');
  assert(lastSnapshot.challengeReward.amount === DailyChallenge.CHALLENGE_HELPER_REWARD_AMOUNT, 'reward amount matches the spec (2 charges)');
  assert(lastSnapshot.challengeReward.stars === wonSnapshot.rating, 'reward stars equal the rating earned this run');

  const rewardedHelper = lastSnapshot.challengeReward.helperId;
  assert(
    Helpers.getCharges(rewardedHelper) === chargesBefore[rewardedHelper] + DailyChallenge.CHALLENGE_HELPER_REWARD_AMOUNT,
    'the rewarded helper gained exactly the reward amount in charges'
  );
  Helpers.HELPER_IDS.filter((id) => id !== rewardedHelper).forEach(function (id) {
    assert(Helpers.getCharges(id) === chargesBefore[id], `non-rewarded helper ${id} is untouched`);
  });
  assert(Platform.loadTotalScore() === totalScoreBefore + wonSnapshot.levelScore, 'total score gains exactly this run\'s level score, once');
  assert(Platform.loadTotalStars() === totalStarsBefore + wonSnapshot.rating, 'total stars gains exactly this run\'s rating, once');
  assert(DailyChallenge.isDoneToday() === true, 'the challenge is marked done for today after the first win');
  assert(Platform.loadWinStreak() === 0, 'a challenge win never touches the win streak (never incremented from its starting 0)');

  // --- Idempotent: a reload/double-tap re-delivering the same 'won' snapshot grants nothing more ---
  const secondHandle = DailyChallenge.handleSnapshot(wonSnapshot);
  assert(secondHandle.challengeReward === null, 'handling the same win snapshot again grants no second reward');
  assert(Platform.loadTotalScore() === totalScoreBefore + wonSnapshot.levelScore, 'total score did not change on the idempotent re-handle');
  assert(Helpers.getCharges(rewardedHelper) === chargesBefore[rewardedHelper] + DailyChallenge.CHALLENGE_HELPER_REWARD_AMOUNT, 'helper charges did not change on the idempotent re-handle');

  // --- A genuine replay (retry + win again the same day) also grants nothing ---
  game2.retryLevel();
  const replaySnapshot = winChallenge(game2, todayB, snapshots);
  assert(DailyChallenge.creditIfFirstWinToday(replaySnapshot.levelScore, replaySnapshot.rating) === null, 'replaying and re-winning the same day grants no reward');
  assert(Platform.loadTotalScore() === totalScoreBefore + wonSnapshot.levelScore, 'total score still unchanged after a same-day replay win');

  // --- Midnight rollover: a new day allows a new reward, with a different puzzle ---
  setNow('2024-05-03');
  const todayC = Checkin.getTodayKey();
  assert(DailyChallenge.isDoneToday() === false, 'a new calendar day is not done yet');
  assert(
    DailyChallenge.buildChallengeLevel(todayC).regionOf.toString() !== DailyChallenge.buildChallengeLevel(todayB).regionOf.toString() ||
      DailyChallenge.difficultyLevelForDate(todayC) !== DailyChallenge.difficultyLevelForDate(todayB),
    'the new day usually gets a different puzzle than the previous day'
  );

  const snapshotsC = [];
  const game3 = State.createGame({ onChange: function (snap) { snapshotsC.push(snap); } });
  DailyChallenge.start(game3);
  const wonSnapshotC = winChallenge(game3, todayC, snapshotsC);
  const rewardC = DailyChallenge.creditIfFirstWinToday(wonSnapshotC.levelScore, wonSnapshotC.rating);
  assert(rewardC !== null, 'a new day grants the reward again after already winning the previous day');
  assert(Platform.loadTotalScore() === totalScoreBefore + wonSnapshot.levelScore + wonSnapshotC.levelScore, 'total score accumulates across two different days\' wins');

  // --- Clock moved backwards: never re-grants from an artificial rollback ---
  setNow('2024-05-02'); // back to the already-rewarded day B
  const scoreBeforeTamperAttempt = Platform.loadTotalScore();
  const tamperedResult = DailyChallenge.creditIfFirstWinToday(999, 3);
  assert(tamperedResult === null, 'a clock rolled back to an earlier, already-seen date grants nothing');
  assert(Platform.loadTotalScore() === scoreBeforeTamperAttempt, 'total score is untouched by the blocked backwards-clock attempt');

  // --- Migration preserves everything else ---
  resetStorage();
  // Simulate a save made before this feature existed: real progress/score/
  // stars/best-time/charges/streak/daily-gift/sound data already present,
  // but no garden.dailyChallenge key or schema version at all yet.
  Platform.saveProgress(27);
  Platform.saveHighestLevel(27);
  Platform.saveTotalScore(1234);
  Platform.saveBestTime(5, 42);
  Platform.saveBestStars(5, 3);
  Platform.saveWinStreak(6);
  Platform.saveDailyGift({ lastClaimDate: '2024-04-01', lastSeenDate: '2024-04-01', position: 3, plan: null });
  Platform.saveSfxEnabled(false);
  Platform.saveMusicEnabled(false);
  Helpers.addCharges('finder', 9);
  const financeAfterAdd = Helpers.getCharges('finder');
  localStorage.removeItem('garden.dailyChallenge');
  localStorage.removeItem('garden.dailyChallengeSchemaVersion');

  Platform.migrateDailyChallenge();

  const migratedRecord = Platform.loadDailyChallenge();
  assert(migratedRecord.lastRewardDate === null && migratedRecord.challengeStars === 0, 'migration establishes a fresh, never-won daily-challenge record');
  assert(Platform.loadProgress() === 27, 'migration leaves saved progress untouched');
  assert(Platform.loadHighestLevel() === 27, 'migration leaves the highest-level watermark untouched');
  assert(Platform.loadTotalScore() === 1234, 'migration leaves total score untouched');
  assert(Platform.loadBestTime(5) === 42, 'migration leaves best time untouched');
  assert(Platform.loadBestStars(5) === 3, 'migration leaves best stars untouched');
  assert(Platform.loadWinStreak() === 6, 'migration leaves the win streak untouched');
  assert(Platform.loadDailyGift().position === 3, 'migration leaves the daily gift state untouched');
  assert(Platform.loadSfxEnabled() === false && Platform.loadMusicEnabled() === false, 'migration leaves sound settings untouched');
  assert(Helpers.getCharges('finder') === financeAfterAdd, 'migration leaves helper charges untouched');

  // Idempotent: calling it again changes nothing further.
  Platform.migrateDailyChallenge();
  assert(JSON.stringify(Platform.loadDailyChallenge()) === JSON.stringify(migratedRecord), 'migration is idempotent on a second call');

  console.log(`${checks} checks run, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
