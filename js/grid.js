// Grid/cell data model. No DOM dependency - safe to run in Node for tests.
(function (root) {
  const CellState = Object.freeze({
    EMPTY: 'empty',
    X: 'x',
    FLOWER: 'flower',
    // A flower attempt that turned out wrong: marked with a red X and locked,
    // so the cell permanently shows "no flower belongs here".
    WRONG: 'wrong',
  });

  // regionOf: size x size array of region indices (0..size-1)
  function createGrid(size, regionOf) {
    const cells = [];
    for (let row = 0; row < size; row++) {
      const rowCells = [];
      for (let col = 0; col < size; col++) {
        rowCells.push({ row, col, region: regionOf[row][col], state: CellState.EMPTY, locked: false });
      }
      cells.push(rowCells);
    }
    return { size, cells };
  }

  function getCell(grid, row, col) {
    return grid.cells[row][col];
  }

  function forEachCell(grid, fn) {
    for (let row = 0; row < grid.size; row++) {
      for (let col = 0; col < grid.size; col++) {
        fn(grid.cells[row][col]);
      }
    }
  }

  function nextState(state) {
    if (state === CellState.EMPTY) return CellState.X;
    if (state === CellState.X) return CellState.FLOWER;
    return CellState.EMPTY;
  }

  const Grid = { CellState, createGrid, getCell, forEachCell, nextState };

  root.Garden = root.Garden || {};
  root.Garden.grid = Grid;
})(typeof window !== 'undefined' ? window : globalThis);
