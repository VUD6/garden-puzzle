// Helper charges module: the per-id API (getCharges/addCharges/spendCharge)
// on top of platform.js's raw, corruption-tolerant charge-object storage.
// No DOM dependency - safe to run in Node for tests. Replaces the old soft-
// currency (seeds) module from Step 4 - there is no shared currency anymore,
// each helper has its own independent charge count.
(function (root) {
  const HELPER_IDS = ['finder', 'random', 'snowman'];

  // Granted once per helper, the very first time charges are ever loaded
  // with nothing in storage yet - mirrors the old starting-seed grant.
  const STARTING_CHARGES = 5;

  // Snowman stays locked until the player has reached this level - checked
  // against the highest level ever reached, not the level currently open.
  const SNOWMAN_UNLOCK_LEVEL = 10;

  function platform() {
    return root.Garden.platform;
  }

  // Loads the full charge map, granting the one-time starting balance for
  // every helper id if nothing has ever been stored (platform.loadHelperCharges
  // returns null only in that exact case - see platform.js). Any id missing
  // from an otherwise-valid stored object (e.g. a helper added after the
  // player's first launch) defaults to 0, not a fresh grant, same as a
  // corrupted value would.
  function loadAll() {
    const stored = platform().loadHelperCharges();
    if (stored === null) {
      const fresh = {};
      HELPER_IDS.forEach(function (id) { fresh[id] = STARTING_CHARGES; });
      platform().saveHelperCharges(fresh);
      return fresh;
    }
    const charges = {};
    HELPER_IDS.forEach(function (id) { charges[id] = stored[id] || 0; });
    return charges;
  }

  function getCharges(id) {
    return loadAll()[id] || 0;
  }

  // Adds n charges (n may be any sign in principle, but callers only ever
  // add positive amounts) to the given helper, clamped so a balance can
  // never go negative, and persists immediately.
  function addCharges(id, n) {
    const charges = loadAll();
    charges[id] = Math.max(0, (charges[id] || 0) + n);
    platform().saveHelperCharges(charges);
    return charges[id];
  }

  // Spends exactly one charge if available; returns whether it succeeded.
  // Never lets a balance go below 0.
  function spendCharge(id) {
    const charges = loadAll();
    if ((charges[id] || 0) <= 0) return false;
    charges[id] -= 1;
    platform().saveHelperCharges(charges);
    return true;
  }

  function isSnowmanUnlocked() {
    return platform().loadHighestLevel() >= SNOWMAN_UNLOCK_LEVEL;
  }

  function isUnlocked(id) {
    return id === 'snowman' ? isSnowmanUnlocked() : true;
  }

  const Helpers = {
    HELPER_IDS,
    STARTING_CHARGES,
    SNOWMAN_UNLOCK_LEVEL,
    getCharges,
    addCharges,
    spendCharge,
    isUnlocked,
  };

  root.Garden = root.Garden || {};
  root.Garden.helpers = Helpers;
})(typeof window !== 'undefined' ? window : globalThis);
