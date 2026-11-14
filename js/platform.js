// Platform module: stubs save/load and ad hooks behind a stable API.
// Backed by localStorage for now; will later wrap the Yandex Games SDK
// without changing call sites elsewhere.
(function (root) {
  const LEVEL_KEY = 'garden.currentLevel';
  const PATTERNS_KEY = 'garden.patternsEnabled';
  const TOTAL_SCORE_KEY = 'garden.totalScore';
  const BOARD_KEY_PREFIX = 'garden.board.';
  const BEST_TIME_KEY_PREFIX = 'garden.bestTime.';
  const TUTORIAL_DONE_KEY = 'garden.tutorialDone';
  const REDUCE_MOTION_KEY = 'garden.reduceMotion';
  const VIBRATION_KEY = 'garden.vibrationEnabled';
  const SEEDS_KEY = 'garden.seeds';

  // Granted once, on first-ever launch (see loadSeeds below) - never
  // re-granted just because the balance later drops to 0.
  const STARTING_SEEDS = 30;

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

  function saveBestTime(level, seconds) {
    if (!hasStorage()) return;
    localStorage.setItem(BEST_TIME_KEY_PREFIX + level, String(seconds));
  }

  function loadBestTime(level) {
    if (!hasStorage()) return null;
    const raw = localStorage.getItem(BEST_TIME_KEY_PREFIX + level);
    if (raw === null) return null;
    const seconds = parseInt(raw, 10);
    return Number.isInteger(seconds) && seconds >= 0 ? seconds : null;
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

  function saveSeeds(amount) {
    if (!hasStorage()) return;
    localStorage.setItem(SEEDS_KEY, String(amount));
  }

  // The starting balance is granted exactly once: the very first time this
  // is ever called with nothing in storage yet, it persists STARTING_SEEDS
  // immediately so that a later balance of 0 (after spending) is never
  // mistaken for "never granted" and re-topped-up. Any other stored value
  // that fails to parse is treated as corrupted and defaults to 0, not to
  // a fresh grant.
  function loadSeeds() {
    if (!hasStorage()) return STARTING_SEEDS;
    const raw = localStorage.getItem(SEEDS_KEY);
    if (raw === null) {
      saveSeeds(STARTING_SEEDS);
      return STARTING_SEEDS;
    }
    const seeds = parseInt(raw, 10);
    return Number.isInteger(seeds) && seeds >= 0 ? seeds : 0;
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
    saveTotalScore,
    loadTotalScore,
    saveBoard,
    loadBoard,
    clearBoard,
    saveBestTime,
    loadBestTime,
    saveTutorialDone,
    loadTutorialDone,
    saveReduceMotionEnabled,
    loadReduceMotionEnabled,
    saveVibrationEnabled,
    loadVibrationEnabled,
    vibrate,
    isVibrationSupported,
    saveSeeds,
    loadSeeds,
    STARTING_SEEDS,
    gameReady,
    showRewardedAd,
    showInterstitialAd,
  };

  root.Garden = root.Garden || {};
  root.Garden.platform = Platform;
})(typeof window !== 'undefined' ? window : globalThis);
