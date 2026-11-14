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

  function vibrate(pattern) {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  }

  // Stub for the future main-menu step (roadmap step 3): the back button
  // calls this so the call site never needs to change once a real menu exists.
  function navigateToMenu() {}

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
    navigateToMenu,
    showRewardedAd,
    showInterstitialAd,
  };

  root.Garden = root.Garden || {};
  root.Garden.platform = Platform;
})(typeof window !== 'undefined' ? window : globalThis);
