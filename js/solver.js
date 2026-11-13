// Counts solutions for a region layout (one flower per row/col/region, no touching).
// Operates on a plain regionOf matrix, independent of grid.js, so it can be reused
// by the generator (uniqueness check) and later by a hint system.
(function (root) {
  // Exactly one flower per row (by construction) and per column (colUsed) and per
  // region (regionUsed). Two flowers can only ever be adjacent if they sit in
  // consecutive rows (since each row holds exactly one flower), so the touch check
  // only needs to compare the current row's candidate column against the previous
  // row's chosen column.
  function countSolutions(size, regionOf, limit = 2) {
    const colUsed = new Array(size).fill(false);
    const regionUsed = new Array(size).fill(false);
    const colsChosen = new Array(size).fill(-1);
    let count = 0;

    function backtrack(row) {
      if (count >= limit) return;
      if (row === size) {
        count++;
        return;
      }
      for (let col = 0; col < size; col++) {
        if (colUsed[col]) continue;
        const region = regionOf[row][col];
        if (regionUsed[region]) continue;
        if (row > 0 && Math.abs(colsChosen[row - 1] - col) <= 1) continue;

        colUsed[col] = true;
        regionUsed[region] = true;
        colsChosen[row] = col;

        backtrack(row + 1);

        colUsed[col] = false;
        regionUsed[region] = false;

        if (count >= limit) return;
      }
    }

    backtrack(0);
    return count;
  }

  function hasUniqueSolution(size, regionOf) {
    return countSolutions(size, regionOf, 2) === 1;
  }

  const Solver = { countSolutions, hasUniqueSolution };

  root.Garden = root.Garden || {};
  root.Garden.solver = Solver;
})(typeof window !== 'undefined' ? window : globalThis);
