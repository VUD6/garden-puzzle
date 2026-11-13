// Platform module: stubs save/load and ad hooks behind a stable API.
// Backed by localStorage for now; will later wrap the Yandex Games SDK
// without changing call sites elsewhere.
(function (root) {
  const LEVEL_KEY = 'garden.currentLevel';
  const PATTERNS_KEY = 'garden.patternsEnabled';

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
    showRewardedAd,
    showInterstitialAd,
  };

  root.Garden = root.Garden || {};
  root.Garden.platform = Platform;
})(typeof window !== 'undefined' ? window : globalThis);
