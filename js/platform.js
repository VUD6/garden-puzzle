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

  function loadPatternsEnabled() {
    if (!hasStorage()) return true;
    const raw = localStorage.getItem(PATTERNS_KEY);
    return raw === null ? true : raw === '1';
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
    showRewardedAd,
    showInterstitialAd,
  };

  root.Garden = root.Garden || {};
  root.Garden.platform = Platform;
})(typeof window !== 'undefined' ? window : globalThis);
