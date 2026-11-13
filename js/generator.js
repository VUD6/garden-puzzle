// Level generator: places flowers, grows regions around them, verifies the
// resulting puzzle has a unique solution via solver.js. No DOM dependency -
// safe to run in Node for tests. Depends on Garden.solver (load solver.js first).
(function (root) {
  function shuffleRange(n, rng) {
    const arr = Array.from({ length: n }, (_, i) => i);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function shuffleArray(items, rng) {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  // Randomized backtracking: one flower per row/column, no two in adjacent
  // (incl. diagonal) rows-and-columns. Returns an array of columns indexed by row.
  function generateSolution(size, rng) {
    const colsChosen = new Array(size).fill(-1);
    const colUsed = new Array(size).fill(false);

    function backtrack(row) {
      if (row === size) return true;
      const order = shuffleRange(size, rng);
      for (const col of order) {
        if (colUsed[col]) continue;
        if (row > 0 && Math.abs(colsChosen[row - 1] - col) <= 1) continue;

        colUsed[col] = true;
        colsChosen[row] = col;

        if (backtrack(row + 1)) return true;

        colUsed[col] = false;
        colsChosen[row] = -1;
      }
      return false;
    }

    return backtrack(0) ? colsChosen : null;
  }

  // Random-Eden-style growth: a single shared frontier of (region, cell) claims,
  // one random entry picked and grown per step (4-directional, so regions stay
  // connected). This produces jagged, interlocking region shapes rather than
  // round Voronoi blobs - round regions turn out to admit many alternate
  // solutions, while jagged ones are far more likely to pin down a unique one.
  function growRegions(size, colsChosen, rng) {
    const regionOf = Array.from({ length: size }, () => new Array(size).fill(-1));
    let frontier = [];
    for (let i = 0; i < size; i++) {
      const row = i;
      const col = colsChosen[i];
      regionOf[row][col] = i;
      frontier.push({ row, col, region: i });
    }

    let remaining = size * size - size;
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    while (remaining > 0 && frontier.length > 0) {
      const idx = Math.floor(rng() * frontier.length);
      const entry = frontier[idx];
      const dirOrder = shuffleArray(dirs, rng);
      let claimed = null;

      for (const [dr, dc] of dirOrder) {
        const nr = entry.row + dr;
        const nc = entry.col + dc;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        if (regionOf[nr][nc] !== -1) continue;

        regionOf[nr][nc] = entry.region;
        claimed = { row: nr, col: nc, region: entry.region };
        remaining--;
        break;
      }

      if (claimed) {
        frontier.push(claimed);
      } else {
        frontier.splice(idx, 1);
      }
    }

    // Fallback for any cell the flood-fill couldn't reach (shouldn't happen on a
    // fully connected grid, but keeps the generator from ever returning -1 cells).
    if (remaining > 0) {
      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
          if (regionOf[row][col] !== -1) continue;
          let best = 0;
          let bestDist = Infinity;
          for (let i = 0; i < size; i++) {
            const dist = Math.abs(row - i) + Math.abs(col - colsChosen[i]);
            if (dist < bestDist) {
              bestDist = dist;
              best = i;
            }
          }
          regionOf[row][col] = best;
        }
      }
    }

    return regionOf;
  }

  function generateLevel(size, rng, maxAttempts) {
    rng = rng || Math.random;
    maxAttempts = maxAttempts || 5000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const solutionCols = generateSolution(size, rng);
      if (!solutionCols) continue;

      const regionOf = growRegions(size, solutionCols, rng);
      if (root.Garden.solver.hasUniqueSolution(size, regionOf)) {
        const solution = solutionCols.map((col, row) => ({ row, col }));
        return { size, regionOf, solution };
      }
    }

    throw new Error(
      'Garden.generator: failed to generate a unique-solution level for size ' +
        size +
        ' after ' +
        maxAttempts +
        ' attempts'
    );
  }

  const Generator = { generateLevel, generateSolution, growRegions };

  root.Garden = root.Garden || {};
  root.Garden.generator = Generator;
})(typeof window !== 'undefined' ? window : globalThis);
