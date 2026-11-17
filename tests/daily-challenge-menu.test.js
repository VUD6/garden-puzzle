// Plain Node script, no test framework/dependency. Run with: node tests/daily-challenge-menu.test.js
// Covers the bug where the daily-challenge menu button in a 'done' (or
// 'locked') state could still start something: js/menu.js's click handler
// now re-derives the button's eligibility fresh at click time
// (Menu.challengeState), rather than trusting the DOM's own
// `.disabled`/`dataset.state`, so a click (mouse, touch, or a keyboard
// Enter/Space activation - a real <button> dispatches the exact same
// 'click' event for all three) can only ever call handlers.onDailyChallenge
// while that fresh state is 'available'. Uses a small fake DOM/document (no
// real browser needed), same spirit as tests/audio.test.js's fake
// AudioContext.
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
require('../js/grid.js');
require('../js/platform.js');
require('../js/helpers.js');
require('../js/rng.js');
require('../js/rules.js');
require('../js/solver.js');
require('../js/generator.js');
require('../js/levelstart.js');
require('../js/state.js');
require('../js/checkin.js');
require('../js/i18n.js');
require('../js/daily-challenge.js');
require('../js/menu.js');

const { platform: Platform, menu: Menu, dailyChallenge: DailyChallenge } = globalThis.Garden;

// menu.js's createMenuScreen calls Garden.audio.playEffect('tap') on a
// successful click - stubbed as a no-op rather than requiring the real
// js/audio.js (which assumes a real/feature-detectable Web Audio
// environment this test has no need for).
globalThis.Garden.audio = { playEffect: function () {} };

let failures = 0;
let checks = 0;

function assert(condition, message) {
  checks++;
  if (!condition) {
    failures++;
    console.error('FAIL: ' + message);
  }
}

function setNow(dateString) {
  Platform.now = function () {
    return new Date(dateString + 'T12:00:00');
  };
}

// --- Minimal fake DOM: just enough surface for js/menu.js's createMenuScreen
// to run end to end (classList, dataset, addEventListener/dispatch,
// attributes, a querySelector that always returns a fake icon child). ---
function makeFakeElement() {
  const listeners = {};
  const el = {
    className: '',
    classList: {
      _set: new Set(),
      add(cls) { this._set.add(cls); },
      remove(cls) { this._set.delete(cls); },
      contains(cls) { return this._set.has(cls); },
    },
    dataset: {},
    _attrs: {},
    hidden: true,
    disabled: false,
    textContent: '',
    children: [],
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    dispatch(type) {
      (listeners[type] || []).forEach(function (fn) { fn(); });
    },
    setAttribute(name, value) { this._attrs[name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null; },
    appendChild(child) { this.children.push(child); return child; },
    insertAdjacentElement() {},
    querySelector() { return this._iconChild || (this._iconChild = makeFakeElement()); },
  };
  return el;
}

globalThis.document = {
  createElement: function () { return makeFakeElement(); },
};

function makeFakeDom() {
  return {
    menuTitle: makeFakeElement(),
    menuSubtitle: makeFakeElement(),
    playButton: makeFakeElement(),
    howToPlayButton: makeFakeElement(),
    menuSettingsButton: makeFakeElement(),
    dailyChallengeButton: makeFakeElement(),
    dailyChallengeCaption: makeFakeElement(),
  };
}

function makeHandlers() {
  let onDailyChallengeCalls = 0;
  return {
    calls: () => onDailyChallengeCalls,
    handlers: {
      onPlay: function () {},
      onHowToPlay: function () {},
      onSettings: function () {},
      onDailyChallenge: function () { onDailyChallengeCalls++; },
    },
  };
}

// Simulates a user interaction with the button: identical whether it came
// from a mouse click, a touch tap, or a keyboard Enter/Space activation,
// since a real <button> dispatches the same 'click' event for all three and
// js/menu.js's handler has no separate keydown branch to diverge from it.
function clickButton(dom) {
  dom.dailyChallengeButton.dispatch('click');
}

function main() {
  // --- Click while locked (below level 15): does nothing ---
  resetStorage();
  Platform.saveProgress(5);
  setNow('2024-06-01');

  let dom = makeFakeDom();
  let h = makeHandlers();
  const menuLocked = Menu.createMenuScreen(dom, h.handlers);
  menuLocked.render();
  assert(dom.dailyChallengeButton.dataset.state === 'locked', 'rendered state is locked below level 15');
  assert(dom.dailyChallengeButton.disabled === true, 'the button is natively disabled while locked');

  clickButton(dom);
  assert(h.calls() === 0, 'clicking a locked button never calls onDailyChallenge');
  assert(Platform.loadProgress() === 5, 'a blocked click never changes saved progress');
  assert(DailyChallenge.isDoneToday() === false, 'a blocked click never marks the challenge done');

  // --- Click while already done today: does nothing ---
  resetStorage();
  Platform.saveProgress(20);
  Platform.saveHighestLevel(20);
  setNow('2024-06-02');
  const todayDone = globalThis.Garden.checkin.getTodayKey();
  // Grant today's reward directly (storage-level) so isDoneToday() is true,
  // without needing to actually play and win a full board in this test.
  Platform.saveDailyChallenge({ lastSeenDate: todayDone, lastRewardDate: todayDone, challengeStars: 1 });

  dom = makeFakeDom();
  h = makeHandlers();
  const menuDone = Menu.createMenuScreen(dom, h.handlers);
  menuDone.render();
  assert(dom.dailyChallengeButton.dataset.state === 'done', 'rendered state is done after already winning today');
  assert(dom.dailyChallengeButton.disabled === true, 'the button is natively disabled while done');
  assert(dom.dailyChallengeButton.getAttribute('aria-disabled') === 'true', 'aria-disabled reflects the done state too');

  const scoreBefore = Platform.loadTotalScore();
  const starsBefore = Platform.loadTotalStars();
  clickButton(dom);
  assert(h.calls() === 0, 'clicking a done button never calls onDailyChallenge');
  assert(DailyChallenge.isDoneToday() === true, 'the done record is completely unchanged by the blocked click');
  assert(Platform.loadTotalScore() === scoreBefore, 'a blocked click on "done" never changes total score');
  assert(Platform.loadTotalStars() === starsBefore, 'a blocked click on "done" never changes total stars');

  // Keyboard activation behaves identically (same 'click' event, no separate path).
  clickButton(dom);
  assert(h.calls() === 0, 'a second (keyboard-equivalent) activation on a done button still does nothing');

  // --- Click while available: starts the challenge, exactly once per click ---
  resetStorage();
  Platform.saveProgress(20);
  Platform.saveHighestLevel(20);
  setNow('2024-06-03');

  dom = makeFakeDom();
  h = makeHandlers();
  const menuAvailable = Menu.createMenuScreen(dom, h.handlers);
  menuAvailable.render();
  assert(dom.dailyChallengeButton.dataset.state === 'available', 'rendered state is available once unlocked and not yet won today');
  assert(dom.dailyChallengeButton.disabled === false, 'the button is natively enabled while available');
  assert(dom.dailyChallengeButton.getAttribute('aria-disabled') === 'false', 'aria-disabled reflects the available state too');

  clickButton(dom);
  assert(h.calls() === 1, 'clicking an available button calls onDailyChallenge exactly once');

  // A second click right after (e.g. a rapid double click) before any
  // re-render still calls through once more per click - menu.js never
  // debounces this itself; it's main.js's Garden.dailyChallenge.start()
  // that's the actual one-shot-per-day guard once a game is involved (see
  // tests/daily-challenge.test.js's own start()/canStart() coverage).
  clickButton(dom);
  assert(h.calls() === 2, 'a second click on a still-available button calls through again (idempotency lives in start(), not the button)');

  console.log(`${checks} checks run, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
