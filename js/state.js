// Game state machine: ties grid/rules/generator/platform together behind a
// small API. No DOM dependency - render.js subscribes via the onChange callback.
(function (root) {
  const MAX_LIVES = 3;
  const DOUBLE_TAP_WINDOW_MS = 300;
  const POINTS_PER_FLOWER = 10;

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
    let lastTap = null; // { row, col, time } - tracks the double-tap gesture
    let levelScore = 0;
    let totalScore = platform.loadTotalScore();
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
        totalScore,
        perfect: lives === MAX_LIVES,
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
      return { lives, levelScore, cells };
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

      const given = built.solution[built.givenIndex];
      const givenCell = grid.cells[given.row][given.col];
      givenCell.state = CellState.FLOWER;
      givenCell.locked = true;

      const saved = platform.loadBoard(levelNumber);
      if (saved && Array.isArray(saved.cells) && saved.cells.length === built.size) {
        lives = saved.lives;
        levelScore = saved.levelScore || 0;
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
    // best time is updated if this run beat it.
    function finishLevel(scoreGain) {
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

      const previousBest = platform.loadBestTime(level);
      const bestTimeSeconds = previousBest === null ? elapsedSeconds : Math.min(previousBest, elapsedSeconds);
      platform.saveBestTime(level, bestTimeSeconds);

      status = 'won';
      platform.clearBoard(level);
      emit({ scoreGain, winFill, rating, elapsedSeconds, bestTimeSeconds });
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

      cell.state = CellState.FLOWER;
      levelScore += POINTS_PER_FLOWER;
      totalScore += POINTS_PER_FLOWER;
      platform.saveTotalScore(totalScore);

      const scoreGain = { row, col, amount: POINTS_PER_FLOWER };

      if (rules.isSolved(grid)) {
        finishLevel(scoreGain);
        return;
      }

      commit({ scoreGain });
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
        setTimeout(function () {
          if (cell.state === CellState.X) {
            cell.state = CellState.EMPTY;
            commit();
          }
        }, DOUBLE_TAP_WINDOW_MS);
      } else if (cell.state === CellState.FLOWER) {
        cell.state = CellState.EMPTY;
        commit();
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

    return { tapCell, markCellX, clearCellX, nextLevel, retryLevel, getSnapshot };
  }

  const State = {
    createGame,
    gridSizeForLevel,
    buildLevel,
    computeRating,
    MAX_LIVES,
    DOUBLE_TAP_WINDOW_MS,
    POINTS_PER_FLOWER,
  };

  root.Garden = root.Garden || {};
  root.Garden.state = State;
})(typeof window !== 'undefined' ? window : globalThis);
