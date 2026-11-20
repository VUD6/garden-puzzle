// Cloud-save orchestration: GAME logic, not a platform concern - this file
// decides WHICH side wins each field of a cross-device merge and WHEN to
// push a save, but never talks to any SDK directly. It only ever calls
// Garden.platformAdapter's generic loadData()/saveData() - exactly the
// separation CLAUDE.md/GAME_DESIGN.md's "Platform layer" section asks for,
// so a future platform adapter (e.g. Playgama) needs no changes here at
// all, as long as it implements the same two generic methods.
//
// See GAME_DESIGN.md's "Cloud saves" section for the full written merge
// policy this implements - unchanged from before this file was split out
// of the Yandex-specific adapter.
(function (root) {
  const CLOUD_SAVE_DEBOUNCE_MS = 1500;

  // --- pure logic: the merge policy --------------------------------------
  //
  // Every function below takes plain data in, returns plain data out - no
  // Garden.platform, no SDK, no DOM - so mergeSnapshots itself is trivially
  // unit-testable; only buildLocalSnapshot/applyMergedSnapshot (which DO
  // read/write Garden.platform) need a fake localStorage, the same
  // convention every other Node test in this repo already uses.

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

  // --- orchestration: debounced writes, boot-time merge ------------------

  let cloudReady = false;
  let saveTimer = null;

  // Called by js/platform.js's notifyCloudDirty() (itself called from
  // every meaningful localStorage write - see its own comment) - a no-op
  // until the boot-time merge below has actually completed, since writing
  // to the cloud before that would race the merge and could clobber
  // whichever side it hasn't read yet.
  function scheduleSave() {
    if (!cloudReady) return;
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      flushNow();
    }, CLOUD_SAVE_DEBOUNCE_MS);
  }

  function flushNow() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const Platform = root.Garden.platformAdapter;
    if (!Platform || !cloudReady) return;
    Platform.saveData(buildLocalSnapshot());
  }

  // Called once at boot, well after the menu is already interactive (never
  // blocks it). Fetches the cloud snapshot via the generic facade, merges
  // it against a FRESHLY re-read local snapshot (read right now, not an
  // earlier captured copy - minimizes, though doesn't eliminate, the race
  // window against any local write that happens during the fetch's own
  // round trip - see GAME_DESIGN.md), applies the merge locally if anything
  // actually changed, then immediately pushes the reconciled result back up
  // so both sides agree. Never throws: a failed fetch just leaves the
  // player on their local data, retried on the next flush.
  function init(onMerged) {
    const Platform = root.Garden.platformAdapter;
    if (!Platform) {
      cloudReady = true;
      if (onMerged) onMerged(false);
      return;
    }
    Platform.loadData()
      .then(function (cloudSnapshot) {
        const freshLocal = buildLocalSnapshot();
        const merged = mergeSnapshots(freshLocal, cloudSnapshot);
        const changed = JSON.stringify(merged) !== JSON.stringify(freshLocal);
        if (changed) applyMergedSnapshot(merged);
        cloudReady = true;
        flushNow();
        if (onMerged) onMerged(changed);
      })
      .catch(function () {
        cloudReady = true;
        if (onMerged) onMerged(false);
      });
  }

  const CloudSave = {
    mergeSnapshots,
    buildLocalSnapshot,
    applyMergedSnapshot,
    init,
    scheduleSave,
    flushNow,
  };

  root.Garden = root.Garden || {};
  root.Garden.cloudsave = CloudSave;
})(typeof window !== 'undefined' ? window : globalThis);
