// Platform module: stubs save/load and ad hooks behind a stable API.
// Backed by localStorage for now; will later wrap the Yandex Games SDK
// without changing call sites elsewhere.
(function (root) {
  const LEVEL_KEY = 'garden.currentLevel';
  const PATTERNS_KEY = 'garden.patternsEnabled';
  const TOTAL_SCORE_KEY = 'garden.totalScore';
  const BOARD_KEY_PREFIX = 'garden.board.';
  const BEST_TIME_KEY_PREFIX = 'garden.bestTime.';
  // Bumped once, the moment the active-play timer stopped counting time
  // while the tab was hidden/backgrounded (see state.js's pauseTimer) -
  // every best time recorded before that fix could be inflated, so
  // migrateBestTimes() below wipes them exactly once per player. Progress,
  // total score, board state, stars, and helper charges are all untouched.
  const BEST_TIME_SCHEMA_VERSION = 2;
  const BEST_TIME_SCHEMA_VERSION_KEY = 'garden.bestTimeSchemaVersion';
  // Index of every level that currently (or ever did) have a best time
  // saved - lets the one-time migration find and clear them all without
  // depending on localStorage.key()/length(), which Node's/tests' minimal
  // localStorage polyfills don't implement.
  const BEST_TIME_LEVELS_KEY = 'garden.bestTimeLevels';
  const TUTORIAL_DONE_KEY = 'garden.tutorialDone';
  const REDUCE_MOTION_KEY = 'garden.reduceMotion';
  const VIBRATION_KEY = 'garden.vibrationEnabled';
  // Sound/music settings (js/audio.js) - both default ON, independent
  // switches. Versioned the same "establish once, idempotent" way as
  // migrateStars: there is no pre-existing sound feature to migrate FROM,
  // so migrateAudioSettings() below only ever has to write the defaults
  // once if nothing is stored yet - it never touches progress, score,
  // stars, best times, charges, win streak, or daily gift state.
  const SFX_ENABLED_KEY = 'garden.sfxEnabled';
  const MUSIC_ENABLED_KEY = 'garden.musicEnabled';
  const AUDIO_SCHEMA_VERSION = 1;
  const AUDIO_SCHEMA_VERSION_KEY = 'garden.audioSchemaVersion';
  const THEME_KEY = 'garden.theme';
  const HELPER_CHARGES_KEY = 'garden.helperCharges';
  const HIGHEST_LEVEL_KEY = 'garden.highestLevel';
  // Win streak (consecutive levels won in a row, see state.js) - a plain
  // counter, not date-based, so it needs no migration of its own: a
  // missing key already defaults to 0, exactly the correct "never won a
  // level" starting state.
  const WIN_STREAK_KEY = 'garden.winStreak';
  // Best stars (1-3) ever earned per level, and the running sum of them
  // shown on the menu. Versioned because this is a brand-new save: there
  // is no historical per-level star data to recover (star ratings were
  // never recorded before this feature), so migrateStars() below only
  // ever has to establish totalStars at 0 once - see its own comment.
  const BEST_STARS_KEY_PREFIX = 'garden.bestStars.';
  const TOTAL_STARS_KEY = 'garden.totalStars';
  const STARS_SCHEMA_VERSION = 1;
  const STARS_SCHEMA_VERSION_KEY = 'garden.starsSchemaVersion';
  // Daily gift (js/checkin.js): a position-based record (no more streak -
  // see migrateDailyGift below for why), versioned separately from every
  // other save so tuning it can never touch progress/score/charges/best times.
  const DAILY_GIFT_KEY = 'garden.dailyGift';
  const DAILY_GIFT_SCHEMA_VERSION = 1;
  const DAILY_GIFT_SCHEMA_VERSION_KEY = 'garden.dailyGiftSchemaVersion';
  // The old daily check-in's storage key (streak-based: lastClaimDate,
  // currentStreak, bestStreak) - read once by migrateDailyGift below, then
  // removed; never written again.
  const LEGACY_CHECKIN_KEY = 'garden.checkin';
  // Debug-only simulated day offset (js/checkin.js's debug*  helpers) -
  // only ever has an effect when isDebugEnabled() is true (?debug=1 in the
  // URL), so a real player's clock can never be affected by a stray value
  // left over from testing.
  const DEBUG_DAY_OFFSET_KEY = 'garden.debugDayOffset';
  // Daily challenge (js/daily-challenge.js): a brand-new feature, so - same
  // "establish once, idempotent" shape as migrateStars/migrateAudioSettings -
  // there is no legacy data to migrate FROM. lastSeenDate/lastRewardDate
  // mirror the daily gift's own clock-tampering guard shape; challengeStars
  // is the running count of star ratings earned from challenge wins, added
  // on top of (never replacing) the sum of best stars per level.
  const DAILY_CHALLENGE_KEY = 'garden.dailyChallenge';
  const DAILY_CHALLENGE_SCHEMA_VERSION = 1;
  const DAILY_CHALLENGE_SCHEMA_VERSION_KEY = 'garden.dailyChallengeSchemaVersion';
  // Best (highest-ever) win streak - new, max-merged field for cloud-save
  // reconciliation (js/yandex.js). Distinct from the plain win-streak
  // counter above, which can legitimately drop back to 0 on a loss;
  // bestWinStreak only ever goes up, bumped as a side effect of
  // saveWinStreak below (same "dumb writer + automatic side effect"
  // convention saveBestStars already uses for totalStars).
  const BEST_WIN_STREAK_KEY = 'garden.bestWinStreak';
  // Index of every level that currently has a best-stars rating saved -
  // same purpose and shape as BEST_TIME_LEVELS_KEY above, needed so cloud-
  // save merge (js/yandex.js) can enumerate every per-level best-stars
  // entry without depending on localStorage.key()/length().
  const BEST_STARS_LEVELS_KEY = 'garden.bestStarsLevels';
  // Last-local-write marker for cloud-save merge (js/yandex.js): a single
  // real wall-clock timestamp (Date.now(), deliberately NOT the
  // debug-shiftable Platform.now() clock below, since this is about
  // comparing device write recency, not calendar-date game logic), bumped
  // by touchSavedAt() whenever any field in the "take the newer device's
  // value" merge group changes (helper charges, win streak, daily gift,
  // daily challenge, sound/theme settings - see GAME_DESIGN.md's cloud-save
  // section for the exact field list and why). A brand-new/never-touched
  // save defaults to 0 (the oldest possible value) rather than "now", so a
  // player updating from a pre-cloud-save version always loses a first-sync
  // tie to any real cloud data rather than clobbering it - same "establish
  // once, nothing fabricated" stance as migrateStars.
  const SAVED_AT_KEY = 'garden.savedAt';
  const SAVED_AT_SCHEMA_VERSION = 1;
  const SAVED_AT_SCHEMA_VERSION_KEY = 'garden.savedAtSchemaVersion';

  function hasStorage() {
    return typeof localStorage !== 'undefined';
  }

  // Soft dependency on js/cloudsave.js: platform.js must stay usable (and
  // Node-testable) with no cloud-save module loaded at all, so this never
  // throws if Garden.cloudsave isn't present - it's a plain no-op then, and
  // js/cloudsave.js's own debounced scheduler is what actually decides when
  // to talk to the active platform adapter.
  function notifyCloudDirty() {
    if (root.Garden && root.Garden.cloudsave && typeof root.Garden.cloudsave.scheduleSave === 'function') {
      root.Garden.cloudsave.scheduleSave();
    }
  }

  function touchSavedAt() {
    if (!hasStorage()) return;
    localStorage.setItem(SAVED_AT_KEY, String(Date.now()));
    notifyCloudDirty();
  }

  function loadSavedAt() {
    if (!hasStorage()) return 0;
    const raw = localStorage.getItem(SAVED_AT_KEY);
    const n = parseInt(raw, 10);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  }

  // One-time setup, same idempotent "establish once" shape as migrateStars/
  // migrateAudioSettings: there is no historical write-recency data to
  // recover, so this just establishes garden.savedAt at 0 once, if nothing
  // is stored yet - never touches progress, score, stars, best times, or
  // charges.
  function migrateSavedAt() {
    if (!hasStorage()) return;
    const storedVersion = parseInt(localStorage.getItem(SAVED_AT_SCHEMA_VERSION_KEY), 10);
    if (Number.isInteger(storedVersion) && storedVersion >= SAVED_AT_SCHEMA_VERSION) return;

    if (localStorage.getItem(SAVED_AT_KEY) === null) {
      localStorage.setItem(SAVED_AT_KEY, '0');
    }
    localStorage.setItem(SAVED_AT_SCHEMA_VERSION_KEY, String(SAVED_AT_SCHEMA_VERSION));
  }

  function saveProgress(level) {
    if (!hasStorage()) return;
    localStorage.setItem(LEVEL_KEY, String(level));
    notifyCloudDirty();
  }

  function loadProgress() {
    if (!hasStorage()) return 1;
    const raw = localStorage.getItem(LEVEL_KEY);
    const level = parseInt(raw, 10);
    return Number.isInteger(level) && level > 0 ? level : 1;
  }

  function savePatternsEnabled(enabled) {
    if (!hasStorage()) return;
    localStorage.setItem(PATTERNS_KEY, enabled ? '1' : '0');
  }

  // Off by default: patterns are an accessibility aid, not the normal look.
  function loadPatternsEnabled() {
    if (!hasStorage()) return false;
    const raw = localStorage.getItem(PATTERNS_KEY);
    return raw === null ? false : raw === '1';
  }

  function saveTheme(id) {
    if (!hasStorage()) return;
    localStorage.setItem(THEME_KEY, String(id));
    touchSavedAt();
  }

  // Returns the raw stored value (or null if nothing stored) and does no
  // validation of its own - Garden.themes.applyTheme() is what resolves a
  // missing/unknown/corrupted value to DEFAULT_THEME_ID, since that registry
  // is the one place that knows which ids are actually valid.
  function loadTheme() {
    if (!hasStorage()) return null;
    return localStorage.getItem(THEME_KEY);
  }

  function saveTotalScore(score) {
    if (!hasStorage()) return;
    localStorage.setItem(TOTAL_SCORE_KEY, String(score));
    notifyCloudDirty();
  }

  function loadTotalScore() {
    if (!hasStorage()) return 0;
    const raw = localStorage.getItem(TOTAL_SCORE_KEY);
    const score = parseInt(raw, 10);
    return Number.isInteger(score) && score >= 0 ? score : 0;
  }

  function saveBoard(level, boardState) {
    if (!hasStorage()) return;
    localStorage.setItem(BOARD_KEY_PREFIX + level, JSON.stringify(boardState));
  }

  function loadBoard(level) {
    if (!hasStorage()) return null;
    const raw = localStorage.getItem(BOARD_KEY_PREFIX + level);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function clearBoard(level) {
    if (!hasStorage()) return;
    localStorage.removeItem(BOARD_KEY_PREFIX + level);
  }

  function loadBestTimeLevels() {
    const raw = localStorage.getItem(BEST_TIME_LEVELS_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((n) => Number.isInteger(n)) : [];
    } catch (e) {
      return [];
    }
  }

  function rememberBestTimeLevel(level) {
    const levels = loadBestTimeLevels();
    if (levels.indexOf(level) === -1) {
      levels.push(level);
      localStorage.setItem(BEST_TIME_LEVELS_KEY, JSON.stringify(levels));
    }
  }

  function saveBestTime(level, seconds) {
    if (!hasStorage()) return;
    localStorage.setItem(BEST_TIME_KEY_PREFIX + level, String(seconds));
    rememberBestTimeLevel(level);
    notifyCloudDirty();
  }

  function loadBestTime(level) {
    if (!hasStorage()) return null;
    const raw = localStorage.getItem(BEST_TIME_KEY_PREFIX + level);
    if (raw === null) return null;
    const seconds = parseInt(raw, 10);
    return Number.isInteger(seconds) && seconds >= 0 ? seconds : null;
  }

  // One-time migration: wipes every previously-recorded best time once per
  // player, the moment BEST_TIME_SCHEMA_VERSION is bumped (see its comment
  // above) - idempotent, since it checks the stored version first and never
  // re-wipes on a later call/page load once that version is already current.
  // Leaves progress, total score, in-progress board state, stars, and helper
  // charges completely untouched; only garden.bestTime.* keys are removed.
  function migrateBestTimes() {
    if (!hasStorage()) return;
    const storedVersion = parseInt(localStorage.getItem(BEST_TIME_SCHEMA_VERSION_KEY), 10);
    if (Number.isInteger(storedVersion) && storedVersion >= BEST_TIME_SCHEMA_VERSION) return;

    loadBestTimeLevels().forEach(function (level) {
      localStorage.removeItem(BEST_TIME_KEY_PREFIX + level);
    });
    localStorage.removeItem(BEST_TIME_LEVELS_KEY);
    localStorage.setItem(BEST_TIME_SCHEMA_VERSION_KEY, String(BEST_TIME_SCHEMA_VERSION));
  }

  function saveWinStreak(n) {
    if (!hasStorage()) return;
    const clamped = Math.max(0, n);
    localStorage.setItem(WIN_STREAK_KEY, String(clamped));
    // Best-ever streak auto-tracks every write here, same "dumb writer plus
    // automatic side effect" shape saveBestStars already uses for
    // totalStars - callers never need to compute/pass the max themselves.
    if (clamped > loadBestWinStreak()) saveBestWinStreakRaw(clamped);
    touchSavedAt();
  }

  function loadWinStreak() {
    if (!hasStorage()) return 0;
    const raw = localStorage.getItem(WIN_STREAK_KEY);
    const n = parseInt(raw, 10);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  }

  // Raw writer, no further side effects - used by saveWinStreak's own
  // auto-bump above and by cloud-save merge (js/yandex.js), which computes
  // the max across both devices itself and just needs a plain write.
  function saveBestWinStreakRaw(n) {
    if (!hasStorage()) return;
    localStorage.setItem(BEST_WIN_STREAK_KEY, String(Math.max(0, n)));
  }

  function loadBestWinStreak() {
    if (!hasStorage()) return 0;
    const raw = localStorage.getItem(BEST_WIN_STREAK_KEY);
    const n = parseInt(raw, 10);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  }

  function loadTotalStars() {
    if (!hasStorage()) return 0;
    const raw = localStorage.getItem(TOTAL_STARS_KEY);
    const n = parseInt(raw, 10);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  }

  function saveTotalStars(n) {
    if (!hasStorage()) return;
    localStorage.setItem(TOTAL_STARS_KEY, String(Math.max(0, n)));
  }

  function loadBestStars(level) {
    if (!hasStorage()) return null;
    const raw = localStorage.getItem(BEST_STARS_KEY_PREFIX + level);
    if (raw === null) return null;
    const stars = parseInt(raw, 10);
    return Number.isInteger(stars) && stars >= 0 && stars <= 3 ? stars : null;
  }

  function loadBestStarsLevels() {
    if (!hasStorage()) return [];
    const raw = localStorage.getItem(BEST_STARS_LEVELS_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((n) => Number.isInteger(n)) : [];
    } catch (e) {
      return [];
    }
  }

  function rememberBestStarsLevel(level) {
    const levels = loadBestStarsLevels();
    if (levels.indexOf(level) === -1) {
      levels.push(level);
      localStorage.setItem(BEST_STARS_LEVELS_KEY, JSON.stringify(levels));
    }
  }

  // A dumb writer, same as saveBestTime - the caller (state.js) is the one
  // that decides the value to write (e.g. Math.max against the previous
  // best), not this function. The only thing this does on top of a plain
  // write is keep the menu's running totalStars in sync by the exact delta,
  // so the menu never needs to re-sum every level's best stars itself.
  function saveBestStars(level, stars) {
    if (!hasStorage()) return;
    const previous = loadBestStars(level);
    localStorage.setItem(BEST_STARS_KEY_PREFIX + level, String(stars));
    rememberBestStarsLevel(level);
    const delta = stars - (previous || 0);
    if (delta !== 0) saveTotalStars(loadTotalStars() + delta);
    notifyCloudDirty();
  }

  // Raw writer with none of saveBestStars's totalStars delta side effect -
  // used exclusively by cloud-save merge (js/yandex.js), which writes every
  // merged per-level value first and then calls recomputeTotalStars() once
  // at the end, rather than letting N individual deltas accumulate (any of
  // which could double-count against a totalStars that's itself also being
  // merged independently - see GAME_DESIGN.md's cloud-save section).
  function writeBestStarsRaw(level, stars) {
    if (!hasStorage()) return;
    localStorage.setItem(BEST_STARS_KEY_PREFIX + level, String(stars));
    rememberBestStarsLevel(level);
  }

  // Recomputes totalStars from scratch as sum(best stars per level) +
  // accumulated daily-challenge stars - the exact same invariant
  // GAME_DESIGN.md's "Total stars" section already documents for normal
  // play, just rebuilt from authoritative per-level/per-challenge data
  // instead of trusted incrementally. Only ever needed after cloud-save
  // merge rewrites a batch of per-level values directly (writeBestStarsRaw)
  // and needs totalStars to catch back up in one shot.
  function recomputeTotalStars() {
    if (!hasStorage()) return;
    let sum = 0;
    loadBestStarsLevels().forEach(function (level) {
      sum += loadBestStars(level) || 0;
    });
    sum += loadDailyChallenge().challengeStars || 0;
    saveTotalStars(sum);
  }

  // One-time setup: per-level best stars were never recorded before this
  // feature existed, so there is no historical data to recover - this just
  // establishes totalStars at 0 once (if nothing is stored yet), the same
  // "nothing lost, nothing fabricated" stance as not backfilling fake star
  // counts for already-completed levels. Idempotent, like migrateBestTimes.
  // Progress, total score, board state, best times, and helper charges are
  // a completely separate storage prefix and are never touched.
  function migrateStars() {
    if (!hasStorage()) return;
    const storedVersion = parseInt(localStorage.getItem(STARS_SCHEMA_VERSION_KEY), 10);
    if (Number.isInteger(storedVersion) && storedVersion >= STARS_SCHEMA_VERSION) return;

    if (localStorage.getItem(TOTAL_STARS_KEY) === null) {
      localStorage.setItem(TOTAL_STARS_KEY, '0');
    }
    localStorage.setItem(STARS_SCHEMA_VERSION_KEY, String(STARS_SCHEMA_VERSION));
  }

  function saveTutorialDone(done) {
    if (!hasStorage()) return;
    localStorage.setItem(TUTORIAL_DONE_KEY, done ? '1' : '0');
  }

  function loadTutorialDone() {
    if (!hasStorage()) return false;
    return localStorage.getItem(TUTORIAL_DONE_KEY) === '1';
  }

  function saveReduceMotionEnabled(enabled) {
    if (!hasStorage()) return;
    localStorage.setItem(REDUCE_MOTION_KEY, enabled ? '1' : '0');
  }

  function loadReduceMotionEnabled() {
    if (!hasStorage()) return false;
    return localStorage.getItem(REDUCE_MOTION_KEY) === '1';
  }

  function saveVibrationEnabled(enabled) {
    if (!hasStorage()) return;
    localStorage.setItem(VIBRATION_KEY, enabled ? '1' : '0');
  }

  function loadVibrationEnabled() {
    if (!hasStorage()) return true;
    const raw = localStorage.getItem(VIBRATION_KEY);
    return raw === null ? true : raw === '1';
  }

  function saveSfxEnabled(enabled) {
    if (!hasStorage()) return;
    localStorage.setItem(SFX_ENABLED_KEY, enabled ? '1' : '0');
    touchSavedAt();
  }

  function loadSfxEnabled() {
    if (!hasStorage()) return true;
    const raw = localStorage.getItem(SFX_ENABLED_KEY);
    return raw === null ? true : raw === '1';
  }

  function saveMusicEnabled(enabled) {
    if (!hasStorage()) return;
    localStorage.setItem(MUSIC_ENABLED_KEY, enabled ? '1' : '0');
    touchSavedAt();
  }

  function loadMusicEnabled() {
    if (!hasStorage()) return true;
    const raw = localStorage.getItem(MUSIC_ENABLED_KEY);
    return raw === null ? true : raw === '1';
  }

  // One-time setup, same idempotent "establish once" shape as migrateStars:
  // there is no earlier sound feature to migrate data FROM, so this only
  // ever has to write the two defaults (both ON) once, if nothing is stored
  // yet - it never touches progress, score, stars, best times, charges, win
  // streak, or daily gift state, which all live under their own keys.
  function migrateAudioSettings() {
    if (!hasStorage()) return;
    const storedVersion = parseInt(localStorage.getItem(AUDIO_SCHEMA_VERSION_KEY), 10);
    if (Number.isInteger(storedVersion) && storedVersion >= AUDIO_SCHEMA_VERSION) return;

    if (localStorage.getItem(SFX_ENABLED_KEY) === null) localStorage.setItem(SFX_ENABLED_KEY, '1');
    if (localStorage.getItem(MUSIC_ENABLED_KEY) === null) localStorage.setItem(MUSIC_ENABLED_KEY, '1');
    localStorage.setItem(AUDIO_SCHEMA_VERSION_KEY, String(AUDIO_SCHEMA_VERSION));
  }

  function saveHelperCharges(charges) {
    if (!hasStorage()) return;
    localStorage.setItem(HELPER_CHARGES_KEY, JSON.stringify(charges));
    touchSavedAt();
  }

  // Raw charge-object storage: corruption-tolerant (a missing/negative/non-
  // integer count for any id defaults that id to 0, never throws), and
  // returns null when nothing has ever been stored yet so Garden.helpers
  // (the one place that knows the starting amount and the helper id list)
  // can tell "never granted" apart from "granted, then spent to 0" and do
  // the one-time starting grant itself.
  function loadHelperCharges() {
    if (!hasStorage()) return null;
    const raw = localStorage.getItem(HELPER_CHARGES_KEY);
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      const charges = {};
      Object.keys(parsed).forEach(function (id) {
        const value = parseInt(parsed[id], 10);
        charges[id] = Number.isInteger(value) && value >= 0 ? value : 0;
      });
      return charges;
    } catch (e) {
      return {};
    }
  }

  function saveHighestLevel(level) {
    if (!hasStorage()) return;
    localStorage.setItem(HIGHEST_LEVEL_KEY, String(level));
    notifyCloudDirty();
  }

  function loadHighestLevel() {
    if (!hasStorage()) return 1;
    const raw = localStorage.getItem(HIGHEST_LEVEL_KEY);
    const level = parseInt(raw, 10);
    return Number.isInteger(level) && level > 0 ? level : 1;
  }

  // Whether debug mode is active: the URL carries ?debug=1. Gates every
  // debug-only affordance (window.GardenDebug in main.js, and the day-
  // offset clock below) so none of it can ever reach a real player by
  // accident - without the flag, loadDebugDayOffset's stored value (even if
  // non-zero from earlier testing) has zero effect on now().
  function isDebugEnabled() {
    if (typeof location === 'undefined' || typeof URLSearchParams === 'undefined') return false;
    try {
      return new URLSearchParams(location.search).get('debug') === '1';
    } catch (e) {
      return false;
    }
  }

  function loadDebugDayOffset() {
    if (!hasStorage()) return 0;
    const raw = localStorage.getItem(DEBUG_DAY_OFFSET_KEY);
    const n = parseInt(raw, 10);
    return Number.isInteger(n) ? n : 0;
  }

  function saveDebugDayOffset(days) {
    if (!hasStorage()) return;
    localStorage.setItem(DEBUG_DAY_OFFSET_KEY, String(days));
  }

  // The single clock entry point for anything date-based (the daily gift
  // and daily challenge features). Tests override this directly
  // (Platform.now = () => ...) to simulate arbitrary days without waiting
  // for real ones. In the real app, prefers the active platform's server
  // time (js/platform-adapter.js's getServerTimeOffsetMs(), a synchronous
  // cached-offset accessor - see its own comment on why this is sync while
  // the generic getServerTime() contract method is a Promise) over the
  // device clock whenever it's available, so the existing clock-backwards
  // tamper guard in js/checkin.js/js/daily-challenge.js is judging against
  // a clock the player can't just set back themselves; falls back to the
  // plain device clock if the platform never reported an offset (not yet
  // ready, or running with no adapter loaded at all - never blocks or
  // throws either way). Under explicit debug mode (?debug=1 - see
  // isDebugEnabled) a persisted day offset still shifts whichever base
  // clock was picked, exactly as before, so the daily gift's day-by-day
  // logic stays testable without waiting on real calendar days.
  function now() {
    const Platform = root.Garden && root.Garden.platformAdapter;
    const offsetMs = Platform && typeof Platform.getServerTimeOffsetMs === 'function' ? Platform.getServerTimeOffsetMs() : null;
    const real = offsetMs === null ? new Date() : new Date(Date.now() + offsetMs);
    if (!isDebugEnabled()) return real;
    const offsetDays = loadDebugDayOffset();
    if (!offsetDays) return real;
    return new Date(real.getTime() + offsetDays * 86400000);
  }

  function freshDailyGiftRecord() {
    return { lastClaimDate: null, lastSeenDate: null, position: 0, plan: null };
  }

  function saveDailyGift(record) {
    if (!hasStorage()) return;
    localStorage.setItem(DAILY_GIFT_KEY, JSON.stringify(record));
    touchSavedAt();
  }

  // A plan's shape (see js/checkin.js's computePlan) - kept structural
  // only (never hardcodes the actual helper id strings), since platform.js
  // deliberately knows nothing about what a "helper" is.
  function isValidPlan(plan) {
    return (
      !!plan &&
      typeof plan === 'object' &&
      typeof plan.day3Helper === 'string' &&
      typeof plan.day4Helper === 'string' &&
      Array.isArray(plan.day7Helpers) &&
      plan.day7Helpers.length === 3 &&
      plan.day7Helpers.every(function (id) { return typeof id === 'string'; })
    );
  }

  // Corruption-tolerant: anything missing, unparsable, or shaped wrong
  // falls back to a fresh record (or, for just `plan`, to null - a missing/
  // invalid plan simply means no cycle plan is frozen yet, which the daily
  // gift logic already treats as "compute a live preview/fresh plan") -
  // never throws or trusts bad data.
  function loadDailyGift() {
    if (!hasStorage()) return freshDailyGiftRecord();
    const raw = localStorage.getItem(DAILY_GIFT_KEY);
    if (!raw) return freshDailyGiftRecord();
    try {
      const parsed = JSON.parse(raw);
      const lastClaimDate = typeof parsed.lastClaimDate === 'string' ? parsed.lastClaimDate : null;
      const lastSeenDate = typeof parsed.lastSeenDate === 'string' ? parsed.lastSeenDate : null;
      const position = Number.isInteger(parsed.position) && parsed.position >= 0 && parsed.position <= 7 ? parsed.position : 0;
      const plan = isValidPlan(parsed.plan) ? parsed.plan : null;
      return { lastClaimDate, lastSeenDate, position, plan };
    } catch (e) {
      return freshDailyGiftRecord();
    }
  }

  // One-time migration from the old streak-based daily check-in record
  // (garden.checkin - lastClaimDate/currentStreak/bestStreak) to the new
  // position-based daily gift record. The new rules never reset on a
  // missed day, so there's no "streak" left to carry over - only
  // lastClaimDate matters, preserved exactly so a player mid-update can
  // never claim twice on the same calendar day; the old streak is used
  // only to best-effort seed an initial cycle position. Idempotent (checks
  // the schema version first) and touches nothing but the two daily-gift
  // keys and the legacy key it reads from - progress, total score, stars,
  // best times, and helper charges are a completely separate storage prefix.
  function migrateDailyGift() {
    if (!hasStorage()) return;
    const storedVersion = parseInt(localStorage.getItem(DAILY_GIFT_SCHEMA_VERSION_KEY), 10);
    if (Number.isInteger(storedVersion) && storedVersion >= DAILY_GIFT_SCHEMA_VERSION) return;

    let migrated = freshDailyGiftRecord();
    const legacyRaw = localStorage.getItem(LEGACY_CHECKIN_KEY);
    if (legacyRaw) {
      try {
        const legacy = JSON.parse(legacyRaw);
        if (legacy && typeof legacy.lastClaimDate === 'string') {
          const streak = Number.isInteger(legacy.currentStreak) && legacy.currentStreak > 0 ? legacy.currentStreak : 1;
          migrated = {
            lastClaimDate: legacy.lastClaimDate,
            lastSeenDate: legacy.lastClaimDate,
            position: ((streak - 1) % 7) + 1,
            plan: null,
          };
        }
      } catch (e) {
        // Unparsable legacy record - fall through to the fresh one.
      }
      localStorage.removeItem(LEGACY_CHECKIN_KEY);
    }

    localStorage.setItem(DAILY_GIFT_KEY, JSON.stringify(migrated));
    localStorage.setItem(DAILY_GIFT_SCHEMA_VERSION_KEY, String(DAILY_GIFT_SCHEMA_VERSION));
  }

  function freshDailyChallengeRecord() {
    return { lastSeenDate: null, lastRewardDate: null, challengeStars: 0 };
  }

  function saveDailyChallenge(record) {
    if (!hasStorage()) return;
    localStorage.setItem(DAILY_CHALLENGE_KEY, JSON.stringify(record));
    touchSavedAt();
  }

  // Corruption-tolerant, same shape as loadDailyGift: anything missing,
  // unparsable, or shaped wrong falls back to a fresh record rather than
  // throwing or trusting bad data.
  function loadDailyChallenge() {
    if (!hasStorage()) return freshDailyChallengeRecord();
    const raw = localStorage.getItem(DAILY_CHALLENGE_KEY);
    if (!raw) return freshDailyChallengeRecord();
    try {
      const parsed = JSON.parse(raw);
      const lastSeenDate = typeof parsed.lastSeenDate === 'string' ? parsed.lastSeenDate : null;
      const lastRewardDate = typeof parsed.lastRewardDate === 'string' ? parsed.lastRewardDate : null;
      const challengeStars = Number.isInteger(parsed.challengeStars) && parsed.challengeStars >= 0 ? parsed.challengeStars : 0;
      return { lastSeenDate, lastRewardDate, challengeStars };
    } catch (e) {
      return freshDailyChallengeRecord();
    }
  }

  // One-time setup, same idempotent "establish once" shape as migrateStars/
  // migrateAudioSettings: this is a brand-new feature with no earlier data
  // to migrate FROM, so it only ever has to write the fresh record once, if
  // nothing is stored yet. Never touches progress, score, best times,
  // stars, helper charges, win streak, or daily gift state - all separate
  // storage prefixes.
  function migrateDailyChallenge() {
    if (!hasStorage()) return;
    const storedVersion = parseInt(localStorage.getItem(DAILY_CHALLENGE_SCHEMA_VERSION_KEY), 10);
    if (Number.isInteger(storedVersion) && storedVersion >= DAILY_CHALLENGE_SCHEMA_VERSION) return;

    if (localStorage.getItem(DAILY_CHALLENGE_KEY) === null) {
      localStorage.setItem(DAILY_CHALLENGE_KEY, JSON.stringify(freshDailyChallengeRecord()));
    }
    localStorage.setItem(DAILY_CHALLENGE_SCHEMA_VERSION_KEY, String(DAILY_CHALLENGE_SCHEMA_VERSION));
  }

  function vibrate(pattern) {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  }

  // iOS Safari has no navigator.vibrate at all, so the "Vibrate on mistake"
  // setting would otherwise be a silent no-op there; the settings UI uses
  // this to show the toggle as disabled with an explanatory note instead.
  function isVibrationSupported() {
    return typeof navigator !== 'undefined' && 'vibrate' in navigator;
  }

  // Called once after boot (i18n/settings/saves ready, right as the menu
  // becomes interactive - see js/main.js). Hooks the active platform
  // adapter's ready() signal (e.g. Yandex's features.LoadingAPI.ready(),
  // via js/platform-adapter.js, never any SDK directly) exactly as this
  // function's old stub comment promised, without needing any change at
  // the main.js call site - a no-op with no adapter loaded. The concrete
  // adapter's own ready() queues this if its init()'s async SDK handshake
  // hasn't resolved yet, so it's safe to call this as early as the menu is
  // actually ready, regardless of which finishes first.
  function gameReady() {
    if (root.Garden.platformAdapter) root.Garden.platformAdapter.ready();
  }

  // Stubs for the Yandex Games SDK integration (roadmap step 7). Calling code
  // elsewhere should only ever go through these, never touch ads directly.
  function showRewardedAd(onComplete) {
    if (typeof onComplete === 'function') onComplete();
  }

  function showInterstitialAd(onComplete) {
    if (typeof onComplete === 'function') onComplete();
  }

  const Platform = {
    saveProgress,
    loadProgress,
    savePatternsEnabled,
    loadPatternsEnabled,
    saveTheme,
    loadTheme,
    saveTotalScore,
    loadTotalScore,
    saveBoard,
    loadBoard,
    clearBoard,
    saveBestTime,
    loadBestTime,
    loadBestTimeLevels,
    migrateBestTimes,
    saveWinStreak,
    loadWinStreak,
    saveBestWinStreakRaw,
    loadBestWinStreak,
    saveBestStars,
    loadBestStars,
    loadBestStarsLevels,
    writeBestStarsRaw,
    recomputeTotalStars,
    saveTotalStars,
    loadTotalStars,
    migrateStars,
    saveTutorialDone,
    loadTutorialDone,
    saveReduceMotionEnabled,
    loadReduceMotionEnabled,
    saveVibrationEnabled,
    loadVibrationEnabled,
    vibrate,
    isVibrationSupported,
    saveSfxEnabled,
    loadSfxEnabled,
    saveMusicEnabled,
    loadMusicEnabled,
    migrateAudioSettings,
    saveHelperCharges,
    loadHelperCharges,
    saveHighestLevel,
    loadHighestLevel,
    now,
    isDebugEnabled,
    loadDebugDayOffset,
    saveDebugDayOffset,
    saveDailyGift,
    loadDailyGift,
    migrateDailyGift,
    saveDailyChallenge,
    loadDailyChallenge,
    migrateDailyChallenge,
    loadSavedAt,
    migrateSavedAt,
    gameReady,
    showRewardedAd,
    showInterstitialAd,
  };

  // Run once, right when this module is first loaded (i.e. once per real
  // page load) - all idempotent, see their own comments.
  migrateBestTimes();
  migrateDailyGift();
  migrateStars();
  migrateAudioSettings();
  migrateDailyChallenge();
  migrateSavedAt();

  root.Garden = root.Garden || {};
  root.Garden.platform = Platform;
})(typeof window !== 'undefined' ? window : globalThis);
