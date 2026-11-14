// Game state machine: ties grid/rules/generator/platform together behind a
// small API. No DOM dependency - render.js subscribes via the onChange callback.
(function (root) {
  const MAX_LIVES = 3;
  const DOUBLE_TAP_WINDOW_MS = 300;
  const POINTS_PER_FLOWER = 10;
  const HINT_COST = 10;
  // Minimum gap between two hint uses - blocks a rapid repeated tap from
  // ever being processed while the previous hint's animation is still
  // playing, so a hint can never charge twice for the same flower.
  const HINT_LOCK_MS = 400;

  // Seed reward for a level's first-ever completion, keyed by star rating.
  const SEED_REWARD_BY_RATING = { 1: 3, 2: 5, 3: 8 };

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
  // same regions, solution, and pre-placed flower, for every player and every
  // reload, because it is derived entirely from a PRNG seeded by the level
  // number (never Math.random).
  function buildLevel(levelNumber) {
    const size = gridSizeForLevel(levelNumber);
    const rng = root.Garden.rng.createRng(levelNumber);
    const generated = root.Garden.generator.generateLevel(size, rng);
    const givenIndex = Math.floor(rng() * generated.solution.length);
    return { size, regionOf: generated.regionOf, solution: generated.solution, givenIndex };
  }

  function createGame(options) {
    options = options || {};
    const onChange = options.onChange || function () {};

    const platform = root.Garden.platform;
    const gridModule = root.Garden.grid;
    const rules = root.Garden.rules;
    const CellState = gridModule.CellState;

    let level = platform.loadProgress();
    let lives = MAX_LIVES;
    let grid = null;
    let status = 'playing'; // 'playing' | 'won' | 'lost'
    let solutionKeys = null; // Set of 'row,col' for the puzzle's one true solution
    // The solution's flowers, ordered ascending by row (see buildLevel/
    // generator.js: solution[i].row === i by construction). Hints rely on
    // this order to deterministically pick "the unplanted flower with the
    // lowest row index" - see pickHintTarget below.
    let solutionList = null;
    let lastTap = null; // { row, col, time } - tracks the double-tap gesture
    let levelScore = 0;
    let committedScore = platform.loadTotalScore(); // persisted total; only changes on first-ever level completion
    let seeds = platform.loadSeeds(); // soft currency; independent of score, spent on hints
    let hintLockedUntil = 0; // Date.now() timestamp; double-spend guard, see useHint
    let awardedCells = new Set(); // 'row,col' already scored this attempt - safeguard against double-awarding
    let levelStartTime = Date.now();

    function cellKey(row, col) {
      return row + ',' + col;
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
        seeds,
        hintCost: HINT_COST,
        canUseHint: canUseHint(),
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
      return { lives, levelScore, cells, awardedCells: Array.from(awardedCells) };
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

      const given = built.solution[built.givenIndex];
      const givenCell = grid.cells[given.row][given.col];
      givenCell.state = CellState.FLOWER;
      givenCell.locked = true;

      const saved = platform.loadBoard(levelNumber);
      if (saved && Array.isArray(saved.cells) && saved.cells.length === built.size) {
        lives = saved.lives;
        levelScore = saved.levelScore || 0;
        awardedCells = new Set(Array.isArray(saved.awardedCells) ? saved.awardedCells : []);
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
      }

      platform.saveProgress(level);
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
    // best time is updated if this run beat it. hintPos (if this win was
    // the hinted flower) is passed through only so the renderer knows which
    // cell to play the hint-specific animation on.
    function finishLevel(scoreGain, hintPos) {
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
      // score and seed reward only ever come from this level's first-ever
      // completion - replaying an already-completed level earns no more of
      // either.
      const previousBest = platform.loadBestTime(level);
      const alreadyCompletedBefore = previousBest !== null;
      const bestTimeSeconds = alreadyCompletedBefore ? Math.min(previousBest, elapsedSeconds) : elapsedSeconds;
      platform.saveBestTime(level, bestTimeSeconds);

      let seedGain = null;
      if (!alreadyCompletedBefore) {
        committedScore += levelScore;
        platform.saveTotalScore(committedScore);

        const reward = SEED_REWARD_BY_RATING[rating] || 0;
        if (reward > 0) {
          seeds += reward;
          platform.saveSeeds(seeds);
          seedGain = reward;
        }
      }

      status = 'won';
      platform.clearBoard(level);
      emit({ scoreGain, winFill, rating, elapsedSeconds, bestTimeSeconds, seedGain, hint: hintPos || null });
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

    // Deterministic hint target: among the solution's flowers not yet
    // planted, the one with the lowest row index. solutionList is already
    // ordered ascending by row (see the comment where it's declared above),
    // so the first eligible entry found by a plain forward scan is correct.
    // Red-X cells can never be solution cells in normal play (attemptFlower
    // only marks a cell WRONG when it is *not* in solutionKeys), but that
    // state is skipped too as a defensive guard.
    function pickHintTarget() {
      for (const pos of solutionList) {
        const cell = grid.cells[pos.row][pos.col];
        if (cell.state === CellState.FLOWER || cell.state === CellState.WRONG) continue;
        return pos;
      }
      return null;
    }

    function canUseHint() {
      if (status !== 'playing') return false;
      if (Date.now() < hintLockedUntil) return false;
      if (seeds < HINT_COST) return false;
      return pickHintTarget() !== null;
    }

    // Plants one correct flower from the unique solution, exactly like a
    // correctly-tapped one (same lock, same bloom, same bed-tracker update,
    // same win trigger if it's the last one) - but earns no points and
    // costs no life/mistake. The cost is deducted and persisted immediately,
    // before the cell even changes, so a crash/reload mid-animation can
    // never leave the player charged-but-hintless or hinted-but-unharged.
    function useHint() {
      if (!canUseHint()) return false;

      hintLockedUntil = Date.now() + HINT_LOCK_MS;
      const target = pickHintTarget();
      seeds -= HINT_COST;
      platform.saveSeeds(seeds);

      const cell = grid.cells[target.row][target.col];
      cell.state = CellState.FLOWER;
      cell.locked = true;

      // Belt-and-suspenders, exactly like a correct tap: mark the cell as
      // "awarded" so it can never later be scored, even though this award
      // is worth 0 points (a hint never earns the +10).
      awardedCells.add(cellKey(target.row, target.col));

      if (rules.isSolved(grid)) {
        finishLevel(null, target);
      } else {
        commit({ hint: target });
      }
      return true;
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

    return { tapCell, markCellX, clearCellX, nextLevel, retryLevel, useHint, canUseHint, getSnapshot };
  }

  const State = {
    createGame,
    gridSizeForLevel,
    buildLevel,
    computeRating,
    MAX_LIVES,
    DOUBLE_TAP_WINDOW_MS,
    POINTS_PER_FLOWER,
    HINT_COST,
    HINT_LOCK_MS,
    SEED_REWARD_BY_RATING,
  };

  root.Garden = root.Garden || {};
  root.Garden.state = State;
})(typeof window !== 'undefined' ? window : globalThis);
