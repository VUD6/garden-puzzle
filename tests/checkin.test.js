// Plain Node script, no test framework/dependency. Run with: node tests/checkin.test.js
// Covers Step 5 (daily check-in): streak transitions, the 7-day reward
// table, the clock-tampering guard, DST-safe day diffing, corrupted-storage
// fallback, and the persist-before-credit ordering - all via the injectable
// Platform.now() clock, no waiting for real days.
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
require('../js/checkin.js');

const { platform: Platform, checkin: Checkin } = globalThis.Garden;

let failures = 0;
let checks = 0;

function assert(condition, message) {
  checks++;
  if (!condition) {
    failures++;
    console.error('FAIL: ' + message);
  }
}

function setToday(year, month, day) {
  // month is 1-based here for readability at call sites; Date wants 0-based.
  Platform.now = function () {
    return new Date(year, month - 1, day, 10, 0, 0);
  };
}

function main() {
  // --- First-ever claim gives streak 1, no reward (day 1 of the cycle) ---
  resetStorage();
  setToday(2026, 1, 1);
  let result = Checkin.claim();
  assert(result.claimed === true, 'first-ever claim succeeds');
  assert(result.record.currentStreak === 1, 'first-ever claim starts the streak at 1');
  assert(result.record.bestStreak === 1, 'first-ever claim sets bestStreak to 1');
  assert(result.reward === 0, 'day 1 grants no seeds');
  assert(Platform.loadSeeds() === Platform.STARTING_SEEDS, 'day 1 does not change the seed balance (got ' + Platform.loadSeeds() + ')');

  // --- Double claim on the same day is a no-op ---
  const seedsAfterDay1 = Platform.loadSeeds();
  const sameDay = Checkin.claim();
  assert(sameDay.claimed === false, 'a second claim the same day is rejected');
  assert(sameDay.alreadyClaimedToday === true, 'a second claim the same day reports alreadyClaimedToday');
  assert(Checkin.claim().record.currentStreak === 1, 'the streak is unchanged by a same-day double claim');
  assert(Platform.loadSeeds() === seedsAfterDay1, 'a same-day double claim never changes the seed balance');

  // --- Consecutive days increase the streak; day 4 and day 7 pay out exactly their configured seeds ---
  resetStorage();
  setToday(2026, 1, 1);
  Checkin.claim(); // day 1, streak 1
  for (let day = 2; day <= 7; day++) {
    setToday(2026, 1, day);
    result = Checkin.claim();
    assert(result.claimed === true, 'day ' + day + ' claim succeeds');
    assert(result.record.currentStreak === day, 'consecutive days increase the streak (day ' + day + ' -> streak ' + result.record.currentStreak + ')');
    const expectedReward = Checkin.SEED_REWARD_BY_DAY[day] || 0;
    assert(result.reward === expectedReward, 'day ' + day + ' (cycle position ' + day + ') grants ' + expectedReward + ' seeds (got ' + result.reward + ')');
  }
  const seedsAfterFullCycle = Platform.loadSeeds();
  assert(
    seedsAfterFullCycle === Platform.STARTING_SEEDS + Checkin.SEED_REWARD_BY_DAY[4] + Checkin.SEED_REWARD_BY_DAY[7],
    'exactly the day-4 and day-7 rewards were credited over a full cycle (got +' + (seedsAfterFullCycle - Platform.STARTING_SEEDS) + ')'
  );

  // --- Day 8 wraps to position 1, streak keeps counting past 7 ---
  setToday(2026, 1, 8);
  result = Checkin.claim();
  assert(result.record.currentStreak === 8, 'day 8 continues the streak count (got ' + result.record.currentStreak + ')');
  assert(Checkin.dayInCycle(result.record.currentStreak) === 1, 'day 8 wraps to row position 1 of a new cycle');
  assert(result.reward === 0, 'the wrapped day 1 grants no seeds, same as the first cycle');
  assert(result.record.bestStreak === 8, 'bestStreak tracks the streak past a full cycle');

  // --- A missed day resets the streak to 1 ---
  setToday(2026, 1, 10); // skipped day 9
  result = Checkin.claim();
  assert(result.record.currentStreak === 1, 'a missed day resets the streak to 1 (got ' + result.record.currentStreak + ')');
  assert(result.record.bestStreak === 8, 'bestStreak never decreases after a reset (stayed ' + result.record.bestStreak + ')');

  // --- bestStreak never decreases even across further resets ---
  setToday(2026, 1, 12); // skip day 11 too
  result = Checkin.claim();
  assert(result.record.currentStreak === 1, 'another missed day resets the streak to 1 again');
  assert(result.record.bestStreak === 8, 'bestStreak still has not decreased (stayed ' + result.record.bestStreak + ')');

  // --- Clock moved backwards: grants nothing, streak/record untouched ---
  resetStorage();
  setToday(2026, 2, 10);
  Checkin.claim(); // streak 1 on Feb 10
  const recordBeforeTamper = Platform.loadCheckin();
  const seedsBeforeTamper = Platform.loadSeeds();
  setToday(2026, 2, 9); // move the clock back one day
  result = Checkin.claim();
  assert(result.claimed === false, 'a backwards clock grants no claim');
  assert(result.alreadyClaimedToday === true, 'a backwards clock is reported as "already claimed"');
  assert(result.reward === 0, 'a backwards clock credits no seeds');
  const recordAfterTamper = Platform.loadCheckin();
  assert(
    recordAfterTamper.lastClaimDate === recordBeforeTamper.lastClaimDate && recordAfterTamper.currentStreak === recordBeforeTamper.currentStreak,
    'a backwards clock leaves the streak record completely untouched'
  );
  assert(Platform.loadSeeds() === seedsBeforeTamper, 'a backwards clock leaves the seed balance untouched');
  // Clock corrected back to the real, later day: normal operation resumes.
  setToday(2026, 2, 11);
  result = Checkin.claim();
  assert(result.claimed === true && result.record.currentStreak === 2, 'claiming resumes normally once the clock is honest again');

  // --- DST-safe day diffing: a boundary date pair still counts as exactly 1 day ---
  // (daysBetweenKeys works from UTC anchors of the calendar date parts, never
  // from a millisecond difference between real local Date objects, so it is
  // correct regardless of the host machine's own timezone/DST rules.)
  assert(Checkin.daysBetweenKeys('2026-03-08', '2026-03-09') === 1, 'a US spring-forward DST boundary still counts as 1 day apart');
  assert(Checkin.daysBetweenKeys('2026-11-01', '2026-11-02') === 1, 'a US fall-back DST boundary still counts as 1 day apart');

  // --- Corrupted storage falls back safely ---
  resetStorage();
  globalThis.localStorage.setItem('garden.checkin', 'not json at all {{{');
  let record = Platform.loadCheckin();
  assert(record.lastClaimDate === null && record.currentStreak === 0 && record.bestStreak === 0, 'unparsable JSON falls back to a fresh record');

  resetStorage();
  globalThis.localStorage.setItem('garden.checkin', JSON.stringify({ lastClaimDate: 12345, currentStreak: -3, bestStreak: 'lots' }));
  record = Platform.loadCheckin();
  assert(record.lastClaimDate === null, 'a non-string lastClaimDate is discarded');
  assert(record.currentStreak === 0, 'a negative currentStreak is discarded');
  assert(record.bestStreak === 0, 'a non-numeric bestStreak is discarded');
  setToday(2026, 1, 1);
  result = Checkin.claim();
  assert(result.claimed === true && result.record.currentStreak === 1, 'claiming still works cleanly after recovering from corrupted storage');

  // --- Persist-before-credit: a simulated crash between the two steps never double-claims ---
  resetStorage();
  setToday(2026, 4, 1);
  Checkin.claim(); // streak 1
  setToday(2026, 4, 2);
  Checkin.claim(); // streak 2
  setToday(2026, 4, 3);
  Checkin.claim(); // streak 3, about to become streak 4 (a reward day)
  setToday(2026, 4, 4);
  const todayKey = Checkin.dateKeyFromDate(Platform.now());
  const preview = Checkin.computeClaim(Platform.loadCheckin(), todayKey);
  assert(preview.reward === Checkin.SEED_REWARD_BY_DAY[4], 'sanity: this claim would be the day-4 reward');
  const seedsBeforeCrash = Platform.loadSeeds();
  // Simulate claim() crashing after persisting the record but before the
  // seed credit line runs (exactly the ordering claim() uses).
  Platform.saveCheckin(preview.record);
  assert(Platform.loadSeeds() === seedsBeforeCrash, 'sanity: seeds were not credited yet (crash simulated)');
  const afterCrashRetry = Checkin.claim();
  assert(afterCrashRetry.claimed === false, 'retrying after the simulated crash finds the day already marked claimed');
  assert(afterCrashRetry.reward === 0, 'the retry credits no further seeds (no double claim)');
  assert(Platform.loadSeeds() === seedsBeforeCrash, 'the seed balance never received the reward after the interrupted claim (lost, not duplicated)');

  console.log(`${checks} checks run, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
