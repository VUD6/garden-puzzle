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
        rowCells.push({ row, col, region: regionOf[row][col], state: CellState.EMPTY, locked: false, given: false });
      }
      cells.push(rowCells);
    }
    return { size, cells };
  }

  const Grid = { CellState, createGrid };

  root.Garden = root.Garden || {};
  root.Garden.grid = Grid;
})(typeof window !== 'undefined' ? window : globalThis);
