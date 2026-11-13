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

    function getSnapshot() {
      return { level, lives, maxLives: MAX_LIVES, grid, status };
    }

    function emit() {
      onChange(getSnapshot());
    }

    function startLevel(levelNumber) {
      level = levelNumber;
      lives = MAX_LIVES;
      status = 'playing';
      const size = gridSizeForLevel(level);
      const generated = generator.generateLevel(size);
      grid = gridModule.createGrid(size, generated.regionOf);
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
      const newState = gridModule.nextState(cell.state);

      if (newState === gridModule.CellState.FLOWER && rules.wouldConflict(grid, row, col)) {
        cell.state = gridModule.CellState.EMPTY;
        lives--;
        if (lives <= 0) status = 'lost';
        emit();
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
