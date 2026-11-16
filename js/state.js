// Game state machine: ties grid/rules/generator/platform together behind a
// small API. No DOM dependency - render.js subscribes via the onChange callback.
(function (root) {
  const MAX_LIVES = 3;
  const DOUBLE_TAP_WINDOW_MS = 300;
  const POINTS_PER_FLOWER = 10;

  // Minimum gap between two uses of the SAME helper - blocks a rapid
  // repeated tap from ever being processed while the previous use's effect
  // is still playing, so one tap can never spend two charges.
  const HELPER_LOCK_MS = 400;

  // Snowman always places up to this many crosses; Random's cross outcome
  // places one of these two counts (chosen by the same roll that picked
  // the cross outcome itself - see useRandom below).
  const SNOWMAN_CROSS_COUNT = 3;
  const RANDOM_CROSS_COUNT_OPTIONS = [4, 5];

  // Charges of EACH helper granted on a milestone level's first-ever
  // completion (see finishLevel) - reuses the exact same loadBestTime-based
  // "already completed" guard that protects the total score, so a replay
  // never re-grants it.
  const MILESTONE_HELPER_REWARD = 1;

  // Grid size by level: 1-2 -> 4x4, 3-5 -> 5x5, 6-9 -> 6x6, 10-14 -> 7x7, 15+ -> 8x8.
  const SIZE_THRESHOLDS = [
    { minLevel: 1, size: 4 },
    { minLevel: 3, size: 5 },
    { minLevel: 6, size: 6 },
    { minLevel: 10, size: 7 },
    { minLevel: 15, size: 8 },
  ];

  function gridSizeForLevel(level) {
    let size = SIZE_THRESHOLDS[0].size;
    for (const entry of SIZE_THRESHOLDS) {
      if (level >= entry.minLevel) size = entry.size;
    }
    return size;
  }

  // Win rating (1-3 stars): based on mistakes made and time taken, scaled to
  // grid size since bigger boards naturally take longer to solve.
  const STAR3_SECONDS_PER_CELL_SIDE = 10;
  const STAR2_SECONDS_PER_CELL_SIDE = 20;

  function computeRating(size, mistakesUsed, elapsedSeconds) {
    if (mistakesUsed === 0 && elapsedSeconds <= size * STAR3_SECONDS_PER_CELL_SIDE) return 3;
    if (mistakesUsed <= 1 && elapsedSeconds <= size * STAR2_SECONDS_PER_CELL_SIDE) return 2;
    return 1;
  }

  // Pure, deterministic level construction: level N always produces the exact
  // same regions and solution, for every player and every reload, because
  // it is derived entirely from a PRNG seeded by the level number (never
  // Math.random). The start set (which cells begin pre-placed) is decided
  // separately by Garden.levelstart.buildLevelStart, from its own dedicated
  // RNG stream that never touches - and so can never perturb - the
  // generation draws above (see js/levelstart.js).
  function buildLevel(levelNumber) {
    const size = gridSizeForLevel(levelNumber);
    const rng = root.Garden.rng.createRng(levelNumber);
    const generated = root.Garden.generator.generateLevel(size, rng);
    const start = root.Garden.levelstart.buildLevelStart(levelNumber, generated.solution, size);
    return {
      size,
      regionOf: generated.regionOf,
      solution: generated.solution,
      startType: start.type,
      levelKind: start.kind,
      givenFlowers: start.givenFlowers,
      crossCells: start.crossCells,
    };
  }

  // A seed for Random's own PRNG stream - deliberately separate from the
  // level-generation RNG above (that one is created and discarded entirely
  // inside buildLevel). Mixes the level number with the per-attempt use
  // counter so each use of Random within an attempt gets its own
  // deterministic roll, reproducible after a reload.
  function randomRollSeed(levelNumber, useCount) {
    return ((levelNumber + 1) * 2654435761 + (useCount + 1) * 97) >>> 0;
  }

  // Picks up to `count` cells out of `eligible` using sequential draws from
  // `rng`, consuming the same stream the roll itself came from so the whole
  // use (type, count, and exact cells) is one deterministic sequence.
  function pickRandomCells(eligible, count, rng) {
    const pool = eligible.slice();
    const chosen = [];
    const n = Math.min(count, pool.length);
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(rng() * pool.length);
      chosen.push(pool[idx]);
      pool.splice(idx, 1);
    }
    return chosen;
  }

  function createGame(options) {
    options = options || {};
    const onChange = options.onChange || function () {};

    const platform = root.Garden.platform;
    const Helpers = root.Garden.helpers;
    const gridModule = root.Garden.grid;
    const rules = root.Garden.rules;
    const CellState = gridModule.CellState;

    let level = platform.loadProgress();
    let lives = MAX_LIVES;
    let grid = null;
    let status = 'playing'; // 'playing' | 'won' | 'lost'
    let solutionKeys = null; // Set of 'row,col' for the puzzle's one true solution
    // The solution's flowers, ordered ascending by row (see buildLevel/
    // generator.js: solution[i].row === i by construction). Finder relies on
    // this order to deterministically pick "the unplanted flower with the
    // lowest row index" - see pickFinderTarget below.
    let solutionList = null;
    let lastTap = null; // { row, col, time } - tracks the double-tap gesture
    let levelScore = 0;
    let committedScore = platform.loadTotalScore(); // persisted total; only changes on first-ever level completion
    // Per-helper double-spend guard (Date.now() timestamps); not persisted -
    // it only needs to survive a single in-flight tap, not a reload.
    let helperLockedUntil = { finder: 0, random: 0, snowman: 0 };
    // Random's per-attempt use counter - persisted with the board (see
    // serializeBoard/startLevel below) so a reload can never re-roll a use
    // that already happened, and reset to 0 on a fresh attempt/Retry.
    let randomUseCount = 0;
    let awardedCells = new Set(); // 'row,col' already scored this attempt - safeguard against double-awarding
    let levelStartTime = Date.now();
    let startType = root.Garden.levelstart.START_TYPES.GIFT; // this level's start type ('gift'|'none'|'rich'|'notes')
    let levelKindValue = 'normal'; // 'normal'|'milestone' - see Garden.levelstart.levelKind

    function cellKey(row, col) {
      return row + ',' + col;
    }

    function buildHelperSnapshot() {
      const snap = {};
      Helpers.HELPER_IDS.forEach(function (id) {
        snap[id] = {
          charges: Helpers.getCharges(id),
          locked: !Helpers.isUnlocked(id),
          canUse: canUseHelper(id),
        };
      });
      return snap;
    }

    function getSnapshot() {
      return {
        level,
        lives,
        maxLives: MAX_LIVES,
        grid,
        status,
        levelScore,
        // While playing, preview the total as if this level's score were
        // already banked. Once won, committedScore is already final (it was
        // only added to if this was the level's first-ever completion), so
        // adding levelScore again here would double-count it.
        totalScore: status === 'won' ? committedScore : committedScore + levelScore,
        perfect: lives === MAX_LIVES,
        helpers: buildHelperSnapshot(),
        startType,
        levelKind: levelKindValue,
      };
    }

    function emit(extra) {
      onChange(Object.assign(getSnapshot(), extra || {}));
    }

    function serializeBoard() {
      const cells = [];
      for (let row = 0; row < grid.size; row++) {
        const rowCells = [];
        for (let col = 0; col < grid.size; col++) {
          const cell = grid.cells[row][col];
          rowCells.push({ state: cell.state, locked: cell.locked });
        }
        cells.push(rowCells);
      }
      return { lives, levelScore, cells, awardedCells: Array.from(awardedCells), randomUseCount };
    }

    function commit(extra) {
      platform.saveBoard(level, serializeBoard());
      emit(extra);
    }

    function startLevel(levelNumber) {
      level = levelNumber;
      status = 'playing';
      lastTap = null;
      levelStartTime = Date.now();

      const built = buildLevel(levelNumber);
      grid = gridModule.createGrid(built.size, built.regionOf);
      solutionKeys = new Set(built.solution.map((pos) => cellKey(pos.row, pos.col)));
      solutionList = built.solution;
      startType = built.startType;
      levelKindValue = built.levelKind;

      // Pre-placed pieces/crosses: locked, earn no points, and (like the old
      // single pre-placed flower) never added to awardedCells. `given` is
      // purely a rendering hook (see render.js's data-given attribute) - no
      // game-rule logic ever reads it.
      built.givenFlowers.forEach(function (pos) {
        const cell = grid.cells[pos.row][pos.col];
        cell.state = CellState.FLOWER;
        cell.locked = true;
        cell.given = true;
      });
      built.crossCells.forEach(function (pos) {
        const cell = grid.cells[pos.row][pos.col];
        cell.state = CellState.X;
        cell.locked = true;
        cell.given = true;
      });

      const saved = platform.loadBoard(levelNumber);
      if (saved && Array.isArray(saved.cells) && saved.cells.length === built.size) {
        lives = saved.lives;
        levelScore = saved.levelScore || 0;
        awardedCells = new Set(Array.isArray(saved.awardedCells) ? saved.awardedCells : []);
        randomUseCount = Number.isInteger(saved.randomUseCount) && saved.randomUseCount >= 0 ? saved.randomUseCount : 0;
        for (let row = 0; row < built.size; row++) {
          for (let col = 0; col < built.size; col++) {
            const savedCell = saved.cells[row][col];
            if (!savedCell) continue;
            grid.cells[row][col].state = savedCell.state;
            grid.cells[row][col].locked = savedCell.locked;
          }
        }
        if (lives <= 0) status = 'lost';
      } else {
        lives = MAX_LIVES;
        levelScore = 0;
        awardedCells = new Set();
        randomUseCount = 0;
      }

      platform.saveProgress(level);
      // Tracked separately from "current level" so Snowman's level-10 lock
      // (see Helpers.isUnlocked) can never flicker back on by revisiting an
      // earlier level - it only ever goes up.
      platform.saveHighestLevel(Math.max(platform.loadHighestLevel(), level));
      emit();
    }

    function retryLevel() {
      platform.clearBoard(level);
      startLevel(level);
    }

    function nextLevel() {
      startLevel(level + 1);
    }

    // All remaining empty cells get a white X (a solved board never leaves
    // ambiguous empty cells), then the level ends: score is finalized,
    // rating (1-3 stars) is computed from mistakes + time, and the level's
    // best time is updated if this run beat it. helperPlant (if this win was
    // a Finder/Random-planted flower) is passed through only so the renderer
    // knows which cell to play the planting-specific animation on.
    function finishLevel(scoreGain, helperPlant) {
      const winFill = [];
      for (let row = 0; row < grid.size; row++) {
        for (let col = 0; col < grid.size; col++) {
          const fillCell = grid.cells[row][col];
          if (fillCell.state === CellState.EMPTY) {
            fillCell.state = CellState.X;
            winFill.push({ row, col });
          }
        }
      }

      const elapsedSeconds = Math.max(0, Math.round((Date.now() - levelStartTime) / 1000));
      const mistakesUsed = MAX_LIVES - lives;
      const rating = computeRating(grid.size, mistakesUsed, elapsedSeconds);

      // Best time and stars can always improve on a replay, but the total
      // score only ever comes from this level's first-ever completion -
      // replaying an already-completed level earns no more of it.
      const previousBest = platform.loadBestTime(level);
      const alreadyCompletedBefore = previousBest !== null;
      const bestTimeSeconds = alreadyCompletedBefore ? Math.min(previousBest, elapsedSeconds) : elapsedSeconds;
      platform.saveBestTime(level, bestTimeSeconds);

      if (!alreadyCompletedBefore) {
        committedScore += levelScore;
        platform.saveTotalScore(committedScore);
      }

      // Milestone reward: +1 charge of EACH helper, granted only on a
      // milestone level's first-ever completion - same loadBestTime-based
      // guard as the total score above, so a replay never re-grants it, and
      // always credited through Garden.helpers.addCharges (which persists
      // immediately), never a direct storage write.
      let milestoneReward = null;
      if (!alreadyCompletedBefore && levelKindValue === 'milestone') {
        Helpers.HELPER_IDS.forEach(function (id) { Helpers.addCharges(id, MILESTONE_HELPER_REWARD); });
        milestoneReward = { amount: MILESTONE_HELPER_REWARD };
      }

      status = 'won';
      platform.clearBoard(level);
      emit({ scoreGain, winFill, rating, elapsedSeconds, bestTimeSeconds, helperPlant: helperPlant || null, milestoneReward });
    }

    function attemptFlower(row, col, cell) {
      if (!solutionKeys.has(cellKey(row, col))) {
        cell.state = CellState.WRONG;
        cell.locked = true;
        lives--;
        if (lives <= 0) status = 'lost';
        commit({ mistake: { row, col, lostLifeIndex: lives } });
        return;
      }

      // Correct flowers lock immediately, exactly like the pre-placed one:
      // once planted correctly, a cell can never be changed again.
      cell.state = CellState.FLOWER;
      cell.locked = true;

      // Safeguard: a given cell's points are only ever awarded once per
      // level attempt, even if it were somehow possible to clear and
      // replant it (the lock above already prevents that in normal play).
      const key = cellKey(row, col);
      let scoreGain = null;
      if (!awardedCells.has(key)) {
        awardedCells.add(key);
        levelScore += POINTS_PER_FLOWER;
        scoreGain = { row, col, amount: POINTS_PER_FLOWER };
      }

      if (rules.isSolved(grid)) {
        finishLevel(scoreGain);
        return;
      }

      commit({ scoreGain });
    }

    // Deterministic Finder target: among the solution's flowers not yet
    // planted, the one with the lowest row index. solutionList is already
    // ordered ascending by row (see the comment where it's declared above),
    // so the first eligible entry found by a plain forward scan is correct.
    // Red-X cells can never be solution cells in normal play (attemptFlower
    // only marks a cell WRONG when it is *not* in solutionKeys), but that
    // state is skipped too as a defensive guard. Used both by Finder itself
    // and by Random's finder-outcome branch.
    function pickFinderTarget() {
      for (const pos of solutionList) {
        const cell = grid.cells[pos.row][pos.col];
        if (cell.state === CellState.FLOWER || cell.state === CellState.WRONG) continue;
        return pos;
      }
      return null;
    }

    // Cells a cross (Snowman, or Random's cross outcome) is allowed to land
    // on: empty, unmarked, unlocked, and never part of the level's one true
    // solution. Returned in row-major order, which Snowman uses directly
    // (its placement is otherwise deterministic, no RNG involved).
    function collectEligibleCrossCells() {
      const cells = [];
      for (let row = 0; row < grid.size; row++) {
        for (let col = 0; col < grid.size; col++) {
          const cell = grid.cells[row][col];
          if (cell.locked) continue;
          if (cell.state !== CellState.EMPTY) continue;
          if (solutionKeys.has(cellKey(row, col))) continue;
          cells.push({ row, col });
        }
      }
      return cells;
    }

    // Plants one correct flower from the unique solution, exactly like a
    // correctly-tapped one (same lock, same bloom, same bed-tracker update,
    // same win trigger if it's the last one) - but earns no points and
    // costs no life/mistake. Shared by Finder and Random's finder outcome.
    function plantFinderFlower(target) {
      const cell = grid.cells[target.row][target.col];
      cell.state = CellState.FLOWER;
      cell.locked = true;

      // Belt-and-suspenders, exactly like a correct tap: mark the cell as
      // "awarded" so it can never later be scored, even though this award
      // is worth 0 points (a helper never earns the +10).
      awardedCells.add(cellKey(target.row, target.col));

      if (rules.isSolved(grid)) {
        finishLevel(null, target);
      } else {
        commit({ helperPlant: target });
      }
    }

    // Marks the given cells with a plain white X - ordinary X marks, not
    // locked, exactly as if the player had tapped them. Crosses never touch
    // a solution cell, so this can never complete the level on its own (see
    // rules.isSolved, which only ever counts flowers).
    function placeCrossCells(cells) {
      cells.forEach(function (pos) {
        grid.cells[pos.row][pos.col].state = CellState.X;
      });
      commit({ helperCross: cells });
    }

    function canUseHelper(id) {
      if (status !== 'playing') return false;
      if (Date.now() < helperLockedUntil[id]) return false;
      if (!Helpers.isUnlocked(id)) return false;
      if (Helpers.getCharges(id) <= 0) return false;
      // Snowman's placement is fully deterministic, so whether it would be
      // a no-op is cheap to know in advance and the button reflects it.
      // Random's outcome is a 50/50 roll, so it can't know in advance
      // whether this particular tap will land on a cross with zero eligible
      // cells - see useRandom, which just does nothing (no charge spent) in
      // that case rather than disabling the button ahead of time.
      if (id === 'snowman') return collectEligibleCrossCells().length > 0;
      return true;
    }

    function useFinder() {
      if (!canUseHelper('finder')) return false;
      const target = pickFinderTarget();

      helperLockedUntil.finder = Date.now() + HELPER_LOCK_MS;
      Helpers.spendCharge('finder');
      plantFinderFlower(target);
      return true;
    }

    function useSnowman() {
      if (!canUseHelper('snowman')) return false;
      const eligible = collectEligibleCrossCells();
      if (eligible.length === 0) return false; // defensive; canUseHelper already checked this

      helperLockedUntil.snowman = Date.now() + HELPER_LOCK_MS;
      Helpers.spendCharge('snowman');
      placeCrossCells(eligible.slice(0, SNOWMAN_CROSS_COUNT));
      return true;
    }

    // Rolls a deterministic 50/50 outcome from a dedicated PRNG stream
    // (never the level-generation RNG), seeded from the level number and
    // the per-attempt use counter - see randomRollSeed. The charge and use
    // counter are only spent/advanced once an actual effect is about to
    // happen: if the roll lands on the cross outcome but no eligible cross
    // cell currently exists on the board, this does nothing and spends no
    // charge, exactly like Snowman would in the same situation - the player
    // can simply try again once the board changes (e.g. clearing an X).
    function useRandom() {
      if (!canUseHelper('random')) return false;

      const rng = root.Garden.rng.createRng(randomRollSeed(level, randomUseCount));
      const isCross = rng() < 0.5;

      if (isCross) {
        const countIndex = rng() < 0.5 ? 0 : 1;
        const count = RANDOM_CROSS_COUNT_OPTIONS[countIndex];
        const eligible = collectEligibleCrossCells();
        if (eligible.length === 0) return false;

        helperLockedUntil.random = Date.now() + HELPER_LOCK_MS;
        Helpers.spendCharge('random');
        randomUseCount += 1;
        placeCrossCells(pickRandomCells(eligible, count, rng));
        return true;
      }

      helperLockedUntil.random = Date.now() + HELPER_LOCK_MS;
      Helpers.spendCharge('random');
      randomUseCount += 1;
      plantFinderFlower(pickFinderTarget());
      return true;
    }

    function useHelper(id) {
      if (id === 'finder') return useFinder();
      if (id === 'random') return useRandom();
      if (id === 'snowman') return useSnowman();
      return false;
    }

    function tapCell(row, col) {
      if (status !== 'playing') return;

      const cell = grid.cells[row][col];
      if (cell.locked) return;

      const now = Date.now();
      const isDoubleTap =
        lastTap &&
        lastTap.row === row &&
        lastTap.col === col &&
        now - lastTap.time <= DOUBLE_TAP_WINDOW_MS &&
        cell.state === CellState.X;

      if (isDoubleTap) {
        lastTap = null;
        attemptFlower(row, col, cell);
        return;
      }

      lastTap = { row, col, time: now };

      if (cell.state === CellState.EMPTY) {
        cell.state = CellState.X;
        commit();
      } else if (cell.state === CellState.X) {
        // Single tap on an existing X: wait out the double-tap window before
        // clearing, in case a second tap arrives and promotes it to a flower.
        // (A FLOWER cell is always locked, so there's no "tap clears it" case.)
        setTimeout(function () {
          if (cell.state === CellState.X) {
            cell.state = CellState.EMPTY;
            commit();
          }
        }, DOUBLE_TAP_WINDOW_MS);
      }
    }

    // Drag-to-mark: immediate, no double-tap ambiguity, never touches flowers,
    // the pre-placed flower, or red X marks.
    function markCellX(row, col) {
      if (status !== 'playing') return;
      const cell = grid.cells[row][col];
      if (cell.locked || cell.state !== CellState.EMPTY) return;
      cell.state = CellState.X;
      commit();
    }

    function clearCellX(row, col) {
      if (status !== 'playing') return;
      const cell = grid.cells[row][col];
      if (cell.locked || cell.state !== CellState.X) return;
      cell.state = CellState.EMPTY;
      commit();
    }

    startLevel(level);

    return { tapCell, markCellX, clearCellX, nextLevel, retryLevel, useHelper, canUseHelper, getSnapshot };
  }

  const State = {
    createGame,
    gridSizeForLevel,
    buildLevel,
    computeRating,
    randomRollSeed,
    MAX_LIVES,
    DOUBLE_TAP_WINDOW_MS,
    POINTS_PER_FLOWER,
    HELPER_LOCK_MS,
    SNOWMAN_CROSS_COUNT,
    RANDOM_CROSS_COUNT_OPTIONS,
    MILESTONE_HELPER_REWARD,
  };

  root.Garden = root.Garden || {};
  root.Garden.state = State;
})(typeof window !== 'undefined' ? window : globalThis);
