// Plain Node script, no test framework/dependency. Run with: node tests/themes.test.js
// Covers the theme registry: default resolution, stored-value overrides and
// corruption-tolerance, that switching themes never touches level generation,
// that the winter bed colors stay distinguishable from each other and from
// the board background, and that the fixed-color gingerbread stays legible
// against every one of those bed colors.
require('../js/rng.js');
require('../js/grid.js');
require('../js/rules.js');
require('../js/solver.js');
require('../js/generator.js');

function makeMemoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

globalThis.localStorage = makeMemoryStorage();
require('../js/platform.js');
require('../js/themes.js');
require('../js/state.js');

const { platform: Platform, themes: Themes, state: State } = globalThis.Garden;

let failures = 0;
let checks = 0;

function assert(condition, message) {
  checks++;
  if (!condition) {
    failures++;
    console.error('FAIL: ' + message);
  }
}

// --- DEFAULT_THEME_ID resolution ---

assert(Themes.DEFAULT_THEME_ID === 'winter', 'DEFAULT_THEME_ID is winter');
assert(Platform.loadTheme() === null, 'nothing stored yet: loadTheme() returns null');
assert(Themes.applyTheme(Platform.loadTheme()) === 'winter', 'nothing stored: resolves to winter (the default)');

// --- stored theme overrides the default ---

Platform.saveTheme('garden');
assert(Platform.loadTheme() === 'garden', 'loadTheme() returns the stored value');
assert(Themes.applyTheme(Platform.loadTheme()) === 'garden', 'stored "garden" resolves to garden, overriding the default');

Platform.saveTheme('winter');
assert(Themes.applyTheme(Platform.loadTheme()) === 'winter', 'stored "winter" resolves to winter');

// --- invalid stored value falls back to the default ---

Platform.saveTheme('bogus-theme-id');
assert(Platform.loadTheme() === 'bogus-theme-id', 'loadTheme() returns the raw (invalid) stored value as-is');
assert(Themes.applyTheme(Platform.loadTheme()) === 'winter', 'an invalid stored value falls back to DEFAULT_THEME_ID');
assert(Themes.applyTheme(undefined) === 'winter', 'applyTheme(undefined) falls back to the default');
assert(Themes.applyTheme('') === 'winter', 'applyTheme("") falls back to the default');

// --- theme switching never alters a generated level ---

const LEVELS = [1, 3, 6, 10, 15, 22];

for (const level of LEVELS) {
  Themes.applyTheme('winter');
  const underWinter = State.buildLevel(level);
  Themes.applyTheme('garden');
  const underGarden = State.buildLevel(level);

  assert(underWinter.size === underGarden.size, `level ${level}: size identical regardless of active theme`);
  assert(
    JSON.stringify(underWinter.regionOf) === JSON.stringify(underGarden.regionOf),
    `level ${level}: bed map (regionOf) identical regardless of active theme`
  );
  assert(
    JSON.stringify(underWinter.solution) === JSON.stringify(underGarden.solution),
    `level ${level}: solution identical regardless of active theme`
  );
  assert(underWinter.givenIndex === underGarden.givenIndex, `level ${level}: pre-placed flower index identical regardless of active theme`);
}

// --- garden theme stays exactly today's look ---

const ORIGINAL_REGION_COLORS = ['#c97b84', '#6f9bc4', '#cdb15a', '#6fb08a', '#a888c9', '#cc8c5c', '#5cb3a8', '#c47bb0'];
assert(
  JSON.stringify(Themes.THEMES.garden.bedColors) === JSON.stringify(ORIGINAL_REGION_COLORS),
  'garden theme bed colors are unchanged from the original 8 region colors'
);

// --- winter bed colors: minimum pairwise distance + distance from the board background ---

const winterBedColors = Themes.THEMES.winter.bedColors;
assert(winterBedColors.length === 8, 'winter theme defines exactly 8 bed colors');
assert(new Set(winterBedColors).size === 8, 'winter theme bed colors are all distinct');

// Thresholds picked with real margin below the palette's actual worst case
// (checked separately while tuning the colors: worst pairwise ~95, worst
// vs-background ~227) so a future color tweak that erodes distinguishability
// fails loudly well before it becomes a real problem.
const MIN_PAIRWISE_DISTANCE = 80;
const MIN_BACKGROUND_DISTANCE = 150;

let minPairwiseDistance = Infinity;
for (let i = 0; i < winterBedColors.length; i++) {
  for (let j = i + 1; j < winterBedColors.length; j++) {
    const d = Themes.colorDistance(winterBedColors[i], winterBedColors[j]);
    minPairwiseDistance = Math.min(minPairwiseDistance, d);
  }
}
assert(
  minPairwiseDistance >= MIN_PAIRWISE_DISTANCE,
  `winter bed colors stay >= ${MIN_PAIRWISE_DISTANCE} color-distance apart from each other (worst pair: ${minPairwiseDistance.toFixed(1)})`
);

const bgTop = Themes.THEMES.winter.tokens['--bg-top'];
const bgBottom = Themes.THEMES.winter.tokens['--bg-bottom'];
assert(typeof bgTop === 'string' && typeof bgBottom === 'string', 'winter theme defines both background gradient stops');

let minBackgroundDistance = Infinity;
for (const hex of winterBedColors) {
  const d = Math.min(Themes.colorDistance(hex, bgTop), Themes.colorDistance(hex, bgBottom));
  minBackgroundDistance = Math.min(minBackgroundDistance, d);
}
assert(
  minBackgroundDistance >= MIN_BACKGROUND_DISTANCE,
  `winter bed colors stay >= ${MIN_BACKGROUND_DISTANCE} color-distance from the board background (worst: ${minBackgroundDistance.toFixed(1)})`
);

// --- winter gingerbread: body/outline contrast against all 8 bed colors ---

// The gingerbread uses a FIXED body/outline palette (not hue-derived like
// the flower), so what needs checking is that fixed pair against every one
// of the 8 bed colors - whichever of the two (the dark body or the cream
// outline) contrasts more is what actually carries the silhouette, so the
// readability bar is "at least one of them clears the threshold", not both.
const MIN_CONTRAST_RATIO = 3; // WCAG's "large text/graphics" baseline

const pieceColors = Themes.THEMES.winter.pieceColors;
assert(pieceColors && typeof pieceColors.body === 'string' && typeof pieceColors.outline === 'string', 'winter theme exposes its fixed gingerbread body/outline colors');

let minGingerbreadContrast = Infinity;
for (const hex of winterBedColors) {
  const best = Math.max(Themes.contrastRatio(pieceColors.body, hex), Themes.contrastRatio(pieceColors.outline, hex));
  minGingerbreadContrast = Math.min(minGingerbreadContrast, best);
}
assert(
  minGingerbreadContrast >= MIN_CONTRAST_RATIO,
  `the gingerbread's body or outline clears a ${MIN_CONTRAST_RATIO}:1 contrast ratio against every winter bed color (worst: ${minGingerbreadContrast.toFixed(2)}:1)`
);

console.log(`${checks} checks run, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
