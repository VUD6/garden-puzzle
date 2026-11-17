// Plain Node script, no test framework/dependency. Run with: node tests/audio-hooks.test.js
// render.js/input.js/checkin.js/menu.js/tutorial.js are DOM-only modules
// (they need a real `document`, which this plain-Node test suite doesn't
// provide anywhere - see every other DOM-touching file's own tests, which
// only exercise their pure logic and leave the actual DOM wiring to a real-
// browser pass). A fake-AudioContext unit test therefore can't drive a real
// render() call to prove each game event actually plays the right sound.
// This test instead statically confirms the WIRING is present and uses the
// right effect ids - a lightweight textual check, the same technique
// tests/index-html-version.test.js already uses to check index.html without
// a browser. It can't catch "wired to the wrong event", only "never wired
// at all" or "wired with a typo'd/renamed id" - the real behavior still
// needs a real-browser pass (see GAME_DESIGN.md).
const fs = require('fs');
const path = require('path');

globalThis.localStorage = (function () {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
})();
require('../js/platform.js');
require('../js/audio.js');
const { audio: Audio } = globalThis.Garden;

let failures = 0;
let checks = 0;

function assert(condition, message) {
  checks++;
  if (!condition) {
    failures++;
    console.error('FAIL: ' + message);
  }
}

function readJs(file) {
  return fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');
}

const render = readJs('render.js');
const input = readJs('input.js');
const checkin = readJs('checkin.js');
const menu = readJs('menu.js');
const tutorial = readJs('tutorial.js');
const main = readJs('main.js');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function assertContains(text, snippet, message) {
  assert(text.includes(snippet), message + ` (looking for: ${snippet})`);
}

// --- index.html loads the new module (the one allowed index.html edit) ---
assert(/<script src="js\/audio\.js(\?[^"]*)?">/.test(indexHtml), 'index.html loads js/audio.js');

// --- render.js: state-driven effects, keyed off the actual snapshot/cell
// transitions rather than a separate game-logic change ---
assertContains(render, "playEffect('placeFlower')", 'render.js plays placeFlower when a cell becomes a flower');
assertContains(render, "playEffect('placeCross')", 'render.js plays placeCross when a cell becomes an X');
assertContains(render, "'lose' : 'mistake'", "render.js picks lose vs mistake off whether this mistake ended the game");
assertContains(render, "playEffect('win'", 'render.js plays win on the win screen');
assertContains(render, "playEffect('milestoneStart')", 'render.js plays milestoneStart on entering a milestone level');
const rewardCount = render.split("playEffect('reward')").length - 1;
assert(rewardCount >= 2, `render.js plays reward for both the milestone reward and the win-streak bonus badges (found ${rewardCount})`);

// --- input.js: generic tap tick + helper-use sparkle ---
assertContains(input, "playEffect('tap')", 'input.js has a generic button tap tick');
assertContains(input, "playEffect('helperUse')", 'input.js plays helperUse on a successful helper use');

// --- checkin.js: daily reward claim ---
assertContains(checkin, "playEffect('reward')", 'checkin.js plays reward on a successful daily-gift claim');
const checkinTapCount = checkin.split("playEffect('tap')").length - 1;
assert(checkinTapCount >= 2, `checkin.js ticks on opening/closing its popup (found ${checkinTapCount})`);

// --- menu.js: menu button ticks ---
const menuTapCount = menu.split("playEffect('tap')").length - 1;
assert(menuTapCount >= 3, `menu.js ticks on its Play/How-to-play/Settings buttons (found ${menuTapCount})`);

// --- tutorial.js: the same placeFlower/placeCross feedback as the real board ---
assertContains(tutorial, "playEffect('placeFlower')", 'tutorial.js plays placeFlower on its own flower step');
assertContains(tutorial, "playEffect('placeCross')", 'tutorial.js plays placeCross on its own mark steps');
assertContains(tutorial, "playEffect('tap')", 'tutorial.js ticks on its "Got it!" button');

// --- main.js: lifecycle wiring ---
assertContains(main, 'audio.init()', 'main.js calls Garden.audio.init() once at startup');
assertContains(main, 'audio.createSettingsRows(dom)', 'main.js builds the sfx/music settings rows');
assertContains(main, "audio.setMusicTrack('game')", 'main.js switches to the gameplay track on entering a level');
const menuTrackCount = main.split("audio.setMusicTrack('menu')").length - 1;
assert(menuTrackCount >= 2, `main.js switches to the menu/loading/tutorial track in more than one place (found ${menuTrackCount})`);

// --- completeness: every id audio.js actually defines is referenced by at
// least one of the hook files above - catches a sound effect defined in
// audio.js that nothing ever plays. ---
const hookedText = [render, input, checkin, menu, tutorial].join('\n');
Audio.EFFECT_IDS.forEach((id) => {
  assert(hookedText.includes(`'${id}'`), `effect "${id}" is referenced by at least one game-event hook`);
});

console.log(`${checks} checks run, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
