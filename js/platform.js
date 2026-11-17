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
  const THEME_KEY = 'garden.theme';
  const HELPER_CHARGES_KEY = 'garden.helperCharges';
  const HIGHEST_LEVEL_KEY = 'garden.highestLevel';
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

  function hasStorage() {
    return typeof localStorage !== 'undefined';
  }

  function saveProgress(level) {
    if (!hasStorage()) return;
    localStorage.setItem(LEVEL_KEY, String(level));
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

  function saveHelperCharges(charges) {
    if (!hasStorage()) return;
    localStorage.setItem(HELPER_CHARGES_KEY, JSON.stringify(charges));
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
  // feature). Tests override this directly (Platform.now = () => ...) to
  // simulate arbitrary days without waiting for real ones. In the real app,
  // defaults to the real device clock; under explicit debug mode (?debug=1
  // - see isDebugEnabled) a persisted day offset can shift it instead, so
  // the daily gift's day-by-day logic can be tested without waiting on real
  // calendar days. Swapping this for a Yandex SDK server-time call later
  // (roadmap step 8) needs no changes at any call site - every date-based
  // feature already goes through here.
  function now() {
    const real = new Date();
    if (!isDebugEnabled()) return real;
    const offsetDays = loadDebugDayOffset();
    if (!offsetDays) return real;
    return new Date(real.getTime() + offsetDays * 86400000);
  }

  function freshDailyGiftRecord() {
    return { lastClaimDate: null, lastSeenDate: null, position: 0 };
  }

  function saveDailyGift(record) {
    if (!hasStorage()) return;
    localStorage.setItem(DAILY_GIFT_KEY, JSON.stringify(record));
  }

  // Corruption-tolerant: anything missing, unparsable, or shaped wrong
  // falls back to a fresh record rather than throwing or trusting bad data.
  function loadDailyGift() {
    if (!hasStorage()) return freshDailyGiftRecord();
    const raw = localStorage.getItem(DAILY_GIFT_KEY);
    if (!raw) return freshDailyGiftRecord();
    try {
      const parsed = JSON.parse(raw);
      const lastClaimDate = typeof parsed.lastClaimDate === 'string' ? parsed.lastClaimDate : null;
      const lastSeenDate = typeof parsed.lastSeenDate === 'string' ? parsed.lastSeenDate : null;
      const position = Number.isInteger(parsed.position) && parsed.position >= 0 && parsed.position <= 7 ? parsed.position : 0;
      return { lastClaimDate, lastSeenDate, position };
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

  // Called once after boot (i18n/settings/saves ready). Stub for now;
  // step 8 will hook Yandex LoadingAPI.ready() into it without changing
  // the call site in main.js.
  function gameReady() {}

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
    migrateBestTimes,
    saveTutorialDone,
    loadTutorialDone,
    saveReduceMotionEnabled,
    loadReduceMotionEnabled,
    saveVibrationEnabled,
    loadVibrationEnabled,
    vibrate,
    isVibrationSupported,
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
    gameReady,
    showRewardedAd,
    showInterstitialAd,
  };

  // Run once, right when this module is first loaded (i.e. once per real
  // page load) - both idempotent, see their own comments.
  migrateBestTimes();
  migrateDailyGift();

  root.Garden = root.Garden || {};
  root.Garden.platform = Platform;
})(typeof window !== 'undefined' ? window : globalThis);
