// The Playgama Bridge concrete platform adapter: the ONLY place in the
// game that is allowed to touch window.bridge (the Playgama Bridge SDK
// global, https://bridge.playgama.com/v2/stable/playgama-bridge.js) -
// js/platform-adapter.js (the generic facade every other module actually
// calls) forwards here when window.GAME_PLATFORM === 'playgama'. See
// js/platform-yandex.js for the sibling Yandex adapter and GAME_DESIGN.md's
// "Platform layer" section for the shared contract both implement.
//
// Unlike the Yandex adapter, there is no built-in mock backend here: this
// adapter is only ever active in a Playgama build (window.GAME_PLATFORM is
// only ever 'playgama' when tools/build.ps1 -Platform playgama produced the
// index.html being served, and that same build step is what adds the real
// Bridge <script> tag to <head> - see that script's own comment). Local
// dev / GitHub Pages / opening index.html directly all keep defaulting to
// 'yandex' (js/platform-adapter.js's own default), whose adapter already
// has its own mock backend for exactly that case. If `window.bridge` is
// missing or its initialize() rejects even so (a bad/slow network fetch of
// the CDN script, say), every method below degrades to a safe no-op/null
// result instead of throwing - never a mock, just "this platform has
// nothing to offer right now", same as a real SDK call that legitimately
// has no answer.
//
// Bridge API surface used here (see
// https://wiki.playgama.com/playgama/bridge-sdk/api/*.md - v2, "Current" at
// the time this was written, not the legacy v1 doc tree):
//   bridge.initialize(): Promise<void>
//   bridge.platform.{language, isAudioEnabled, isExternalLinksAllowed,
//     sendMessage(msg), getServerTime(): Promise<number>, on(EVENT_NAME, cb)}
//   bridge.storage.{get(keys): Promise<array>, set(keys, values): Promise}
//   bridge.advertisement.{isRewardedSupported, showRewarded(), on(EVENT_NAME, cb)}
//     - outcome reported via REWARDED_STATE_CHANGED states: loading/opened/
//       closed/rewarded/failed (NOT a callback/promise on showRewarded()
//       itself - unlike Yandex's showRewardedVideo(callbacks)).
//   bridge.leaderboards.{type, setScore(id, score): Promise}
//   bridge.player.{isAuthorized, authorize(): Promise}
// Deliberately NOT used (see this round's report for the full reasoning):
// payments (no IAPs in this game), social (share/invite/rate - this game
// has zero external links by design, see CLAUDE.md), banner/interstitial
// ads (rewarded only, per this task's explicit scope), leaderboards.
// getEntries()/showNativePopup() (no custom leaderboard popup for Playgama
// yet - only submitScore(), see the "leaderboard" section below),
// remote-config, analytics, and player.name/photos/extra (no UI surface
// for them today).
(function (root) {
  // These two ids MUST match platform/playgama/playgama-bridge-config.json
  // exactly - Bridge only recognizes a leaderboard/placement id that was
  // pre-declared in that file (see GAME_DESIGN.md's "Platform layer"
  // section and the config file's own comments-equivalent in that doc).
  const LEADERBOARD_ID = 'points'; // same technical id js/main.js already submits under for every platform; config: leaderboards[0].id
  const REWARDED_PLACEMENT_ID = 'helper_charge'; // the game's only rewarded placement (the helper "+1 charge" ad); config: advertisement.rewarded.placements[0].id / placementFallback
  // Generous upper bound on a real rewarded video (open -> watch -> close) -
  // same reasoning as js/platform-yandex.js's own DEFAULT_AD_SAFETY_TIMEOUT_MS:
  // a dropped/never-fired terminal state must never leave the game paused
  // and input-blocked forever (the exact stuck-helper-button bug that was
  // fixed for Yandex - see GAME_DESIGN.md).
  const DEFAULT_AD_SAFETY_TIMEOUT_MS = 90000;

  // --- generic helpers (same shapes as js/platform-yandex.js's own) -----

  function toPromise(value) {
    if (value && typeof value.then === 'function') return value;
    return Promise.resolve(value);
  }

  function safeCall(fn, fallback) {
    try {
      return fn();
    } catch (e) {
      return fallback;
    }
  }

  function getGlobalBridge() {
    return (typeof window !== 'undefined' && window.bridge) || (typeof globalThis !== 'undefined' && globalThis.bridge) || null;
  }

  // --- module state --------------------------------------------------

  let bridge = null; // the real (or test-injected) `window.bridge` object, once confirmed usable
  let initPromise = null;
  let readyFlag = false; // true once bridge.initialize() has resolved
  let gameplayActive = false;
  let adInProgress = false;
  let pendingAd = null; // { resolve, reject, rewarded, settled, safetyTimer } - at most one in flight, see showRewardedAd()
  let adSafetyTimeoutMs = DEFAULT_AD_SAFETY_TIMEOUT_MS;
  let rewardedListenerBound = false;
  let pauseListenerBound = false;
  let audioListenerBound = false;
  let pendingPauseResumeHandlers = null;
  let pendingAudioStateHandler = null;
  let serverTimeOffsetMs = null;
  let readyMessageQueued = false; // see ready()'s own comment

  // Conservative until init() actually resolves and a real `bridge` is
  // confirmed usable - "unsupported until proven otherwise" is the same
  // fail-safe default js/platform-adapter.js itself starts with.
  let capabilities = { rewardedAds: false, cloudSave: false, leaderboard: false, serverTime: false };

  function refreshCapabilities() {
    capabilities = {
      rewardedAds: !!safeCall(function () { return bridge.advertisement && bridge.advertisement.isRewardedSupported; }, false),
      // Bridge "automatically picks the most suitable place to store data on
      // the current platform" - storage.get/set existing at all is the only
      // thing worth checking; a platform with no cloud slot still has a
      // local fallback (js/cloudsave.js keeps localStorage as the source of
      // truth either way - see that file's own merge policy).
      cloudSave: !!safeCall(function () { return bridge.storage && typeof bridge.storage.get === 'function' && typeof bridge.storage.set === 'function'; }, false),
      leaderboard: !!safeCall(function () { return bridge.leaderboards && bridge.leaderboards.type !== 'not_available'; }, false),
      serverTime: !!safeCall(function () { return typeof bridge.platform.getServerTime === 'function'; }, false),
    };
  }

  // --- init --------------------------------------------------------------

  // Idempotent: safe to call more than once, always returns the SAME
  // promise. Never rejects - a missing/broken Bridge just leaves every
  // capability false and every method a safe no-op, exactly like Yandex's
  // own adapter falls back to its mock rather than ever rejecting init().
  function init() {
    if (initPromise) return initPromise;
    const candidate = getGlobalBridge();
    if (!candidate || typeof candidate.initialize !== 'function') {
      initPromise = Promise.resolve();
      return initPromise;
    }
    bridge = candidate;
    initPromise = toPromise(bridge.initialize())
      .then(function () {
        readyFlag = true;
        refreshCapabilities();
        refreshServerTimeOffset();
        registerPauseListener();
        registerAudioListener();
        flushReadyMessageIfQueued();
      })
      .catch(function () {
        // A genuine initialize() failure - never surfaced to the caller.
        // Bridge's own docs are explicit that initialize() must succeed
        // before any other API call is safe, so `bridge` is cleared here
        // too (not just readyFlag) - every other method's own `if
        // (!bridge) return safe-default` guard then uniformly treats this
        // exactly like "no Bridge at all" rather than defensively trying
        // individual calls against a backend that never finished its own
        // handshake.
        readyFlag = false;
        bridge = null;
      });
    return initPromise;
  }

  // --- platform: ready / language / audio-enabled / server time ---------

  // sendMessage('game_ready') can race init() exactly like Yandex's
  // LoadingAPI.ready() can - js/platform.js's gameReady() calls this as soon
  // as the menu is interactive, which is often before bridge.initialize()
  // has resolved. Queuing instead of dropping matters here for the same
  // reason it does for Yandex: a lost "ready" signal could leave a
  // platform's own loading UI waiting forever.
  function flushReadyMessageIfQueued() {
    if (!readyMessageQueued || !readyFlag || !bridge) return;
    readyMessageQueued = false;
    safeCall(function () { toPromise(bridge.platform.sendMessage('game_ready')).catch(function () {}); });
  }

  function ready() {
    readyMessageQueued = true;
    flushReadyMessageIfQueued();
  }

  function gameplayStart() {
    // Bridge has no single "gameplay session active" flag the way Yandex's
    // GameplayAPI.start()/stop() does - the closest documented equivalent
    // is the level_resumed/level_paused message pair (see
    // bridge-sdk/api/platform.md's sendMessage list). Used generically here
    // (not just on a genuinely-resumed level) because this facade method
    // itself is called just as generically by every caller (entering OR
    // resuming a level/challenge) - see js/main.js/js/input.js. Best-effort
    // only: never blocks anything, and a dropped/ignored message changes
    // nothing about actual gameplay.
    if (!bridge || gameplayActive) return;
    gameplayActive = true;
    safeCall(function () { toPromise(bridge.platform.sendMessage('level_resumed')).catch(function () {}); });
  }

  function gameplayStop() {
    if (!bridge || !gameplayActive) return;
    gameplayActive = false;
    safeCall(function () { toPromise(bridge.platform.sendMessage('level_paused')).catch(function () {}); });
  }

  function getLanguage() {
    return safeCall(function () {
      const lang = bridge && bridge.platform && bridge.platform.language;
      return typeof lang === 'string' && lang ? lang : null;
    }, null);
  }

  function isAudioEnabled() {
    return safeCall(function () { return !!(bridge && bridge.platform && bridge.platform.isAudioEnabled); }, true);
  }

  function isExternalLinksAllowed() {
    // Conservative default (false = hide) if the property genuinely isn't
    // there at all, rather than assuming a v1-only Bridge build would allow
    // them - see this round's report for why v2 was picked specifically so
    // this property exists; this fallback only matters if that assumption
    // somehow doesn't hold on a real platform.
    return safeCall(function () { return !!(bridge && bridge.platform && bridge.platform.isExternalLinksAllowed); }, false);
  }

  // Cached from bridge.platform.getServerTime() once at init() time, same
  // shape as js/platform-yandex.js's getServerTimeOffsetMs() - a null
  // offset here is exactly what makes js/platform.js's Platform.now() fall
  // back to the device clock, which is the "daily features degrade safely
  // without server time" behavior this task asked for; no separate
  // fallback logic needed in this file.
  function refreshServerTimeOffset() {
    if (!bridge || typeof bridge.platform.getServerTime !== 'function') {
      serverTimeOffsetMs = null;
      return;
    }
    toPromise(bridge.platform.getServerTime())
      .then(function (serverMs) {
        serverTimeOffsetMs = typeof serverMs === 'number' && Number.isFinite(serverMs) ? serverMs - Date.now() : null;
      })
      .catch(function () { serverTimeOffsetMs = null; });
  }

  function getServerTimeOffsetMs() { return serverTimeOffsetMs; }

  function getServerTime() {
    return Promise.resolve(serverTimeOffsetMs === null ? null : Date.now() + serverTimeOffsetMs);
  }

  // --- pause / resume (platform.on(PAUSE_STATE_CHANGED)) -----------------

  function registerPauseListener() {
    if (!bridge || pauseListenerBound || !pendingPauseResumeHandlers) return;
    pauseListenerBound = true;
    safeCall(function () {
      bridge.platform.on(bridge.EVENT_NAME.PAUSE_STATE_CHANGED, function (isPaused) {
        if (!pendingPauseResumeHandlers) return;
        if (isPaused) { if (pendingPauseResumeHandlers.onPause) pendingPauseResumeHandlers.onPause(); }
        else if (pendingPauseResumeHandlers.onResume) pendingPauseResumeHandlers.onResume();
      });
    });
  }

  function onPauseResume(handlers) {
    pendingPauseResumeHandlers = handlers;
    if (readyFlag) registerPauseListener();
  }

  // --- platform-level audio toggle (platform.on(AUDIO_STATE_CHANGED)) ---
  //
  // NOT part of the minimum generic adapter contract (Yandex has no
  // equivalent) - js/platform-adapter.js forwards an extra
  // onAudioStateChange(handler) purely so this one Playgama-specific signal
  // ("the platform-level mute toggle changed") can still reach the game's
  // existing generic Garden.audio.setExternalMute() system without any
  // platform-id check in js/main.js. onAudioStateChange() below fires the
  // CURRENT value immediately on every call (so a player who had the
  // platform muted before this game even loaded starts muted, per the
  // Playgama UX requirement: "check isAudioEnabled at startup, react to
  // audio state events, stay muted after reload"), then again on every
  // live change - registerAudioListener() itself only binds the live
  // bridge.platform.on() subscription, at most once, kept deliberately
  // separate from the "fire now" step so a handler registered AFTER init()
  // already ran once (the real js/main.js ordering: init() is kicked off
  // at the very top of that file, onAudioStateChange() is called later,
  // inside DOMContentLoaded) still gets its own immediate callback rather
  // than silently missing it because some earlier, unrelated handler
  // already flipped the "listener bound" flag.
  function registerAudioListener() {
    if (!bridge || audioListenerBound) return;
    audioListenerBound = true;
    safeCall(function () {
      bridge.platform.on(bridge.EVENT_NAME.AUDIO_STATE_CHANGED, function (isEnabled) {
        if (pendingAudioStateHandler) pendingAudioStateHandler(!!isEnabled);
      });
    });
  }

  function onAudioStateChange(handler) {
    pendingAudioStateHandler = handler;
    if (!readyFlag) return; // nothing to report yet - no bridge answer exists before init() resolves
    registerAudioListener();
    if (handler) handler(isAudioEnabled());
  }

  // --- rewarded ads (adapter contract: Promise<{rewarded: boolean}>) ----
  //
  // Bridge reports a rewarded ad's outcome through a persistent event
  // stream (advertisement.on(REWARDED_STATE_CHANGED, state => ...), states
  // loading/opened/closed/rewarded/failed - see this file's own top
  // comment) rather than Yandex's per-call callbacks object, so the
  // listener is bound ONCE (ensureRewardedListener, idempotent) and each
  // call's own Promise is tracked via the single `pendingAd` slot instead -
  // there is only ever one ad open at a time anyway (same double-tap guard
  // Yandex's adapter has). Exactly like Yandex's showRewardedAd(), this
  // Promise is GUARANTEED to settle exactly once no matter what Bridge
  // does: 'rewarded' then 'closed' resolves {rewarded:true} (the
  // documented, mandatory order - "reward the player only when the state is
  // rewarded"); 'closed' with no 'rewarded' first resolves
  // {rewarded:false} (a decline, not an error - js/input.js's own
  // ad-unavailable message must never show for this); 'failed' REJECTS (so
  // that message only shows for a genuine failure); and if Bridge never
  // reports any terminal state at all, a safety timeout force-resolves
  // {rewarded:false} instead of leaving the caller's cleanup (unblock
  // input, unmute, resume the timer/GameplayAPI, drop stale focus - all in
  // js/input.js, not here) waiting forever - the exact "same fix as
  // Yandex" this task asked for.
  function ensureRewardedListener() {
    if (!bridge || rewardedListenerBound) return;
    rewardedListenerBound = true;
    safeCall(function () {
      bridge.advertisement.on(bridge.EVENT_NAME.REWARDED_STATE_CHANGED, handleRewardedState);
    });
  }

  function handleRewardedState(state) {
    if (!pendingAd || pendingAd.settled) return;
    if (state === 'rewarded') { pendingAd.rewarded = true; return; }
    if (state === 'closed') { settlePendingAd(); return; }
    if (state === 'failed') { failPendingAd(); return; }
    // 'loading' / 'opened' - transient, nothing to do yet.
  }

  function settlePendingAd() {
    if (!pendingAd || pendingAd.settled) return;
    pendingAd.settled = true;
    clearTimeout(pendingAd.safetyTimer);
    adInProgress = false;
    const rewarded = pendingAd.rewarded;
    const resolve = pendingAd.resolve;
    pendingAd = null;
    resolve({ rewarded: rewarded });
  }

  function failPendingAd() {
    if (!pendingAd || pendingAd.settled) return;
    pendingAd.settled = true;
    clearTimeout(pendingAd.safetyTimer);
    adInProgress = false;
    const reject = pendingAd.reject;
    pendingAd = null;
    reject(new Error('rewarded ad unavailable'));
  }

  function showRewardedAd() {
    return new Promise(function (resolve, reject) {
      const supported = !!safeCall(function () { return bridge && bridge.advertisement && bridge.advertisement.isRewardedSupported; }, false);
      if (!supported || adInProgress) {
        resolve({ rewarded: false });
        return;
      }
      ensureRewardedListener();
      adInProgress = true;
      pendingAd = { resolve: resolve, reject: reject, rewarded: false, settled: false, safetyTimer: null };
      pendingAd.safetyTimer = setTimeout(settlePendingAd, adSafetyTimeoutMs);
      // Passed explicitly rather than relying on the config's own
      // placementFallback - this way the call is correct even if the
      // config's fallback is ever edited/removed, and `grep`ping this file
      // for REWARDED_PLACEMENT_ID finds every real use of that id.
      safeCall(function () { bridge.advertisement.showRewarded(REWARDED_PLACEMENT_ID); });
    });
  }

  function isAdInProgress() { return adInProgress; }

  // --- cloud-data primitives (adapter contract: no merge policy here) ---
  //
  // Per this task's explicit instruction: local storage (js/platform.js,
  // via localStorage) stays the source of truth, and the merge policy
  // itself lives entirely in js/cloudsave.js, same as for Yandex - this
  // file only ever offers the two generic primitives js/cloudsave.js calls,
  // exactly like js/platform-yandex.js's loadData()/saveData(); a failed
  // bridge.storage.get()/set() here just resolves to "nothing to merge"/
  // "not saved this time" rather than throwing, so js/cloudsave.js's
  // already-existing "cloud === null -> local wins outright" and "write
  // failed -> retried on the next debounced flush" behavior keeps working
  // completely unchanged.
  //
  // js/cloudsave.js's buildLocalSnapshot() always sends one flat object
  // with the same fixed field set (progress, bestTimes, lang, savedAt, ...)
  // - storage.set(object) (the object-form overload) is the natural fit,
  // one Bridge call per saveData(), same call-count shape as Yandex's
  // setPlayerData(obj, true).
  function loadData() {
    if (!bridge || !bridge.storage || typeof bridge.storage.get !== 'function') return Promise.resolve(null);
    return toPromise(bridge.storage.get(['gardenCloudSave']))
      .then(function (values) {
        const raw = Array.isArray(values) ? values[0] : values;
        if (raw == null) return null;
        if (typeof raw === 'object') return raw; // some platforms may already hand back parsed JSON
        return safeCall(function () { return JSON.parse(raw); }, null);
      })
      .catch(function () { return null; });
  }

  function saveData(obj) {
    if (!bridge || !bridge.storage || typeof bridge.storage.set !== 'function') return Promise.resolve(false);
    return toPromise(bridge.storage.set({ gardenCloudSave: JSON.stringify(obj) }))
      .then(function () { return true; })
      .catch(function () { return false; });
  }

  // --- leaderboard: submit only (see this file's own top comment for why
  // no custom popup/getEntries() wiring was added this round) ------------

  function submitScore(name, score) {
    if (!bridge || !bridge.leaderboards || bridge.leaderboards.type === 'not_available') return;
    safeCall(function () { toPromise(bridge.leaderboards.setScore(LEADERBOARD_ID, score)).catch(function () {}); });
  }

  // --- player / auth (used only if a future leaderboard popup needs it) -

  function isAuthorized() {
    return !!safeCall(function () { return bridge && bridge.player && bridge.player.isAuthorized; }, false);
  }

  function openAuthDialog(callback) {
    if (!bridge || !bridge.player || typeof bridge.player.authorize !== 'function') {
      if (callback) callback(false);
      return;
    }
    toPromise(bridge.player.authorize())
      .then(function () { if (callback) callback(isAuthorized()); })
      .catch(function () { if (callback) callback(isAuthorized()); });
  }

  // --- test-only configuration hook ---
  //
  // Lets tests/platform-playgama.test.js fully control this module's
  // behavior with an injected fake `bridge` object - no window, no
  // document, no real Bridge script. Unlike js/platform-yandex.js's
  // _configureForTests (which bypasses init() entirely with an already-
  // "ready" fake backend), this one clears the memoized initPromise and
  // installs the fake as window.bridge / globalThis.bridge, then re-runs
  // the REAL init() against it - so a test can exercise genuine
  // "initialize() resolves" vs "initialize() rejects" behavior repeatedly
  // in the same process, not just a pre-baked ready state. Returns the
  // resulting init() promise. Never called from any real game code path.
  function _configureForTests(fakeBridge) {
    initPromise = null;
    bridge = null;
    readyFlag = false;
    gameplayActive = false;
    adInProgress = false;
    pendingAd = null;
    rewardedListenerBound = false;
    pauseListenerBound = false;
    audioListenerBound = false;
    pendingPauseResumeHandlers = null;
    pendingAudioStateHandler = null;
    serverTimeOffsetMs = null;
    readyMessageQueued = false;
    capabilities = { rewardedAds: false, cloudSave: false, leaderboard: false, serverTime: false };
    if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
    globalThis.window.bridge = fakeBridge;
    globalThis.bridge = fakeBridge;
    return init();
  }

  const PlatformPlaygama = {
    // --- generic adapter contract (see js/platform-adapter.js) ---
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
    get capabilities() { return capabilities; },
    // --- extras also reached only via the generic facade ---
    onPauseResume,
    onAudioStateChange,
    isAuthorized,
    openAuthDialog,
    isAdInProgress,
    getServerTimeOffsetMs,
    isExternalLinksAllowed,
    _configureForTests,
  };

  root.Garden = root.Garden || {};
  root.Garden.platformPlaygama = PlatformPlaygama;
})(typeof window !== 'undefined' ? window : globalThis);
