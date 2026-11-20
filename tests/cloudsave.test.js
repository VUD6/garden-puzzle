// Plain Node script, no test framework/dependency. Run with: node tests/cloudsave.test.js
// Covers js/cloudsave.js: the cloud-save merge policy (several conflict
// cases plus the cross-device idempotent-daily-claim guard - unchanged
// logic, just moved out of the Yandex-specific adapter per the "Platform
// layer" refactor, see GAME_DESIGN.md), buildLocalSnapshot/
// applyMergedSnapshot's round-trip through real Garden.platform storage,
// and the debounced-save/boot-time-merge orchestration against an injected
// fake Garden.platformAdapter (loadData/saveData only - no real SDK, no
// window, no document).
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
require('../js/cloudsave.js');

const { platform: Platform, checkin: Checkin, cloudsave: CloudSave } = globalThis.Garden;

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
      lang: 'ru',
      savedAt: 0,
    },
    overrides || {}
  );
}

async function main() {
  // --- Merge policy: max-group fields ---
  {
    const local = baseSnapshot({ progress: 5, highestLevel: 5, totalScore: 100, bestWinStreak: 3, savedAt: 1000 });
    const cloud = baseSnapshot({ progress: 9, highestLevel: 7, totalScore: 40, bestWinStreak: 8, savedAt: 500 });
    const merged = CloudSave.mergeSnapshots(local, cloud);
    assert(merged.progress === 9, 'progress merges via max (cloud ahead)');
    assert(merged.highestLevel === 7, 'highestLevel merges via max (cloud ahead)');
    assert(merged.totalScore === 100, 'totalScore merges via max (local ahead)');
    assert(merged.bestWinStreak === 8, 'bestWinStreak merges via max regardless of savedAt side');
  }

  // --- Merge policy: per-level best times (min) / best stars (max) ---
  {
    const local = baseSnapshot({ bestTimes: { 3: 40, 5: 20 }, bestStars: { 3: 2, 5: 3 } });
    const cloud = baseSnapshot({ bestTimes: { 3: 25, 7: 60 }, bestStars: { 3: 3, 7: 1 } });
    const merged = CloudSave.mergeSnapshots(local, cloud);
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
      lang: 'en',
    });
    const cloud = baseSnapshot({
      savedAt: 1000,
      helperCharges: { finder: 9, random: 9, snowman: 9 },
      winStreak: 7,
      sfxEnabled: true,
      musicEnabled: true,
      theme: 'winter',
      lang: 'ru',
    });
    const mergedLocalNewer = CloudSave.mergeSnapshots(local, cloud);
    assert(mergedLocalNewer.helperCharges.finder === 1, 'helper charges come wholesale from the newer-savedAt side (local here)');
    assert(mergedLocalNewer.winStreak === 4, 'the live win-streak counter comes from the newer-savedAt side (local here)');
    assert(mergedLocalNewer.theme === 'garden', 'settings come from the newer-savedAt side (local here)');
    assert(mergedLocalNewer.lang === 'en', 'the language choice comes from the newer-savedAt side too (local here) - same group as theme/sfx/music');

    const mergedCloudNewer = CloudSave.mergeSnapshots(Object.assign({}, local, { savedAt: 500 }), cloud);
    assert(mergedCloudNewer.helperCharges.finder === 9, 'helper charges come wholesale from the newer-savedAt side (cloud here)');
    assert(mergedCloudNewer.winStreak === 7, 'the live win-streak counter comes from the newer-savedAt side (cloud here)');
    assert(mergedCloudNewer.theme === 'winter', 'settings come from the newer-savedAt side (cloud here)');
    assert(mergedCloudNewer.lang === 'ru', 'the language choice comes from the newer-savedAt side too (cloud here)');
  }

  // --- Merge policy: daily-challenge challengeStars is its OWN max-group
  // field, independent of which side wins the rest of that same record ---
  {
    const local = baseSnapshot({ savedAt: 2000, dailyChallenge: freshDailyChallenge({ challengeStars: 2, lastSeenDate: '2024-05-01' }) });
    const cloud = baseSnapshot({ savedAt: 1000, dailyChallenge: freshDailyChallenge({ challengeStars: 9, lastSeenDate: '2024-04-01' }) });
    const merged = CloudSave.mergeSnapshots(local, cloud);
    assert(merged.dailyChallenge.challengeStars === 9, 'challengeStars merges via max even though local otherwise wins the savedAt side');
    assert(merged.dailyChallenge.lastSeenDate === '2024-05-01', 'the rest of the dailyChallenge record still comes from the newer-savedAt side');
  }

  // --- Merge policy: a claim/reward date can NEVER regress across a merge,
  // even when that side loses the savedAt comparison - the exact guard
  // against claiming the same day's reward twice on two devices ---
  {
    const local = baseSnapshot({ savedAt: 2000, dailyGift: freshDailyGift({ lastClaimDate: '2024-05-01', position: 3 }) });
    const cloud = baseSnapshot({ savedAt: 1000, dailyGift: freshDailyGift({ lastClaimDate: '2024-05-03', position: 5 }) });
    const merged = CloudSave.mergeSnapshots(local, cloud);
    assert(merged.dailyGift.lastClaimDate === '2024-05-03', 'the later claim date always wins, even from the savedAt-losing side');
    assert(merged.dailyGift.position === 3, 'every OTHER field of the daily-gift record still comes from the savedAt-winning side');

    const localChallenge = baseSnapshot({ savedAt: 2000, dailyChallenge: freshDailyChallenge({ lastRewardDate: '2024-05-01' }) });
    const cloudChallenge = baseSnapshot({ savedAt: 1000, dailyChallenge: freshDailyChallenge({ lastRewardDate: '2024-05-03' }) });
    const mergedChallenge = CloudSave.mergeSnapshots(localChallenge, cloudChallenge);
    assert(mergedChallenge.dailyChallenge.lastRewardDate === '2024-05-03', 'same later-date guard for the daily-challenge reward date');
  }

  // --- Idempotent daily claim across devices: once merged, the resulting
  // record can never be claimed a second time for the same day ---
  {
    const todayKey = '2024-06-10';
    const local = baseSnapshot({ savedAt: 5000, dailyGift: { lastClaimDate: todayKey, lastSeenDate: todayKey, position: 3, plan: null } });
    const cloud = baseSnapshot({ savedAt: 4000, dailyGift: { lastClaimDate: todayKey, lastSeenDate: todayKey, position: 3, plan: null } });
    const merged = CloudSave.mergeSnapshots(local, cloud);
    const claimAttempt = Checkin.computeClaim(merged.dailyGift, todayKey);
    assert(claimAttempt.available === false, 'a merged record for a day already claimed on both sides can never be claimed again');
  }

  // --- cloud === null: local wins outright, nothing to reconcile ---
  {
    const local = baseSnapshot({ progress: 12 });
    assert(CloudSave.mergeSnapshots(local, null) === local, 'merging against no cloud data at all returns the local snapshot unchanged');
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
    const localSnap = CloudSave.buildLocalSnapshot();
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
    const merged = CloudSave.mergeSnapshots(localSnap, cloudSnap);
    CloudSave.applyMergedSnapshot(merged);

    assert(Platform.loadProgress() === 20, 'applyMergedSnapshot writes the merged progress');
    assert(Platform.loadBestTime(1) === 30, 'applyMergedSnapshot writes the merged (min) best time for a level present on both sides');
    assert(Platform.loadBestTime(3) === 10, 'applyMergedSnapshot writes a best time present only in the cloud');
    assert(Platform.loadBestStars(1) === 3, 'applyMergedSnapshot writes the merged (max) best stars');
    assert(Platform.loadBestStars(2) === 1, 'a best-stars level present only locally survives untouched');
    // totalStars must be rebuilt from scratch: best(1)=3 + best(2)=1 + best(3)=3 + challengeStars=4 = 11
    assert(Platform.loadTotalStars() === 11, `totalStars is recomputed as sum(best stars) + challengeStars (got ${Platform.loadTotalStars()})`);
    assert(Platform.loadLang() === 'ru', 'applyMergedSnapshot writes the merged language choice too (cloud\'s "ru" here, nothing was ever saved locally)');
  }

  // --- Orchestration: boot-time merge + debounced/flushed writes against an
  // injected fake Garden.platformAdapter (loadData/saveData only) ---
  {
    resetStorage();
    Platform.saveProgress(7);
    const savedPayloads = [];
    let loadResolvesWith = null;
    globalThis.Garden.platformAdapter = {
      loadData: () => Promise.resolve(loadResolvesWith),
      saveData: (obj) => { savedPayloads.push(obj); return Promise.resolve(true); },
    };

    // Nothing in the cloud yet - local wins outright, and the merge (even
    // though "unchanged") still immediately pushes the reconciled state up
    // once, per CloudSave.init's own contract.
    let mergedChanged = 'unset';
    CloudSave.init((changed) => { mergedChanged = changed; });
    await flush();
    assert(mergedChanged === false, 'merging against an empty cloud reports no change');
    assert(savedPayloads.length === 1, 'init() still flushes once after the boot-time merge, even with nothing to reconcile');

    // A write AFTER the boot-time merge has completed schedules a normal
    // debounced save.
    savedPayloads.length = 0;
    Platform.saveProgress(8);
    CloudSave.scheduleSave();
    await delay(1600); // past CLOUD_SAVE_DEBOUNCE_MS
    assert(savedPayloads.length === 1, 'a write after boot-time merge completion schedules exactly one debounced save');
    assert(savedPayloads[0].progress === 8, 'the debounced save carries the latest local snapshot');

    // flushNow() bypasses the debounce entirely.
    savedPayloads.length = 0;
    Platform.saveProgress(9);
    CloudSave.flushNow();
    assert(savedPayloads.length === 1 && savedPayloads[0].progress === 9, 'flushNow() saves immediately, with no debounce wait');
  }

  console.log(`${checks} checks run, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
