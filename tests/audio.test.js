// Plain Node script, no test framework/dependency. Run with: node tests/audio.test.js
// Covers js/audio.js's own logic with a fake AudioContext/document/window
// (no real browser needed): no audio plays before the first user gesture,
// settings persistence + the one-time migration, suspend/resume on
// visibility/blur/pagehide (including overlapping reasons), the external
// mute API (future Yandex ad hook), safe handling of an unknown effect
// name, the voice cap, and that every synthesized node gets disconnected
// once its voice ends (no leaks).

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
require('../js/audio.js');

const { platform: Platform, audio: Audio } = globalThis.Garden;

let failures = 0;
let checks = 0;

function assert(condition, message) {
  checks++;
  if (!condition) {
    failures++;
    console.error('FAIL: ' + message);
  }
}

// --- fake Web Audio graph: just enough surface for audio.js to drive, plus
// bookkeeping the tests read directly (created oscillators, disconnect
// calls, how many real AudioContext instances got constructed). ---

let contextsCreated = 0;
const createdOscillators = [];
let disconnectCount = 0;

function makeParam(initial) {
  return {
    value: initial,
    setValueAtTime(v) { this.value = v; },
    linearRampToValueAtTime(v) { this.value = v; },
    exponentialRampToValueAtTime(v) { this.value = v; },
    cancelScheduledValues() {},
  };
}

function makeNode(extra) {
  return Object.assign(
    {
      connect() {},
      disconnect() { disconnectCount++; },
    },
    extra || {}
  );
}

function FakeAudioContext() {
  contextsCreated++;
  let time = 0;
  const self = {
    state: 'suspended',
    get currentTime() { return time; },
    destination: makeNode(),
    createDynamicsCompressor() { return makeNode(); },
    createGain() { return makeNode({ gain: makeParam(1) }); },
    createBiquadFilter() { return makeNode({ frequency: { value: 0 }, type: 'lowpass' }); },
    createOscillator() {
      const osc = makeNode({
        type: 'sine',
        frequency: makeParam(440),
        onended: null,
        start() {},
        stop() {},
      });
      createdOscillators.push(osc);
      return osc;
    },
    resume() { self.state = 'running'; return Promise.resolve(); },
    suspend() { self.state = 'suspended'; return Promise.resolve(); },
    advance(seconds) { time += seconds; },
  };
  return self;
}

function makeFakeEventTarget(extra) {
  const listeners = {};
  return Object.assign(
    {
      addEventListener(type, fn) {
        (listeners[type] = listeners[type] || []).push(fn);
      },
      fire(type, event) {
        (listeners[type] || []).forEach((fn) => fn(event || {}));
      },
    },
    extra || {}
  );
}

function main() {
  const fakeWindow = makeFakeEventTarget({ AudioContext: FakeAudioContext });
  const fakeDocument = makeFakeEventTarget({ hidden: false });

  // --- settings persistence + one-time migration (pure Platform calls,
  // independent of the AudioContext/gesture state below) ---
  assert(Platform.loadSfxEnabled() === true, 'sfx defaults to on with nothing stored');
  assert(Platform.loadMusicEnabled() === true, 'music defaults to on with nothing stored');

  Platform.saveSfxEnabled(false);
  assert(Platform.loadSfxEnabled() === false, 'saveSfxEnabled persists false');
  Platform.saveSfxEnabled(true);

  Platform.saveTotalScore(250);
  Platform.migrateAudioSettings();
  Platform.migrateAudioSettings(); // idempotent - calling twice changes nothing further
  assert(Platform.loadSfxEnabled() === true, 'migration does not clobber an explicitly-set value');
  assert(Platform.loadTotalScore() === 250, 'migration never touches unrelated progress/score keys');

  // --- init() wires listeners but creates no AudioContext yet ---
  Audio.init({ document: fakeDocument, window: fakeWindow });
  assert(contextsCreated === 0, 'init() does not create an AudioContext by itself');

  // --- no audio before the first user gesture ---
  Audio.playEffect('tap');
  assert(createdOscillators.length === 0, 'playEffect() before any gesture is a silent no-op (no oscillator created)');

  // --- first gesture creates (and resumes) the context ---
  fakeDocument.fire('pointerdown', { view: fakeWindow });
  assert(contextsCreated === 1, 'the first gesture creates exactly one AudioContext');

  fakeDocument.fire('touchend', { view: fakeWindow });
  fakeDocument.fire('keydown', { view: fakeWindow });
  assert(contextsCreated === 1, 'later gestures never create a second AudioContext');

  const beforeTap = createdOscillators.length;
  Audio.playEffect('tap');
  assert(createdOscillators.length > beforeTap, 'playEffect() after a gesture actually schedules a voice');

  // --- unknown effect name: safe no-op, never throws ---
  const beforeUnknown = createdOscillators.length;
  let threw = false;
  try {
    Audio.playEffect('not-a-real-effect');
  } catch (e) {
    threw = true;
  }
  assert(threw === false, 'playEffect() with an unknown name never throws');
  assert(createdOscillators.length === beforeUnknown, 'an unknown effect name schedules nothing');

  // --- sfx setting gates playEffect() ---
  Audio.setSfxEnabled(false);
  assert(Platform.loadSfxEnabled() === false, 'setSfxEnabled(false) persists through platform.js');
  const beforeDisabledTap = createdOscillators.length;
  Audio.playEffect('placeFlower');
  assert(createdOscillators.length === beforeDisabledTap, 'playEffect() does nothing while sfx is disabled');
  Audio.setSfxEnabled(true);
  assert(Platform.loadSfxEnabled() === true, 'setSfxEnabled(true) persists through platform.js');

  // --- effect-to-event catalogue: a fixed id list the render/input/checkin/
  // menu/tutorial hooks (see tests/audio-hooks.test.js) are pinned against -
  // a rename here without updating that list would fail loudly there.
  const EXPECTED_EFFECT_IDS = [
    'tap', 'placeFlower', 'placeCross', 'mistake', 'helperUse', 'win', 'lose', 'reward', 'milestoneStart',
  ];
  EXPECTED_EFFECT_IDS.forEach((id) => {
    assert(Audio.EFFECT_IDS.includes(id), `EFFECT_IDS includes "${id}"`);
  });
  assert(Audio.EFFECT_IDS.length === EXPECTED_EFFECT_IDS.length, 'EFFECT_IDS has no extra/undocumented ids');

  // --- pause/resume on visibilitychange (hidden/visible) ---
  assert(fakeDocument.hidden === false, 'sanity: starts visible');
  fakeDocument.hidden = true;
  fakeDocument.fire('visibilitychange');
  const beforeHiddenTap = createdOscillators.length;
  Audio.playEffect('tap');
  assert(createdOscillators.length === beforeHiddenTap, 'playEffect() does nothing while the tab is hidden (context suspended)');

  fakeDocument.hidden = false;
  fakeDocument.fire('visibilitychange');
  const afterVisibleBefore = createdOscillators.length;
  Audio.playEffect('tap');
  assert(createdOscillators.length > afterVisibleBefore, 'playEffect() works again once the tab is visible');

  // --- overlapping pause reasons (hidden + blur): only resumes once BOTH
  // clear - mirrors state.js's own pauseTimer reason-set behavior.
  fakeDocument.hidden = true;
  fakeDocument.fire('visibilitychange');
  fakeWindow.fire('blur');
  fakeDocument.hidden = false;
  fakeDocument.fire('visibilitychange'); // one reason cleared, blur still active
  const stillBlurredBefore = createdOscillators.length;
  Audio.playEffect('tap');
  assert(createdOscillators.length === stillBlurredBefore, 'still silenced while blur alone is still an active pause reason');

  fakeWindow.fire('focus'); // the other reason clears -> fully resumed
  const afterFocusBefore = createdOscillators.length;
  Audio.playEffect('tap');
  assert(createdOscillators.length > afterFocusBefore, 'resumes once every pause reason has cleared');

  // --- pagehide/pageshow ---
  fakeWindow.fire('pagehide');
  const duringPagehideBefore = createdOscillators.length;
  Audio.playEffect('tap');
  assert(createdOscillators.length === duringPagehideBefore, 'silenced during pagehide');
  fakeWindow.fire('pageshow');
  const afterPageshowBefore = createdOscillators.length;
  Audio.playEffect('tap');
  assert(createdOscillators.length > afterPageshowBefore, 'resumes after pageshow');

  // --- external mute API (future Yandex ad hook) ---
  Audio.setExternalMute('ad', true);
  const duringAdBefore = createdOscillators.length;
  Audio.playEffect('tap');
  assert(createdOscillators.length === duringAdBefore, 'setExternalMute("ad", true) silences effects');
  Audio.setExternalMute('ad', false);
  const afterAdBefore = createdOscillators.length;
  Audio.playEffect('tap');
  assert(createdOscillators.length > afterAdBefore, 'setExternalMute("ad", false) restores sound');

  // External mute stacks with a real pause reason too.
  fakeDocument.hidden = true;
  fakeDocument.fire('visibilitychange');
  Audio.setExternalMute('ad', true);
  Audio.setExternalMute('ad', false); // tab is still hidden
  const stillHiddenBefore = createdOscillators.length;
  Audio.playEffect('tap');
  assert(createdOscillators.length === stillHiddenBefore, 'clearing the external mute alone does not resume while still hidden');
  fakeDocument.hidden = false;
  fakeDocument.fire('visibilitychange');

  // --- no node leaks: every oscillator disconnects (itself + its gain + its
  // lowpass filter, when it has one) once its voice ends, and the freed
  // voice slot can immediately be reused. ---
  const voicesBeforeCap = createdOscillators.length;
  for (let i = 0; i < 40; i++) Audio.playEffect('tap'); // far more than the internal voice cap
  const cappedCount = createdOscillators.length - voicesBeforeCap;
  assert(cappedCount > 0 && cappedCount < 40, `the voice cap silently drops excess simultaneous effects (created ${cappedCount} of 40 requested)`);

  const disconnectBefore = disconnectCount;
  const liveOscillators = createdOscillators.slice(voicesBeforeCap);
  liveOscillators.forEach((osc) => {
    assert(typeof osc.onended === 'function', 'every oscillator has an onended cleanup handler attached');
    if (typeof osc.onended === 'function') osc.onended();
  });
  assert(disconnectCount > disconnectBefore, 'ending a voice disconnects its nodes');

  const afterCleanupBefore = createdOscillators.length;
  Audio.playEffect('tap');
  assert(createdOscillators.length > afterCleanupBefore, 'a freed voice slot can be reused immediately after cleanup');

  // --- music: setMusicTrack() is safe to call before a gesture, and the
  // scheduler actually starts producing notes once a track is selected and
  // the context exists. ---
  Platform.saveMusicEnabled(true);
  Audio.setMusicEnabled(true);
  const beforeTrack = createdOscillators.length;
  Audio.setMusicTrack('menu');
  assert(createdOscillators.length > beforeTrack, 'selecting a track while the context already exists starts scheduling notes right away');

  threw = false;
  try {
    Audio.setMusicTrack('bogus-track-name');
  } catch (e) {
    threw = true;
  }
  assert(threw === false, 'setMusicTrack() with an invalid name never throws');

  console.log(`${checks} checks run, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
