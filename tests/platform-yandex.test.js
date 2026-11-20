// Plain Node script, no test framework/dependency. Run with: node tests/platform-yandex.test.js
// Covers js/platform-yandex.js, the concrete Yandex adapter: the rewarded-
// ad Promise<{rewarded}> contract (resolve with/without a reward, reject on
// a genuine error, a reward signaled AFTER the ad already closed within
// and beyond the bounded grace window, the double-tap guard, and the
// safety-timeout recovery when the backend never calls a terminal callback
// at all - the stuck-helper-button bug reported from a live Yandex Games
// draft, see GAME_DESIGN.md), the server-time offset and its device-clock
// fallback (including js/platform.js's Platform.now() own integration via
// a minimal fake Garden.platformAdapter), getLanguage (real mock-mode
// ?lang= reading, and the fallback-to-null shape), the leaderboard
// submit-score throttle, and the not-authorized flow never nagging
// automatically. Every scenario uses an injected fake backend
// (PlatformYandex._configureForTests) - no document, no real SDK.
require('../js/platform.js');
require('../js/helpers.js');
require('../js/checkin.js');
require('../js/platform-yandex.js');

const { platform: Platform, platformYandex: PlatformYandex } = globalThis.Garden;

let failures = 0;
let checks = 0;

function assert(condition, message) {
  checks++;
  if (!condition) {
    failures++;
    console.error('FAIL: ' + message);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function flush() {
  return delay(0);
}

// A fake backend satisfying every method PlatformYandex might call on it -
// individual tests override just the methods they care about.
function makeFakeBackend(overrides) {
  return Object.assign(
    {
      isMock: true,
      init: () => Promise.resolve(),
      ready: () => {},
      gameplayStart: () => {},
      gameplayStop: () => {},
      on: () => {},
      isAvailableMethod: () => Promise.resolve(true),
      getPlayer: () => Promise.resolve({ authorized: false }),
      openAuthDialog: () => Promise.resolve(),
      getPlayerData: () => Promise.resolve(null),
      setPlayerData: () => Promise.resolve(true),
      showRewardedVideo: (callbacks) => { if (callbacks.onError) callbacks.onError(); },
      serverTime: () => Date.now(),
      language: () => null,
      leaderboards: {
        setScore: () => Promise.resolve(),
        getEntries: () => Promise.resolve(null),
        getTotalEntries: () => null,
      },
    },
    overrides || {}
  );
}

async function main() {
  // --- getLanguage: real mock-mode ?lang= reading, via a genuine init()
  // call (no window.YaGames, so the mock backend is selected for real -
  // not a fake stand-in) - this MUST run before anything else touches
  // _configureForTests, since init() is memoized (and _configureForTests
  // itself pre-resolves that memo) for the whole lifetime of this module. ---
  {
    globalThis.location = { search: '?lang=tr' };
    await PlatformYandex.init();
    assert(PlatformYandex.getLanguage() === 'tr', 'the real mock backend reads ?lang= from the URL');
    delete globalThis.location;
  }

  // --- Rewarded ads: resolves {rewarded:true} when onRewarded fired
  // before close, idempotent even if the backend fires onRewarded twice ---
  {
    const backend = makeFakeBackend({
      showRewardedVideo: (callbacks) => {
        callbacks.onOpen();
        callbacks.onRewarded();
        callbacks.onRewarded(); // simulated backend quirk - must never double-anything
        callbacks.onClose();
      },
    });
    PlatformYandex._configureForTests(backend);
    const result = await PlatformYandex.showRewardedAd();
    assert(result && result.rewarded === true, 'resolves {rewarded:true} after a genuine reward');
    assert(PlatformYandex.isAdInProgress() === false, 'the ad-in-progress flag clears once the promise has settled');
  }

  // --- No reward on an early close (player backed out without finishing) ---
  {
    const backend = makeFakeBackend({
      showRewardedVideo: (callbacks) => { callbacks.onOpen(); callbacks.onClose(); },
    });
    PlatformYandex._configureForTests(backend);
    const result = await PlatformYandex.showRewardedAd();
    assert(result && result.rewarded === false, 'resolves {rewarded:false} on a close with no reward signaled, with no artificial delay');
  }

  // --- A genuine SDK error REJECTS the promise (so the caller's "ad
  // unavailable" message only shows for a real error, never a plain
  // decline) ---
  {
    const backend = makeFakeBackend({
      showRewardedVideo: (callbacks) => { callbacks.onOpen(); callbacks.onError(); },
    });
    PlatformYandex._configureForTests(backend);
    let rejected = false;
    try {
      await PlatformYandex.showRewardedAd();
    } catch (e) {
      rejected = true;
    }
    assert(rejected === true, 'a genuine ad error rejects the promise instead of resolving {rewarded:false}');
    assert(PlatformYandex.isAdInProgress() === false, 'the ad-in-progress flag clears after a rejection too');
  }

  // --- Reward signaled AFTER the ad has already closed, WITHIN the grace
  // window - still caught and resolved as rewarded, not dropped ---
  {
    const backend = makeFakeBackend({
      showRewardedVideo: (callbacks) => {
        callbacks.onOpen();
        callbacks.onClose();
        setTimeout(() => callbacks.onRewarded(), 10);
      },
    });
    PlatformYandex._configureForTests(backend, { rewardGraceMs: 200 });
    const result = await PlatformYandex.showRewardedAd();
    assert(result && result.rewarded === true, 'a reward arriving shortly after close, within the grace window, is still caught');
  }

  // --- Reward signaled AFTER the ad has already closed, BEYOND the grace
  // window - a documented, bounded limitation: the promise has already
  // resolved by then, so the late reward can no longer change the result ---
  {
    const backend = makeFakeBackend({
      showRewardedVideo: (callbacks) => {
        callbacks.onOpen();
        callbacks.onClose();
        setTimeout(() => callbacks.onRewarded(), 80);
      },
    });
    PlatformYandex._configureForTests(backend, { rewardGraceMs: 20 });
    const result = await PlatformYandex.showRewardedAd();
    assert(result && result.rewarded === false, 'a reward arriving AFTER the bounded grace window has already elapsed is not caught (documented trade-off)');
  }

  // --- Safety timeout: if the backend never calls onClose, onError, OR
  // onRewarded at all, the promise still resolves (not rejects) after a
  // bounded wait - the actual root cause of the live bug report (the
  // helper button stayed input-blocked with no event ever left to release
  // it) ---
  {
    const backend = makeFakeBackend({
      showRewardedVideo: (callbacks) => { callbacks.onOpen(); /* then nothing, ever */ },
    });
    PlatformYandex._configureForTests(backend, { adSafetyTimeoutMs: 20 });
    let settled = null;
    PlatformYandex.showRewardedAd().then((r) => { settled = r; });
    assert(PlatformYandex.isAdInProgress() === true, 'the ad is still open immediately after starting, before the safety timeout fires');
    await delay(60);
    assert(settled && settled.rewarded === false, 'the safety timeout force-resolves {rewarded:false} instead of staying stuck forever');
    assert(PlatformYandex.isAdInProgress() === false, 'the ad-in-progress flag is cleared once the safety timeout force-resolves it');
  }

  // --- Double-tap guard: a second concurrent call resolves {rewarded:false}
  // immediately without touching the backend again; a later call succeeds
  // once the first has genuinely finished ---
  {
    let showCount = 0;
    let captured = null;
    const backend = makeFakeBackend({
      showRewardedVideo: (callbacks) => { showCount++; captured = callbacks; }, // deliberately never resolves on its own
    });
    PlatformYandex._configureForTests(backend);

    const firstPromise = PlatformYandex.showRewardedAd();
    const second = await PlatformYandex.showRewardedAd();
    assert(second && second.rewarded === false, 'a second call while the first ad is still open resolves {rewarded:false} immediately');
    assert(showCount === 1, "the backend's showRewardedVideo is only ever invoked once for the refused double-tap");

    captured.onClose();
    const first = await firstPromise;
    assert(first && first.rewarded === false, 'the first (genuine) call eventually resolves normally');

    const third = await PlatformYandex.showRewardedAd();
    assert(showCount === 2, 'the backend is invoked again for a genuinely new call once the previous ad has actually closed');
    void third;
  }

  // --- Server-time offset: cached from the backend, with a device-clock
  // fallback (and js/platform.js's Platform.now() reflecting it via a
  // minimal fake Garden.platformAdapter - the real facade is covered
  // separately in tests/platform-adapter.test.js) ---
  {
    const futureMs = Date.now() + 100000;
    PlatformYandex._configureForTests(makeFakeBackend({ serverTime: () => futureMs }));
    PlatformYandex.refreshServerTimeOffset();
    const offset = PlatformYandex.getServerTimeOffsetMs();
    assert(typeof offset === 'number' && Math.abs(offset - 100000) < 1000, `server-time offset is cached from the backend (got ${offset})`);

    globalThis.Garden.platformAdapter = { getServerTimeOffsetMs: () => PlatformYandex.getServerTimeOffsetMs() };
    const nowViaPlatform = Platform.now().getTime();
    assert(Math.abs(nowViaPlatform - futureMs) < 2000, 'Platform.now() reflects the cached server-time offset via Garden.platformAdapter');

    PlatformYandex._configureForTests(makeFakeBackend({ serverTime: () => { throw new Error('unavailable'); } }));
    PlatformYandex.refreshServerTimeOffset();
    assert(PlatformYandex.getServerTimeOffsetMs() === null, 'a throwing/unavailable serverTime() falls back to null (device clock)');
    const nowFallback = Platform.now().getTime();
    assert(Math.abs(nowFallback - Date.now()) < 2000, 'Platform.now() falls back to the device clock when no server offset is available');
    delete globalThis.Garden.platformAdapter;
  }

  // --- getLanguage: the null fallback through a fake backend (the real
  // mock-mode ?lang= reading is covered at the very top of this file) ---
  {
    PlatformYandex._configureForTests(makeFakeBackend({ language: () => null }));
    assert(PlatformYandex.getLanguage() === null, 'getLanguage() reports null when the backend has none to offer');
  }

  // --- Leaderboard throttle: max 1 request per second-ish window, only the
  // latest queued value actually gets sent ---
  {
    const sentScores = [];
    const backend = makeFakeBackend({
      leaderboards: { setScore: (name, score) => { sentScores.push(score); return Promise.resolve(); }, getEntries: () => Promise.resolve(null), getTotalEntries: () => null },
    });
    PlatformYandex._configureForTests(backend, { player: { authorized: true }, leaderboardThrottleMs: 40 });

    PlatformYandex.submitScore('points', 10);
    await flush();
    assert(sentScores.length === 1 && sentScores[0] === 10, 'the first call sends immediately when idle');

    PlatformYandex.submitScore('points', 20);
    PlatformYandex.submitScore('points', 30);
    await flush();
    assert(sentScores.length === 1, 'rapid-fire calls inside the throttle window are not sent yet');

    await delay(70);
    assert(sentScores.length === 2 && sentScores[1] === 30, `exactly one trailing send fires with only the LATEST value (got ${JSON.stringify(sentScores)})`);
  }

  // --- submitScore is a no-op entirely when not authorized ---
  {
    const sentScores = [];
    const backend = makeFakeBackend({
      leaderboards: { setScore: (name, score) => { sentScores.push(score); return Promise.resolve(); }, getEntries: () => Promise.resolve(null), getTotalEntries: () => null },
    });
    PlatformYandex._configureForTests(backend, { player: { authorized: false }, leaderboardThrottleMs: 40 });
    PlatformYandex.submitScore('points', 999);
    await flush();
    await delay(70);
    assert(sentScores.length === 0, 'submitScore never queues/sends anything while the player is not authorized');
  }

  // --- Not-authorized flow: prompts exactly once per explicit call, never
  // nags again on its own after a decline, and prompts again on a fresh
  // explicit call ---
  {
    let authCalls = 0;
    let authorizedAfterDialog = false;
    const backend = makeFakeBackend({
      openAuthDialog: () => { authCalls++; return Promise.resolve(); },
      getPlayer: () => Promise.resolve({ authorized: authorizedAfterDialog }),
    });
    PlatformYandex._configureForTests(backend, { player: { authorized: false } });

    let firstResult = 'unset';
    PlatformYandex.openAuthDialog((authorized) => { firstResult = authorized; });
    await flush();
    assert(authCalls === 1, 'an explicit call prompts the auth dialog exactly once');
    assert(firstResult === false, 'declining (still unauthorized after the dialog closes) reports false');
    assert(PlatformYandex.isAuthorized() === false, 'isAuthorized() reflects the decline');

    await delay(30);
    assert(authCalls === 1, 'a decline is never automatically re-prompted on its own');

    authorizedAfterDialog = true;
    let secondResult = 'unset';
    PlatformYandex.openAuthDialog((authorized) => { secondResult = authorized; });
    await flush();
    assert(authCalls === 2, 'a fresh explicit call prompts again - a past decline never blocks it');
    assert(secondResult === true, 'accepting reports true');
    assert(PlatformYandex.isAuthorized() === true, 'isAuthorized() reflects the acceptance');
  }

  console.log(`${checks} checks run, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
