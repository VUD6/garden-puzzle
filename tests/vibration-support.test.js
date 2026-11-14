// Plain Node script, no test framework/dependency. Run with: node tests/vibration-support.test.js
// Covers platform.isVibrationSupported() feature detection (iOS Safari has no
// navigator.vibrate at all) and confirms the stored setting's default is
// unaffected either way.

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
require('../js/platform.js');

const { platform: Platform } = globalThis.Garden;

let failures = 0;
let checks = 0;

function assert(condition, message) {
  checks++;
  if (!condition) {
    failures++;
    console.error('FAIL: ' + message);
  }
}

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function setNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
}

function restoreNavigator() {
  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
  } else {
    delete globalThis.navigator;
  }
}

function main() {
  // --- Supported: navigator.vibrate exists (e.g. Android Chrome) ---
  setNavigator({ vibrate: function () {} });
  assert(Platform.isVibrationSupported() === true, 'detects support when navigator.vibrate exists');

  // --- Unsupported: navigator exists but has no vibrate (e.g. iOS Safari) ---
  setNavigator({});
  assert(Platform.isVibrationSupported() === false, 'detects lack of support when navigator.vibrate is missing');

  // --- Unsupported: no navigator at all ---
  restoreNavigator();
  delete globalThis.navigator;
  assert(Platform.isVibrationSupported() === false, 'detects lack of support when navigator is undefined');

  // --- The stored setting's default is unaffected by support either way ---
  resetStorage();
  setNavigator({});
  assert(Platform.loadVibrationEnabled() === true, 'default vibration setting stays true even when unsupported');
  setNavigator({ vibrate: function () {} });
  assert(Platform.loadVibrationEnabled() === true, 'default vibration setting stays true when supported');

  // --- vibrate() itself stays a safe no-op when unsupported (no throw) ---
  setNavigator({});
  let threw = false;
  try {
    Platform.vibrate(120);
  } catch (e) {
    threw = true;
  }
  assert(threw === false, 'vibrate() does not throw when navigator.vibrate is missing');

  restoreNavigator();

  console.log(`${checks} checks run, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
