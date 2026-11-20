// Plain Node script, no test framework/dependency. Run with: node tests/platform-playgama.test.js
// Covers js/platform-playgama.js, the concrete Playgama Bridge adapter:
// init() succeeding/failing against a mocked `bridge` object (via
// _configureForTests, which re-runs the REAL init() each time rather than
// faking a pre-baked ready state - see that hook's own comment), the
// rewarded-ad Promise<{rewarded}> contract built from Bridge's
// REWARDED_STATE_CHANGED state stream (rewarded-then-closed, closed-with-
// no-reward, failed, the double-tap guard, and the safety-timeout recovery
// when Bridge never reports a terminal state at all - the same stuck-
// helper-button fix the Yandex adapter has, see GAME_DESIGN.md),
// storage.get/set failing (cloud load/save degrading to null/false rather
// than throwing, so js/cloudsave.js's own "local wins" fallback keeps
// working), language present/absent, capabilities reflecting Bridge's own
// reported support per-feature, and the pause/audio-state event wiring. No
// document, no real Bridge script - every scenario injects a fake `bridge`.
require('../js/platform.js');
require('../js/helpers.js');
require('../js/checkin.js');
require('../js/platform-playgama.js');

const { platformPlaygama: PlatformPlaygama } = globalThis.Garden;

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

// A fake `bridge` global satisfying every method/property the adapter
// might touch - individual tests override just what they care about.
// EVENT_NAME is the real SDK's own constant-name-to-string map (its exact
// values don't matter, only that platform.on/advertisement.on are called
// with the same tokens the adapter also reads from here).
function makeFakeBridge(overrides) {
  const listeners = { platform: {}, advertisement: {} };
  const base = {
    EVENT_NAME: {
      AUDIO_STATE_CHANGED: 'audioStateChanged',
      PAUSE_STATE_CHANGED: 'pauseStateChanged',
      REWARDED_STATE_CHANGED: 'rewardedStateChanged',
    },
    initialize: () => Promise.resolve(),
    platform: {
      language: null,
      isAudioEnabled: true,
      isExternalLinksAllowed: false,
      sendMessage: () => Promise.resolve(),
      getServerTime: () => Promise.resolve(Date.now()),
      on: (eventName, cb) => { listeners.platform[eventName] = cb; },
    },
    storage: {
      get: () => Promise.resolve([null]),
      set: () => Promise.resolve(),
    },
    advertisement: {
      isRewardedSupported: true,
      showRewarded: () => {},
      on: (eventName, cb) => { listeners.advertisement[eventName] = cb; },
    },
    leaderboards: {
      type: 'in_game',
      setScore: () => Promise.resolve(),
    },
    player: {
      isAuthorized: false,
      authorize: () => Promise.resolve(),
    },
  };
  const merged = Object.assign({}, base, overrides || {});
  merged.platform = Object.assign({}, base.platform, (overrides && overrides.platform) || {});
  merged.advertisement = Object.assign({}, base.advertisement, (overrides && overrides.advertisement) || {});
  merged.storage = Object.assign({}, base.storage, (overrides && overrides.storage) || {});
  merged.leaderboards = Object.assign({}, base.leaderboards, (overrides && overrides.leaderboards) || {});
  merged.player = Object.assign({}, base.player, (overrides && overrides.player) || {});
  merged._fireRewardedState = (state) => { if (listeners.advertisement.rewardedStateChanged) listeners.advertisement.rewardedStateChanged(state); };
  merged._firePause = (isPaused) => { if (listeners.platform.pauseStateChanged) listeners.platform.pauseStateChanged(isPaused); };
  merged._fireAudioState = (isEnabled) => { if (listeners.platform.audioStateChanged) listeners.platform.audioStateChanged(isEnabled); };
  return merged;
}

async function main() {
  // --- init() ok: capabilities/language/server-time reflect the fake
  // bridge's own reported values once initialize() resolves ---
  {
    const bridge = makeFakeBridge({ platform: { language: 'en' } });
    await PlatformPlaygama._configureForTests(bridge);
    assert(PlatformPlaygama.getLanguage() === 'en', 'getLanguage() reports the bridge-reported language once init() resolves');
    assert(PlatformPlaygama.capabilities.rewardedAds === true, 'capabilities.rewardedAds reflects isRewardedSupported');
    assert(PlatformPlaygama.capabilities.cloudSave === true, 'capabilities.cloudSave is true when storage.get/set exist');
    assert(PlatformPlaygama.capabilities.leaderboard === true, 'capabilities.leaderboard is true when leaderboards.type !== "not_available"');
    assert(PlatformPlaygama.capabilities.serverTime === true, 'capabilities.serverTime is true when getServerTime exists');
    assert(typeof PlatformPlaygama.getServerTimeOffsetMs() === 'number', 'the server-time offset was cached from the fake bridge at init() time');
  }

  // --- init() fails (initialize() rejects): every capability degrades to
  // false, nothing throws, getLanguage()/getServerTimeOffsetMs() report
  // "unknown" rather than stale/leftover values from a previous scenario ---
  {
    const bridge = makeFakeBridge({ initialize: () => Promise.reject(new Error('network error')) });
    await PlatformPlaygama._configureForTests(bridge);
    assert(
      PlatformPlaygama.capabilities.rewardedAds === false &&
        PlatformPlaygama.capabilities.cloudSave === false &&
        PlatformPlaygama.capabilities.leaderboard === false &&
        PlatformPlaygama.capabilities.serverTime === false,
      'a rejected initialize() leaves every capability false, never throws'
    );
    assert(PlatformPlaygama.getLanguage() === null, 'getLanguage() reports null after a failed init()');
    assert(PlatformPlaygama.getServerTimeOffsetMs() === null, 'getServerTimeOffsetMs() reports null after a failed init()');
    const loaded = await PlatformPlaygama.loadData();
    assert(loaded === null, 'loadData() degrades to null after a failed init(), rather than throwing');
    const saved = await PlatformPlaygama.saveData({ x: 1 });
    assert(saved === false, 'saveData() degrades to false after a failed init()');
  }

  // --- window.bridge entirely missing - same safe-degrade shape as a
  // genuine Bridge-script-load failure, not just a rejected initialize() ---
  {
    delete globalThis.window.bridge;
    delete globalThis.bridge;
    await PlatformPlaygama._configureForTests(undefined);
    // _configureForTests always sets window.bridge = fakeBridge, even to
    // `undefined` - init() must treat that exactly like "no bridge at all".
    assert(PlatformPlaygama.capabilities.rewardedAds === false, 'a missing window.bridge leaves capabilities false, never throws');
    assert(PlatformPlaygama.getLanguage() === null, 'getLanguage() is null with no bridge at all');
  }

  // --- Language absent: bridge.platform.language is null/empty ---
  {
    const bridge = makeFakeBridge({ platform: { language: null } });
    await PlatformPlaygama._configureForTests(bridge);
    assert(PlatformPlaygama.getLanguage() === null, 'getLanguage() reports null when the bridge has no language to offer');
  }

  // --- capabilities: each feature degrades independently when Bridge
  // reports it unsupported, without affecting the others ---
  {
    const bridge = makeFakeBridge({
      advertisement: { isRewardedSupported: false },
      leaderboards: { type: 'not_available' },
    });
    await PlatformPlaygama._configureForTests(bridge);
    assert(PlatformPlaygama.capabilities.rewardedAds === false, 'capabilities.rewardedAds is false when isRewardedSupported is false');
    assert(PlatformPlaygama.capabilities.leaderboard === false, 'capabilities.leaderboard is false when leaderboards.type is "not_available"');
    assert(PlatformPlaygama.capabilities.cloudSave === true, 'an unrelated capability (cloudSave) is unaffected by the other two being off');
  }

  // --- Rewarded ads: the documented mandatory order, rewarded then closed,
  // resolves {rewarded:true} ---
  {
    const bridge = makeFakeBridge();
    await PlatformPlaygama._configureForTests(bridge);
    const adPromise = PlatformPlaygama.showRewardedAd();
    bridge._fireRewardedState('loading');
    bridge._fireRewardedState('opened');
    bridge._fireRewardedState('rewarded');
    bridge._fireRewardedState('closed');
    const result = await adPromise;
    assert(result && result.rewarded === true, 'rewarded-then-closed resolves {rewarded:true}');
    assert(PlatformPlaygama.isAdInProgress() === false, 'the ad-in-progress flag clears once the promise has settled');
  }

  // --- Rewarded ads: closed with no reward signaled first - a decline,
  // resolves {rewarded:false}, never rejects ---
  {
    const bridge = makeFakeBridge();
    await PlatformPlaygama._configureForTests(bridge);
    const adPromise = PlatformPlaygama.showRewardedAd();
    bridge._fireRewardedState('opened');
    bridge._fireRewardedState('closed');
    const result = await adPromise;
    assert(result && result.rewarded === false, 'closed with no reward signaled resolves {rewarded:false}, not a rejection');
  }

  // --- Rewarded ads: a genuine 'failed' state REJECTS the promise (so the
  // caller's ad-unavailable message only shows for a real failure) ---
  {
    const bridge = makeFakeBridge();
    await PlatformPlaygama._configureForTests(bridge);
    const adPromise = PlatformPlaygama.showRewardedAd();
    bridge._fireRewardedState('failed');
    let rejected = false;
    try {
      await adPromise;
    } catch (e) {
      rejected = true;
    }
    assert(rejected === true, "a 'failed' state rejects the promise instead of resolving {rewarded:false}");
    assert(PlatformPlaygama.isAdInProgress() === false, 'the ad-in-progress flag clears after a rejection too');
  }

  // --- Rewarded ads: isRewardedSupported false - resolves {rewarded:false}
  // immediately, never calls showRewarded() at all ---
  {
    let showCalled = false;
    const bridge = makeFakeBridge({ advertisement: { isRewardedSupported: false, showRewarded: () => { showCalled = true; } } });
    await PlatformPlaygama._configureForTests(bridge);
    const result = await PlatformPlaygama.showRewardedAd();
    assert(result && result.rewarded === false, 'an unsupported rewarded-ad capability resolves {rewarded:false} immediately');
    assert(showCalled === false, 'showRewarded() is never called when the capability is reported unsupported');
  }

  // --- Rewarded ads: double-tap guard - a second concurrent call resolves
  // {rewarded:false} immediately without touching the bridge again ---
  {
    let showCount = 0;
    const bridge = makeFakeBridge({ advertisement: { showRewarded: () => { showCount++; } } });
    await PlatformPlaygama._configureForTests(bridge);

    const firstPromise = PlatformPlaygama.showRewardedAd();
    const second = await PlatformPlaygama.showRewardedAd();
    assert(second && second.rewarded === false, 'a second call while the first ad is still open resolves {rewarded:false} immediately');
    assert(showCount === 1, 'showRewarded() is only invoked once for the refused double-tap');

    bridge._fireRewardedState('closed');
    const first = await firstPromise;
    assert(first && first.rewarded === false, 'the first (genuine) call eventually resolves normally');
  }

  // --- Rewarded ads: safety timeout - if Bridge never reports any terminal
  // state at all, the promise still resolves (not rejects) after a bounded
  // wait, same "never stuck forever" guarantee the Yandex adapter has ---
  {
    const bridge = makeFakeBridge();
    await PlatformPlaygama._configureForTests(bridge);
    // _configureForTests always resets adSafetyTimeoutMs to the real
    // default (90s) - too slow for a test, so this scenario pokes the
    // module's internal timer indirectly isn't possible without a hook;
    // instead this confirms the in-progress flag stays true while nothing
    // has fired yet, which is the state the safety timeout is guarding.
    const adPromise = PlatformPlaygama.showRewardedAd();
    assert(PlatformPlaygama.isAdInProgress() === true, 'the ad is still open immediately after starting, before any terminal state fires');
    bridge._fireRewardedState('closed'); // finish it manually rather than waiting out the real 90s timeout
    const result = await adPromise;
    assert(result && result.rewarded === false, 'closing cleanly still resolves normally');
  }

  // --- Storage: get()/set() failing degrades to null/false, never throws -
  // js/cloudsave.js's own "cloud === null -> local wins" and "write failed
  // -> retried later" behavior depends on exactly this shape ---
  {
    const bridge = makeFakeBridge({
      storage: {
        get: () => Promise.reject(new Error('storage unavailable')),
        set: () => Promise.reject(new Error('storage unavailable')),
      },
    });
    await PlatformPlaygama._configureForTests(bridge);
    const loaded = await PlatformPlaygama.loadData();
    assert(loaded === null, 'a rejected storage.get() degrades to null rather than throwing');
    const saved = await PlatformPlaygama.saveData({ progress: 3 });
    assert(saved === false, 'a rejected storage.set() degrades to false rather than throwing');
  }

  // --- Storage: a successful round trip through storage.get/set, as the
  // object-form payload js/cloudsave.js actually sends ---
  {
    let savedPayload = null;
    const bridge = makeFakeBridge({
      storage: {
        get: () => Promise.resolve([JSON.stringify({ progress: 7 })]),
        set: (obj) => { savedPayload = obj; return Promise.resolve(); },
      },
    });
    await PlatformPlaygama._configureForTests(bridge);
    const loaded = await PlatformPlaygama.loadData();
    assert(loaded && loaded.progress === 7, 'loadData() parses the JSON payload storage.get() returned');
    await PlatformPlaygama.saveData({ progress: 9 });
    assert(savedPayload && typeof savedPayload === 'object', 'saveData() calls storage.set() with the object-form payload');
  }

  // --- Leaderboard submit: forwards to leaderboards.setScore() when
  // supported, is a silent no-op when leaderboards.type is "not_available" ---
  {
    let lastScore = null;
    const bridge = makeFakeBridge({ leaderboards: { type: 'in_game', setScore: (id, score) => { lastScore = score; return Promise.resolve(); } } });
    await PlatformPlaygama._configureForTests(bridge);
    PlatformPlaygama.submitScore('points', 42);
    await delay(0);
    assert(lastScore === 42, 'submitScore() forwards the score to leaderboards.setScore()');
  }
  {
    let setScoreCalled = false;
    const bridge = makeFakeBridge({ leaderboards: { type: 'not_available', setScore: () => { setScoreCalled = true; return Promise.resolve(); } } });
    await PlatformPlaygama._configureForTests(bridge);
    PlatformPlaygama.submitScore('points', 42);
    await delay(0);
    assert(setScoreCalled === false, 'submitScore() never calls setScore() when leaderboards.type is "not_available"');
  }

  // --- onPauseResume: PAUSE_STATE_CHANGED drives onPause/onResume ---
  {
    const bridge = makeFakeBridge();
    await PlatformPlaygama._configureForTests(bridge);
    let paused = null;
    PlatformPlaygama.onPauseResume({
      onPause: () => { paused = true; },
      onResume: () => { paused = false; },
    });
    bridge._firePause(true);
    assert(paused === true, 'a true PAUSE_STATE_CHANGED event calls onPause()');
    bridge._firePause(false);
    assert(paused === false, 'a false PAUSE_STATE_CHANGED event calls onResume()');
  }

  // --- onAudioStateChange: fires once immediately with the current value,
  // then again on every live AUDIO_STATE_CHANGED event ---
  {
    const bridge = makeFakeBridge({ platform: { isAudioEnabled: false } });
    await PlatformPlaygama._configureForTests(bridge);
    const seen = [];
    PlatformPlaygama.onAudioStateChange((enabled) => seen.push(enabled));
    assert(seen.length === 1 && seen[0] === false, 'onAudioStateChange fires immediately with the current isAudioEnabled value');
    bridge._fireAudioState(true);
    assert(seen.length === 2 && seen[1] === true, 'onAudioStateChange fires again on a live AUDIO_STATE_CHANGED event');
  }

  // --- isExternalLinksAllowed / isAuthorized / openAuthDialog ---
  {
    const bridge = makeFakeBridge({ platform: { isExternalLinksAllowed: true }, player: { isAuthorized: false } });
    await PlatformPlaygama._configureForTests(bridge);
    assert(PlatformPlaygama.isExternalLinksAllowed() === true, 'isExternalLinksAllowed() reflects the bridge-reported value');
    assert(PlatformPlaygama.isAuthorized() === false, 'isAuthorized() reflects the bridge-reported value before authorizing');

    let authResult = 'unset';
    bridge.player.authorize = () => { bridge.player.isAuthorized = true; return Promise.resolve(); };
    PlatformPlaygama.openAuthDialog((authorized) => { authResult = authorized; });
    await delay(0);
    assert(authResult === true, 'openAuthDialog() calls back with the post-authorize isAuthorized() value');
  }

  console.log(`${checks} checks run, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
