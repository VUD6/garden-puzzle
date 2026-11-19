// Yandex Games SDK integration: the ONLY place in the game that is allowed
// to touch window.YaGames - every other module talks exclusively to
// Garden.yandex, so the rest of the game works identically whether a real
// SDK is present (Yandex Games), absent (GitHub Pages, a local file open),
// or deliberately forced into its mock twin for testing (?mock=1).
//
// Shape of this file, top to bottom:
//   1. Small generic promise/async helpers.
//   2. Pure, side-effect-free logic (cloud-save merge policy, the
//      leaderboard "beat N%" math) - exported directly, Node-testable with
//      no DOM/SDK/window at all, same convention every other feature module
//      in this game already follows (checkin.js, daily-challenge.js, ...).
//   3. The REAL backend: a thin adapter around window.YaGames's actual
//      methods, defensive about every single call (try/catch + duck-typed
//      Promise handling) because a 3rd-party SDK's exact method shapes
//      can't be verified from outside a live Yandex Games session - see
//      GAME_DESIGN.md's integration notes for what's confirmed vs. assumed.
//   4. The MOCK backend: a 2-second fake rewarded ad that always succeeds,
//      an in-memory/localStorage-backed "cloud", and clearly-fake
//      leaderboard data for visual testing - every mock-only fabrication is
//      commented as such and NEVER reachable from the real backend.
//   5. Orchestration: which backend got picked, ad/gameplay/leaderboard
//      state machines, cloud-save scheduling, and the leaderboard popup's
//      DOM glue.
(function (root) {
  const LEADERBOARD_NAME = 'points';
  const MOCK_AD_DELAY_MS = 2000;
  const CLOUD_SAVE_DEBOUNCE_MS = 1500;
  const DEFAULT_LEADERBOARD_THROTTLE_MS = 1000;
  // Generous upper bound on a real rewarded video (open -> watch -> close) -
  // see showRewardedAd's own comment for why this exists at all: a dropped
  // onClose/onError from the real SDK must never leave the game paused and
  // input-blocked forever.
  const DEFAULT_AD_SAFETY_TIMEOUT_MS = 90000;

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

  // --- 2. pure logic: cloud-save merge policy -------------------------
  //
  // See GAME_DESIGN.md's "Cloud saves" section for the full written policy
  // this implements. Every function here takes plain data in, returns plain
  // data out - no Garden.platform, no SDK, no DOM - so mergeSnapshots itself
  // is trivially unit-testable; only buildLocalSnapshot/applyMergedSnapshot
  // below (which DO read/write Garden.platform) need a fake localStorage,
  // the same convention every other Node test in this repo already uses.

  // Lexicographic max of two 'YYYY-MM-DD' keys (or null) - safe because the
  // format is fixed-width and zero-padded (see js/checkin.js's
  // dateKeyFromParts). Used to make sure a daily reward's claim/reward date
  // can never regress across a merge, which is exactly what would let the
  // same day's reward be claimed twice on two different devices.
  function laterDateKey(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return a >= b ? a : b;
  }

  // Unions two {level: value} maps, applying `pick(a, b)` only where BOTH
  // sides have a value for that level; a level present on only one side
  // just keeps that side's value untouched (there is nothing to reconcile).
  function mergeByLevelMaps(a, b, pick) {
    a = a || {};
    b = b || {};
    const result = {};
    const keys = {};
    Object.keys(a).forEach(function (k) { keys[k] = true; });
    Object.keys(b).forEach(function (k) { keys[k] = true; });
    Object.keys(keys).forEach(function (key) {
      const av = a[key];
      const bv = b[key];
      if (av == null) { result[key] = bv; return; }
      if (bv == null) { result[key] = av; return; }
      result[key] = pick(av, bv);
    });
    return result;
  }

  // The actual merge. `cloud` may be null/undefined (nothing in the cloud
  // yet) - the local snapshot wins outright in that case, nothing to do.
  //
  // Field-by-field policy (see GAME_DESIGN.md for the "why"):
  //  - progress/highestLevel/totalScore/bestWinStreak: max (never regress).
  //  - bestTimes: min per level (a smaller time is always the better one).
  //  - bestStars: max per level.
  //  - dailyChallenge.challengeStars: max (independent of the rest of that
  //    same record - see below).
  //  - everything else (helper charges, the live win streak counter, the
  //    rest of the daily-gift record, the rest of the daily-challenge
  //    record, sound/theme settings): taken wholesale from whichever side
  //    has the later `savedAt` - these can legitimately go DOWN (spent
  //    charges, a streak reset by a loss), so "max" would be wrong for them;
  //    "most recently written, on either device" is the right rule instead.
  //    One shared savedAt governs this whole group (see platform.js's
  //    touchSavedAt) rather than a separate timestamp per field, a
  //    deliberate simplification - see GAME_DESIGN.md.
  //  - lastClaimDate/lastRewardDate get one extra override on top of the
  //    savedAt-side pick: whichever of the two is chronologically LATER
  //    always wins, specifically so a device that's behind on savedAt but
  //    genuinely claimed a later calendar day's reward can never have that
  //    claim marker rolled back - the one case where losing the savedAt-side
  //    pick would let the same reward be claimed twice.
  function mergeSnapshots(local, cloud) {
    if (!cloud) return local;

    const localSavedAt = local.savedAt || 0;
    const cloudSavedAt = cloud.savedAt || 0;
    const savedAtSide = localSavedAt >= cloudSavedAt ? local : cloud;

    const localGift = local.dailyGift || {};
    const cloudGift = cloud.dailyGift || {};
    const dailyGift = Object.assign({}, savedAtSide.dailyGift || {}, {
      lastClaimDate: laterDateKey(localGift.lastClaimDate, cloudGift.lastClaimDate),
    });

    const localChallenge = local.dailyChallenge || {};
    const cloudChallenge = cloud.dailyChallenge || {};
    const challengeStars = Math.max(localChallenge.challengeStars || 0, cloudChallenge.challengeStars || 0);
    const dailyChallenge = Object.assign({}, savedAtSide.dailyChallenge || {}, {
      lastRewardDate: laterDateKey(localChallenge.lastRewardDate, cloudChallenge.lastRewardDate),
      challengeStars: challengeStars,
    });

    return {
      progress: Math.max(local.progress || 1, cloud.progress || 1),
      highestLevel: Math.max(local.highestLevel || 1, cloud.highestLevel || 1),
      totalScore: Math.max(local.totalScore || 0, cloud.totalScore || 0),
      bestTimes: mergeByLevelMaps(local.bestTimes, cloud.bestTimes, Math.min),
      bestStars: mergeByLevelMaps(local.bestStars, cloud.bestStars, Math.max),
      bestWinStreak: Math.max(local.bestWinStreak || 0, cloud.bestWinStreak || 0),
      winStreak: savedAtSide.winStreak || 0,
      helperCharges: savedAtSide.helperCharges || {},
      dailyGift: dailyGift,
      dailyChallenge: dailyChallenge,
      sfxEnabled: savedAtSide.sfxEnabled,
      musicEnabled: savedAtSide.musicEnabled,
      theme: savedAtSide.theme,
    };
  }

  // Reads everything the cloud-save policy cares about straight out of
  // Garden.platform - deliberately NOT the in-progress board state (never
  // part of this payload; see GAME_DESIGN.md for why), and deliberately NOT
  // patternsEnabled/reduceMotion/vibrationEnabled/tutorialDone (accessibility
  // and device-specific prefs, left local-only on purpose - same doc).
  function buildLocalSnapshot() {
    const Platform = root.Garden.platform;
    const bestTimes = {};
    Platform.loadBestTimeLevels().forEach(function (level) {
      bestTimes[level] = Platform.loadBestTime(level);
    });
    const bestStars = {};
    Platform.loadBestStarsLevels().forEach(function (level) {
      bestStars[level] = Platform.loadBestStars(level);
    });
    return {
      progress: Platform.loadProgress(),
      highestLevel: Platform.loadHighestLevel(),
      totalScore: Platform.loadTotalScore(),
      bestTimes: bestTimes,
      bestStars: bestStars,
      bestWinStreak: Platform.loadBestWinStreak(),
      winStreak: Platform.loadWinStreak(),
      helperCharges: Platform.loadHelperCharges() || {},
      dailyGift: Platform.loadDailyGift(),
      dailyChallenge: Platform.loadDailyChallenge(),
      sfxEnabled: Platform.loadSfxEnabled(),
      musicEnabled: Platform.loadMusicEnabled(),
      theme: Platform.loadTheme(),
      savedAt: Platform.loadSavedAt(),
    };
  }

  // Writes a merged snapshot (see mergeSnapshots) back into Garden.platform.
  // Per-level best stars go through writeBestStarsRaw (no per-call totalStars
  // delta) followed by one recomputeTotalStars() at the end, rather than
  // saveBestStars's normal delta bookkeeping - see platform.js's own comment
  // on writeBestStarsRaw for why: totalStars is ALSO being reconstructed
  // wholesale here (sum of per-level bests + challengeStars), so letting N
  // individual deltas apply on top of that would double-count.
  function applyMergedSnapshot(merged) {
    const Platform = root.Garden.platform;
    Platform.saveProgress(merged.progress);
    Platform.saveHighestLevel(merged.highestLevel);
    Platform.saveTotalScore(merged.totalScore);
    Object.keys(merged.bestTimes || {}).forEach(function (level) {
      const value = merged.bestTimes[level];
      if (value != null) Platform.saveBestTime(Number(level), value);
    });
    Object.keys(merged.bestStars || {}).forEach(function (level) {
      const value = merged.bestStars[level];
      if (value != null) Platform.writeBestStarsRaw(Number(level), value);
    });
    Platform.saveBestWinStreakRaw(merged.bestWinStreak);
    Platform.saveWinStreak(merged.winStreak);
    Platform.saveHelperCharges(merged.helperCharges);
    Platform.saveDailyGift(merged.dailyGift);
    // Written BEFORE recomputeTotalStars() below, which reads
    // loadDailyChallenge().challengeStars - the merged record must already
    // be in storage or the recompute would sum against the stale
    // pre-merge challengeStars instead of the just-merged one.
    Platform.saveDailyChallenge(merged.dailyChallenge);
    Platform.recomputeTotalStars();
    if (typeof merged.sfxEnabled === 'boolean') Platform.saveSfxEnabled(merged.sfxEnabled);
    if (typeof merged.musicEnabled === 'boolean') Platform.saveMusicEnabled(merged.musicEnabled);
    if (merged.theme) Platform.saveTheme(merged.theme);
  }

  // --- 2b. pure logic: leaderboard "beat N%" ---------------------------
  //
  // See the module-level comment and GAME_DESIGN.md: the real SDK exposes
  // no "total number of entries on the board" call that this file could
  // find documented anywhere, so getLeaderboardTotalEntries() (real backend,
  // below) always returns null and this line never renders in real mode -
  // exactly the "don't fake it, show nothing" behavior the spec asked for.
  function computeBeatPercent(rank, total) {
    if (typeof rank !== 'number' || typeof total !== 'number' || total <= 0 || rank <= 0) return null;
    const beaten = Math.max(0, total - rank);
    return Math.max(0, Math.min(100, Math.round((beaten / total) * 100)));
  }

  // --- 3. real backend: the only code in this file allowed to touch
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

    function setScore(name, score) {
      if (!ysdk || !ysdk.leaderboards || typeof ysdk.leaderboards.setScore !== 'function') return Promise.resolve();
      return toPromise(ysdk.leaderboards.setScore(name, score)).catch(function () {});
    }

    function getEntries(name, options) {
      if (!ysdk || !ysdk.leaderboards || typeof ysdk.leaderboards.getEntries !== 'function') return Promise.resolve(null);
      return toPromise(ysdk.leaderboards.getEntries(name, options)).catch(function () { return null; });
    }

    // See computeBeatPercent's comment: no confirmed real-SDK call for this,
    // so the real backend always reports "unknown" rather than inventing a
    // number.
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
      leaderboards: { setScore: setScore, getEntries: getEntries, getTotalEntries: getTotalEntries },
    };
  }

  // --- 4. mock backend: used whenever window.YaGames is absent, or
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
    // Garden.yandex.debugSetAdSequence / window.GardenDebug.simulateAdSequence.
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
    // backend in tests/yandex.test.js instead.
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
    // the "server" clock here, so Garden.yandex.getServerTimeOffsetMs() ends
    // up ~0 and Platform.now() behaves exactly as it did before this feature.
    function serverTime() { return Date.now(); }

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
      leaderboards: { setScore: setScore, getEntries: getEntries, getTotalEntries: getTotalEntries },
      _setAdDelayMs: function (ms) { adDelayMs = ms; },
      _setAdSequence: function (name) { forcedAdSequence = name; },
      _forceAdErrorOnce: function () { forcedAdSequence = 'error'; }, // kept as a thin alias - see debugSimulateAdError
      _setAuthorized: function (value) { authorized = !!value; },
    };
  }

  // --- 5. orchestration -------------------------------------------------

  let backend = null;
  let initStarted = false;
  let readyFlag = false;
  let player = { authorized: false };
  let serverTimeOffsetMs = null;
  let gameplayActive = false;
  let adInProgress = false;
  let adSafetyTimeoutMs = DEFAULT_AD_SAFETY_TIMEOUT_MS;
  let pendingPauseResumeHandlers = null;
  let cloudReady = false;
  let cloudSaveTimer = null;

  let lbThrottleMs = DEFAULT_LEADERBOARD_THROTTLE_MS;
  let lbTimer = null;
  let lbPendingScore = null;
  let lbLastSentAt = 0;

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

  // Idempotent: safe to call once at boot. `onReady(mock)` fires exactly
  // once, after the backend (real or mock) is as ready as it'll get -
  // including a graceful fallback to mock if the real SDK is present but
  // its own init() rejects (offline, SDK-side error, ...), so the menu is
  // never blocked waiting on a broken SDK (per CLAUDE.md's Yandex Games
  // constraints and this feature's own spec).
  function init(onReady) {
    if (initStarted) {
      if (readyFlag && onReady) onReady(isMock());
      return;
    }
    initStarted = true;
    const win = typeof window !== 'undefined' ? window : null;
    backend = selectBackend(win);

    backend
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
        if (onReady) onReady(isMock());
      });
  }

  // Reads the backend's server time once and caches the offset from the
  // device clock (see Platform.now()'s own comment on why it's cached
  // rather than re-read on every date check) - a plain device-clock
  // fallback (offset stays/resets to null) if the backend has no
  // serverTime() at all, or it throws. Exposed (not just called from
  // init()) so tests can exercise the fallback directly against an
  // injected fake backend without needing a real window.YaGames.
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

  function getPlayerData(callback) {
    if (!backend) { callback(null); return; }
    backend.getPlayerData().then(function (data) { callback(data || null); }).catch(function () { callback(null); });
  }

  function setPlayerData(data, flush, callback) {
    if (!backend) { if (callback) callback(false); return; }
    backend.setPlayerData(data, flush).then(function (ok) { if (callback) callback(!!ok); }).catch(function () { if (callback) callback(false); });
  }

  // --- rewarded ads ---
  //
  // Single entry point for every rewarded-ad placement in the game (today,
  // only the helper "+1 charge" tap - see js/input.js). Guards: only one ad
  // open at a time (a second call while one is already open returns false
  // and touches nothing - the double-tap guard), the reward itself can only
  // ever fire once per showRewardedAd() call even if the backend's
  // onRewarded somehow fired more than once, and - the fix for a real bug
  // reported from a live Yandex Games draft (see GAME_DESIGN.md) - the
  // terminal callback (onClose/onError) is GUARANTEED to fire exactly once,
  // through exactly one path (`settle`), no matter what order the backend
  // calls things in or whether it calls them at all:
  //  - onRewarded may legitimately fire before OR after onClose (some real
  //    SDKs/ad networks signal the reward only once the overlay is already
  //    gone) - it is always still delivered to the caller whenever it
  //    actually arrives, never dropped just because `settle` already ran.
  //  - if the backend never calls onClose OR onError at all (a dropped/lost
  //    callback - the actual root cause of the live bug report: the helper
  //    button stayed input-blocked and visually stuck forever with no event
  //    left to ever clear it), a safety timeout force-settles exactly as
  //    onClose would have, so every caller's own cleanup (js/input.js:
  //    unblocking input, unmuting, resuming the timer/GameplayAPI, dropping
  //    stale focus) always eventually runs.
  function showRewardedAd(handlers) {
    handlers = handlers || {};
    if (!backend || adInProgress) return false;
    adInProgress = true;
    let rewarded = false;
    let settled = false;
    let safetyTimer = null;

    function settle(isError) {
      if (settled) return;
      settled = true;
      if (safetyTimer) {
        clearTimeout(safetyTimer);
        safetyTimer = null;
      }
      adInProgress = false;
      if (isError) {
        if (handlers.onError) handlers.onError();
      } else if (handlers.onClose) {
        // Passes along whether THIS session has rewarded SO FAR, so the
        // caller can apply an already-known reward immediately - a reward
        // that arrives LATER (after this fires) still reaches the caller
        // separately via onRewarded below, never silently dropped.
        handlers.onClose(rewarded);
      }
    }

    safetyTimer = setTimeout(function () {
      settle(false);
    }, adSafetyTimeoutMs);

    backend.showRewardedVideo({
      onOpen: function () { if (handlers.onOpen) handlers.onOpen(); },
      onRewarded: function () {
        if (rewarded) return;
        rewarded = true;
        if (handlers.onRewarded) handlers.onRewarded();
      },
      onClose: function () { settle(false); },
      onError: function () { settle(true); },
    });
    return true;
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

  function getServerTimeOffsetMs() { return serverTimeOffsetMs; }

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
  function submitScore(score) {
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

  // --- cloud save orchestration ---

  function scheduleCloudSave() {
    if (!cloudReady) return; // the next explicit flushCloudSaveNow/cloudSaveInit call will pick up any pending local writes
    if (cloudSaveTimer) return;
    cloudSaveTimer = setTimeout(function () {
      cloudSaveTimer = null;
      flushCloudSaveNow();
    }, CLOUD_SAVE_DEBOUNCE_MS);
  }

  function flushCloudSaveNow() {
    if (cloudSaveTimer) {
      clearTimeout(cloudSaveTimer);
      cloudSaveTimer = null;
    }
    if (!backend || !cloudReady) return;
    setPlayerData(buildLocalSnapshot(), true);
  }

  // Called once at boot. Fetches the cloud snapshot, merges it against a
  // FRESHLY re-read local snapshot (read right now, not an earlier captured
  // copy - minimizes, though doesn't eliminate, the race window against any
  // local write that happens during the fetch's own round trip - see
  // GAME_DESIGN.md), applies the merge locally if anything actually
  // changed, then immediately pushes the reconciled result back up so both
  // sides agree. Never blocks the menu: this always resolves (never throws
  // synchronously), and a failed fetch just leaves the player on their
  // local data, retried on the next flush.
  function cloudSaveInit(onMerged) {
    if (!backend) {
      cloudReady = true;
      if (onMerged) onMerged(false);
      return;
    }
    getPlayerData(function (cloudSnapshot) {
      const freshLocal = buildLocalSnapshot();
      const merged = mergeSnapshots(freshLocal, cloudSnapshot);
      const changed = JSON.stringify(merged) !== JSON.stringify(freshLocal);
      if (changed) applyMergedSnapshot(merged);
      cloudReady = true;
      flushCloudSaveNow();
      if (onMerged) onMerged(changed);
    });
  }

  // --- leaderboard popup (DOM glue) ---
  //
  // index.html has no slot for any of this (CLAUDE.md's hard rule for this
  // task only allows adding the SDK script tag and this one new file's own
  // script tag there) - so, same convention js/menu.js/js/render.js/
  // js/checkin.js already use for their own "no slot" additions, the button
  // and popup are built once in JS and inserted into the existing menu
  // screen. Functional hooks only, no styling: .leaderboard-btn,
  // .leaderboard-popup, .leaderboard-row, .leaderboard-me, .leaderboard-empty.
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
  // Lets tests/yandex.test.js fully control this module's behavior with an
  // injected fake backend - no window, no document, no real timers for the
  // ad delay/leaderboard throttle unless the test wants them. Never called
  // from any real game code path.
  function _configureForTests(fakeBackend, opts) {
    opts = opts || {};
    backend = fakeBackend;
    initStarted = true;
    readyFlag = true;
    player = opts.player || { authorized: false };
    serverTimeOffsetMs = null;
    gameplayActive = false;
    adInProgress = false;
    adSafetyTimeoutMs = opts.adSafetyTimeoutMs || DEFAULT_AD_SAFETY_TIMEOUT_MS;
    cloudReady = !!opts.cloudReady;
    if (cloudSaveTimer) { clearTimeout(cloudSaveTimer); cloudSaveTimer = null; }
    if (lbTimer) { clearTimeout(lbTimer); lbTimer = null; }
    lbPendingScore = null;
    lbLastSentAt = 0;
    lbThrottleMs = opts.leaderboardThrottleMs || DEFAULT_LEADERBOARD_THROTTLE_MS;
  }

  const Yandex = {
    init,
    isMock,
    isReady,
    ready,
    onPauseResume,
    gameplayStart,
    gameplayStop,
    isAuthorized,
    openAuthDialog,
    getPlayerData,
    setPlayerData,
    showRewardedAd,
    isAdInProgress,
    debugSimulateAdError,
    debugSetAdSequence,
    getServerTimeOffsetMs,
    refreshServerTimeOffset,
    submitScore,
    getLeaderboardEntries,
    getLeaderboardTotalEntries,
    computeBeatPercent,
    fetchBeatPercentForWinScreen,
    cloudSaveInit,
    scheduleCloudSave,
    flushCloudSaveNow,
    buildLocalSnapshot,
    mergeSnapshots,
    applyMergedSnapshot,
    createLeaderboardScreen,
    LEADERBOARD_NAME,
    _configureForTests,
  };

  root.Garden = root.Garden || {};
  root.Garden.yandex = Yandex;
})(typeof window !== 'undefined' ? window : globalThis);
