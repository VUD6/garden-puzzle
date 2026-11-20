// The generic platform facade: every other module in this game calls
// Garden.platformAdapter.* instead of anything platform-specific - no
// module outside this file and the concrete adapter files (js/platform-
// yandex.js today; a future js/platform-playgama.js) may reference an
// adapter's internals, window.YaGames, or ysdk directly. This file knows
// NOTHING about Yandex (or any other platform) beyond the one-line lookup
// table below - it just picks a concrete adapter and forwards.
//
// Which platform is active: window.GAME_PLATFORM, read once at init() time
// (defaults to 'yandex' when undefined, so local dev / GitHub Pages / the
// existing Yandex draft all keep working with zero configuration - see
// tools/build.ps1 for how a real build pins this explicitly instead of
// relying on the default). There is deliberately no `if (platform ===
// 'yandex')` anywhere in game code - a feature either goes through one of
// the methods below (safe to call regardless of which adapter is active,
// or whether the active one even implements it) or through
// `capabilities`, never a platform-id check.
//
// Adding a platform (e.g. Playgama, in a later task): write js/platform-
// playgama.js implementing the same methods as js/platform-yandex.js
// (exporting Garden.platformPlaygama), add one line to the ADAPTERS lookup
// below, add one entry to tools/build.ps1's -Platform ValidateSet, and add
// its script tag to index.html (and to tools/build.ps1's own file list).
// Nothing else in the game needs to change - see GAME_DESIGN.md's
// "Platform layer" section.
(function (root) {
  // One lookup per supported platform id. Each entry is a function (not a
  // direct reference) so load order between this file and the concrete
  // adapter files never matters - the lookup only actually runs inside
  // init(), by which point every script has already loaded.
  const ADAPTERS = {
    yandex: function () { return root.Garden.platformYandex; },
    playgama: function () { return root.Garden.platformPlaygama; },
  };
  const DEFAULT_PLATFORM_ID = 'yandex';

  // Conservative defaults until an adapter is picked at all (before the
  // very first init() call) - "unsupported until proven otherwise" is the
  // safe default for "so the UI can hide unsupported features" to actually
  // mean something even in that brief window.
  const DEFAULT_CAPABILITIES = { rewardedAds: false, cloudSave: false, leaderboard: false, serverTime: false };

  let activeAdapter = null;
  let initPromise = null;

  function selectedPlatformId() {
    return (typeof window !== 'undefined' && window.GAME_PLATFORM) || DEFAULT_PLATFORM_ID;
  }

  function resolveAdapter() {
    const id = selectedPlatformId();
    const lookup = ADAPTERS[id] || ADAPTERS[DEFAULT_PLATFORM_ID];
    return lookup ? lookup() : null;
  }

  // Generic "call this method on the active adapter if it exists, else
  // return a safe default" wrapper - this is what makes every facade
  // method below "safe to call when a feature is unsupported" without each
  // one repeating the same guard. `fallback` is a plain value for
  // synchronous methods, or a function returning one for methods whose
  // fallback must be computed per-call (e.g. a fresh resolved Promise).
  function forward(name, args, fallback) {
    if (!activeAdapter || typeof activeAdapter[name] !== 'function') {
      return typeof fallback === 'function' ? fallback() : fallback;
    }
    return activeAdapter[name].apply(activeAdapter, args);
  }

  // Idempotent: safe to call more than once, always returns the SAME
  // promise. Picks the active adapter synchronously, then delegates the
  // actual handshake to it. Never rejects - a platform adapter that can't
  // reach its real SDK is responsible for falling back to its own mock/
  // degraded mode internally (see js/platform-yandex.js), so the menu is
  // never blocked here either.
  function init() {
    if (initPromise) return initPromise;
    activeAdapter = resolveAdapter();
    if (!activeAdapter) {
      initPromise = Promise.resolve();
      return initPromise;
    }
    initPromise = Promise.resolve(activeAdapter.init()).catch(function () {});
    return initPromise;
  }

  function ready() { forward('ready', []); }
  function gameplayStart() { forward('gameplayStart', []); }
  function gameplayStop() { forward('gameplayStop', []); }

  function showRewardedAd() {
    return forward('showRewardedAd', [], function () { return Promise.resolve({ rewarded: false }); });
  }

  function loadData() {
    return forward('loadData', [], function () { return Promise.resolve(null); });
  }

  function saveData(obj) {
    return forward('saveData', [obj], function () { return Promise.resolve(false); });
  }

  function submitScore(name, value) {
    forward('submitScore', [name, value]);
  }

  function getServerTime() {
    return forward('getServerTime', [], function () { return Promise.resolve(null); });
  }

  function getLanguage() {
    return forward('getLanguage', [], null);
  }

  // --- extras beyond the minimum contract, still only ever reached via
  // this same facade (never Garden.platformYandex directly) from any game
  // code - today these are all Yandex-specific capabilities (leaderboard
  // UI, auth, debug hooks); a platform lacking them simply never has
  // anything to forward to, and these become safe no-ops/null results. ---

  function onPauseResume(handlers) { forward('onPauseResume', [handlers]); }
  // Not part of the minimum contract - only Playgama's Bridge adapter
  // implements this today (its platform-level audio-mute toggle has no
  // Yandex equivalent, see js/platform-playgama.js's own comment); a
  // missing implementation (Yandex) is a silent no-op, same as every other
  // extra below, so this changes nothing about Yandex's own behavior.
  function onAudioStateChange(handler) { forward('onAudioStateChange', [handler]); }
  // Fails safe toward "hide" (false) rather than "show" if the active
  // adapter has no answer - matches capabilities' own "unsupported until
  // proven otherwise" philosophy. Not consumed by any game code today (this
  // game has zero external-link UI at all, by design - see CLAUDE.md);
  // exported now so a future external-facing element has somewhere correct
  // to check first, without ever needing a platform-id check of its own.
  function isExternalLinksAllowed() { return forward('isExternalLinksAllowed', [], false); }
  function isAuthorized() { return forward('isAuthorized', [], false); }
  function openAuthDialog(callback) { forward('openAuthDialog', [callback]); }
  function createLeaderboardScreen(dom) {
    return forward('createLeaderboardScreen', [dom], function () {
      return { render: function () {}, open: function () {}, close: function () {} };
    });
  }
  function fetchBeatPercentForWinScreen(callback) {
    if (!activeAdapter || typeof activeAdapter.fetchBeatPercentForWinScreen !== 'function') {
      if (callback) callback(null);
      return;
    }
    activeAdapter.fetchBeatPercentForWinScreen(callback);
  }
  function debugSimulateAdError() { forward('debugSimulateAdError', []); }
  function debugSetAdSequence(name) { forward('debugSetAdSequence', [name]); }
  function getServerTimeOffsetMs() { return forward('getServerTimeOffsetMs', [], null); }
  function isMock() { return forward('isMock', [], false); }

  const Platform = {
    init,
    ready,
    gameplayStart,
    gameplayStop,
    showRewardedAd,
    loadData,
    saveData,
    submitScore,
    getServerTime,
    getLanguage,
    // Reads the active adapter's OWN capabilities property live, on every
    // access, rather than caching a one-time snapshot at init() time - that
    // distinction is invisible for Yandex (a static object, always the same
    // value) but matters for an adapter whose real capabilities are only
    // known once its own async handshake resolves (see
    // js/platform-playgama.js), well after this facade's own init() call
    // already returned.
    get capabilities() { return (activeAdapter && activeAdapter.capabilities) || DEFAULT_CAPABILITIES; },
    onPauseResume,
    onAudioStateChange,
    isExternalLinksAllowed,
    isAuthorized,
    openAuthDialog,
    createLeaderboardScreen,
    fetchBeatPercentForWinScreen,
    debugSimulateAdError,
    debugSetAdSequence,
    getServerTimeOffsetMs,
    isMock,
  };

  root.Garden = root.Garden || {};
  root.Garden.platformAdapter = Platform;
})(typeof window !== 'undefined' ? window : globalThis);
