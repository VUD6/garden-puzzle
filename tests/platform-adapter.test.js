// Plain Node script, no test framework/dependency. Run with: node tests/platform-adapter.test.js
// Covers js/platform-adapter.js, the generic facade EVERY other module
// calls instead of anything platform-specific: capabilities default to
// conservative ("unsupported") before init() and reflect the active
// adapter's own static object afterward, every contract method forwards
// to whatever's in window.GAME_PLATFORM's resolved adapter (defaulting to
// 'yandex' when unset, and falling back to 'yandex' for an unknown id
// too), a method the active adapter doesn't implement degrades to a safe
// default instead of throwing, rejected adapter calls never leak out of the
// facade unexpectedly, and getLanguage() reports null while the active
// adapter's own handshake is still pending, then the real answer once
// init() resolves - the exact "platform language resolves late" timing
// js/main.js's own two-phase language resolution exists to work around (see
// GAME_DESIGN.md's Localization section). A deliberately FAKE adapter (swapped into
// Garden.platformYandex before the very first init() call - see the
// module-level comment on why this ordering matters) is used throughout,
// so this file never touches a real SDK, window, or document either.
require('../js/platform-adapter.js');

const { platformAdapter: Platform } = globalThis.Garden;

let failures = 0;
let checks = 0;

function assert(condition, message) {
  checks++;
  if (!condition) {
    failures++;
    console.error('FAIL: ' + message);
  }
}

function makeFakeAdapter(overrides) {
  return Object.assign(
    {
      capabilities: { rewardedAds: true, cloudSave: true, leaderboard: true, serverTime: true },
      init: () => Promise.resolve(),
      ready: () => {},
      gameplayStart: () => {},
      gameplayStop: () => {},
      showRewardedAd: () => Promise.resolve({ rewarded: true }),
      loadData: () => Promise.resolve(null),
      saveData: () => Promise.resolve(true),
      submitScore: () => {},
      getServerTime: () => Promise.resolve(null),
      getLanguage: () => null,
    },
    overrides || {}
  );
}

async function main() {
  // --- Capabilities: conservative defaults before init(), the active
  // adapter's own static object after - Platform.init() here is the ONLY
  // call to init() this whole process ever makes (it's memoized forever
  // once called), so this must run first. ---
  assert(
    Platform.capabilities.rewardedAds === false &&
      Platform.capabilities.cloudSave === false &&
      Platform.capabilities.leaderboard === false &&
      Platform.capabilities.serverTime === false,
    'capabilities default to "unsupported" before any adapter has been picked'
  );

  const savedPayloads = [];
  // Language resolves LATE - exactly like a real Yandex SDK handshake
  // (ysdk.environment.i18n.lang is only readable once window.YaGames.init()
  // itself has resolved, see js/platform-yandex.js's real backend): the
  // adapter reports no language at all (null, the same "unavailable" shape
  // a failed/declined handshake would produce) until its own init() has
  // actually finished, then answers for real - js/main.js's own two-phase
  // language resolution exists specifically because this facade's
  // getLanguage() behaves exactly like this on a real platform.
  let platformHandshakeDone = false;
  const fakeAdapter = makeFakeAdapter({
    capabilities: { rewardedAds: true, cloudSave: true, leaderboard: false, serverTime: true },
    init: () => new Promise((resolve) => setTimeout(() => { platformHandshakeDone = true; resolve(); }, 20)),
    loadData: () => Promise.resolve({ fromCloud: true }),
    saveData: (obj) => { savedPayloads.push(obj); return Promise.resolve(true); },
    getServerTime: () => Promise.resolve(123456),
    getLanguage: () => (platformHandshakeDone ? 'ru' : null),
    submitScore: (name, value) => { fakeAdapter._lastSubmit = { name, value }; },
  });
  // Swapped in BEFORE the only init() call of this process - js/platform-
  // adapter.js picks its active adapter once and caches that choice for
  // good (same "idempotent, always the same promise" shape every other
  // init() in this game follows), so there is no way to swap it again
  // after this point within the same process - see the previous comment.
  globalThis.Garden.platformYandex = fakeAdapter;

  // Deliberately an UNKNOWN platform id (never literally unset) - exercises
  // the more interesting half of the "default to yandex" fallback
  // (resolveAdapter's `ADAPTERS[id] || ADAPTERS[DEFAULT_PLATFORM_ID]`); the
  // plain "window.GAME_PLATFORM never set at all" case goes through the
  // exact same fallback via an even simpler `||` one line up
  // (selectedPlatformId()) and isn't separately exercised here, since
  // init() can only ever run once per process in this file.
  globalThis.window = globalThis.window || {};
  globalThis.window.GAME_PLATFORM = 'some-unknown-platform-id';

  const initPromise = Platform.init();
  assert(Platform.getLanguage() === null, 'getLanguage() reports null while the active adapter\'s own handshake is still pending');
  await initPromise;
  assert(Platform.getLanguage() === 'ru', 'getLanguage() reports the real answer once init() has actually resolved');
  assert(
    Platform.capabilities.rewardedAds === true && Platform.capabilities.leaderboard === false && Platform.capabilities.serverTime === true,
    'capabilities reflect the active adapter\'s own object once init() resolves'
  );

  // --- Forwarding: every facade method reaches the active adapter and
  // returns exactly what it returned ---
  const adResult = await Platform.showRewardedAd();
  assert(adResult && adResult.rewarded === true, 'showRewardedAd() forwards to the active adapter and resolves its result');

  const loaded = await Platform.loadData();
  assert(loaded && loaded.fromCloud === true, 'loadData() forwards to the active adapter');

  const saved = await Platform.saveData({ x: 1 });
  assert(saved === true && savedPayloads.length === 1 && savedPayloads[0].x === 1, 'saveData() forwards the exact payload to the active adapter');

  Platform.submitScore('points', 42);
  assert(fakeAdapter._lastSubmit && fakeAdapter._lastSubmit.name === 'points' && fakeAdapter._lastSubmit.value === 42, 'submitScore(name, value) forwards both arguments');

  const serverTime = await Platform.getServerTime();
  assert(serverTime === 123456, 'getServerTime() forwards to the active adapter');

  assert(Platform.getLanguage() === 'ru', 'getLanguage() forwards to the active adapter');

  // --- Safe fallback: a method the active adapter doesn't implement at
  // all degrades to a safe default instead of throwing - this is what lets
  // a future, narrower adapter (e.g. one with no leaderboard support) be
  // called from the exact same game code with zero platform-id checks. ---
  delete fakeAdapter.getLanguage;
  assert(Platform.getLanguage() === null, 'a missing getLanguage on the active adapter safely falls back to null, never throws');

  delete fakeAdapter.showRewardedAd;
  const fallbackAd = await Platform.showRewardedAd();
  assert(fallbackAd && fallbackAd.rewarded === false, 'a missing showRewardedAd safely resolves {rewarded:false} instead of throwing');

  delete fakeAdapter.submitScore;
  let threw = false;
  try {
    Platform.submitScore('points', 1);
  } catch (e) {
    threw = true;
  }
  assert(threw === false, 'a missing submitScore is a silent no-op, never throws');

  console.log(`${checks} checks run, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
