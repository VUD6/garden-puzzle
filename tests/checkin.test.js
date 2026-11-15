// Plain Node script, no test framework/dependency. Run with: node tests/checkin.test.js
// Covers Step 5 (daily check-in): streak transitions, the 7-day reward
// table (now helper charges instead of seeds), the clock-tampering guard,
// DST-safe day diffing, corrupted-storage fallback, and the
// persist-before-credit ordering - all via the injectable Platform.now()
// clock, no waiting for real days.
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
require('../js/checkin.js');

const { platform: Platform, helpers: Helpers, checkin: Checkin } = globalThis.Garden;

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

function totalCharges() {
  return Helpers.HELPER_IDS.reduce((sum, id) => sum + Helpers.getCharges(id), 0);
}

function main() {
  // --- First-ever claim gives streak 1, no reward (day 1 of the cycle) ---
  resetStorage();
  setToday(2026, 1, 1);
  let result = Checkin.claim();
  assert(result.claimed === true, 'first-ever claim succeeds');
  assert(result.record.currentStreak === 1, 'first-ever claim starts the streak at 1');
  assert(result.record.bestStreak === 1, 'first-ever claim sets bestStreak to 1');
  assert(result.reward === null, 'day 1 grants no reward');
  const startingTotal = Helpers.HELPER_IDS.length * Helpers.STARTING_CHARGES;
  assert(totalCharges() === startingTotal, 'day 1 does not change any helper charge balance (got ' + totalCharges() + ')');

  // --- Double claim on the same day is a no-op ---
  const totalAfterDay1 = totalCharges();
  const sameDay = Checkin.claim();
  assert(sameDay.claimed === false, 'a second claim the same day is rejected');
  assert(sameDay.alreadyClaimedToday === true, 'a second claim the same day reports alreadyClaimedToday');
  assert(Checkin.claim().record.currentStreak === 1, 'the streak is unchanged by a same-day double claim');
  assert(totalCharges() === totalAfterDay1, 'a same-day double claim never changes any charge balance');

  // --- Consecutive days increase the streak; day 4 and day 7 pay out exactly their configured charges ---
  resetStorage();
  setToday(2026, 1, 1);
  Checkin.claim(); // day 1, streak 1
  for (let day = 2; day <= 7; day++) {
    setToday(2026, 1, day);
    const before = totalCharges();
    result = Checkin.claim();
    assert(result.claimed === true, 'day ' + day + ' claim succeeds');
    assert(result.record.currentStreak === day, 'consecutive days increase the streak (day ' + day + ' -> streak ' + result.record.currentStreak + ')');

    const config = Checkin.HELPER_REWARD_BY_DAY[day];
    if (!config) {
      assert(result.reward === null, 'day ' + day + ' (no configured reward) grants nothing');
      assert(totalCharges() === before, 'day ' + day + " doesn't change any charge balance");
    } else if (config.allHelpers) {
      assert(result.reward.allHelpers === true, 'day ' + day + ' credits all three helpers');
      assert(result.reward.amount === config.amount, 'day ' + day + ' grants exactly ' + config.amount + ' charges to each helper');
      assert(
        totalCharges() === before + config.amount * Helpers.HELPER_IDS.length,
        'day ' + day + ' increases the total charge count by amount * 3 helpers (got +' + (totalCharges() - before) + ')'
      );
    } else {
      assert(result.reward.allHelpers === false, 'day ' + day + ' credits exactly one helper');
      assert(result.reward.amount === config.amount, 'day ' + day + ' grants exactly ' + config.amount + ' charges');
      assert(Helpers.HELPER_IDS.includes(result.reward.helperId), 'day ' + day + " names a real helper id (got '" + result.reward.helperId + "')");
      assert(totalCharges() === before + config.amount, 'day ' + day + ' increases the total charge count by exactly ' + config.amount);
    }
  }
  const totalAfterFullCycle = totalCharges();
  const day4Config = Checkin.HELPER_REWARD_BY_DAY[4];
  const day7Config = Checkin.HELPER_REWARD_BY_DAY[7];
  assert(
    totalAfterFullCycle === startingTotal + day4Config.amount + day7Config.amount * Helpers.HELPER_IDS.length,
    'exactly the day-4 (one helper) and day-7 (all three helpers) rewards were credited over a full cycle (got +' + (totalAfterFullCycle - startingTotal) + ')'
  );

  // --- Day 4's single-helper pick is deterministic by date, not by cycle position ---
  resetStorage();
  setToday(2026, 5, 4);
  const pickA = Checkin.pickDailyHelperId(Checkin.dateKeyFromDate(Platform.now()));
  const pickB = Checkin.pickDailyHelperId(Checkin.dateKeyFromDate(Platform.now()));
  assert(pickA === pickB, 'the same calendar date always picks the same helper for a day-4 reward');

  // --- Day 8 wraps to position 1, streak keeps counting past 7 ---
  resetStorage();
  setToday(2026, 1, 1);
  Checkin.claim();
  for (let day = 2; day <= 7; day++) {
    setToday(2026, 1, day);
    Checkin.claim();
  }
  setToday(2026, 1, 8);
  result = Checkin.claim();
  assert(result.record.currentStreak === 8, 'day 8 continues the streak count (got ' + result.record.currentStreak + ')');
  assert(Checkin.dayInCycle(result.record.currentStreak) === 1, 'day 8 wraps to row position 1 of a new cycle');
  assert(result.reward === null, 'the wrapped day 1 grants nothing, same as the first cycle');
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

  // --- Clock moved backwards: grants nothing, streak/record/charges untouched ---
  resetStorage();
  setToday(2026, 2, 10);
  Checkin.claim(); // streak 1 on Feb 10
  const recordBeforeTamper = Platform.loadCheckin();
  const totalBeforeTamper = totalCharges();
  setToday(2026, 2, 9); // move the clock back one day
  result = Checkin.claim();
  assert(result.claimed === false, 'a backwards clock grants no claim');
  assert(result.alreadyClaimedToday === true, 'a backwards clock is reported as "already claimed"');
  assert(result.reward === null, 'a backwards clock credits nothing');
  const recordAfterTamper = Platform.loadCheckin();
  assert(
    recordAfterTamper.lastClaimDate === recordBeforeTamper.lastClaimDate && recordAfterTamper.currentStreak === recordBeforeTamper.currentStreak,
    'a backwards clock leaves the streak record completely untouched'
  );
  assert(totalCharges() === totalBeforeTamper, 'a backwards clock leaves every charge balance untouched');
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

  // --- advanceDateKey is a DST-safe inverse of daysBetweenKeys, used to preview future reward rows ---
  assert(Checkin.advanceDateKey('2026-03-08', 1) === '2026-03-09', 'advanceDateKey moves a date forward by whole calendar days across a DST boundary');
  assert(Checkin.advanceDateKey('2026-01-01', -1) === '2025-12-31', 'advanceDateKey can move backward and crosses a year boundary correctly');

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
  assert(preview.reward && preview.reward.amount === Checkin.HELPER_REWARD_BY_DAY[4].amount, 'sanity: this claim would be the day-4 reward');
  const totalBeforeCrash = totalCharges();
  // Simulate claim() crashing after persisting the record but before the
  // charge credit line runs (exactly the ordering claim() uses).
  Platform.saveCheckin(preview.record);
  assert(totalCharges() === totalBeforeCrash, 'sanity: charges were not credited yet (crash simulated)');
  const afterCrashRetry = Checkin.claim();
  assert(afterCrashRetry.claimed === false, 'retrying after the simulated crash finds the day already marked claimed');
  assert(afterCrashRetry.reward === null, 'the retry credits nothing further (no double claim)');
  assert(totalCharges() === totalBeforeCrash, 'no charge balance ever received the reward after the interrupted claim (lost, not duplicated)');

  console.log(`${checks} checks run, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
