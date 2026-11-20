// Plain Node script, no test framework/dependency. Run with: node tests/i18n-parity.test.js
// Covers the RU/EN localization added to js/i18n.js: the ru and en
// dictionaries have exactly the same key set, no empty values, and the
// same {placeholder} names per key (so a template that needs {count} in
// one language can never silently lose it in the other); the real
// language-aware plural helper (I18n.plural - ru one/few/many, en
// one/other, replacing pluralRu's "always-Russian-rule" approximation for
// any NEW count-driven string); the initial-language resolution priority
// order (saved > platform > navigator > "en" default) and its "ru"/"else en"
// normalization, including a platform that failed/couldn't answer (null)
// falling straight through to navigator.language; and js/platform.js's
// saveLang/loadLang persistence (localStorage round-trip, corruption-
// tolerant default). js/main.js's own two-phase boot sequence (a quick
// guess, corrected once the platform adapter's handshake and the cloud-save
// merge have both actually settled) is covered where its two moving parts
// actually live instead: the "platform answers late" timing in
// tests/platform-adapter.test.js, and "cloud lang overrides local" in
// tests/cloudsave.test.js.
function makeMemoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

function resetStorage() {
  globalThis.localStorage = makeMemoryStorage();
}

resetStorage();
require('../js/i18n.js');
require('../js/platform.js');

const { i18n: I18n, platform: Platform } = globalThis.Garden;

let failures = 0;
let checks = 0;

function assert(condition, message) {
  checks++;
  if (!condition) {
    failures++;
    console.error('FAIL: ' + message);
  }
}

// Every {placeholder} name referenced in a template string, as a sorted,
// de-duplicated array - e.g. "Уровень {level}" -> ['level'].
function placeholdersIn(str) {
  if (typeof str !== 'string') return [];
  const found = new Set();
  const re = /\{(\w+)\}/g;
  let match;
  while ((match = re.exec(str)) !== null) found.add(match[1]);
  return Array.from(found).sort();
}

function main() {
  // --- Key parity: ru and en define EXACTLY the same set of keys ---
  const ruKeys = new Set(I18n._allKeys('ru'));
  const enKeys = new Set(I18n._allKeys('en'));
  assert(ruKeys.size > 0 && enKeys.size > 0, 'both dictionaries are actually non-empty');

  const missingFromEn = [...ruKeys].filter((k) => !enKeys.has(k));
  const missingFromRu = [...enKeys].filter((k) => !ruKeys.has(k));
  assert(missingFromEn.length === 0, `every ru key also exists in en (missing from en: ${missingFromEn.join(', ')})`);
  assert(missingFromRu.length === 0, `every en key also exists in ru (missing from ru: ${missingFromRu.join(', ')})`);

  // --- No empty values in either dictionary ---
  let emptyCount = 0;
  ruKeys.forEach((key) => {
    ['ru', 'en'].forEach((lang) => {
      const value = I18n._rawValue(lang, key);
      if (typeof value !== 'string' || value.length === 0) {
        emptyCount++;
        console.error(`FAIL: ${lang}.${key} is empty or not a string (got ${JSON.stringify(value)})`);
      }
    });
  });
  checks += ruKeys.size * 2;
  failures += emptyCount;

  // --- Same {placeholder} set per key, in both languages ---
  let placeholderMismatches = 0;
  ruKeys.forEach((key) => {
    const ruPlaceholders = placeholdersIn(I18n._rawValue('ru', key)).join(',');
    const enPlaceholders = placeholdersIn(I18n._rawValue('en', key)).join(',');
    checks++;
    if (ruPlaceholders !== enPlaceholders) {
      placeholderMismatches++;
      console.error(`FAIL: "${key}" placeholders differ (ru: [${ruPlaceholders}], en: [${enPlaceholders}])`);
    }
  });
  failures += placeholderMismatches;

  // --- I18n.plural: Russian one/few/many ---
  I18n.setLang('ru');
  const RU_FORMS = { one: 'ONE', few: 'FEW', many: 'MANY', other: 'OTHER' };
  const RU_CASES = [
    [0, 'MANY'], [1, 'ONE'], [2, 'FEW'], [4, 'FEW'], [5, 'MANY'],
    [11, 'MANY'], [21, 'ONE'], [22, 'FEW'], [25, 'MANY'], [101, 'ONE'], [112, 'MANY'],
  ];
  RU_CASES.forEach(([n, expected]) => {
    assert(I18n.plural(n, RU_FORMS) === expected, `ru plural(${n}) is "${expected}" (got "${I18n.plural(n, RU_FORMS)}")`);
  });

  // --- I18n.plural: English one/other - crucially, including counts a
  // Russian-rule-based approximation (the legacy pluralRu) would get
  // WRONG, like 21 (Russian "one", English "other") ---
  I18n.setLang('en');
  const EN_CASES = [
    [0, 'OTHER'], [1, 'ONE'], [2, 'OTHER'], [5, 'OTHER'],
    [21, 'OTHER'], [100, 'OTHER'], [101, 'OTHER'],
  ];
  EN_CASES.forEach(([n, expected]) => {
    assert(I18n.plural(n, RU_FORMS) === expected, `en plural(${n}) is "${expected}" (got "${I18n.plural(n, RU_FORMS)}")`);
  });
  I18n.setLang('ru'); // restore default for any later-loaded module in the same process

  // --- normalizeLangCode: "ru" if the code starts with "ru", else "en" ---
  assert(I18n.normalizeLangCode('ru') === 'ru', 'normalizeLangCode("ru") is "ru"');
  assert(I18n.normalizeLangCode('ru-RU') === 'ru', 'normalizeLangCode("ru-RU") is "ru"');
  assert(I18n.normalizeLangCode('RU') === 'ru', 'normalizeLangCode is case-insensitive');
  assert(I18n.normalizeLangCode('en') === 'en', 'normalizeLangCode("en") is "en"');
  assert(I18n.normalizeLangCode('en-US') === 'en', 'normalizeLangCode("en-US") is "en"');
  assert(I18n.normalizeLangCode('be') === 'en', 'a Russian-adjacent locale (be) is NOT special-cased to "ru" - spec says keep it simple');
  assert(I18n.normalizeLangCode('kk') === 'en', 'a Russian-adjacent locale (kk) is NOT special-cased to "ru"');
  assert(I18n.normalizeLangCode(null) === 'en', 'a missing/non-string code falls back to "en"');
  assert(I18n.normalizeLangCode(undefined) === 'en', 'undefined falls back to "en"');

  // --- resolveInitialLang: priority order saved > platform > navigator > default ---
  assert(I18n.resolveInitialLang('en', 'ru', 'ru-RU') === 'en', 'an explicit saved choice always wins over everything else');
  assert(I18n.resolveInitialLang('ru', 'en', 'en-US') === 'ru', 'saved "ru" wins too, regardless of platform/navigator');
  assert(I18n.resolveInitialLang(null, 'en-US', 'ru-RU') === 'en', 'absent a saved choice, the platform language wins over navigator.language');
  assert(I18n.resolveInitialLang(undefined, null, 'en-GB') === 'en', 'absent saved AND platform, navigator.language is used');
  assert(I18n.resolveInitialLang(null, null, null) === 'en', 'absent all three sources, the default is "en" (no signal at all to go on)');
  assert(I18n.resolveInitialLang('fr', null, 'en-US') === 'en', 'a corrupted/unrecognized saved value is treated as "nothing saved"');
  assert(I18n.resolveInitialLang(null, 'ru-RU', null) === 'ru', 'the platform language is normalized the same way navigator.language is');

  // --- resolveInitialLang: "platform failing" - a platform whose adapter
  // couldn't answer (a rejected/timed-out handshake, or simply no
  // getLanguage() support) always reports null rather than throwing (see
  // js/platform-adapter.js's forward()/js/platform-yandex.js's getLanguage())
  // - resolveInitialLang must fall straight through to navigator.language
  // exactly as if the platform source were never offered at all. ---
  assert(I18n.resolveInitialLang(null, null, 'ru-RU') === 'ru', 'a failed/unavailable platform (null) falls through to navigator.language');
  assert(I18n.resolveInitialLang(null, null, 'en-GB') === 'en', 'same fall-through, resolving to "en" via navigator.language');

  // --- js/platform.js: saveLang/loadLang persistence ---
  resetStorage();
  assert(Platform.loadLang() === null, 'loadLang() is null when nothing has ever been saved');
  Platform.saveLang('en');
  assert(Platform.loadLang() === 'en', 'saveLang/loadLang round-trips through localStorage');
  Platform.saveLang('ru');
  assert(Platform.loadLang() === 'ru', 'saving again overwrites the previous choice');

  console.log(`${checks} checks run, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
