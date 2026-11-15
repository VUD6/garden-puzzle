// Plain Node script, no test framework/dependency. Run with: node tests/themes.test.js
// Covers the theme registry: default resolution, stored-value overrides and
// corruption-tolerance, that switching themes never touches level generation,
// and that the winter piece-art contrast shades stay sane for every bed.
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

// --- winter piece color contrast check for all 8 beds ---

function parseHsl(hslString) {
  const match = /^hsl\(([\d.]+) (\d+)% (\d+)%\)$/.exec(hslString);
  assert(match !== null, `"${hslString}" parses as an hsl() string`);
  return match ? { h: Number(match[1]), s: Number(match[2]), l: Number(match[3]) } : null;
}

const winterBedColors = Themes.THEMES.winter.bedColors;
assert(winterBedColors.length === 8, 'winter theme defines exactly 8 bed colors');
assert(new Set(winterBedColors).size === 8, 'winter theme bed colors are all distinct');

for (const hex of winterBedColors) {
  const shades = Themes.contrastShades(hex);
  for (const ring of ['outer', 'middle', 'inner']) {
    const parsed = parseHsl(shades[ring]);
    if (!parsed) continue;
    assert(parsed.l > 0 && parsed.l < 100, `${hex} ${ring} shade lightness (${parsed.l}%) never clips to pure black/white`);
    assert(parsed.s > 0, `${hex} ${ring} shade keeps some saturation (not a flat grey)`);
  }
}

console.log(`${checks} checks run, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
