// Plain Node script, no test framework/dependency. Run with: node tests/yandex.test.js
// Covers js/yandex.js: the cloud-save merge policy (several conflict cases
// plus the cross-device idempotent-daily-claim guard), the rewarded-ad
// callback state machine (reward granted only on onRewarded, no reward on
// error/an early close, the double-tap guard), the server-time offset and
// its device-clock fallback (including Platform.now()'s own integration),
// the leaderboard submit-score throttle, and the not-authorized flow never
// nagging automatically. Every scenario here uses an injected fake backend
// (Yandex._configureForTests) - no window, no document, no real SDK.
function makeMemoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

function resetStorage() {
  globalThis.localStorage = makeMemoryStorage();
}

resetStorage();
require('../js/platform.js');
require('../js/helpers.js');
require('../js/checkin.js');
require('../js/yandex.js');

const { platform: Platform, checkin: Checkin, yandex: Yandex } = globalThis.Garden;

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

// Lets any already-resolved/resolving Promise chains (e.g. checkAvailable's
// Promise.resolve(true).then(...)) actually run before the next assertion.
function flush() {
  return delay(0);
}

function freshDailyGift(overrides) {
  return Object.assign({ lastClaimDate: null, lastSeenDate: null, position: 0, plan: null }, overrides || {});
}

function freshDailyChallenge(overrides) {
  return Object.assign({ lastSeenDate: null, lastRewardDate: null, challengeStars: 0 }, overrides || {});
}

function baseSnapshot(overrides) {
  return Object.assign(
    {
      progress: 1,
      highestLevel: 1,
      totalScore: 0,
      bestTimes: {},
      bestStars: {},
      bestWinStreak: 0,
      winStreak: 0,
      helperCharges: { finder: 5, random: 5, snowman: 0 },
      dailyGift: freshDailyGift(),
      dailyChallenge: freshDailyChallenge(),
      sfxEnabled: true,
      musicEnabled: true,
      theme: 'winter',
      savedAt: 0,
    },
    overrides || {}
  );
}

// A fake backend satisfying every method Garden.yandex might call on it -
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
  // --- Merge policy: max-group fields ---
  {
    const local = baseSnapshot({ progress: 5, highestLevel: 5, totalScore: 100, bestWinStreak: 3, savedAt: 1000 });
    const cloud = baseSnapshot({ progress: 9, highestLevel: 7, totalScore: 40, bestWinStreak: 8, savedAt: 500 });
    const merged = Yandex.mergeSnapshots(local, cloud);
    assert(merged.progress === 9, 'progress merges via max (cloud ahead)');
    assert(merged.highestLevel === 7, 'highestLevel merges via max (cloud ahead)');
    assert(merged.totalScore === 100, 'totalScore merges via max (local ahead)');
    assert(merged.bestWinStreak === 8, 'bestWinStreak merges via max regardless of savedAt side');
  }

  // --- Merge policy: per-level best times (min) / best stars (max) ---
  {
    const local = baseSnapshot({ bestTimes: { 3: 40, 5: 20 }, bestStars: { 3: 2, 5: 3 } });
    const cloud = baseSnapshot({ bestTimes: { 3: 25, 7: 60 }, bestStars: { 3: 3, 7: 1 } });
    const merged = Yandex.mergeSnapshots(local, cloud);
    assert(merged.bestTimes[3] === 25, 'best time at a level present on both sides takes the min');
    assert(merged.bestTimes[5] === 20, 'best time present only locally is kept as-is');
    assert(merged.bestTimes[7] === 60, 'best time present only in the cloud is kept as-is');
    assert(merged.bestStars[3] === 3, 'best stars at a level present on both sides takes the max');
    assert(merged.bestStars[5] === 3, 'best stars present only locally is kept as-is');
    assert(merged.bestStars[7] === 1, 'best stars present only in the cloud is kept as-is');
  }

  // --- Merge policy: savedAt-group wholesale pick, both directions ---
  {
    const local = baseSnapshot({
      savedAt: 2000,
      helperCharges: { finder: 1, random: 1, snowman: 1 },
      winStreak: 4,
      sfxEnabled: false,
      musicEnabled: false,
      theme: 'garden',
    });
    const cloud = baseSnapshot({
      savedAt: 1000,
      helperCharges: { finder: 9, random: 9, snowman: 9 },
      winStreak: 7,
      sfxEnabled: true,
      musicEnabled: true,
      theme: 'winter',
    });
    const mergedLocalNewer = Yandex.mergeSnapshots(local, cloud);
    assert(mergedLocalNewer.helperCharges.finder === 1, 'helper charges come wholesale from the newer-savedAt side (local here)');
    assert(mergedLocalNewer.winStreak === 4, 'the live win-streak counter comes from the newer-savedAt side (local here)');
    assert(mergedLocalNewer.theme === 'garden', 'settings come from the newer-savedAt side (local here)');

    const mergedCloudNewer = Yandex.mergeSnapshots(Object.assign({}, local, { savedAt: 500 }), cloud);
    assert(mergedCloudNewer.helperCharges.finder === 9, 'helper charges come wholesale from the newer-savedAt side (cloud here)');
    assert(mergedCloudNewer.winStreak === 7, 'the live win-streak counter comes from the newer-savedAt side (cloud here)');
    assert(mergedCloudNewer.theme === 'winter', 'settings come from the newer-savedAt side (cloud here)');
  }

  // --- Merge policy: daily-challenge challengeStars is its OWN max-group
  // field, independent of which side wins the rest of that same record ---
  {
    const local = baseSnapshot({ savedAt: 2000, dailyChallenge: freshDailyChallenge({ challengeStars: 2, lastSeenDate: '2024-05-01' }) });
    const cloud = baseSnapshot({ savedAt: 1000, dailyChallenge: freshDailyChallenge({ challengeStars: 9, lastSeenDate: '2024-04-01' }) });
    const merged = Yandex.mergeSnapshots(local, cloud);
    assert(merged.dailyChallenge.challengeStars === 9, 'challengeStars merges via max even though local otherwise wins the savedAt side');
    assert(merged.dailyChallenge.lastSeenDate === '2024-05-01', 'the rest of the dailyChallenge record still comes from the newer-savedAt side');
  }

  // --- Merge policy: a claim/reward date can NEVER regress across a merge,
  // even when that side loses the savedAt comparison - the exact guard
  // against claiming the same day's reward twice on two devices ---
  {
    // Device A claims today (savedAt=2000, later real write) but somehow
    // ends up with an OLDER lastClaimDate than device B's (e.g. B claimed a
    // later calendar day while offline, then synced after A). The merge
    // must still keep B's later claim date, not roll it back.
    const local = baseSnapshot({ savedAt: 2000, dailyGift: freshDailyGift({ lastClaimDate: '2024-05-01', position: 3 }) });
    const cloud = baseSnapshot({ savedAt: 1000, dailyGift: freshDailyGift({ lastClaimDate: '2024-05-03', position: 5 }) });
    const merged = Yandex.mergeSnapshots(local, cloud);
    assert(merged.dailyGift.lastClaimDate === '2024-05-03', 'the later claim date always wins, even from the savedAt-losing side');
    assert(merged.dailyGift.position === 3, 'every OTHER field of the daily-gift record still comes from the savedAt-winning side');

    const localChallenge = baseSnapshot({ savedAt: 2000, dailyChallenge: freshDailyChallenge({ lastRewardDate: '2024-05-01' }) });
    const cloudChallenge = baseSnapshot({ savedAt: 1000, dailyChallenge: freshDailyChallenge({ lastRewardDate: '2024-05-03' }) });
    const mergedChallenge = Yandex.mergeSnapshots(localChallenge, cloudChallenge);
    assert(mergedChallenge.dailyChallenge.lastRewardDate === '2024-05-03', 'same later-date guard for the daily-challenge reward date');
  }

  // --- Idempotent daily claim across devices: once merged, the resulting
  // record can never be claimed a second time for the same day ---
  {
    const todayKey = '2024-06-10';
    // Device A claims today at cycle position 3; device B, slightly later
    // in wall-clock terms but with a stale pre-claim view, tries to use the
    // merged record afterward.
    const local = baseSnapshot({ savedAt: 5000, dailyGift: { lastClaimDate: todayKey, lastSeenDate: todayKey, position: 3, plan: null } });
    const cloud = baseSnapshot({ savedAt: 4000, dailyGift: { lastClaimDate: todayKey, lastSeenDate: todayKey, position: 3, plan: null } });
    const merged = Yandex.mergeSnapshots(local, cloud);
    const claimAttempt = Checkin.computeClaim(merged.dailyGift, todayKey);
    assert(claimAttempt.available === false, 'a merged record for a day already claimed on both sides can never be claimed again');
  }

  // --- cloud === null: local wins outright, nothing to reconcile ---
  {
    const local = baseSnapshot({ progress: 12 });
    assert(Yandex.mergeSnapshots(local, null) === local, 'merging against no cloud data at all returns the local snapshot unchanged');
  }

  // --- buildLocalSnapshot / applyMergedSnapshot round-trip through real
  // Garden.platform storage, including totalStars recomputation ---
  {
    resetStorage();
    Platform.saveProgress(4);
    Platform.saveHighestLevel(4);
    Platform.saveBestTime(1, 50);
    Platform.saveBestStars(1, 2);
    Platform.saveBestStars(2, 1);
    const localSnap = Yandex.buildLocalSnapshot();
    assert(localSnap.bestTimes[1] === 50, 'buildLocalSnapshot picks up per-level best times via the level index');
    assert(localSnap.bestStars[1] === 2 && localSnap.bestStars[2] === 1, 'buildLocalSnapshot picks up per-level best stars via the level index');

    const cloudSnap = baseSnapshot({
      progress: 20,
      highestLevel: 20,
      bestTimes: { 1: 30, 3: 10 },
      bestStars: { 1: 3, 3: 3 },
      dailyChallenge: freshDailyChallenge({ challengeStars: 4 }),
      savedAt: localSnap.savedAt + 1, // cloud wins the savedAt-group this time
    });
    const merged = Yandex.mergeSnapshots(localSnap, cloudSnap);
    Yandex.applyMergedSnapshot(merged);

    assert(Platform.loadProgress() === 20, 'applyMergedSnapshot writes the merged progress');
    assert(Platform.loadBestTime(1) === 30, 'applyMergedSnapshot writes the merged (min) best time for a level present on both sides');
    assert(Platform.loadBestTime(3) === 10, 'applyMergedSnapshot writes a best time present only in the cloud');
    assert(Platform.loadBestStars(1) === 3, 'applyMergedSnapshot writes the merged (max) best stars');
    assert(Platform.loadBestStars(2) === 1, 'a best-stars level present only locally survives untouched');
    // totalStars must be rebuilt from scratch: best(1)=3 + best(2)=1 + best(3)=3 + challengeStars=4 = 11
    assert(Platform.loadTotalStars() === 11, `totalStars is recomputed as sum(best stars) + challengeStars (got ${Platform.loadTotalStars()})`);
  }

  // --- Rewarded ads: reward granted only on onRewarded, idempotent even if
  // the backend fires it more than once ---
  {
    const backend = makeFakeBackend({
      showRewardedVideo: (callbacks) => {
        callbacks.onOpen();
        callbacks.onRewarded();
        callbacks.onRewarded(); // simulated backend quirk - must never double-grant
        callbacks.onClose();
      },
    });
    Yandex._configureForTests(backend);
    let rewardedCount = 0;
    let closeArg = null;
    let errorCount = 0;
    const started = Yandex.showRewardedAd({
      onRewarded: () => { rewardedCount++; },
      onClose: (rewarded) => { closeArg = rewarded; },
      onError: () => { errorCount++; },
    });
    assert(started === true, 'showRewardedAd starts when no ad is already open');
    assert(rewardedCount === 1, 'onRewarded fires exactly once even if the backend fires it twice');
    assert(closeArg === true, 'onClose reports rewarded=true after a genuine reward');
    assert(errorCount === 0, 'onError never fires on a successful ad');
    assert(Yandex.isAdInProgress() === false, 'the ad-in-progress flag clears once onClose has fired');
  }

  // --- No reward on error ---
  {
    const backend = makeFakeBackend({
      showRewardedVideo: (callbacks) => { callbacks.onOpen(); callbacks.onError(); },
    });
    Yandex._configureForTests(backend);
    let rewardedCount = 0;
    let closeFired = false;
    let errorCount = 0;
    Yandex.showRewardedAd({
      onRewarded: () => { rewardedCount++; },
      onClose: () => { closeFired = true; },
      onError: () => { errorCount++; },
    });
    assert(rewardedCount === 0, 'onRewarded never fires on an SDK error');
    assert(closeFired === false, 'onClose never fires on an SDK error');
    assert(errorCount === 1, 'onError fires exactly once');
    assert(Yandex.isAdInProgress() === false, 'the ad-in-progress flag clears after an error too');
  }

  // --- No reward on an early close (player backed out without finishing) ---
  {
    const backend = makeFakeBackend({
      showRewardedVideo: (callbacks) => { callbacks.onOpen(); callbacks.onClose(); },
    });
    Yandex._configureForTests(backend);
    let rewardedCount = 0;
    let closeArg = 'unset';
    Yandex.showRewardedAd({
      onRewarded: () => { rewardedCount++; },
      onClose: (rewarded) => { closeArg = rewarded; },
    });
    assert(rewardedCount === 0, 'onRewarded never fires when the ad closes without ever rewarding');
    assert(closeArg === false, 'onClose reports rewarded=false for an early close');
  }

  // --- Double-tap guard: a second concurrent call is refused outright,
  // and a later call succeeds once the first has genuinely finished ---
  {
    let showCount = 0;
    let captured = null;
    const backend = makeFakeBackend({
      showRewardedVideo: (callbacks) => { showCount++; captured = callbacks; }, // deliberately never resolves on its own
    });
    Yandex._configureForTests(backend);

    const first = Yandex.showRewardedAd({ onClose: () => {} });
    const second = Yandex.showRewardedAd({ onClose: () => {} });
    assert(first === true, 'the first call starts the ad');
    assert(second === false, 'a second call while the first ad is still open is refused');
    assert(showCount === 1, "the backend's showRewardedVideo is only ever invoked once for the refused double-tap");

    captured.onClose(false);
    const third = Yandex.showRewardedAd({ onClose: () => {} });
    assert(third === true, 'a later call succeeds once the previous ad has actually closed');
    assert(showCount === 2, 'the backend is invoked again for the genuinely new call');
  }

  // --- Server-time offset: cached from the backend, with a device-clock
  // fallback (and Platform.now() actually reflecting it) ---
  {
    const futureMs = Date.now() + 100000;
    Yandex._configureForTests(makeFakeBackend({ serverTime: () => futureMs }));
    Yandex.refreshServerTimeOffset();
    const offset = Yandex.getServerTimeOffsetMs();
    assert(typeof offset === 'number' && Math.abs(offset - 100000) < 1000, `server-time offset is cached from the backend (got ${offset})`);
    const nowViaPlatform = Platform.now().getTime();
    assert(Math.abs(nowViaPlatform - futureMs) < 2000, 'Platform.now() reflects the cached server-time offset');

    Yandex._configureForTests(makeFakeBackend({ serverTime: () => { throw new Error('unavailable'); } }));
    Yandex.refreshServerTimeOffset();
    assert(Yandex.getServerTimeOffsetMs() === null, 'a throwing/unavailable serverTime() falls back to null (device clock)');
    const nowFallback = Platform.now().getTime();
    assert(Math.abs(nowFallback - Date.now()) < 2000, 'Platform.now() falls back to the device clock when no server offset is available');
  }

  // --- Leaderboard throttle: max 1 request per second-ish window, only the
  // latest queued value actually gets sent ---
  {
    const sentScores = [];
    const backend = makeFakeBackend({
      leaderboards: { setScore: (name, score) => { sentScores.push(score); return Promise.resolve(); }, getEntries: () => Promise.resolve(null), getTotalEntries: () => null },
    });
    Yandex._configureForTests(backend, { player: { authorized: true }, leaderboardThrottleMs: 40 });

    Yandex.submitScore(10);
    await flush();
    assert(sentScores.length === 1 && sentScores[0] === 10, 'the first call sends immediately when idle');

    Yandex.submitScore(20);
    Yandex.submitScore(30);
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
    Yandex._configureForTests(backend, { player: { authorized: false }, leaderboardThrottleMs: 40 });
    Yandex.submitScore(999);
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
    Yandex._configureForTests(backend, { player: { authorized: false } });

    let firstResult = 'unset';
    Yandex.openAuthDialog((authorized) => { firstResult = authorized; });
    await flush();
    assert(authCalls === 1, 'an explicit call prompts the auth dialog exactly once');
    assert(firstResult === false, 'declining (still unauthorized after the dialog closes) reports false');
    assert(Yandex.isAuthorized() === false, 'isAuthorized() reflects the decline');

    await delay(30);
    assert(authCalls === 1, 'a decline is never automatically re-prompted on its own');

    authorizedAfterDialog = true;
    let secondResult = 'unset';
    Yandex.openAuthDialog((authorized) => { secondResult = authorized; });
    await flush();
    assert(authCalls === 2, 'a fresh explicit call prompts again - a past decline never blocks it');
    assert(secondResult === true, 'accepting reports true');
    assert(Yandex.isAuthorized() === true, 'isAuthorized() reflects the acceptance');
  }

  console.log(`${checks} checks run, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
