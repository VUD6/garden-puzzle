// Daily challenge: one special puzzle per calendar date, identical for
// every player on that date, slightly harder than a typical level
// (equivalent to a level somewhere in 15-30, picked deterministically by
// the date itself). Pure date/puzzle/reward logic (Node-testable, no DOM) -
// the menu button, in-game banner, and win-screen reward lines are wired
// from js/menu.js, js/render.js, and js/main.js respectively, reusing their
// existing markup/mechanisms rather than inventing new ones.
//
// Unlocked at level 15 (UNLOCK_LEVEL below - kept as its own small local
// copy of js/menu.js's DAILY_CHALLENGE_UNLOCK_LEVEL, same convention
// js/checkin.js already uses for its own small rule copies, so menu.js's
// pure, Node-testable shouldShowDailyLock() never has to depend on this
// file loading first).
(function (root) {
  const UNLOCK_LEVEL = 15;

  // The puzzle's difficulty is pinned to this range - always an 8x8 board
  // (every level 15+ is 8x8, see Garden.state.gridSizeForLevel), but the
  // exact level chosen within it still varies the single-cell-region cap
  // (Garden.state.singleCellRegionCap) from date to date.
  const DIFFICULTY_MIN_LEVEL = 15;
  const DIFFICULTY_MAX_LEVEL = 30;
  const DIFFICULTY_RANGE = DIFFICULTY_MAX_LEVEL - DIFFICULTY_MIN_LEVEL + 1;

  // Reward on the first win of the day: 2 charges of whichever helper the
  // player currently has the fewest of (ties favor finder) - see
  // pickChallengeRewardHelper below. The challenge is only reachable at
  // level 15+, well past Snowman's own level-10 unlock, so all three
  // helpers are always eligible here (unlike js/checkin.js's own version of
  // this rule, which also has to handle Snowman still being locked).
  const CHALLENGE_HELPER_REWARD_AMOUNT = 2;

  // --- Date -> puzzle, pure and deterministic ---

  // A small, fast 32-bit string hash (djb2-xor variant) - not cryptographic,
  // just needs to spread a short date-key string ("YYYY-MM-DD") across the
  // full 32-bit range so the two derived values below don't correlate.
  function hashDateKey(dateKey) {
    let hash = 5381;
    for (let i = 0; i < dateKey.length; i++) {
      hash = ((hash * 33) ^ dateKey.charCodeAt(i)) >>> 0;
    }
    return hash >>> 0;
  }

  // One avalanche-style mixing round (murmur3-finalizer-style) so a modulo
  // taken afterward doesn't just read the hash's low bits directly - djb2's
  // low bits alone are weaker than its full spread for short strings.
  function mix32(x) {
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
    return (x ^ (x >>> 16)) >>> 0;
  }

  // Which "difficulty level" (15-30) today's puzzle is equivalent to -
  // deterministic by date only, independent of the player's own progress.
  function difficultyLevelForDate(dateKey) {
    return DIFFICULTY_MIN_LEVEL + (mix32(hashDateKey(dateKey)) % DIFFICULTY_RANGE);
  }

  // The puzzle-generation seed: deliberately a DIFFERENT mix of the same
  // base hash than difficultyLevelForDate above (XORed with a distinct odd
  // constant before mixing), so two dates that happen to land on the same
  // difficulty level still always get a completely different board - the
  // puzzle varies by the full date, never just by the 16-way difficulty pick.
  function generationSeedForDate(dateKey) {
    return mix32(hashDateKey(dateKey) ^ 0x9e3779b9);
  }

  // Builds today's puzzle in the exact shape Garden.state.createGame's
  // levelBuilder hook expects (see buildLevel in js/state.js): no pre-placed
  // flowers or crosses (the hardest start, 'none') - a clean, standalone
  // puzzle, always respecting the existing generator caps (at most 1
  // pre-placed gingerbread - trivially true here since there are zero - and
  // the single-cell-region cap for whichever difficulty level today picked).
  function buildChallengeLevel(dateKey) {
    const State = root.Garden.state;
    const Generator = root.Garden.generator;
    const difficultyLevel = difficultyLevelForDate(dateKey);
    const size = State.gridSizeForLevel(difficultyLevel);
    const cap = State.singleCellRegionCap(difficultyLevel);
    const rng = root.Garden.rng.createRng(generationSeedForDate(dateKey));
    const generated = Generator.generateLevel(size, rng, undefined, cap);
    return {
      size,
      regionOf: generated.regionOf,
      solution: generated.solution,
      startType: 'none',
      levelKind: 'normal',
      givenFlowers: [],
      crossCells: [],
      difficultyLevel,
    };
  }

  // --- Reward crediting: once per calendar day, idempotent ---

  function todayKey() {
    return root.Garden.checkin.getTodayKey();
  }

  // Bumps lastSeenDate forward (monotonic max), exactly like js/checkin.js's
  // own syncSeenDate - establishes the baseline a later backwards clock jump
  // is detected against, even on a day nothing was won.
  function syncSeenDate() {
    const Platform = root.Garden.platform;
    const Checkin = root.Garden.checkin;
    const record = Platform.loadDailyChallenge();
    const today = todayKey();
    if (record.lastSeenDate && Checkin.daysBetweenKeys(record.lastSeenDate, today) <= 0) return record;
    const updated = Object.assign({}, record, { lastSeenDate: today });
    Platform.saveDailyChallenge(updated);
    return updated;
  }

  function isDoneToday() {
    const record = syncSeenDate();
    return record.lastRewardDate === todayKey();
  }

  // Fewest-charges-of-the-three, tie favors finder - a small local copy of
  // the same rule js/checkin.js's fewestChargesAmong/resolveHelperId and
  // js/state.js's pickStreakBonusHelper already each keep their own copy of
  // (see their comments for why: each reward feature stays independent
  // rather than cross-calling another feature module for an algorithm this
  // small). Snowman is always unlocked by the time this is reachable (the
  // challenge itself requires level 15, Snowman unlocks at 10), but the
  // unlock check is kept anyway as the same defensive belt-and-suspenders
  // those other two copies use.
  function pickChallengeRewardHelper() {
    const Helpers = root.Garden.helpers;
    const eligible = Helpers.isUnlocked('snowman') ? Helpers.HELPER_IDS.slice() : ['finder', 'random'];
    let best = eligible[0];
    let bestCharges = Helpers.getCharges(best);
    for (let i = 1; i < eligible.length; i++) {
      const charges = Helpers.getCharges(eligible[i]);
      if (charges < bestCharges) {
        best = eligible[i];
        bestCharges = charges;
      }
    }
    return best;
  }

  // The only place that actually grants the daily challenge's reward.
  // Returns the credited { helperId, amount, points, stars } on a genuine
  // first win of the day, or null if today's reward was already granted
  // (idempotent - a reload or a double-tap on the win screen can never
  // grant it twice) or if the device clock has moved backwards relative to
  // the latest date this module has ever observed (same two-sided
  // clock-tampering guard js/checkin.js's computeClaim uses).
  function creditIfFirstWinToday(levelScore, rating) {
    const Platform = root.Garden.platform;
    const Checkin = root.Garden.checkin;
    const today = todayKey();
    const record = syncSeenDate();

    const alreadyRewardedToday = record.lastRewardDate === today;
    const tampered = !!record.lastSeenDate && Checkin.daysBetweenKeys(record.lastSeenDate, today) < 0;
    if (alreadyRewardedToday || tampered) return null;

    const helperId = pickChallengeRewardHelper();

    // Persist the "rewarded today" marker FIRST (same ordering as
    // js/checkin.js's claim()), so a reload/crash between this write and the
    // credits below can never grant the reward twice - a later call always
    // sees lastRewardDate already equal to today.
    Platform.saveDailyChallenge({ lastSeenDate: today, lastRewardDate: today, challengeStars: record.challengeStars + rating });

    root.Garden.helpers.addCharges(helperId, CHALLENGE_HELPER_REWARD_AMOUNT);
    // Points: the normal per-flower score earned this attempt, added to the
    // running total exactly once (the challenge has no per-level identity
    // of its own for a loadBestTime-style "already completed" guard, so
    // this file's own lastRewardDate check above is what makes it one-time).
    Platform.saveTotalScore(Platform.loadTotalScore() + levelScore);
    // Stars: added directly on top of the existing totalStars counter (which
    // already tracks the sum of best stars per level, see
    // Platform.saveBestStars) - so totalStars stays exactly "best stars per
    // level + accumulated challenge stars" without re-summing anything.
    Platform.saveTotalStars(Platform.loadTotalStars() + rating);

    return { helperId, amount: CHALLENGE_HELPER_REWARD_AMOUNT, points: levelScore, stars: rating };
  }

  // --- Glue: starting a challenge attempt, and reacting to its snapshots ---

  // Whether the challenge is actually allowed to start right now - below
  // the unlock level, or already won today, and this is a no-op. This is
  // the SAME eligibility rule js/menu.js's own challengeState() computes
  // for the button's UI state (locked/available/done), kept as its own
  // independent copy here (consistent with this file's other small local
  // rule copies, see pickChallengeRewardHelper's comment) so `start()`
  // below can never be made to (re-)open a completed/locked challenge by
  // ANY caller - the menu button, a direct console call, or anything else -
  // not just one that happens to go through the button's own disabled
  // check first.
  function canStart() {
    const level = root.Garden.platform.loadProgress();
    return level >= UNLOCK_LEVEL && !isDoneToday();
  }

  // Starts (or resumes an in-progress attempt at) today's puzzle on the
  // given game instance (see Garden.state.createGame's enterChallenge) -
  // the same instance that's showing the player's normal progression the
  // rest of the time, switched into challenge mode for the duration.
  // Returns whether it actually started anything (false - a complete
  // no-op, `game` left untouched - below the unlock level or already won
  // today; see canStart above).
  function start(game) {
    if (!canStart()) return false;
    const today = todayKey();
    const pseudoLevel = difficultyLevelForDate(today);
    game.enterChallenge(function () { return buildChallengeLevel(today); }, pseudoLevel, 'daily-' + today);
    return true;
  }

  // Enriches a game snapshot with this day's reward info, crediting it
  // (idempotently, see creditIfFirstWinToday) the moment a challenge
  // attempt is actually won. A complete no-op for every other
  // snapshot (wrong mode, or not a win) - safe to run on every single
  // onChange tick regardless of mode.
  function handleSnapshot(snapshot) {
    if (snapshot.mode !== 'challenge' || snapshot.status !== 'won') return snapshot;
    const reward = creditIfFirstWinToday(snapshot.levelScore, snapshot.rating);
    return Object.assign({}, snapshot, { challengeReward: reward });
  }

  // --- Debug-only helpers (?debug=1 only, wired to window.GardenDebug by
  // main.js - see js/checkin.js's own debug* helpers for the same pattern).
  // Advancing the simulated day itself is already covered by the existing
  // Garden.checkin.debugAdvanceDays (one shared clock, Garden.platform.now()
  // - advancing it also changes which puzzle the challenge generates). ---

  // Resets the challenge back to "never won" for testing the once-per-day
  // reward repeatedly - also clears today's in-progress saved board (if
  // any), so a fresh attempt starts clean. The simulated day offset itself
  // (debugAdvanceDays) is left untouched.
  function debugReset() {
    const Platform = root.Garden.platform;
    Platform.saveDailyChallenge({ lastSeenDate: todayKey(), lastRewardDate: null, challengeStars: 0 });
    Platform.clearBoard('daily-' + todayKey());
  }

  // Sets the player's saved progress level directly (and keeps the
  // highest-level-reached watermark consistent with it, exactly like really
  // playing up to that level would), so the challenge's level-15 unlock -
  // and, incidentally, Snowman's level-10 unlock - can be checked without
  // actually climbing there level by level.
  function debugSetUnlockedLevel(n) {
    const Platform = root.Garden.platform;
    Platform.saveProgress(n);
    Platform.saveHighestLevel(Math.max(Platform.loadHighestLevel(), n));
  }

  const DailyChallenge = {
    UNLOCK_LEVEL,
    DIFFICULTY_MIN_LEVEL,
    DIFFICULTY_MAX_LEVEL,
    CHALLENGE_HELPER_REWARD_AMOUNT,
    difficultyLevelForDate,
    generationSeedForDate,
    buildChallengeLevel,
    pickChallengeRewardHelper,
    isDoneToday,
    creditIfFirstWinToday,
    canStart,
    start,
    handleSnapshot,
    debugReset,
    debugSetUnlockedLevel,
  };

  root.Garden = root.Garden || {};
  root.Garden.dailyChallenge = DailyChallenge;
})(typeof window !== 'undefined' ? window : globalThis);
