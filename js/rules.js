// Pure rule-validation functions. No DOM dependency - safe to run in Node for tests.
(function (root) {
  function isAdjacent(a, b) {
    if (a.row === b.row && a.col === b.col) return false;
    return Math.abs(a.row - b.row) <= 1 && Math.abs(a.col - b.col) <= 1;
  }

  function getFlowerPositions(grid) {
    const positions = [];
    const CellState = root.Garden.grid.CellState;
    for (let row = 0; row < grid.size; row++) {
      for (let col = 0; col < grid.size; col++) {
        const cell = grid.cells[row][col];
        if (cell.state === CellState.FLOWER) positions.push(cell);
      }
    }
    return positions;
  }

  function isSolved(grid) {
    const flowers = getFlowerPositions(grid);
    if (flowers.length !== grid.size) return false;

    const rowsSeen = new Set();
    const colsSeen = new Set();
    const regionsSeen = new Set();

    for (const flower of flowers) {
      if (rowsSeen.has(flower.row)) return false;
      if (colsSeen.has(flower.col)) return false;
      if (regionsSeen.has(flower.region)) return false;
      rowsSeen.add(flower.row);
      colsSeen.add(flower.col);
      regionsSeen.add(flower.region);
    }

    for (let i = 0; i < flowers.length; i++) {
      for (let j = i + 1; j < flowers.length; j++) {
        if (isAdjacent(flowers[i], flowers[j])) return false;
      }
    }

    return true;
  }

  const Rules = { isAdjacent, getFlowerPositions, isSolved };

  root.Garden = root.Garden || {};
  root.Garden.rules = Rules;
})(typeof window !== 'undefined' ? window : globalThis);
