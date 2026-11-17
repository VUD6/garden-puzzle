// Plain Node script, no test framework/dependency. Run with: node tests/checkin.test.js
// Covers the daily gift (js/checkin.js): the 7-day rotation/day-4/day-7
// reward table, pause-not-reset on a missed day, the clock-tampering guard
// (both relative to the last claim AND the last-seen date), Snowman
// substitution before level 10, idempotent claiming, the migration from the
// old streak-based check-in save, and the debug day-offset clock - all via
// the injectable Platform.now() clock, no waiting for real days.
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

// Captured before any test overrides Platform.now (see setNow below) so the
// real debug-day-offset implementation can be restored later for the
// debug-clock tests - a mid-file override would otherwise be permanent,
// since Platform is one shared module-level object.
const REAL_PLATFORM_NOW = Platform.now;

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

function freshGame(highestLevel) {
  resetStorage();
  Platform.saveHighestLevel(highestLevel || 1);
}

// --- Full 7-day cycle, exact reward table, Snowman unlocked (no substitution) ---
(function () {
  freshGame(10); // Snowman unlocked throughout this block
  const days = ['2024-03-01', '2024-03-02', '2024-03-03', '2024-03-04', '2024-03-05', '2024-03-06', '2024-03-07'];
  const expectedHelper = { 1: 'finder', 2: 'random', 3: 'snowman', 5: 'finder', 6: 'random' };

  days.forEach(function (day, idx) {
    const position = idx + 1;
    setNow(day);
    const before = { finder: Helpers.getCharges('finder'), random: Helpers.getCharges('random'), snowman: Helpers.getCharges('snowman') };
    const result = Checkin.claim();
    assert(result.available === true, `day ${position}: claim succeeds`);
    assert(result.reward.day === position, `day ${position}: resolves to cycle position ${position} (got ${result.reward.day})`);

    if (position === 4) {
      assert(result.reward.credits.length === 1, 'day 4: exactly one credit');
      assert(result.reward.credits[0].amount === 3, 'day 4: amount is 3');
      assert(result.reward.credits[0].helperId === 'finder', 'day 4: a 3-way tie in charges favors finder');
    } else if (position === 7) {
      assert(result.reward.credits.length === 3, 'day 7: credits one each of finder/random/snowman');
      result.reward.credits.forEach(function (c) {
        assert(c.amount === 3, 'day 7: 3 charges per helper (the big prize)');
      });
    } else {
      assert(result.reward.credits.length === 1, `day ${position}: exactly one credit`);
      assert(result.reward.credits[0].helperId === expectedHelper[position], `day ${position}: rotation helper is ${expectedHelper[position]} (got ${result.reward.credits[0].helperId})`);
      assert(result.reward.credits[0].amount === 1, `day ${position}: amount is 1`);
    }

    const after = { finder: Helpers.getCharges('finder'), random: Helpers.getCharges('random'), snowman: Helpers.getCharges('snowman') };
    result.reward.credits.forEach(function (c) {
      assert(after[c.helperId] - before[c.helperId] === c.amount, `day ${position}: ${c.helperId} charges increased by exactly ${c.amount}`);
    });
  });

  // Expected totals starting from STARTING_CHARGES (5 each): +1 finder(d1),
  // +1 random(d2), +1 snowman(d3), +3 finder(d4, tie), +1 finder(d5), +1
  // random(d6), +3 each(d7) => finder 5+1+3+1+3=13, random 5+1+1+3=10, snowman 5+1+3=9.
  assert(Helpers.getCharges('finder') === 13, `finder ends the cycle at 13 charges (got ${Helpers.getCharges('finder')})`);
  assert(Helpers.getCharges('random') === 10, `random ends the cycle at 10 charges (got ${Helpers.getCharges('random')})`);
  assert(Helpers.getCharges('snowman') === 9, `snowman ends the cycle at 9 charges (got ${Helpers.getCharges('snowman')})`);

  // --- Wraparound: an 8th consecutive claim repeats day 1's reward ---
  setNow('2024-03-08');
  const wrap = Checkin.claim();
  assert(wrap.reward.day === 1, `day 8 wraps back to cycle position 1 (got ${wrap.reward.day})`);
  assert(wrap.reward.credits[0].helperId === 'finder', 'day 8 (wrapped day 1) grants finder again');
  assert(Helpers.getCharges('finder') === 14, 'finder charges increased again after the wrap');
})();

// --- Missed days pause, never reset ---
(function () {
  freshGame(10);
  setNow('2024-04-01');
  const first = Checkin.claim();
  assert(first.reward.day === 1, 'first claim is day 1');

  // Skip 5 real days without claiming.
  setNow('2024-04-06');
  const afterGap = Checkin.claim();
  assert(afterGap.available === true, 'claim after a multi-day gap is still available');
  assert(afterGap.reward.day === 2, `a missed gap pauses, it does not reset - the next claim is day 2, not day 1 (got ${afterGap.reward.day})`);
})();

// --- Snowman substitution before level 10 (rotation day 3, day 4, day 7) ---
(function () {
  freshGame(1); // Snowman locked
  assert(Helpers.isUnlocked('snowman') === false, 'sanity: snowman starts locked');

  // Day 1, 2: normal (finder, random) - gets us to day 3 (rotation: snowman).
  setNow('2024-05-01');
  Checkin.claim();
  setNow('2024-05-02');
  Checkin.claim();

  const beforeDay3 = { finder: Helpers.getCharges('finder'), random: Helpers.getCharges('random') };
  setNow('2024-05-03');
  const day3 = Checkin.claim();
  assert(day3.reward.credits.length === 1, 'day 3 (snowman slot, locked): exactly one credit');
  assert(day3.reward.credits[0].helperId !== 'snowman', 'day 3: never actually credits the locked Snowman');
  assert(['finder', 'random'].includes(day3.reward.credits[0].helperId), 'day 3: redirected to finder or random instead');
  assert(Helpers.getCharges('snowman') === Helpers.STARTING_CHARGES, 'day 3: snowman charges are completely untouched while locked');
  const redirected3 = day3.reward.credits[0].helperId;
  assert(
    Helpers.getCharges(redirected3) === beforeDay3[redirected3] + 1,
    'day 3: the redirected helper actually received the charge (nothing wasted)'
  );

  setNow('2024-05-04');
  const day4 = Checkin.claim();
  assert(day4.reward.credits[0].helperId !== 'snowman', 'day 4 (locked): the fewest-charges pick never includes Snowman');
  assert(['finder', 'random'].includes(day4.reward.credits[0].helperId), 'day 4 (locked): eligible set is just finder/random');
  assert(day4.reward.credits[0].amount === 3, 'day 4: still grants 3 charges even redirected');

  setNow('2024-05-05');
  Checkin.claim(); // day 5
  setNow('2024-05-06');
  Checkin.claim(); // day 6

  const beforeDay7 = { finder: Helpers.getCharges('finder'), random: Helpers.getCharges('random'), snowman: Helpers.getCharges('snowman') };
  setNow('2024-05-07');
  const day7 = Checkin.claim();
  assert(day7.reward.credits.every(function (c) { return c.helperId !== 'snowman'; }), 'day 7 (locked): snowman never appears as a credited id');
  assert(day7.reward.credits.length <= 2, 'day 7 (locked): snowman\'s slot collapses onto finder/random, so at most 2 distinct credits');
  const totalDay7Amount = day7.reward.credits.reduce(function (sum, c) { return sum + c.amount; }, 0);
  assert(totalDay7Amount === 9, 'day 7 (locked): all 9 charges (3 helpers x 3) are still granted, just redirected (got ' + totalDay7Amount + ')');
  assert(Helpers.getCharges('snowman') === beforeDay7.snowman, 'day 7 (locked): snowman charges are untouched');
  assert(
    Helpers.getCharges('finder') + Helpers.getCharges('random') - beforeDay7.finder - beforeDay7.random === 9,
    'day 7 (locked): the full 9 charges landed on finder+random combined'
  );

  // --- Once unlocked, Snowman receives its own rewards again ---
  freshGame(10);
  setNow('2024-06-01');
  Checkin.claim(); // day1
  setNow('2024-06-02');
  Checkin.claim(); // day2
  setNow('2024-06-03');
  const day3Unlocked = Checkin.claim();
  assert(day3Unlocked.reward.credits[0].helperId === 'snowman', 'day 3, unlocked: snowman receives its own rotation reward');
})();

// --- Idempotent claim: a reload/double-tap on the same day grants once ---
(function () {
  freshGame(10);
  setNow('2024-07-01');
  const first = Checkin.claim();
  assert(first.available === true, 'first claim of the day succeeds');
  const snapshot = { finder: Helpers.getCharges('finder'), random: Helpers.getCharges('random'), snowman: Helpers.getCharges('snowman') };

  const second = Checkin.claim();
  assert(second.available === false, 'an immediate second claim the same day is rejected');
  assert(second.tampered === false, 'the rejection is "already claimed", not a tamper flag');
  assert(
    Helpers.getCharges('finder') === snapshot.finder &&
      Helpers.getCharges('random') === snapshot.random &&
      Helpers.getCharges('snowman') === snapshot.snowman,
    'no charges are granted twice'
  );

  // A reload (fresh read of storage) sees the same "already claimed" state.
  const reloaded = Checkin.previewToday();
  assert(reloaded.available === false, 'previewing after a simulated reload still reports unavailable');
})();

// --- Backwards clock relative to the last CLAIM date: blocked, untouched ---
(function () {
  freshGame(10);
  setNow('2024-08-10');
  Checkin.claim();
  const chargesAfterClaim = Helpers.getCharges('finder');

  setNow('2024-08-08'); // 2 days before the claim
  const tampered = Checkin.claim();
  assert(tampered.available === false, 'a backwards clock blocks the claim');
  assert(tampered.tampered === true, 'reported specifically as tampering, not "already claimed"');
  assert(Helpers.getCharges('finder') === chargesAfterClaim, 'no extra charge is granted on a tampered attempt');
  const recordAfterTamper = Platform.loadDailyGift();
  assert(recordAfterTamper.position === 1, 'the tampered attempt leaves the cycle position untouched');

  // Clock corrected forward again - normal claiming resumes.
  setNow('2024-08-11');
  const resumed = Checkin.claim();
  assert(resumed.available === true, 'claiming resumes normally once the clock is corrected forward');
  assert(resumed.reward.day === 2, 'the resumed claim continues the cycle (day 2), unaffected by the tamper attempt');
})();

// --- Backwards clock relative to the last SEEN date (no claim that day) ---
(function () {
  freshGame(10);
  setNow('2024-09-01');
  Checkin.claim(); // position 1, lastSeenDate = 2024-09-01

  setNow('2024-09-05');
  Checkin.previewToday(); // just opening the app - bumps lastSeenDate to 2024-09-05, no claim

  setNow('2024-09-03'); // after the last CLAIM (09-01) but before the last SEEN (09-05)
  const result = Checkin.claim();
  assert(result.available === false, 'blocked even though today is after the last claim date');
  assert(result.tampered === true, 'flagged as tampering because it is before the last SEEN date');
  const record = Platform.loadDailyGift();
  assert(record.lastSeenDate === '2024-09-05', 'lastSeenDate is never rewritten backwards by a tampered check');
})();

// --- Migration from the old streak-based check-in save ---
(function () {
  resetStorage();
  globalThis.localStorage.setItem('garden.checkin', JSON.stringify({ lastClaimDate: '2024-01-05', currentStreak: 10, bestStreak: 12 }));
  globalThis.localStorage.setItem('garden.currentLevel', '7');
  globalThis.localStorage.setItem('garden.totalScore', '500');
  globalThis.localStorage.setItem('garden.helperCharges', JSON.stringify({ finder: 2, random: 3, snowman: 1 }));

  Platform.migrateDailyGift();

  const migrated = Platform.loadDailyGift();
  assert(migrated.lastClaimDate === '2024-01-05', 'migration carries over the last claim date (so today can\'t double-claim)');
  assert(migrated.position === ((10 - 1) % 7) + 1, `migration best-effort maps the old streak to a cycle position (got ${migrated.position})`);
  assert(globalThis.localStorage.getItem('garden.checkin') === null, 'the old legacy key is removed after migrating');
  assert(Platform.loadProgress() === 7, 'migration leaves progress untouched');
  assert(Platform.loadTotalScore() === 500, 'migration leaves total score untouched');
  assert(
    JSON.stringify(Platform.loadHelperCharges()) === JSON.stringify({ finder: 2, random: 3, snowman: 1 }),
    'migration leaves helper charges untouched'
  );

  // Idempotent: running it again after a fresh claim does not wipe it.
  setNow('2024-01-06');
  Checkin.claim();
  Platform.migrateDailyGift();
  assert(Platform.loadDailyGift().lastClaimDate === '2024-01-06', 'running the migration again after it already ran is a no-op');
})();

// --- Migration with no legacy save at all (fresh install) ---
(function () {
  resetStorage();
  Platform.migrateDailyGift();
  const fresh = Platform.loadDailyGift();
  assert(fresh.lastClaimDate === null && fresh.position === 0, 'with nothing to migrate, the daily gift starts fresh');
})();

// --- Migration with a corrupted legacy save falls back to fresh, never throws ---
(function () {
  resetStorage();
  globalThis.localStorage.setItem('garden.checkin', 'not json at all {{{');
  Platform.migrateDailyGift();
  const fresh = Platform.loadDailyGift();
  assert(fresh.lastClaimDate === null && fresh.position === 0, 'a corrupted legacy save falls back to a fresh daily gift record');
})();

// --- Debug day-offset clock: zero effect unless explicitly enabled ---
(function () {
  resetStorage();
  Platform.now = REAL_PLATFORM_NOW; // use the real implementation, not a setNow() test override
  delete globalThis.location;

  assert(Platform.isDebugEnabled() === false, 'debug mode is off with no location global at all (plain Node/real app without ?debug=1)');
  Platform.saveDebugDayOffset(5);
  const withoutDebug = Platform.now();
  assert(Math.abs(withoutDebug.getTime() - Date.now()) < 5000, 'a stored offset has zero effect on now() without ?debug=1');

  // Simulate ?debug=1 being present in the URL.
  globalThis.location = { search: '?debug=1' };
  assert(Platform.isDebugEnabled() === true, 'debug mode turns on when the URL has ?debug=1');

  globalThis.location = { search: '?debug=0' };
  assert(Platform.isDebugEnabled() === false, 'any other value for ?debug= does not enable debug mode');

  globalThis.location = { search: '' };
  assert(Platform.isDebugEnabled() === false, 'no debug param at all does not enable debug mode');

  delete globalThis.location;
})();

// --- Debug clock actually shifts Platform.now() when enabled, and the
// daily gift's debug helpers use it to simulate days passing ---
(function () {
  resetStorage();
  Platform.now = REAL_PLATFORM_NOW;
  globalThis.location = { search: '?debug=1' };

  const beforeOffset = Date.now();
  Checkin.debugAdvanceDays(3);
  const afterOffset = Platform.now().getTime();
  const diffDays = Math.round((afterOffset - beforeOffset) / 86400000);
  assert(diffDays === 3, `debugAdvanceDays(3) shifts Platform.now() forward by 3 days (got ${diffDays})`);

  Checkin.debugAdvanceDays(-3);
  const backToNormal = Platform.now().getTime();
  assert(Math.abs(backToNormal - beforeOffset) < 5000, 'debugAdvanceDays accumulates - advancing -3 after +3 returns to roughly real time');

  // Disabling debug mode makes the offset inert again, even though it's
  // still stored.
  delete globalThis.location;
  const withDebugOff = Platform.now().getTime();
  assert(Math.abs(withDebugOff - beforeOffset) < 5000, 'without ?debug=1, a stored offset has zero effect on now()');

  globalThis.location = { search: '?debug=1' };
  Platform.saveDebugDayOffset(0);

  // debugJumpToDay / debugResetDailyGift
  Checkin.debugJumpToDay(4);
  const todayKey = Checkin.getTodayKey();
  const jumped = Platform.loadDailyGift();
  assert(jumped.position === 3, 'debugJumpToDay(4): position set so the next claim resolves to day 4');
  assert(jumped.lastClaimDate !== todayKey, "debugJumpToDay(4): today's claim is available (not already claimed)");
  const jumpResult = Checkin.previewToday();
  assert(
    jumpResult.available === true && jumpResult.reward.day === 4,
    `debugJumpToDay(4): previewing today resolves to day 4 (got ${jumpResult.reward && jumpResult.reward.day})`
  );

  Checkin.debugJumpToDay(1);
  const jumpedToOne = Platform.loadDailyGift();
  assert(jumpedToOne.position === 0 && jumpedToOne.lastClaimDate === null, 'debugJumpToDay(1): equivalent to a fresh cycle');

  Checkin.claim();
  Checkin.debugResetDailyGift();
  const resetRecord = Platform.loadDailyGift();
  assert(resetRecord.position === 0 && resetRecord.lastClaimDate === null, 'debugResetDailyGift: back to never-claimed');

  delete globalThis.location;
  Platform.now = REAL_PLATFORM_NOW;
})();

console.log(`${checks} checks run, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
