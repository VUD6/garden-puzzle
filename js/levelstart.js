// Level start descriptor: decides what's pre-placed on a level's board at
// the moment it begins - 1 flower ("gift"), nothing ("none"), 8-12
// non-solution crosses and no flower ("rich"), or 0-1 flowers plus 5-10
// non-solution crosses ("notes"). A level never gets more than 1 pre-placed
// flower, "rich" included - its generosity comes entirely from crosses.
// Pure and Node-testable; never touches rules.js/solver.js or buildLevel's
// own generation RNG (js/state.js), so tuning this schedule can never change
// a level's beds or solution (tests/levelstart.test.js guards this directly).
(function (root) {
  const START_TYPES = { GIFT: 'gift', NONE: 'none', RICH: 'rich', NOTES: 'notes' };

  // Levels 1-9 always get the tutorial-like single pre-placed flower.
  const TUTORIAL_MAX_LEVEL = 9;
  // Every multiple of this is a "milestone" level: a friendly rich start,
  // plus a one-time helper-charge reward on first completion (see
  // MILESTONE_HELPER_REWARD / finishLevel in js/state.js).
  const MILESTONE_INTERVAL = 10;
  // Every OTHER multiple of 5 (not already a milestone) is a "none" level -
  // no pre-placed cells at all, roughly one level in five.
  const NO_HINT_INTERVAL = 5;

  // "rich" used to pre-place 2-3 solution flowers; that's now "notes"-style
  // crosses instead (several, more than notes' own 5-10) so a level can
  // never have more than 1 pre-placed gingerbread (see START_TYPES and the
  // givenCount switch in buildLevelStart below) while still feeling like a
  // distinctly generous, friendly start.
  const RICH_CROSS_MIN = 8;
  const RICH_CROSS_MAX = 12;
  const NOTES_GIVEN_MIN = 0;
  const NOTES_GIVEN_MAX = 1;
  const NOTES_CROSS_MIN = 5;
  const NOTES_CROSS_MAX = 10;

  // Deliberately distinct LCG-style transform from both buildLevel's plain
  // level-number seed and the Random helper's randomRollSeed (js/state.js),
  // so this module's draws can never share or perturb either of those
  // streams even when called for the exact same level number.
  function levelStartSeed(level) {
    return (level * 1664525 + 1013904223) >>> 0;
  }

  function isMilestoneLevel(level) {
    return level >= MILESTONE_INTERVAL && level % MILESTONE_INTERVAL === 0;
  }

  function isNoHintLevel(level) {
    return level > TUTORIAL_MAX_LEVEL && level % NO_HINT_INTERVAL === 0 && !isMilestoneLevel(level);
  }

  function levelKind(level) {
    return isMilestoneLevel(level) ? 'milestone' : 'normal';
  }

  // The schedule itself: one pure function of the level number. `rng` is
  // optional - omit it to get a fresh dedicated stream seeded just for this
  // call (what the schedule table test and levelKind-only callers want);
  // buildLevelStart below passes its own stream through instead, so the
  // type roll and the given/cross picks that follow it are one continuous
  // deterministic sequence rather than two streams that happen to share a seed.
  function startTypeForLevel(level, rng) {
    if (level <= TUTORIAL_MAX_LEVEL) return START_TYPES.GIFT;
    if (isMilestoneLevel(level)) return START_TYPES.RICH;
    if (isNoHintLevel(level)) return START_TYPES.NONE;

    const roll = (rng || root.Garden.rng.createRng(levelStartSeed(level)))();
    if (roll < 1 / 3) return START_TYPES.GIFT;
    if (roll < 2 / 3) return START_TYPES.RICH;
    return START_TYPES.NOTES;
  }

  // Sequential sampling without replacement, same pattern as state.js's
  // pickRandomCells - picks at most `count` items (fewer if `items` is
  // shorter than that), consuming one rng() draw per pick.
  function pickWithoutReplacement(items, count, rng) {
    const pool = items.slice();
    const chosen = [];
    const n = Math.min(count, pool.length);
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(rng() * pool.length);
      chosen.push(pool[idx]);
      pool.splice(idx, 1);
    }
    return chosen;
  }

  // Builds the full start descriptor for a level: its type, its "kind"
  // (milestone/normal), which of the solution's flowers start pre-placed
  // (givenFlowers), and which non-solution cells start pre-crossed
  // (crossCells, 'notes' only - always true information, since they're
  // picked only from cells that are not part of the solution). `solution`
  // and `size` come from the already-generated level (see buildLevel in
  // js/state.js) - this never reruns or reseeds generation itself, only
  // reads its output, and draws every one of its own random choices from a
  // dedicated stream that buildLevel's generation RNG never touches.
  // Every non-solution cell (never a cross on a cell that might hold a
  // flower), shared by both "notes" and "rich" - their crosses are always
  // true information for exactly the same reason.
  function nonSolutionCells(solution, size) {
    const solutionKeys = new Set(solution.map(function (pos) { return pos.row + ',' + pos.col; }));
    const cells = [];
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (!solutionKeys.has(row + ',' + col)) cells.push({ row, col });
      }
    }
    return cells;
  }

  function buildLevelStart(level, solution, size) {
    const rng = root.Garden.rng.createRng(levelStartSeed(level));
    const type = startTypeForLevel(level, rng);

    // At most 1 pre-placed gingerbread per level, every level, including
    // milestones - "rich" gives 0 (its generosity comes from crosses
    // instead, below), "gift" gives its usual 1, "none" gives 0, and "notes"
    // keeps its existing 0-1 roll.
    let givenCount;
    if (type === START_TYPES.GIFT) {
      givenCount = 1;
    } else if (type === START_TYPES.NOTES) {
      givenCount = NOTES_GIVEN_MIN + Math.floor(rng() * (NOTES_GIVEN_MAX - NOTES_GIVEN_MIN + 1));
    } else {
      givenCount = 0; // NONE and RICH
    }

    const givenFlowers = pickWithoutReplacement(solution, givenCount, rng);

    let crossCells = [];
    if (type === START_TYPES.NOTES) {
      const eligible = nonSolutionCells(solution, size);
      const crossCount = NOTES_CROSS_MIN + Math.floor(rng() * (NOTES_CROSS_MAX - NOTES_CROSS_MIN + 1));
      crossCells = pickWithoutReplacement(eligible, crossCount, rng);
    } else if (type === START_TYPES.RICH) {
      const eligible = nonSolutionCells(solution, size);
      const crossCount = RICH_CROSS_MIN + Math.floor(rng() * (RICH_CROSS_MAX - RICH_CROSS_MIN + 1));
      crossCells = pickWithoutReplacement(eligible, crossCount, rng);
    }

    return { type, kind: levelKind(level), givenFlowers, crossCells };
  }

  const LevelStart = {
    START_TYPES,
    TUTORIAL_MAX_LEVEL,
    MILESTONE_INTERVAL,
    NO_HINT_INTERVAL,
    RICH_CROSS_MIN,
    RICH_CROSS_MAX,
    NOTES_GIVEN_MIN,
    NOTES_GIVEN_MAX,
    NOTES_CROSS_MIN,
    NOTES_CROSS_MAX,
    levelStartSeed,
    isMilestoneLevel,
    isNoHintLevel,
    levelKind,
    startTypeForLevel,
    pickWithoutReplacement,
    buildLevelStart,
  };

  root.Garden = root.Garden || {};
  root.Garden.levelstart = LevelStart;
})(typeof window !== 'undefined' ? window : globalThis);
