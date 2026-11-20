// Sound and music: everything here is synthesized at runtime with the Web
// Audio API - no audio files, no network requests, nothing recorded. Kept
// browser-only but defensive about it (every entry point checks for a real
// AudioContext before touching it), so a test can swap in a fake
// AudioContext/document/window and exercise the gating logic without a
// real browser - see tests/audio.test.js.
(function (root) {
  const Platform = root.Garden.platform;

  const MAX_VOICES = 16; // hard cap on simultaneous synthesized voices
  const MUSIC_GAIN = 0.1; // music sits well below effects, per design
  const MUSIC_CROSSFADE_SECONDS = 1.4;
  const MUSIC_MUTE_FADE_SECONDS = 0.5;
  const SCHEDULE_LOOKAHEAD_SECONDS = 0.6;
  const SCHEDULE_INTERVAL_MS = 150;

  let ctx = null;
  let masterGain = null; // -> compressor -> destination; effects connect here directly
  let compressor = null;
  let musicBus = null; // overall music volume + the on/off fade lives here
  let menuTrackGain = null; // crossfade weight (0..1) for the menu/loading/tutorial track
  let gameTrackGain = null; // crossfade weight (0..1) for the gameplay track
  let activeVoices = 0;

  let sfxEnabled = true;
  let musicEnabled = true;
  let gestureListenersAttached = false;
  let pauseListenersAttached = false;

  // Overlapping reasons to go silent, same "only resume once every reason
  // clears" shape as state.js's timerPauseReasons - visibility/blur/pagehide
  // can overlap, and an external mute (future ad) is tracked separately so
  // either one alone is enough to silence everything.
  const pauseReasons = new Set();
  const externalMutes = new Set();

  let currentTrackName = null; // 'menu' | 'game' | null
  const trackPlayers = { menu: null, game: null }; // active scheduler state per track, or null

  function resolveAudioContextCtor(win) {
    if (win && (win.AudioContext || win.webkitAudioContext)) return win.AudioContext || win.webkitAudioContext;
    if (typeof AudioContext !== 'undefined') return AudioContext;
    return null;
  }

  // Created lazily and only ever from a real user gesture (see
  // attachGestureListeners) - iOS Safari/Yandex Browser require this; an
  // AudioContext constructed any earlier starts (and stays) suspended there.
  function ensureContext(win) {
    if (ctx) return ctx;
    const Ctor = resolveAudioContextCtor(win || (typeof window !== 'undefined' ? window : null));
    if (!Ctor) return null;
    ctx = new Ctor();

    compressor = ctx.createDynamicsCompressor();
    compressor.connect(ctx.destination);

    masterGain = ctx.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(compressor);

    musicBus = ctx.createGain();
    musicBus.gain.value = musicEnabled ? MUSIC_GAIN : 0;
    musicBus.connect(masterGain);

    menuTrackGain = ctx.createGain();
    menuTrackGain.gain.value = 0;
    menuTrackGain.connect(musicBus);

    gameTrackGain = ctx.createGain();
    gameTrackGain.gain.value = 0;
    gameTrackGain.connect(musicBus);

    return ctx;
  }

  function isSilenced() {
    return pauseReasons.size > 0 || externalMutes.size > 0;
  }

  function applyPauseState() {
    if (!ctx) return;
    if (isSilenced()) {
      if (ctx.state === 'running' && typeof ctx.suspend === 'function') ctx.suspend();
    } else if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      ctx.resume();
    }
  }

  // --- first-gesture unlock (and re-unlock, if a later gesture finds the
  // context suspended for any reason) ---
  const GESTURE_EVENTS = ['pointerdown', 'touchend', 'keydown'];

  function handleGesture(event) {
    const win = (event && event.view) || (typeof window !== 'undefined' ? window : null);
    const hadNoContext = !ctx;
    ensureContext(win);
    if (!ctx) return;
    if (!isSilenced() && ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume();
    // The context didn't exist yet when setMusicTrack()/setMusicEnabled()
    // were last called (e.g. the menu track is selected before the player
    // has interacted at all) - start it now that there's finally somewhere
    // to play it.
    if (hadNoContext && musicEnabled && currentTrackName) {
      ensureTrackRunning(currentTrackName);
      rampGain(trackGainFor(currentTrackName), 1, MUSIC_CROSSFADE_SECONDS);
    }
  }

  // Registered in the CAPTURE phase so this always runs before any bubble-
  // phase game handler on the same tap (e.g. the board's own pointerdown) -
  // otherwise the very first tap's own sound effect could try to play one
  // tick before the context this handler creates actually exists.
  function attachGestureListeners(doc) {
    if (gestureListenersAttached || !doc || typeof doc.addEventListener !== 'function') return;
    gestureListenersAttached = true;
    GESTURE_EVENTS.forEach(function (type) {
      doc.addEventListener(type, handleGesture, { passive: true, capture: true });
    });
  }

  // Suspends/resumes on visibilitychange/pagehide/blur, exactly the pause
  // triggers CLAUDE.md requires - mirrors state.js's own pauseTimer reasons,
  // just for audio instead of the level clock.
  function attachPauseListeners(doc, win) {
    if (pauseListenersAttached || !doc || !win) return;
    pauseListenersAttached = true;

    function setReason(reason, active) {
      if (active) pauseReasons.add(reason);
      else pauseReasons.delete(reason);
      applyPauseState();
    }

    if (typeof doc.addEventListener === 'function') {
      doc.addEventListener('visibilitychange', function () {
        setReason('hidden', !!doc.hidden);
      });
    }
    if (typeof win.addEventListener === 'function') {
      win.addEventListener('pagehide', function () { setReason('pagehide', true); });
      win.addEventListener('pageshow', function () { setReason('pagehide', false); });
      win.addEventListener('blur', function () { setReason('blur', true); });
      win.addEventListener('focus', function () { setReason('blur', false); });
    }
  }

  // Called once at startup. Loads the two persisted settings and wires the
  // gesture/pause listeners - does NOT create an AudioContext itself (see
  // ensureContext's own comment on why that has to wait for a real gesture).
  function init(options) {
    options = options || {};
    const doc = options.document || (typeof document !== 'undefined' ? document : null);
    const win = options.window || (typeof window !== 'undefined' ? window : null);

    sfxEnabled = Platform.loadSfxEnabled();
    musicEnabled = Platform.loadMusicEnabled();

    attachGestureListeners(doc);
    attachPauseListeners(doc, win);
  }

  // Future Yandex SDK hook (CLAUDE.md step 8): e.g.
  // Garden.audio.setExternalMute('ad', true) right before showing a
  // rewarded/interstitial ad, false right after - independent of (and
  // stacks with) the visibility/blur pause reasons above.
  function setExternalMute(key, muted) {
    if (muted) externalMutes.add(key);
    else externalMutes.delete(key);
    applyPauseState();
  }

  function rampGain(gainNode, target, seconds) {
    if (!ctx || !gainNode) return;
    const now = ctx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(gainNode.gain.value, now);
    gainNode.gain.linearRampToValueAtTime(target, now + seconds);
  }

  function trackGainFor(name) {
    return name === 'menu' ? menuTrackGain : name === 'game' ? gameTrackGain : null;
  }

  function setSfxEnabled(enabled) {
    sfxEnabled = !!enabled;
    Platform.saveSfxEnabled(sfxEnabled);
  }

  function setMusicEnabled(enabled) {
    musicEnabled = !!enabled;
    Platform.saveMusicEnabled(musicEnabled);
    if (!ctx) return;

    if (musicEnabled) {
      rampGain(musicBus, MUSIC_GAIN, MUSIC_MUTE_FADE_SECONDS);
      if (currentTrackName) {
        ensureTrackRunning(currentTrackName);
        rampGain(trackGainFor(currentTrackName), 1, MUSIC_MUTE_FADE_SECONDS);
      }
      return;
    }

    // Stops with a short fade (per CLAUDE.md), then actually tears the
    // scheduler(s) down once the fade finishes - rather than leaving them
    // running silently forever, which would waste CPU for the rest of the
    // session every time a disabled player keeps playing.
    rampGain(musicBus, 0, MUSIC_MUTE_FADE_SECONDS);
    setTimeout(function () {
      if (musicEnabled) return; // re-enabled again before the fade finished
      Object.keys(trackPlayers).forEach(function (name) {
        stopTrackScheduler(trackPlayers[name]);
        trackPlayers[name] = null;
      });
    }, MUSIC_MUTE_FADE_SECONDS * 1000 + 100);
  }

  function isSfxEnabled() { return sfxEnabled; }
  function isMusicEnabled() { return musicEnabled; }

  // --- generic synth voice: one short enveloped oscillator tone, optionally
  // lowpass-filtered for the duller/woodier timbres. Self-disconnects via
  // 'onended' - the single place every synthesized node gets torn down, so
  // a long session can never accumulate dead nodes (see tests/audio.test.js's
  // leak check). ---
  function cleanupVoice(nodes) {
    nodes.forEach(function (node) {
      try { node.disconnect(); } catch (e) { /* already disconnected */ }
    });
    activeVoices = Math.max(0, activeVoices - 1);
  }

  function tone(destination, opts) {
    if (!ctx || !destination || activeVoices >= MAX_VOICES) return;
    const now = ctx.currentTime;
    const start = now + (opts.delay || 0);
    const duration = opts.duration || 0.3;
    const peak = opts.peak != null ? opts.peak : 0.25;
    const attack = opts.attack != null ? opts.attack : 0.012;

    const osc = ctx.createOscillator();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.freq, start);
    if (opts.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqEnd), start + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0005, peak), start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);

    const nodes = [osc, gain];
    if (opts.lowpass) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = opts.lowpass;
      gain.connect(filter);
      filter.connect(destination);
      nodes.push(filter);
    } else {
      gain.connect(destination);
    }

    activeVoices++;
    osc.start(start);
    osc.stop(start + duration + 0.05);
    osc.onended = function () { cleanupVoice(nodes); };
  }

  // --- sound effects: short (<1s), soft, cozy bell/marimba/wood timbres,
  // never harsh. Each plays into masterGain directly (bypassing musicBus),
  // so the effects volume/mute is independent of the music settings. ---
  function effectWin(opts) {
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach(function (freq, i) {
      tone(masterGain, { freq, type: 'sine', delay: i * 0.09, duration: 0.4, peak: 0.24, lowpass: 5200 });
    });
    if (opts && opts.rating === 3) {
      const extraDelay = notes.length * 0.09;
      tone(masterGain, { freq: 1318.5, type: 'sine', delay: extraDelay, duration: 0.5, peak: 0.26, lowpass: 6200 });
      tone(masterGain, { freq: 1568.0, type: 'triangle', delay: extraDelay + 0.05, duration: 0.5, peak: 0.16, lowpass: 7000 });
    }
  }

  const EFFECTS = {
    tap: function () {
      tone(masterGain, { freq: 720, type: 'triangle', duration: 0.06, peak: 0.12, attack: 0.004, lowpass: 3200 });
    },
    placeFlower: function () {
      tone(masterGain, { freq: 784.0, type: 'sine', duration: 0.22, peak: 0.22, lowpass: 4200 });
      tone(masterGain, { freq: 987.77, type: 'sine', duration: 0.26, peak: 0.18, delay: 0.05, lowpass: 4200 });
    },
    placeCross: function () {
      tone(masterGain, { freq: 520, freqEnd: 300, type: 'square', duration: 0.09, peak: 0.16, attack: 0.003, lowpass: 900 });
    },
    mistake: function () {
      tone(masterGain, { freq: 180, freqEnd: 110, type: 'sine', duration: 0.3, peak: 0.22, lowpass: 500 });
    },
    helperUse: function () {
      [1046.5, 1318.5, 1568.0, 1760.0].forEach(function (freq, i) {
        tone(masterGain, { freq, type: 'triangle', duration: 0.18, peak: 0.1, delay: i * 0.035, lowpass: 6000 });
      });
    },
    win: effectWin,
    lose: function () {
      [587.33, 523.25, 440.0, 349.23].forEach(function (freq, i) {
        tone(masterGain, { freq, type: 'sine', duration: 0.4, peak: 0.18, delay: i * 0.12, lowpass: 2500 });
      });
    },
    reward: function () {
      [784.0, 987.77, 1174.66, 1568.0].forEach(function (freq, i) {
        tone(masterGain, { freq, type: 'triangle', duration: 0.22, peak: 0.15, delay: i * 0.055, lowpass: 6500 });
      });
    },
    milestoneStart: function () {
      [523.25, 659.25, 783.99, 1046.5].forEach(function (freq, i) {
        tone(masterGain, { freq, type: 'triangle', duration: 0.3, peak: 0.22, delay: i * 0.08, lowpass: 7000 });
      });
    },
  };

  // The only entry point game code calls for a one-shot sound. Silently
  // does nothing if effects are off, no gesture has happened yet (no ctx),
  // the context is currently suspended (pause/external mute), or `name`
  // isn't a known effect - callers never need to guard any of that
  // themselves.
  function playEffect(name, opts) {
    if (!sfxEnabled || !ctx || isSilenced()) return;
    const fn = EFFECTS[name];
    if (fn) fn(opts || {});
  }

  // --- music: two short, calm, original, procedurally-generated loops
  // (bell melody over a soft sustained pad), scheduled with a look-ahead
  // timer so timing survives the main thread being busy for a few ms. ---

  function degreeFreq(scale, degree) {
    const len = scale.length;
    const octave = Math.floor(degree / len);
    const idx = ((degree % len) + len) % len;
    return scale[idx] * Math.pow(2, octave);
  }

  // `degrees`: one scale-degree index per step (or null for a rest), spaced
  // evenly (`stepSeconds` apart) across the loop - a small, readable way to
  // describe a melody without a giant hand-written frequency table.
  function buildBellPattern(scale, degrees, stepSeconds, noteDuration, peak, lowpass) {
    const notes = [];
    degrees.forEach(function (degree, i) {
      if (degree === null) return;
      notes.push({ time: i * stepSeconds, freq: degreeFreq(scale, degree), duration: noteDuration, type: 'sine', peak, lowpass });
    });
    return notes;
  }

  // C D E G A (major pentatonic) - unhurried, 64 BPM-ish spacing.
  const MENU_SCALE = [261.63, 293.66, 329.63, 392.0, 440.0];
  // D E G A C - still consonant with the menu scale, slightly busier.
  const GAME_SCALE = [293.66, 329.63, 392.0, 440.0, 523.25];

  const MENU_TRACK = {
    loopSeconds: 24,
    notes: buildBellPattern(MENU_SCALE, [0, null, 2, 4, null, 3, 2, null, 5, 4, 2, null, 0, null, 2, null], 1.5, 1.1, 0.14, 4600).concat([
      { time: 0, freq: 130.81, duration: 23, type: 'sine', peak: 0.045, attack: 3, lowpass: 700 },
      { time: 0, freq: 196.0, duration: 23, type: 'sine', peak: 0.03, attack: 3.4, lowpass: 700 },
    ]),
  };
  const GAME_TRACK = {
    loopSeconds: 20,
    notes: buildBellPattern(GAME_SCALE, [2, null, 0, 1, null, 3, 4, null, 2, 0, null, 1, 3, null, 2, null], 1.25, 1.0, 0.13, 4200).concat([
      { time: 0, freq: 146.83, duration: 19, type: 'sine', peak: 0.045, attack: 3, lowpass: 700 },
      { time: 0, freq: 220.0, duration: 19, type: 'sine', peak: 0.03, attack: 3.2, lowpass: 700 },
    ]),
  };

  function trackDefinition(name) {
    if (name === 'menu') return MENU_TRACK;
    if (name === 'game') return GAME_TRACK;
    return null;
  }

  function scheduleLoopAt(def, destination, loopStart) {
    def.notes.forEach(function (note) {
      tone(destination, {
        freq: note.freq,
        freqEnd: note.freqEnd,
        type: note.type,
        duration: note.duration,
        peak: note.peak,
        attack: note.attack,
        lowpass: note.lowpass,
        delay: loopStart + note.time - ctx.currentTime,
      });
    });
  }

  function startTrackScheduler(name) {
    const def = trackDefinition(name);
    const destination = trackGainFor(name);
    if (!def || !destination || !ctx) return null;

    const state = { nextLoopTime: ctx.currentTime + 0.05, timerId: null };
    function tick() {
      while (state.nextLoopTime < ctx.currentTime + SCHEDULE_LOOKAHEAD_SECONDS) {
        scheduleLoopAt(def, destination, state.nextLoopTime);
        state.nextLoopTime += def.loopSeconds;
      }
    }
    tick();
    state.timerId = setInterval(tick, SCHEDULE_INTERVAL_MS);
    return state;
  }

  function stopTrackScheduler(state) {
    if (state && state.timerId != null) clearInterval(state.timerId);
  }

  function ensureTrackRunning(name) {
    if (!ctx || !name || trackPlayers[name]) return;
    trackPlayers[name] = startTrackScheduler(name);
  }

  // Switches which of the two loops is audible, with a short crossfade
  // (the outgoing track fades out and its scheduler stops only once that
  // fade finishes; the incoming one starts fresh and fades in) - never both
  // fully audible together, per CLAUDE.md. Safe to call before the first
  // gesture (no ctx yet): it just remembers the choice, and handleGesture
  // starts it for real the moment a context becomes available.
  function setMusicTrack(name) {
    if (name !== 'menu' && name !== 'game' && name !== null) return;
    if (name === currentTrackName) return;
    const previous = currentTrackName;
    currentTrackName = name;
    if (!ctx) return;

    if (previous) {
      const previousGain = trackGainFor(previous);
      rampGain(previousGain, 0, MUSIC_CROSSFADE_SECONDS);
      const previousState = trackPlayers[previous];
      setTimeout(function () {
        stopTrackScheduler(previousState);
        if (trackPlayers[previous] === previousState) trackPlayers[previous] = null;
      }, MUSIC_CROSSFADE_SECONDS * 1000 + 100);
    }

    if (name && musicEnabled) {
      ensureTrackRunning(name);
      rampGain(trackGainFor(name), 1, MUSIC_CROSSFADE_SECONDS);
    }
  }

  // --- Settings UI: index.html's settings popup has no markup for these two
  // switches yet (CLAUDE.md asked for them to be built here instead of
  // editing index.html), so they're created once and inserted right before
  // the existing "Replay tutorial" button - stable hooks for Codex's later
  // styling pass: .setting-sfx / .setting-music, each reusing the exact
  // .settings-row/.toggle-switch/.toggle-knob markup the other settings
  // toggles already use, so existing CSS already applies. ---
  function createSettingsRows(dom) {
    if (!dom || !dom.replayTutorialButton || typeof document === 'undefined') return null;
    const card = dom.replayTutorialButton.parentElement;
    if (!card || card.querySelector('.setting-sfx')) return null; // idempotent

    const I18n = root.Garden.i18n;

    function buildRow(className, labelKey) {
      const row = document.createElement('div');
      row.className = 'settings-row ' + className;

      const label = document.createElement('span');
      label.className = 'settings-row-label';
      label.textContent = I18n.t(labelKey);
      // Declarative hook for a language switch (js/i18n.js's
      // applyDomTranslations, called from js/main.js) to re-set this -
      // this row has no render()/refresh of its own to call instead,
      // unlike most other screens' own static text (see GAME_DESIGN.md's
      // Localization section).
      label.setAttribute('data-i18n', labelKey);

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'toggle-switch';
      const knob = document.createElement('span');
      knob.className = 'toggle-knob';
      toggle.appendChild(knob);

      row.appendChild(label);
      row.appendChild(toggle);
      card.insertBefore(row, dom.replayTutorialButton);
      return { row, label, toggle };
    }

    function wire(toggle, getEnabled, setEnabled) {
      toggle.setAttribute('aria-pressed', String(getEnabled()));
      toggle.addEventListener('click', function () {
        const next = toggle.getAttribute('aria-pressed') !== 'true';
        toggle.setAttribute('aria-pressed', String(next));
        setEnabled(next);
        playEffect('tap');
      });
    }

    const sfxRow = buildRow('setting-sfx', 'sfxToggleLabel');
    const musicRow = buildRow('setting-music', 'musicToggleLabel');
    wire(sfxRow.toggle, isSfxEnabled, setSfxEnabled);
    wire(musicRow.toggle, isMusicEnabled, setMusicEnabled);

    return { sfxRow, musicRow };
  }

  const Audio = {
    init,
    playEffect,
    setMusicTrack,
    setSfxEnabled,
    setMusicEnabled,
    isSfxEnabled,
    isMusicEnabled,
    setExternalMute,
    createSettingsRows,
    EFFECT_IDS: Object.keys(EFFECTS),
  };

  root.Garden = root.Garden || {};
  root.Garden.audio = Audio;
})(typeof window !== 'undefined' ? window : globalThis);
