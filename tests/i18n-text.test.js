// Plain Node script, no test framework/dependency. Run with: node tests/i18n-text.test.js
// Covers three small text fixes: the win-screen rank titles are renamed to
// the "Пряничный ..." set (1/2/3 stars), the milestone banner is collapsed
// to a single phrase (the old, redundant second-line caption key is gone),
// and lives are candy canes - every "капли" (drops) string was replaced
// with candy-cane wording, including the fail-screen title and the lives
// aria-label's Russian plural forms (I18n.pluralRu).
require('../js/i18n.js');

const { i18n: I18n } = globalThis.Garden;

let failures = 0;
let checks = 0;

function assert(condition, message) {
  checks++;
  if (!condition) {
    failures++;
    console.error('FAIL: ' + message);
  }
}

I18n.setLang('ru');
assert(I18n.t('rankGardener') === 'Пряничный новичок', `1-star rank title is "Пряничный новичок" (got "${I18n.t('rankGardener')}")`);
assert(I18n.t('rankSkilledGardener') === 'Пряничный мастер', `2-star rank title is "Пряничный мастер" (got "${I18n.t('rankSkilledGardener')}")`);
assert(I18n.t('rankMasterGardener') === 'Пряничный волшебник', `3-star rank title is "Пряничный волшебник" (got "${I18n.t('rankMasterGardener')}")`);
assert(I18n.t('milestoneBannerTitle') === 'Праздничный уровень!', 'milestone banner title stays "Праздничный уровень!"');
assert(I18n.t('milestoneBannerCaption') === 'milestoneBannerCaption', 'the old redundant caption key no longer has a translation (t() falls back to the bare key)');

I18n.setLang('en');
assert(I18n.t('rankGardener') !== 'Gardener', '1-star rank title no longer the old "Gardener" (EN)');
assert(I18n.t('rankSkilledGardener') !== 'Skilled gardener', '2-star rank title no longer the old "Skilled gardener" (EN)');
assert(I18n.t('rankMasterGardener') !== 'Master gardener', '3-star rank title no longer the old "Master gardener" (EN)');

I18n.setLang('ru');

// --- Lives are candy canes, not water drops ---
assert(I18n.t('failTitle') === 'Леденцы закончились', `lose-screen title is "Леденцы закончились" (got "${I18n.t('failTitle')}")`);
assert(I18n.t('failMessage') === 'Попробуйте снова.', 'lose-screen subtitle stays "Попробуйте снова."');
assert(!/капл/i.test(I18n.t('failTitle')), 'the lose-screen title no longer mentions "капли" at all');

I18n.setLang('en');
assert(I18n.t('failTitle') === 'Out of candy canes', `EN lose-screen title is "Out of candy canes" (got "${I18n.t('failTitle')}")`);
assert(!/drop/i.test(I18n.t('failTitle')), 'the EN lose-screen title no longer mentions "drops"');

I18n.setLang('ru');

// --- I18n.pluralRu: the standard Slavic one/few/many split ---
const FORMS = ['один', 'немного', 'много'];
const PLURAL_CASES = [
  [0, 'много'], [1, 'один'], [2, 'немного'], [3, 'немного'], [4, 'немного'],
  [5, 'много'], [10, 'много'], [11, 'много'], [12, 'много'], [14, 'много'],
  [21, 'один'], [22, 'немного'], [25, 'много'], [101, 'один'], [112, 'много'],
];
for (const [n, expected] of PLURAL_CASES) {
  assert(I18n.pluralRu(n, FORMS) === expected, `pluralRu(${n}) is "${expected}" (got "${I18n.pluralRu(n, FORMS)}")`);
}

// --- The lives aria-label itself, across the 0-3 range the game actually uses ---
const LIVES_FORMS = ['livesAriaLabelOne', 'livesAriaLabelFew', 'livesAriaLabelMany'];
assert(I18n.t(I18n.pluralRu(0, LIVES_FORMS), { count: 0 }) === 'Осталось 0 леденцов', '0 lives: "Осталось 0 леденцов"');
assert(I18n.t(I18n.pluralRu(1, LIVES_FORMS), { count: 1 }) === 'Осталось 1 леденец', '1 life: "Осталось 1 леденец"');
assert(I18n.t(I18n.pluralRu(2, LIVES_FORMS), { count: 2 }) === 'Осталось 2 леденца', '2 lives: "Осталось 2 леденца"');
assert(I18n.t(I18n.pluralRu(3, LIVES_FORMS), { count: 3 }) === 'Осталось 3 леденца', '3 lives: "Осталось 3 леденца"');

I18n.setLang('ru'); // restore default for any later-loaded module in the same process

console.log(`${checks} checks run, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
