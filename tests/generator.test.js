// Plain Node script, no test framework/dependency. Run with: node tests/generator.test.js
require('../js/grid.js');
require('../js/rules.js');
require('../js/solver.js');
require('../js/generator.js');

const { grid: Grid, rules: Rules, solver: Solver, generator: Generator } = globalThis.Garden;

let failures = 0;
let checks = 0;

function assert(condition, message) {
  checks++;
  if (!condition) {
    failures++;
    console.error('FAIL: ' + message);
  }
}

function isConnected(size, regionOf, regionIndex) {
  const cells = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (regionOf[row][col] === regionIndex) cells.push({ row, col });
    }
  }
  if (cells.length === 0) return false;

  const key = (r, c) => r + ',' + c;
  const belongsToRegion = new Set(cells.map((c) => key(c.row, c.col)));
  const seen = new Set([key(cells[0].row, cells[0].col)]);
  const queue = [cells[0]];
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  while (queue.length) {
    const cell = queue.pop();
    for (const [dr, dc] of dirs) {
      const nr = cell.row + dr;
      const nc = cell.col + dc;
      const k = key(nr, nc);
      if (belongsToRegion.has(k) && !seen.has(k)) {
        seen.add(k);
        queue.push({ row: nr, col: nc });
      }
    }
  }

  return seen.size === cells.length;
}

const SIZES = [4, 5, 6, 7, 8];
const TRIALS_PER_SIZE = 20;

for (const size of SIZES) {
  for (let trial = 0; trial < TRIALS_PER_SIZE; trial++) {
    const level = Generator.generateLevel(size);

    assert(level.size === size, `size ${size} trial ${trial}: level.size matches`);

    // Exactly one solution.
    const solutionCount = Solver.countSolutions(size, level.regionOf, 3);
    assert(solutionCount === 1, `size ${size} trial ${trial}: exactly one solution (got ${solutionCount})`);

    // Every region appears exactly once in the regionOf matrix's index set, and
    // every region is 4-directionally connected.
    const regionIndices = new Set();
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        regionIndices.add(level.regionOf[row][col]);
      }
    }
    assert(regionIndices.size === size, `size ${size} trial ${trial}: exactly ${size} distinct regions (got ${regionIndices.size})`);
    for (let r = 0; r < size; r++) {
      assert(isConnected(size, level.regionOf, r), `size ${size} trial ${trial}: region ${r} is connected`);
    }

    // The generator's own solution must satisfy the rules engine too (grid.js + rules.js).
    const liveGrid = Grid.createGrid(size, level.regionOf);
    for (const { row, col } of level.solution) {
      liveGrid.cells[row][col].state = Grid.CellState.FLOWER;
    }
    assert(Rules.isSolved(liveGrid), `size ${size} trial ${trial}: generator's solution satisfies rules.isSolved`);
  }
}

console.log(`${checks} checks run, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
