// Game state machine: ties grid/rules/generator/platform together behind a
// small API. No DOM dependency - render.js subscribes via the onChange callback.
(function (root) {
  const MAX_LIVES = 3;
  const SIZES_BY_STAGE = [4, 5, 6, 7, 8];
  const LEVELS_PER_STAGE = 3;

  function gridSizeForLevel(level) {
    const stageIndex = Math.min(Math.floor((level - 1) / LEVELS_PER_STAGE), SIZES_BY_STAGE.length - 1);
    return SIZES_BY_STAGE[stageIndex];
  }

  function createGame(options) {
    options = options || {};
    const onChange = options.onChange || function () {};

    const platform = root.Garden.platform;
    const generator = root.Garden.generator;
    const gridModule = root.Garden.grid;
    const rules = root.Garden.rules;

    let level = platform.loadProgress();
    let lives = MAX_LIVES;
    let grid = null;
    let status = 'playing'; // 'playing' | 'won' | 'lost'
    let solutionKeys = null; // Set of 'row,col' for the puzzle's one true solution

    function cellKey(row, col) {
      return row + ',' + col;
    }

    function getSnapshot() {
      return { level, lives, maxLives: MAX_LIVES, grid, status };
    }

    function emit(extra) {
      onChange(Object.assign(getSnapshot(), extra || {}));
    }

    function startLevel(levelNumber) {
      level = levelNumber;
      lives = MAX_LIVES;
      status = 'playing';
      const size = gridSizeForLevel(level);
      const generated = generator.generateLevel(size);
      grid = gridModule.createGrid(size, generated.regionOf);

      solutionKeys = new Set(generated.solution.map((pos) => cellKey(pos.row, pos.col)));

      // Give the player a starting point: one solution flower is pre-placed and locked.
      const given = generated.solution[Math.floor(Math.random() * generated.solution.length)];
      const givenCell = grid.cells[given.row][given.col];
      givenCell.state = gridModule.CellState.FLOWER;
      givenCell.locked = true;

      platform.saveProgress(level);
      emit();
    }

    function retryLevel() {
      startLevel(level);
    }

    function nextLevel() {
      startLevel(level + 1);
    }

    function tapCell(row, col) {
      if (status !== 'playing') return;

      const cell = grid.cells[row][col];
      if (cell.locked) return;

      const newState = gridModule.nextState(cell.state);

      if (newState === gridModule.CellState.FLOWER && !solutionKeys.has(cellKey(row, col))) {
        cell.state = gridModule.CellState.WRONG;
        cell.locked = true;
        lives--;
        if (lives <= 0) status = 'lost';
        emit({ mistake: { row, col, lostLifeIndex: lives } });
        return;
      }

      cell.state = newState;

      if (newState === gridModule.CellState.FLOWER && rules.isSolved(grid)) {
        status = 'won';
      }

      emit();
    }

    startLevel(level);

    return { tapCell, nextLevel, retryLevel, getSnapshot };
  }

  const State = { createGame, gridSizeForLevel, MAX_LIVES };

  root.Garden = root.Garden || {};
  root.Garden.state = State;
})(typeof window !== 'undefined' ? window : globalThis);
