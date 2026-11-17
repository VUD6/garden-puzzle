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
  // solutions, while jagged ones are far more likely to pin down a unique one
  // (a 1-cell region in particular tends to be exactly what pins a board down
  // to a single solution - see the comment on repairSingleCellRegions below
  // for why that made forcing regions to size >=2 up front the wrong fix).
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

  // Per-region cell counts, indexed by region id (0..size-1).
  function regionSizes(size, regionOf) {
    const sizes = new Array(size).fill(0);
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        sizes[regionOf[row][col]]++;
      }
    }
    return sizes;
  }

  function countSingleCellRegions(size, regionOf) {
    return regionSizes(size, regionOf).filter((n) => n === 1).length;
  }

  function regionCellPositions(size, regionOf, region) {
    const cells = [];
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (regionOf[row][col] === region) cells.push({ row, col });
      }
    }
    return cells;
  }

  function isConnected4(cells) {
    if (cells.length <= 1) return true;
    const key = (r, c) => r + ',' + c;
    const set = new Set(cells.map((c) => key(c.row, c.col)));
    const seen = new Set([key(cells[0].row, cells[0].col)]);
    const stack = [cells[0]];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    while (stack.length) {
      const cell = stack.pop();
      for (const [dr, dc] of dirs) {
        const nr = cell.row + dr;
        const nc = cell.col + dc;
        const k = key(nr, nc);
        if (set.has(k) && !seen.has(k)) {
          seen.add(k);
          stack.push({ row: nr, col: nc });
        }
      }
    }
    return seen.size === cells.length;
  }

  // Gives every 1-cell region a second cell by stealing one from an adjacent
  // region - chosen so the donor region (a) keeps at least 2 cells of its
  // own, (b) stays itself 4-directionally connected once that cell is gone,
  // and (c) never gives up its OWN seed/flower cell (colsChosen[donor]),
  // since that would leave the donor region with no flower of its own. If no
  // such donor exists for a given lone region (rare), it's left as a
  // singleton; the caller re-checks afterward and rejects the whole attempt
  // if one still remains, exactly as if this repair had never run.
  //
  // Mutates regionOf in place. This - rather than forcing every region to
  // start with 2+ cells before growth even begins - is deliberate: an
  // earlier version of this cap tried exactly that and measured a roughly
  // 1-in-15000 chance of the result still having a unique solution for an
  // 8x8 board (bad enough to blow the generation-speed budget), against
  // roughly 1-in-600 when growth is left alone and only the rare singleton
  // that results is patched up afterward - a single-cell region turns out
  // to often be exactly what pins an 8x8 board down to one true solution,
  // so this only ever disturbs the one cell that actually needs to move.
  function repairSingleCellRegions(size, regionOf, colsChosen, rng) {
    const sizes = regionSizes(size, regionOf);
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    for (let region = 0; region < size; region++) {
      if (sizes[region] !== 1) continue;
      const lone = regionCellPositions(size, regionOf, region)[0];

      const order = shuffleArray(dirs, rng);
      for (const [dr, dc] of order) {
        const nr = lone.row + dr;
        const nc = lone.col + dc;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;

        const donor = regionOf[nr][nc];
        if (donor === region || sizes[donor] <= 2) continue;
        if (nr === donor && nc === colsChosen[donor]) continue;

        const donorCellsWithoutThis = regionCellPositions(size, regionOf, donor).filter(
          (c) => !(c.row === nr && c.col === nc)
        );
        if (!isConnected4(donorCellsWithoutThis)) continue;

        regionOf[nr][nc] = region;
        sizes[region]++;
        sizes[donor]--;
        break;
      }
    }
  }

  // maxSingleCellRegions (default Infinity, i.e. no cap) lets callers reject
  // a shape with too many 1-cell beds - after first trying to patch it up via
  // repairSingleCellRegions - before even running the (more expensive)
  // uniqueness check. See Garden.state.singleCellRegionCap for the schedule
  // that decides this cap per level.
  function generateLevel(size, rng, maxAttempts, maxSingleCellRegions) {
    rng = rng || Math.random;
    // Unconstrained generation (the common case) finds a unique-solution
    // board within a few hundred attempts at most; this higher ceiling only
    // matters for the much rarer "zero single-cell regions AND unique" 8x8
    // combination requested by the single-cell-region cap (see
    // repairSingleCellRegions above) - measured up to ~10000 attempts needed
    // in the worst case across a 1000-level sample, still well under 400ms.
    maxAttempts = maxAttempts || 50000;
    maxSingleCellRegions = maxSingleCellRegions === undefined ? Infinity : maxSingleCellRegions;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const solutionCols = generateSolution(size, rng);
      if (!solutionCols) continue;

      const regionOf = growRegions(size, solutionCols, rng);
      if (countSingleCellRegions(size, regionOf) > maxSingleCellRegions) {
        repairSingleCellRegions(size, regionOf, solutionCols, rng);
        if (countSingleCellRegions(size, regionOf) > maxSingleCellRegions) continue;
      }
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

  const Generator = {
    generateLevel,
    generateSolution,
    growRegions,
    regionSizes,
    countSingleCellRegions,
    repairSingleCellRegions,
  };

  root.Garden = root.Garden || {};
  root.Garden.generator = Generator;
})(typeof window !== 'undefined' ? window : globalThis);
