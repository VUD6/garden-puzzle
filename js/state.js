// Game state machine: ties grid/rules/generator/platform together behind a
// small API. No DOM dependency - render.js subscribes via the onChange callback.
(function (root) {
  const MAX_LIVES = 3;
  const SIZES_BY_STAGE = [4, 5, 6, 7, 8];
  const LEVELS_PER_STAGE = 3;
  const DOUBLE_TAP_WINDOW_MS = 300;

  function gridSizeForLevel(level) {
    const stageIndex = Math.min(Math.floor((level - 1) / LEVELS_PER_STAGE), SIZES_BY_STAGE.length - 1);
    return SIZES_BY_STAGE[stageIndex];
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

    function cellKey(row, col) {
      return row + ',' + col;
    }

    function getSnapshot() {
      return { level, lives, maxLives: MAX_LIVES, grid, status };
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
      return { lives, cells };
    }

    function commit(extra) {
      platform.saveBoard(level, serializeBoard());
      emit(extra);
    }

    function startLevel(levelNumber) {
      level = levelNumber;
      status = 'playing';
      lastTap = null;

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

      if (rules.isSolved(grid)) {
        status = 'won';
        platform.clearBoard(level);
        emit();
        return;
      }

      commit();
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

    startLevel(level);

    return { tapCell, nextLevel, retryLevel, getSnapshot };
  }

  const State = { createGame, gridSizeForLevel, buildLevel, MAX_LIVES, DOUBLE_TAP_WINDOW_MS };

  root.Garden = root.Garden || {};
  root.Garden.state = State;
})(typeof window !== 'undefined' ? window : globalThis);
