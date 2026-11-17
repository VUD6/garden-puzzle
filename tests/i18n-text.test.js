// Plain Node script, no test framework/dependency. Run with: node tests/i18n-text.test.js
// Covers two small text fixes: the win-screen rank titles are renamed to the
// "Пряничный ..." set (1/2/3 stars), and the milestone banner is collapsed
// to a single phrase (the old, redundant second-line caption key is gone).
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

I18n.setLang('ru'); // restore default for any later-loaded module in the same process

console.log(`${checks} checks run, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
