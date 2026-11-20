// The Yandex Games concrete platform adapter: the ONLY place in the game
// that is allowed to touch window.YaGames - js/platform-adapter.js (the
// generic facade every other module actually calls) forwards to whichever
// concrete adapter is active; today that's always this one, since Yandex
// is the only shipped platform (see GAME_DESIGN.md's "Platform layer"
// section for how a future adapter, e.g. Playgama, plugs in next to this).
//
// Shape of this file, top to bottom:
//   1. Small generic promise/async helpers.
//   2. The REAL backend: a thin adapter around window.YaGames's actual
//      methods, defensive about every single call (try/catch + duck-typed
//      Promise handling) because a 3rd-party SDK's exact method shapes
//      can't be verified from outside a live Yandex Games session - see
//      GAME_DESIGN.md's integration notes for what's confirmed vs. assumed.
//   3. The MOCK backend: a 2-second fake rewarded ad that always succeeds,
//      an in-memory/localStorage-backed "cloud", and clearly-fake
//      leaderboard data for visual testing - every mock-only fabrication is
//      commented as such and NEVER reachable from the real backend.
//   4. Orchestration: which backend got picked, the adapter-contract
//      methods (init/ready/gameplayStart/Stop/showRewardedAd/loadData/
//      saveData/submitScore/getServerTime/getLanguage/capabilities) plus
//      Yandex-specific extras beyond that generic contract (leaderboard
//      entries/popup, auth, debug hooks) - all still only ever reached
//      through this module, never raw ysdk, from anywhere else in the game.
//
// NOTE: the cloud-save MERGE POLICY (which side's value wins per field) is
// deliberately NOT in this file - that's game logic, not a platform
// concern, and lives in js/cloudsave.js, which calls this adapter's generic
// loadData()/saveData() rather than anything Yandex-specific.
(function (root) {
  const LEADERBOARD_NAME = 'points';
  const MOCK_AD_DELAY_MS = 2000;
  const DEFAULT_LEADERBOARD_THROTTLE_MS = 1000;
  // Generous upper bound on a real rewarded video (open -> watch -> close) -
  // see showRewardedAd's own comment for why this exists at all: a dropped
  // onClose/onError from the real SDK must never leave the game paused and
  // input-blocked forever.
  const DEFAULT_AD_SAFETY_TIMEOUT_MS = 90000;
  // Short grace window after the ad closes, before the showRewardedAd()
  // Promise actually resolves, ONLY entered when the close arrived before
  // any reward signal did (some real ad networks confirm the reward
  // slightly after the overlay is already gone - see showRewardedAd's own
  // comment). Never applied on the common path (reward already known by
  // the time close fires resolves immediately, no artificial delay).
  const DEFAULT_REWARD_GRACE_MS = 1500;

  // --- 1. generic helpers ---------------------------------------------

  // Wraps a value that MIGHT already be a Promise (real SDK calls are
  // documented as returning Promises, but this file can't verify that
  // against a live SDK, so every call site goes through this rather than
  // trusting `.then` exists) into a real one.
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

  // --- 2. real backend: the only code in this file allowed to touch
  // window.YaGames -----------------------------------------------------

  function createRealBackend(win) {
    let ysdk = null;
    let playerObj = null;
    // ready() can legitimately be called before init()'s promise has
    // resolved (main.js calls it the moment the menu becomes interactive,
    // which can easily race a real network round trip) - queuing the
    // request instead of silently dropping it matters here: Yandex Games
    // actually waits on this call to dismiss ITS OWN loading screen, so a
    // dropped call would leave the player stuck looking at it forever.
    let readyRequested = false;

    function flushReadyIfPossible() {
      safeCall(function () {
        if (readyRequested && ysdk && ysdk.features && ysdk.features.LoadingAPI) {
          ysdk.features.LoadingAPI.ready();
          readyRequested = false;
        }
      });
    }

    function init() {
      if (!win || !win.YaGames || typeof win.YaGames.init !== 'function') {
        return Promise.reject(new Error('YaGames not present'));
      }
      return toPromise(win.YaGames.init()).then(function (sdk) {
        ysdk = sdk;
        flushReadyIfPossible();
      });
    }

    function ready() {
      readyRequested = true;
      flushReadyIfPossible();
    }

    function gameplayStart() {
      safeCall(function () {
        if (ysdk && ysdk.features && ysdk.features.GameplayAPI) ysdk.features.GameplayAPI.start();
      });
    }

    function gameplayStop() {
      safeCall(function () {
        if (ysdk && ysdk.features && ysdk.features.GameplayAPI) ysdk.features.GameplayAPI.stop();
      });
    }

    // Best-effort: the exact event-subscription shape for game_api_pause/
    // game_api_resume couldn't be confirmed without a live SDK session (see
    // GAME_DESIGN.md) - guarded so a wrong/renamed method name degrades to
    // "pause/resume events just never fire" rather than throwing.
    function on(eventName, cb) {
      safeCall(function () {
        if (ysdk && typeof ysdk.on === 'function') ysdk.on(eventName, cb);
      });
    }

    function isAvailableMethod(name) {
      return safeCall(function () {
        if (!ysdk || typeof ysdk.isAvailableMethod !== 'function') return Promise.resolve(true);
        return toPromise(ysdk.isAvailableMethod(name)).catch(function () { return true; });
      }, Promise.resolve(true));
    }

    function getPlayer() {
      if (!ysdk || typeof ysdk.getPlayer !== 'function') return Promise.resolve({ authorized: false });
      return toPromise(ysdk.getPlayer({ scopes: false }))
        .then(function (p) {
          playerObj = p;
          const mode = safeCall(function () { return typeof p.getMode === 'function' ? p.getMode() : null; }, null);
          return { authorized: !!p && mode !== 'lite' };
        })
        .catch(function () {
          playerObj = null;
          return { authorized: false };
        });
    }

    function openAuthDialog() {
      if (!ysdk || !ysdk.auth || typeof ysdk.auth.openAuthDialog !== 'function') {
        return Promise.reject(new Error('auth unavailable'));
      }
      return toPromise(ysdk.auth.openAuthDialog());
    }

    function getPlayerData() {
      if (!playerObj || typeof playerObj.getData !== 'function') return Promise.resolve(null);
      return toPromise(playerObj.getData()).catch(function () { return null; });
    }

    function setPlayerData(data, flush) {
      if (!playerObj || typeof playerObj.setData !== 'function') return Promise.resolve(false);
      return toPromise(playerObj.setData(data, flush))
        .then(function () { return true; })
        .catch(function () { return false; });
    }

    function showRewardedVideo(callbacks) {
      safeCall(function () {
        if (!ysdk || !ysdk.adv || typeof ysdk.adv.showRewardedVideo !== 'function') {
          if (callbacks.onError) callbacks.onError();
          return;
        }
        ysdk.adv.showRewardedVideo({ callbacks: callbacks });
      });
    }

    // Documented as synchronous (ms since epoch); throws (caught by the
    // caller) if the method isn't there at all.
    function serverTime() {
      if (!ysdk || typeof ysdk.serverTime !== 'function') throw new Error('serverTime unavailable');
      return ysdk.serverTime();
    }

    // Best-effort BCP-47-ish short code (e.g. 'ru', 'en') from the SDK's
    // environment info - the exact field path couldn't be confirmed without
    // a live SDK session (see GAME_DESIGN.md), so this is guarded the same
    // defensive way as everything else here: any shape mismatch degrades to
    // "language unknown" rather than throwing.
    function language() {
      return safeCall(function () {
        const lang = ysdk && ysdk.environment && ysdk.environment.i18n && ysdk.environment.i18n.lang;
        return typeof lang === 'string' && lang ? lang : null;
      }, null);
    }

    function setScore(name, score) {
      if (!ysdk || !ysdk.leaderboards || typeof ysdk.leaderboards.setScore !== 'function') return Promise.resolve();
      return toPromise(ysdk.leaderboards.setScore(name, score)).catch(function () {});
    }

    function getEntries(name, options) {
      if (!ysdk || !ysdk.leaderboards || typeof ysdk.leaderboards.getEntries !== 'function') return Promise.resolve(null);
      return toPromise(ysdk.leaderboards.getEntries(name, options)).catch(function () { return null; });
    }

    // No confirmed real-SDK call for "total entries on a leaderboard" (see
    // computeBeatPercent's own comment below), so the real backend always
    // reports "unknown" rather than inventing a number.
    function getTotalEntries() {
      return null;
    }

    return {
      isMock: false,
      init: init,
      ready: ready,
      gameplayStart: gameplayStart,
      gameplayStop: gameplayStop,
      on: on,
      isAvailableMethod: isAvailableMethod,
      getPlayer: getPlayer,
      openAuthDialog: openAuthDialog,
      getPlayerData: getPlayerData,
      setPlayerData: setPlayerData,
      showRewardedVideo: showRewardedVideo,
      serverTime: serverTime,
      language: language,
      leaderboards: { setScore: setScore, getEntries: getEntries, getTotalEntries: getTotalEntries },
    };
  }

  // --- 3. mock backend: used whenever window.YaGames is absent, or
  // ?mock=1 forces it even when the real SDK IS present (dev testing inside
  // a real Yandex Games preview iframe) -------------------------------

  function createMockBackend() {
    const MOCK_CLOUD_KEY = 'garden.mockCloudData';
    let authorized = false;
    let adDelayMs = MOCK_AD_DELAY_MS;
    // One-shot override for the NEXT showRewardedVideo call only (reset to
    // null as soon as it's consumed), so a debug/console tool can dial in
    // exactly one unusual callback order at a time without otherwise
    // disturbing the normal "always succeeds" mock behavior - see
    // debugSetAdSequence / window.GardenDebug.simulateAdSequence.
    // One of: null/'rewarded-close' (default), 'close-then-rewarded' (the
    // reward signal arrives AFTER the ad has already closed - some real ad
    // networks do this), 'error', 'close-no-reward' (closed/declined with
    // no reward at all), 'stuck' (never calls onClose/onError/onRewarded at
    // all - exercises showRewardedAd's own safety-timeout recovery).
    let forcedAdSequence = null;

    function readMockCloud() {
      if (typeof localStorage === 'undefined') return null;
      return safeCall(function () {
        const raw = localStorage.getItem(MOCK_CLOUD_KEY);
        return raw ? JSON.parse(raw) : null;
      }, null);
    }

    function writeMockCloud(data) {
      if (typeof localStorage === 'undefined') return;
      safeCall(function () { localStorage.setItem(MOCK_CLOUD_KEY, JSON.stringify(data)); });
    }

    function init() { return Promise.resolve(); }
    function ready() {}
    function gameplayStart() {}
    function gameplayStop() {}
    // The mock never emits game_api_pause/game_api_resume - there is no
    // platform to pause it from; left as a no-op rather than faking events
    // nothing in a real session would have triggered.
    function on() {}
    function isAvailableMethod() { return Promise.resolve(true); }
    function getPlayer() { return Promise.resolve({ authorized: authorized }); }
    // Dev convenience: the mock's auth dialog always "succeeds" - there is
    // no real decline path to simulate without a UI, and the actual
    // decline/no-nagging behavior is exercised against an injectable fake
    // backend in tests/platform-yandex.test.js instead.
    function openAuthDialog() {
      authorized = true;
      return Promise.resolve();
    }
    function getPlayerData() { return Promise.resolve(readMockCloud()); }
    function setPlayerData(data) {
      writeMockCloud(data);
      return Promise.resolve(true);
    }

    // Spec: "rewarded ad = 2-second fake with success." Always rewards and
    // closes after the delay, UNLESS a one-shot sequence override is in
    // effect (see forcedAdSequence's own comment above) - lets a real bug
    // report's exact SDK callback ordering be reproduced on demand rather
    // than guessed at.
    function showRewardedVideo(callbacks) {
      const sequence = forcedAdSequence || 'rewarded-close';
      forcedAdSequence = null; // one-shot, consumed right here regardless of outcome
      if (callbacks.onOpen) callbacks.onOpen();

      if (sequence === 'stuck') return; // deliberately never calls anything else again

      setTimeout(function () {
        if (sequence === 'error') {
          if (callbacks.onError) callbacks.onError();
          return;
        }
        if (sequence === 'close-no-reward') {
          if (callbacks.onClose) callbacks.onClose();
          return;
        }
        if (sequence === 'close-then-rewarded') {
          if (callbacks.onClose) callbacks.onClose();
          setTimeout(function () {
            if (callbacks.onRewarded) callbacks.onRewarded();
          }, Math.min(150, adDelayMs));
          return;
        }
        // default 'rewarded-close'
        if (callbacks.onRewarded) callbacks.onRewarded();
        if (callbacks.onClose) callbacks.onClose();
      }, adDelayMs);
    }

    // No real server to offset against in mock mode - the device clock IS
    // the "server" clock here, so getServerTimeOffsetMs() ends up ~0 and
    // Platform.now() behaves exactly as it did before this feature.
    function serverTime() { return Date.now(); }

    // Dev convenience for testing getLanguage(): reads ?lang= from the URL
    // if given, else null (the mock has no real platform locale to read) -
    // see GAME_DESIGN.md.
    function language() {
      if (typeof location === 'undefined' || typeof URLSearchParams === 'undefined') return null;
      return safeCall(function () {
        const lang = new URLSearchParams(location.search).get('lang');
        return lang || null;
      }, null);
    }

    function setScore() { return Promise.resolve(); }

    // MOCK-ONLY fabricated leaderboard, purely so the popup has something to
    // show while developing/testing without a real Yandex account or a
    // leaderboard actually configured in the Games Console - never used by
    // the real backend, and getTotalEntries() below is equally fake, only
    // so the win-screen "beat N%" line has something to render in mock mode
    // too (real mode always shows nothing - see computeBeatPercent's comment).
    function getEntries() {
      const mockNames = ['Аня', 'Егор', 'Марк', 'Соня', 'Лёва', 'Ира', 'Паша', 'Юля', 'Ден', 'Катя'];
      const entries = mockNames.map(function (name, i) {
        return { rank: i + 1, score: 900 - i * 37, player: { name: name } };
      });
      entries.push({ rank: 42, score: 210, player: { name: 'Вы (мок)' } });
      return Promise.resolve({ entries: entries, userRank: 42 });
    }
    function getTotalEntries() { return 500; }

    return {
      isMock: true,
      init: init,
      ready: ready,
      gameplayStart: gameplayStart,
      gameplayStop: gameplayStop,
      on: on,
      isAvailableMethod: isAvailableMethod,
      getPlayer: getPlayer,
      openAuthDialog: openAuthDialog,
      getPlayerData: getPlayerData,
      setPlayerData: setPlayerData,
      showRewardedVideo: showRewardedVideo,
      serverTime: serverTime,
      language: language,
      leaderboards: { setScore: setScore, getEntries: getEntries, getTotalEntries: getTotalEntries },
      _setAdDelayMs: function (ms) { adDelayMs = ms; },
      _setAdSequence: function (name) { forcedAdSequence = name; },
      _forceAdErrorOnce: function () { forcedAdSequence = 'error'; }, // kept as a thin alias - see debugSimulateAdError
      _setAuthorized: function (value) { authorized = !!value; },
    };
  }

  // --- 4. orchestration + the adapter-contract methods ------------------

  let backend = null;
  let initPromise = null;
  let readyFlag = false;
  let player = { authorized: false };
  let serverTimeOffsetMs = null;
  let gameplayActive = false;
  let adInProgress = false;
  let adSafetyTimeoutMs = DEFAULT_AD_SAFETY_TIMEOUT_MS;
  let rewardGraceMs = DEFAULT_REWARD_GRACE_MS;
  let pendingPauseResumeHandlers = null;

  let lbThrottleMs = DEFAULT_LEADERBOARD_THROTTLE_MS;
  let lbTimer = null;
  let lbPendingScore = null;
  let lbLastSentAt = 0;

  // Declared statically for the whole platform (not re-derived from the
  // real-vs-mock backend split) - Yandex supports all four today, mock
  // mode included (it simulates each one so the UI exercises the same
  // paths in dev). See js/platform-adapter.js's own comment for how a
  // future adapter with narrower support (e.g. no leaderboard) would
  // report a `false` here instead, letting game code hide that feature
  // without ever checking a platform id directly.
  const capabilities = { rewardedAds: true, cloudSave: true, leaderboard: true, serverTime: true };

  function isMockForced() {
    if (typeof location === 'undefined' || typeof URLSearchParams === 'undefined') return false;
    return safeCall(function () { return new URLSearchParams(location.search).get('mock') === '1'; }, false);
  }

  function selectBackend(win) {
    const hasRealSdk = !!(win && win.YaGames);
    return hasRealSdk && !isMockForced() ? createRealBackend(win) : createMockBackend();
  }

  function registerPauseResume() {
    if (!backend || !pendingPauseResumeHandlers) return;
    const handlers = pendingPauseResumeHandlers;
    backend.on('game_api_pause', function () { if (handlers.onPause) handlers.onPause(); });
    backend.on('game_api_resume', function () { if (handlers.onResume) handlers.onResume(); });
  }

  function onPauseResume(handlers) {
    pendingPauseResumeHandlers = handlers;
    if (readyFlag) registerPauseResume();
  }

  // Idempotent: safe to call more than once, always returns the SAME
  // promise. Resolves once the backend (real or mock) is as ready as it'll
  // get - including a graceful fallback to mock if the real SDK is present
  // but its own init() rejects (offline, SDK-side error, ...), so the menu
  // is never blocked waiting on a broken SDK (per CLAUDE.md's Yandex Games
  // constraints). Never rejects itself.
  function init() {
    if (initPromise) return initPromise;
    const win = typeof window !== 'undefined' ? window : null;
    backend = selectBackend(win);

    initPromise = backend
      .init()
      .catch(function () {
        backend = createMockBackend();
        return backend.init();
      })
      .then(function () { return backend.getPlayer(); })
      .then(function (p) { player = p || { authorized: false }; })
      .catch(function () { player = { authorized: false }; })
      .then(function () {
        refreshServerTimeOffset();
        readyFlag = true;
        registerPauseResume();
      });
    return initPromise;
  }

  // Reads the backend's server time once and caches the offset from the
  // device clock - cached rather than re-read on every date check (see
  // js/platform.js's Platform.now(), the one synchronous consumer of this
  // internally) - a plain device-clock fallback (offset stays/resets to
  // null) if the backend has no serverTime() at all, or it throws.
  function refreshServerTimeOffset() {
    try {
      const serverMs = backend.serverTime();
      if (typeof serverMs === 'number' && Number.isFinite(serverMs)) {
        serverTimeOffsetMs = serverMs - Date.now();
      } else {
        serverTimeOffsetMs = null;
      }
    } catch (e) {
      serverTimeOffsetMs = null;
    }
  }

  // Synchronous cached-offset accessor - NOT part of the generic adapter
  // contract (that's the async getServerTime() below), kept only because
  // js/platform.js's Platform.now() is called synchronously, pervasively,
  // by pure date-logic code (js/checkin.js, js/daily-challenge.js) that
  // can't become async without a much bigger, riskier ripple - see
  // GAME_DESIGN.md.
  function getServerTimeOffsetMs() { return serverTimeOffsetMs; }

  // The adapter-contract version: resolves the current server-adjusted
  // time in ms, or null if no server time is available (device-clock
  // fallback is the CALLER's job here, same as the sync accessor above -
  // this just reports what the platform actually knows).
  function getServerTime() {
    return Promise.resolve(serverTimeOffsetMs === null ? null : Date.now() + serverTimeOffsetMs);
  }

  function getLanguage() {
    return backend && typeof backend.language === 'function' ? backend.language() : null;
  }

  function isMock() { return !!(backend && backend.isMock); }
  function isReady() { return readyFlag; }
  function ready() { if (backend) backend.ready(); }

  function gameplayStart() {
    if (!backend || gameplayActive) return;
    gameplayActive = true;
    backend.gameplayStart();
  }

  function gameplayStop() {
    if (!backend || !gameplayActive) return;
    gameplayActive = false;
    backend.gameplayStop();
  }

  function isAuthorized() { return !!(player && player.authorized); }

  function refreshPlayer(callback) {
    if (!backend) {
      player = { authorized: false };
      if (callback) callback(player);
      return;
    }
    backend
      .getPlayer()
      .then(function (p) {
        player = p || { authorized: false };
        if (callback) callback(player);
      })
      .catch(function () {
        player = { authorized: false };
        if (callback) callback(player);
      });
  }

  // Only ever called from the leaderboard button's own click handler (see
  // createLeaderboardScreen below) - never automatically from anywhere
  // else, so a decline is never nagged again except by the player tapping
  // the button a second time themselves.
  function openAuthDialog(callback) {
    if (!backend) { if (callback) callback(false); return; }
    backend
      .openAuthDialog()
      .then(function () { refreshPlayer(function () { if (callback) callback(isAuthorized()); }); })
      .catch(function () { refreshPlayer(function () { if (callback) callback(isAuthorized()); }); });
  }

  // --- generic cloud-data primitives (adapter contract) - no merge
  // policy, no debounce: that's js/cloudsave.js's job, calling these. ---

  function loadData() {
    if (!backend) return Promise.resolve(null);
    return backend.getPlayerData().catch(function () { return null; });
  }

  function saveData(obj) {
    if (!backend) return Promise.resolve(false);
    return backend.setPlayerData(obj, true).catch(function () { return false; });
  }

  // --- rewarded ads (adapter contract: Promise<{rewarded: boolean}>) ---
  //
  // Single entry point for every rewarded-ad placement in the game (today,
  // only the helper "+1 charge" tap - see js/input.js). Guards: only one ad
  // open at a time (a second call while one is already open resolves
  // {rewarded:false} immediately and touches nothing - the double-tap
  // guard), the reward itself is only ever counted once per call even if
  // the backend's onRewarded somehow fires more than once, and - the fix
  // for a real bug reported from a live Yandex Games draft (see
  // GAME_DESIGN.md) - the Promise is GUARANTEED to settle exactly once, no
  // matter what order the backend calls things in or whether it calls them
  // at all:
  //  - a real ad error REJECTS the promise (so the caller's ad-unavailable
  //    message only shows for a genuine error, never for a plain decline).
  //  - a close with no reward known yet waits a short, bounded grace window
  //    (rewardGraceMs) in case the reward signal is just trailing slightly
  //    behind the close event (some real ad networks do this) - resolves
  //    immediately instead, with no artificial delay, on the common path
  //    where the reward is already known by the time the ad closes.
  //  - if the backend never calls onClose OR onError at all (a dropped/lost
  //    callback - the actual root cause of the live bug report: the helper
  //    button stayed input-blocked and visually stuck forever with no event
  //    left to ever clear it), a safety timeout force-resolves exactly as a
  //    close would have, so the caller's own cleanup (js/input.js:
  //    unblocking input, unmuting, resuming the timer/GameplayAPI, dropping
  //    stale focus) always eventually runs via the Promise's finally.
  function showRewardedAd() {
    return new Promise(function (resolve, reject) {
      if (!backend || adInProgress) {
        resolve({ rewarded: false });
        return;
      }
      adInProgress = true;
      let rewarded = false;
      let settled = false;
      let safetyTimer = null;
      let graceTimer = null;

      function clearTimers() {
        if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null; }
        if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
      }

      function finish() {
        if (settled) return;
        settled = true;
        clearTimers();
        adInProgress = false;
        resolve({ rewarded: rewarded });
      }

      function fail() {
        if (settled) return;
        settled = true;
        clearTimers();
        adInProgress = false;
        reject(new Error('rewarded ad unavailable'));
      }

      safetyTimer = setTimeout(finish, adSafetyTimeoutMs);

      backend.showRewardedVideo({
        onOpen: function () {},
        onRewarded: function () {
          rewarded = true; // idempotent by construction - setting true twice is harmless
        },
        onClose: function () {
          if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null; }
          if (rewarded) { finish(); return; } // already known - resolve now, no artificial delay
          if (!graceTimer) graceTimer = setTimeout(finish, rewardGraceMs);
        },
        onError: fail,
      });
    });
  }

  function isAdInProgress() { return adInProgress; }

  // Console/debug helper (wired to window.GardenDebug by main.js, only
  // under ?debug=1 - see platform.isDebugEnabled) - forces the NEXT rewarded
  // ad (mock mode only; a no-op in real mode, since this file can't make a
  // real ad fail on demand) to resolve as an error instead of a reward, so
  // the "ad unavailable" message path can be exercised without waiting for
  // a real failure.
  function debugSimulateAdError() {
    if (backend && backend.isMock && typeof backend._forceAdErrorOnce === 'function') backend._forceAdErrorOnce();
  }

  // Console/debug helper (mock mode only - a no-op in real mode, same as
  // debugSimulateAdError) - forces the NEXT rewarded ad to resolve through
  // one specific callback order instead of the normal "always succeeds"
  // mock sequence, so the exact orders a live SDK was reported to use (see
  // GAME_DESIGN.md) can be reproduced on demand: 'rewarded-close' (default),
  // 'close-then-rewarded', 'error', 'close-no-reward', 'stuck' (never calls
  // any terminal callback at all - exercises the safety-timeout recovery;
  // see showRewardedAd's own comment).
  function debugSetAdSequence(name) {
    if (backend && backend.isMock && typeof backend._setAdSequence === 'function') backend._setAdSequence(name);
  }

  // --- leaderboard ---

  function checkAvailable(name) {
    if (!backend || typeof backend.isAvailableMethod !== 'function') return Promise.resolve(true);
    return safeCall(function () { return backend.isAvailableMethod(name).catch(function () { return true; }); }, Promise.resolve(true));
  }

  function sendLeaderboardScoreNow() {
    lbTimer = null;
    lbLastSentAt = Date.now();
    const score = lbPendingScore;
    lbPendingScore = null;
    if (score === null || score === undefined || !backend) return;
    safeCall(function () { backend.leaderboards.setScore(LEADERBOARD_NAME, score); });
  }

  // Trailing-edge-coalescing throttle: sends immediately if the last send
  // was long enough ago, otherwise remembers only the LATEST score and
  // sends exactly once when the throttle window ends - matches the spec's
  // "max 1 request per second, send only the latest value" exactly, without
  // needing per-call-site bookkeeping anywhere else.
  function queueLeaderboardScore(score) {
    lbPendingScore = score;
    if (lbTimer) return;
    const elapsed = Date.now() - lbLastSentAt;
    if (elapsed >= lbThrottleMs) {
      sendLeaderboardScoreNow();
    } else {
      lbTimer = setTimeout(sendLeaderboardScoreNow, lbThrottleMs - elapsed);
    }
  }

  // Submits the player's total score to the "points" leaderboard - a no-op
  // (no request, no queued value) unless the player is both authorized and
  // the SDK reports leaderboards.setScore as available, exactly per spec.
  // `name` (adapter-contract's submitScore(name, value)) is accepted but
  // unused today - the Yandex leaderboard's technical name is pinned to
  // LEADERBOARD_NAME ("points"), the only one the Games Console draft has.
  function submitScore(name, score) {
    if (!backend || !isAuthorized()) return;
    checkAvailable('leaderboards.setScore').then(function (available) {
      if (available) queueLeaderboardScore(score);
    });
  }

  function getLeaderboardEntries(options, callback) {
    options = options || {};
    if (!backend) { callback(null); return; }
    toPromise(
      backend.leaderboards.getEntries(LEADERBOARD_NAME, {
        quantityTop: options.quantityTop != null ? options.quantityTop : 10,
        quantityAround: options.quantityAround != null ? options.quantityAround : 3,
        includeUser: options.includeUser !== false,
      })
    )
      .then(function (result) { callback(result || null); })
      .catch(function () { callback(null); });
  }

  function getLeaderboardTotalEntries() {
    return backend ? backend.leaderboards.getTotalEntries() : null;
  }

  // --- pure logic: leaderboard "beat N%" --------------------------------
  //
  // See the module-level comment and GAME_DESIGN.md: the real SDK exposes
  // no "total number of entries on the board" call that this file could
  // find documented anywhere, so getLeaderboardTotalEntries() above always
  // returns null and this line never renders in real mode - exactly the
  // "don't fake it, show nothing" behavior the spec asked for.
  function computeBeatPercent(rank, total) {
    if (typeof rank !== 'number' || typeof total !== 'number' || total <= 0 || rank <= 0) return null;
    const beaten = Math.max(0, total - rank);
    return Math.max(0, Math.min(100, Math.round((beaten / total) * 100)));
  }

  // Fetches just enough to compute the win-screen "beat N%" line (own rank
  // + the leaderboard's total entry count) and calls back with a percent or
  // null. In real mode getLeaderboardTotalEntries() is always null today
  // (see its own comment), so this always calls back null there - the line
  // genuinely never shows yet, not a bug.
  function fetchBeatPercentForWinScreen(callback) {
    const total = getLeaderboardTotalEntries();
    if (total == null) { callback(null); return; }
    getLeaderboardEntries({ quantityTop: 0, quantityAround: 1, includeUser: true }, function (result) {
      const rank = result && typeof result.userRank === 'number' ? result.userRank : null;
      callback(computeBeatPercent(rank, total));
    });
  }

  // --- leaderboard popup (DOM glue) ---
  //
  // index.html has no slot for any of this - so, same convention
  // js/menu.js/js/render.js/js/checkin.js already use for their own "no
  // slot" additions, the button and popup are built once in JS and
  // inserted into the existing menu screen. Functional hooks only, no
  // styling: .leaderboard-btn, .leaderboard-popup, .leaderboard-row,
  // .leaderboard-me, .leaderboard-empty.
  function createLeaderboardScreen(dom) {
    if (typeof document === 'undefined' || !dom || !dom.menuScreen) {
      return { render: function () {}, open: function () {}, close: function () {} };
    }
    const I18n = root.Garden.i18n;
    const menuCard = dom.menuScreen.querySelector('.menu-card') || dom.menuScreen;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu-button menu-secondary-button leaderboard-btn';
    if (dom.menuSettingsButton && dom.menuSettingsButton.parentElement === menuCard) {
      dom.menuSettingsButton.insertAdjacentElement('afterend', button);
    } else {
      menuCard.appendChild(button);
    }

    const overlay = document.createElement('div');
    overlay.className = 'overlay leaderboard-popup winter-plaque-overlay';
    overlay.hidden = true;
    const card = document.createElement('div');
    card.className = 'overlay-card leaderboard-card winter-plaque';
    const title = document.createElement('h2');
    const rowsWrap = document.createElement('div');
    rowsWrap.className = 'leaderboard-rows';
    const emptyEl = document.createElement('p');
    emptyEl.className = 'leaderboard-empty';
    emptyEl.hidden = true;
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'overlay-close-button';
    card.appendChild(title);
    card.appendChild(rowsWrap);
    card.appendChild(emptyEl);
    card.appendChild(closeButton);
    overlay.appendChild(card);
    (dom.menuScreen.parentElement || document.body).appendChild(overlay);

    function applyTexts() {
      button.textContent = I18n.t('leaderboardButtonLabel');
      title.textContent = I18n.t('leaderboardTitle');
      closeButton.setAttribute('aria-label', I18n.t('closeButtonLabel'));
      emptyEl.textContent = I18n.t('leaderboardEmpty');
    }
    applyTexts();

    // LEADERBOARD_PLAYER_NOT_PRESENT (the player has no entry yet): assumed
    // to surface as a missing/non-numeric userRank on the result (see
    // GAME_DESIGN.md - this exact shape couldn't be confirmed without a
    // live SDK session) - handled the same way as "no result at all": the
    // top-10 rows still render, just with no row highlighted as "me".
    function renderEntries(result) {
      rowsWrap.innerHTML = '';
      const entries = result && Array.isArray(result.entries) ? result.entries : [];
      const userRank = result && typeof result.userRank === 'number' ? result.userRank : null;
      emptyEl.hidden = entries.length > 0;
      entries.forEach(function (entry) {
        const row = document.createElement('div');
        row.className = 'leaderboard-row';
        if (userRank !== null && entry.rank === userRank) row.classList.add('leaderboard-me');
        const rankEl = document.createElement('span');
        rankEl.className = 'leaderboard-rank';
        rankEl.textContent = String(entry.rank);
        const nameEl = document.createElement('span');
        nameEl.className = 'leaderboard-name';
        nameEl.textContent = (entry.player && (entry.player.publicName || entry.player.name)) || '';
        const scoreEl = document.createElement('span');
        scoreEl.className = 'leaderboard-score';
        scoreEl.textContent = String(entry.score != null ? entry.score : '');
        row.appendChild(rankEl);
        row.appendChild(nameEl);
        row.appendChild(scoreEl);
        rowsWrap.appendChild(row);
      });
    }

    function openPopup() {
      overlay.hidden = false;
      getLeaderboardEntries({ quantityTop: 10, quantityAround: 3, includeUser: true }, renderEntries);
    }

    function closePopup() { overlay.hidden = true; }

    button.addEventListener('click', function () {
      if (isAuthorized()) { openPopup(); return; }
      // Only ever prompted from here, on an explicit tap - never
      // automatically, and never re-shown after a decline except by the
      // player tapping this same button again (see openAuthDialog's comment).
      openAuthDialog(function (authorized) {
        if (authorized) openPopup();
      });
    });
    closeButton.addEventListener('click', closePopup);
    overlay.addEventListener('click', function (event) { if (event.target === overlay) closePopup(); });

    return { render: applyTexts, open: openPopup, close: closePopup };
  }

  // --- test-only configuration hook ---
  //
  // Lets tests/platform-yandex.test.js fully control this module's behavior
  // with an injected fake backend - no window, no document, no real timers
  // for the ad delay/leaderboard throttle unless the test wants them. Never
  // called from any real game code path.
  function _configureForTests(fakeBackend, opts) {
    opts = opts || {};
    backend = fakeBackend;
    initPromise = Promise.resolve();
    readyFlag = true;
    player = opts.player || { authorized: false };
    serverTimeOffsetMs = null;
    gameplayActive = false;
    adInProgress = false;
    adSafetyTimeoutMs = opts.adSafetyTimeoutMs || DEFAULT_AD_SAFETY_TIMEOUT_MS;
    rewardGraceMs = opts.rewardGraceMs || DEFAULT_REWARD_GRACE_MS;
    if (lbTimer) { clearTimeout(lbTimer); lbTimer = null; }
    lbPendingScore = null;
    lbLastSentAt = 0;
    lbThrottleMs = opts.leaderboardThrottleMs || DEFAULT_LEADERBOARD_THROTTLE_MS;
  }

  const PlatformYandex = {
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
    capabilities,
    // --- Yandex-specific extras, still only ever reached via the facade ---
    isReady,
    isMock,
    onPauseResume,
    isAuthorized,
    openAuthDialog,
    isAdInProgress,
    debugSimulateAdError,
    debugSetAdSequence,
    getServerTimeOffsetMs,
    refreshServerTimeOffset,
    getLeaderboardEntries,
    getLeaderboardTotalEntries,
    computeBeatPercent,
    fetchBeatPercentForWinScreen,
    createLeaderboardScreen,
    LEADERBOARD_NAME,
    _configureForTests,
  };

  root.Garden = root.Garden || {};
  root.Garden.platformYandex = PlatformYandex;
})(typeof window !== 'undefined' ? window : globalThis);
