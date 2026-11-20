// Bootstraps the game: wires DOM refs to state.js, render.js, and input.js.
(function (root) {
  const ZoomGuard = root.Garden.zoomGuard;

  // iOS double-tap-zoom bug fix, part 1 of 2 (see css/style.css's
  // touch-action block for the CSS half, and js/zoomguard.js for the pure
  // guard logic itself - this just wires it to real document-level
  // listeners). Pinch guard: registered non-passive so preventDefault()
  // actually takes effect.
  const handleGesture = ZoomGuard.createPinchGuard();
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (type) {
    document.addEventListener(type, handleGesture, { passive: false });
  });

  // Part 2: the double-tap guard. Registered at document level, in the
  // CAPTURE phase, non-passive, so it always runs before any other
  // handler (anywhere in the tree) could call stopPropagation() and keep
  // it from ever seeing the event.
  const handleTouchEnd = ZoomGuard.createDoubleTapZoomGuard();
  document.addEventListener('touchend', handleTouchEnd, { passive: false, capture: true });

  // Both guards are registered before DOMContentLoaded (rather than
  // waiting on a specific element) since they're independent of the DOM
  // build below and need to be live as early as possible.

  // Starts the active platform adapter's handshake (the real SDK or its
  // mock twin, picked by js/platform-adapter.js from window.GAME_PLATFORM)
  // as early as possible - well before DOMContentLoaded, so a real SDK's
  // own getPlayer()/serverTime() round trips have the most possible time to
  // resolve before anything (gameReady()'s ready() call, the cloud-save
  // merge) actually needs them. Never blocks anything here either way -
  // init() itself never rejects, but a .catch is kept anyway as cheap
  // insurance against an unhandled-rejection warning.
  root.Garden.platformAdapter.init().catch(function () {});

  // Safe pinch-zoom reset (no visible UI): if the page is still visually
  // zoomed in from a pinch inside a popup (visualViewport.scale > 1),
  // nudge iOS Safari back to its initial scale on every screen transition.
  // Re-setting the viewport meta's content attribute - even to the
  // identical string - still runs the UA's "attribute changed" steps per
  // the DOM spec (setAttribute never skips those just because the value
  // is unchanged), which is what actually nudges WebKit's zoom back; a
  // plain property read with no re-assignment would not. Harmless/no-op
  // everywhere else (feature-detected; most browsers have no
  // visualViewport.scale != 1 concept to begin with).
  function resetZoomIfStuck() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (!window.visualViewport || window.visualViewport.scale <= 1) return;
    const meta = document.querySelector('meta[name="viewport"]');
    if (meta) meta.setAttribute('content', meta.getAttribute('content'));
    window.scrollTo(0, 0);
  }

  document.addEventListener('DOMContentLoaded', function () {
    const Garden = root.Garden;

    const dom = {
      ambientParticles: document.getElementById('ambientParticles'),
      loadingScreen: document.getElementById('loadingScreen'),
      loadingMascot: document.getElementById('loadingMascot'),
      loadingTitle: document.getElementById('loadingTitle'),
      loadingStatusText: document.getElementById('loadingStatusText'),
      menuScreen: document.getElementById('menuScreen'),
      menuMascot: document.getElementById('menuMascot'),
      menuTitle: document.getElementById('menuTitle'),
      menuSubtitle: document.getElementById('menuSubtitle'),
      playButton: document.getElementById('playButton'),
      howToPlayButton: document.getElementById('howToPlayButton'),
      menuSettingsButton: document.getElementById('menuSettingsButton'),
      dailyChallengeButton: document.getElementById('dailyChallengeButton'),
      dailyChallengeCaption: document.getElementById('dailyChallengeCaption'),
      dailyCheckinButton: document.getElementById('dailyCheckinButton'),
      dailyCheckinLabel: document.getElementById('dailyCheckinLabel'),
      checkinBadge: document.getElementById('checkinBadge'),
      checkinOverlay: document.getElementById('checkinOverlay'),
      checkinTitle: document.getElementById('checkinTitle'),
      checkinDaysRow: document.getElementById('checkinDaysRow'),
      checkinCurrentStreakText: document.getElementById('checkinCurrentStreakText'),
      checkinBestStreakText: document.getElementById('checkinBestStreakText'),
      checkinClaimReward: document.getElementById('checkinClaimReward'),
      checkinClaimRewardIcons: document.getElementById('checkinClaimRewardIcons'),
      checkinClaimRewardAmount: document.getElementById('checkinClaimRewardAmount'),
      checkinClaimButton: document.getElementById('checkinClaimButton'),
      checkinCloseButton: document.getElementById('checkinCloseButton'),
      gameScreen: document.getElementById('gameScreen'),
      backButton: document.getElementById('backButton'),
      settingsButton: document.getElementById('settingsButton'),
      levelIndicator: document.getElementById('levelIndicator'),
      scoreDisplay: document.getElementById('scoreDisplay'),
      lives: document.getElementById('livesContainer'),
      helperButtonFinder: document.getElementById('helperButtonFinder'),
      helperIconFinder: document.getElementById('helperIconFinder'),
      helperBadgeFinder: document.getElementById('helperBadgeFinder'),
      helperLockCaptionFinder: document.getElementById('helperLockCaptionFinder'),
      helperButtonRandom: document.getElementById('helperButtonRandom'),
      helperIconRandom: document.getElementById('helperIconRandom'),
      helperBadgeRandom: document.getElementById('helperBadgeRandom'),
      helperLockCaptionRandom: document.getElementById('helperLockCaptionRandom'),
      helperButtonSnowman: document.getElementById('helperButtonSnowman'),
      helperIconSnowman: document.getElementById('helperIconSnowman'),
      helperBadgeSnowman: document.getElementById('helperBadgeSnowman'),
      helperLockCaptionSnowman: document.getElementById('helperLockCaptionSnowman'),
      milestoneBanner: document.getElementById('milestoneBanner'),
      milestoneBannerTitle: document.getElementById('milestoneBannerTitle'),
      milestoneBannerCaption: document.getElementById('milestoneBannerCaption'),
      milestoneRewardBadge: document.getElementById('milestoneRewardBadge'),
      milestoneRewardIcons: document.getElementById('milestoneRewardIcons'),
      milestoneRewardAmount: document.getElementById('milestoneRewardAmount'),
      rulesArea: document.getElementById('rulesArea'),
      rulesHelpButton: document.getElementById('rulesHelpButton'),
      rulesBar: document.getElementById('rulesBar'),
      rulesCloseButton: document.getElementById('rulesCloseButton'),
      rulesPopupTitle: document.getElementById('rulesPopupTitle'),
      ruleTextBed: document.getElementById('ruleTextBed'),
      ruleTextRowCol: document.getElementById('ruleTextRowCol'),
      ruleTextTouch: document.getElementById('ruleTextTouch'),
      bedTracker: document.getElementById('bedTracker'),
      boardWrap: document.querySelector('.board-wrap'),
      board: document.getElementById('board'),
      winOverlay: document.getElementById('winOverlay'),
      winFlower: document.getElementById('winFlower'),
      winTitle: document.getElementById('winTitle'),
      starsContainer: document.getElementById('starsContainer'),
      rankTitle: document.getElementById('rankTitle'),
      winMessage: document.getElementById('winMessage'),
      bestTimeLine: document.getElementById('bestTimeLine'),
      nextLevelButton: document.getElementById('nextLevelButton'),
      failOverlay: document.getElementById('failOverlay'),
      failTitle: document.getElementById('failTitle'),
      failMessage: document.getElementById('failMessage'),
      retryButton: document.getElementById('retryButton'),
      settingsOverlay: document.getElementById('settingsOverlay'),
      settingsTitleText: document.getElementById('settingsTitleText'),
      themeLabelText: document.getElementById('themeLabelText'),
      themeWinterButton: document.getElementById('themeWinterButton'),
      themeGardenButton: document.getElementById('themeGardenButton'),
      patternsToggleLabelText: document.getElementById('patternsToggleLabelText'),
      patternsToggle: document.getElementById('patternsToggle'),
      reduceMotionLabelText: document.getElementById('reduceMotionLabelText'),
      reduceMotionToggle: document.getElementById('reduceMotionToggle'),
      vibrationLabelText: document.getElementById('vibrationLabelText'),
      vibrationUnsupportedNote: document.getElementById('vibrationUnsupportedNote'),
      vibrationToggle: document.getElementById('vibrationToggle'),
      replayTutorialButton: document.getElementById('replayTutorialButton'),
      settingsCloseButton: document.getElementById('settingsCloseButton'),
      tutorialOverlay: document.getElementById('tutorialOverlay'),
      tutorialPlay: document.getElementById('tutorialPlay'),
      tutorialBoard: document.getElementById('tutorialBoard'),
      tutorialHand: document.getElementById('tutorialHand'),
      tutorialMascot: document.getElementById('tutorialMascot'),
      tutorialBubble: document.getElementById('tutorialBubble'),
      tutorialFinal: document.getElementById('tutorialFinal'),
      tutorialFinalTitle: document.getElementById('tutorialFinalTitle'),
      tutorialFinalText: document.getElementById('tutorialFinalText'),
      tutorialGotItButton: document.getElementById('tutorialGotItButton'),
    };

    const platform = Garden.platform;
    const audio = Garden.audio;
    // Named distinctly from the pre-existing lowercase `platform` (the
    // local-storage save module, js/platform.js) - this is the SDK-facing
    // facade, js/platform-adapter.js, a deliberately different thing that
    // happens to sound similar; see GAME_DESIGN.md's "Platform layer"
    // section for why the two are separate modules.
    const PlatformAdapter = Garden.platformAdapter;
    audio.init();
    const renderer = Garden.render.createRenderer(dom);
    const prefersReducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    // Which of the two music loops belongs to whatever's on screen right
    // now - the game screen gets the gameplay track, everything else
    // (loading, menu, tutorial) shares the calmer menu/loading track.
    function musicTrackForCurrentScreen() {
      return dom.gameScreen.hidden ? 'menu' : 'game';
    }

    function applyThemeButtons(themeId) {
      dom.themeWinterButton.classList.toggle('active', themeId === 'winter');
      dom.themeGardenButton.classList.toggle('active', themeId === 'garden');
    }

    // Applied before the game is constructed below, so the very first board
    // build already uses the right theme's bed colors/piece art instead of
    // flashing the wrong theme for one frame.
    applyThemeButtons(renderer.setTheme(platform.loadTheme()));

    const game = Garden.state.createGame({
      // Every snapshot passes through the daily challenge's own handler
      // first - a no-op pass-through for every normal-mode snapshot and
      // every challenge snapshot that isn't a win; on an actual challenge
      // win it idempotently credits today's reward (if not already
      // credited) and attaches the result as snapshot.challengeReward for
      // the renderer's win screen (see js/daily-challenge.js/js/render.js).
      onChange: function (snapshot) {
        const enriched = Garden.dailyChallenge.handleSnapshot(snapshot);
        renderer.render(enriched);

        // GameplayAPI.stop() on win/lose - PlatformAdapter.gameplayStop() is
        // idempotent (a no-op once already stopped), so this can run on
        // every single snapshot with no separate "did we already stop"
        // tracking of our own.
        if (enriched.status === 'won' || enriched.status === 'lost') PlatformAdapter.gameplayStop();

        if (enriched.status === 'won') {
          // Reads the fresh total straight from storage rather than
          // enriched.totalScore: a daily-challenge win's own point reward
          // is credited above (Garden.dailyChallenge.handleSnapshot, via
          // platform.saveTotalScore) entirely outside state.js's own
          // committedScore bookkeeping, so the snapshot field itself can be
          // stale for a challenge win specifically - see GAME_DESIGN.md.
          // "points" is the leaderboard's pinned technical name (see
          // GAME_DESIGN.md/the Yandex Games Console setup) - submitScore is
          // a safe no-op on any adapter/mode that doesn't support it.
          PlatformAdapter.submitScore('points', platform.loadTotalScore());
          PlatformAdapter.fetchBeatPercentForWinScreen(renderer.setWinBeatPercent);
        }
      },
    });

    const router = Garden.router.createRouter(dom);
    const tutorial = Garden.tutorial.createTutorial(dom);

    // The level timer (see state.js's pauseTimer/resumeTimer) must not keep
    // counting while "How to play" covers the board, same as Settings -
    // paused for the whole time the tutorial overlay is open, regardless of
    // which button opened it (first-launch Play, the menu's "Как играть",
    // or Settings' "Replay tutorial"), resumed the instant it's dismissed.
    function startTutorial(onComplete) {
      game.pauseTimer('tutorial');
      PlatformAdapter.gameplayStop();
      audio.setMusicTrack('menu');
      tutorial.start(function () {
        game.resumeTimer('tutorial');
        // Only actually resumes the GameplayAPI session if a level/challenge
        // is genuinely open and still in progress behind the tutorial (e.g.
        // Settings' "Replay tutorial") - a no-op, same idempotent guard
        // js/input.js's own maybeResumeGameplay uses, when the tutorial was
        // opened from the menu instead (first launch, or its "How to play"
        // button), where there was never a gameplay session to resume.
        if (!dom.gameScreen.hidden && game.getSnapshot().status === 'playing') PlatformAdapter.gameplayStart();
        audio.setMusicTrack(musicTrackForCurrentScreen());
        if (typeof onComplete === 'function') onComplete();
      });
    }

    // Active-play timer: pause while the tab is hidden/backgrounded or the
    // window loses focus, resume once it's visible/focused again - see
    // state.js's pauseTimer/resumeTimer. No idle timeout: an uninterrupted,
    // visible session keeps counting no matter how long it runs.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        game.pauseTimer('visibility');
        // Cloud save: always flush immediately (not the debounced
        // scheduler) the moment the tab goes background/hidden - the page
        // could be frozen or killed at any point after this, so anything
        // still only debounced would be lost.
        Garden.cloudsave.flushNow();
      } else {
        game.resumeTimer('visibility');
      }
    });
    window.addEventListener('pagehide', function () {
      game.pauseTimer('pagehide');
      Garden.cloudsave.flushNow();
    });
    window.addEventListener('pageshow', function () {
      game.resumeTimer('pagehide');
    });
    window.addEventListener('blur', function () {
      game.pauseTimer('blur');
    });
    window.addEventListener('focus', function () {
      game.resumeTimer('blur');
    });

    // The platform's own pause/resume events (e.g. the Yandex Games app
    // switching away/back on mobile) - pauses/resumes the same active-play
    // timer and audio mute as every other pause reason above, per
    // GAME_DESIGN.md/the Yandex integration spec. A no-op with no SDK
    // present (the mock backend never emits these).
    PlatformAdapter.onPauseResume({
      onPause: function () {
        game.pauseTimer('platform');
        audio.setExternalMute('platform', true);
      },
      onResume: function () {
        game.resumeTimer('platform');
        audio.setExternalMute('platform', false);
      },
    });

    function enterGame() {
      router.showScreen('game');
      audio.setMusicTrack('game');
      resetZoomIfStuck();
      // The board was last sized while the game screen was hidden (clientWidth/
      // Height both 0 then), so it needs a fresh render now that it's visible.
      renderer.render(game.getSnapshot());
      // GameplayAPI.start() - a level or challenge attempt begins or
      // resumes here, whether this is a fresh level, a reload mid-level, or
      // coming back from the menu to a still-in-progress attempt.
      PlatformAdapter.gameplayStart();
    }

    function returnToMenu() {
      // A no-op unless a daily-challenge attempt is actually open (see
      // js/state.js's exitChallenge) - switches the shared game instance
      // back to tracking the player's real progression, so "Играть"/
      // "Продолжить" always resumes the right thing next time.
      game.exitChallenge();
      menuScreen.render();
      checkinScreen.render();
      router.showScreen('menu');
      audio.setMusicTrack('menu');
      resetZoomIfStuck();
      // Leaving to the menu always ends the GameplayAPI session (idempotent
      // if a win/lose already stopped it) - per GAME_DESIGN.md/the Yandex
      // integration spec.
      PlatformAdapter.gameplayStop();
    }

    const checkinScreen = Garden.checkin.createDailyGiftScreen(dom, {
      onClaimed: function () {
        menuScreen.render();
      },
    });

    const menuScreen = Garden.menu.createMenuScreen(dom, {
      onPlay: function () {
        if (!platform.loadTutorialDone()) {
          startTutorial(enterGame);
        } else {
          enterGame();
        }
      },
      onHowToPlay: function () {
        startTutorial();
      },
      onSettings: function () {
        game.pauseTimer('settings');
        PlatformAdapter.gameplayStop();
        renderer.openSettings();
      },
      onDailyChallenge: function () {
        // start() itself is the authoritative guard (see its own comment) -
        // a no-op, returning false, if the challenge is locked or already
        // won today, in which case the screen must stay exactly where it
        // is rather than entering a game that was never actually started.
        if (Garden.dailyChallenge.start(game)) enterGame();
      },
    });

    const input = Garden.input.attach(dom, game, renderer, {
      onBack: returnToMenu,
      onTogglePatterns: function (enabled) {
        platform.savePatternsEnabled(enabled);
        renderer.setPatternsEnabled(enabled);
      },
      onToggleReduceMotion: function (enabled) {
        platform.saveReduceMotionEnabled(enabled);
        renderer.setReducedMotion(enabled || prefersReducedMotionQuery.matches);
      },
      onToggleVibration: function (enabled) {
        platform.saveVibrationEnabled(enabled);
        renderer.setVibrationEnabled(enabled);
      },
      onSelectTheme: function (themeId) {
        platform.saveTheme(themeId);
        applyThemeButtons(renderer.setTheme(themeId));
      },
    });

    const initialPatternsEnabled = platform.loadPatternsEnabled();
    dom.patternsToggle.setAttribute('aria-pressed', String(initialPatternsEnabled));
    renderer.setPatternsEnabled(initialPatternsEnabled);

    const reduceMotionSetting = platform.loadReduceMotionEnabled();
    dom.reduceMotionToggle.setAttribute('aria-pressed', String(reduceMotionSetting));
    renderer.setReducedMotion(reduceMotionSetting || prefersReducedMotionQuery.matches);
    prefersReducedMotionQuery.addEventListener('change', function (event) {
      renderer.setReducedMotion(platform.loadReduceMotionEnabled() || event.matches);
    });

    const initialVibrationEnabled = platform.loadVibrationEnabled();
    dom.vibrationToggle.setAttribute('aria-pressed', String(initialVibrationEnabled));
    renderer.setVibrationEnabled(initialVibrationEnabled);

    // The setting's stored value is left untouched either way; this only
    // controls whether the toggle can actually do anything on this device.
    const vibrationSupported = platform.isVibrationSupported();
    dom.vibrationToggle.disabled = !vibrationSupported;
    dom.vibrationUnsupportedNote.hidden = vibrationSupported;

    dom.replayTutorialButton.addEventListener('click', function () {
      renderer.closeSettings();
      game.resumeTimer('settings');
      startTutorial();
    });

    audio.createSettingsRows(dom);

    // Leaderboard popup (see js/platform-yandex.js's createLeaderboardScreen,
    // reached only via the generic facade) - a menu-only entry point,
    // self-contained (builds its own button/overlay, index.html has no slot
    // for either), so nothing further needs wiring here beyond creating it
    // once.
    PlatformAdapter.createLeaderboardScreen(dom);

    menuScreen.render();
    checkinScreen.render();
    platform.gameReady();
    router.leaveLoading();
    audio.setMusicTrack('menu');
    resetZoomIfStuck();

    // Cloud save: merges whatever's in the cloud against local data (see
    // GAME_DESIGN.md's merge policy) in the background, well after the menu
    // is already interactive - never blocks it. If the merge actually
    // changed anything visible (progress, helper charges, daily-gift/
    // challenge state, ...), re-render the menu/daily-gift badge so it's
    // never showing stale pre-merge data.
    Garden.cloudsave.init(function (changed) {
      if (changed) {
        menuScreen.render();
        checkinScreen.render();
      }
    });

    // Debug-only: simulates the passage of days for the daily gift, without
    // waiting on real calendar days or touching the device clock. Only
    // exists at all when the page was opened with ?debug=1 in the URL (see
    // platform.isDebugEnabled) - never reachable by a real player. See
    // GAME_DESIGN.md's "Daily gift" section for exact usage on desktop and
    // on a phone.
    if (platform.isDebugEnabled()) {
      window.GardenDebug = {
        advanceDays: function (n) {
          Garden.checkin.debugAdvanceDays(n);
          checkinScreen.render();
          // The daily challenge shares this same simulated clock (see
          // Garden.platform.now()) - advancing it changes which puzzle
          // today's challenge generates and the menu button's done/
          // available state, so it needs a re-render too.
          menuScreen.render();
        },
        jumpToDay: function (k) {
          Garden.checkin.debugJumpToDay(k);
          checkinScreen.render();
        },
        resetDailyGift: function () {
          Garden.checkin.debugResetDailyGift();
          checkinScreen.render();
        },
        // Sets the win streak directly (e.g. setWinStreak(4), then win one
        // level normally to see the bonus trigger at 5) - bypasses actually
        // winning/losing levels to reach a given streak quickly.
        setWinStreak: function (n) {
          platform.saveWinStreak(n);
        },
        // Sets the menu's total-stars counter directly, for checking its
        // display without replaying levels for real stars.
        setTotalStars: function (n) {
          platform.saveTotalStars(n);
          menuScreen.render();
        },
        // Resets today's daily-challenge reward back to "not won yet" (and
        // clears any in-progress saved attempt), for re-testing the
        // once-per-day reward without waiting for a new day.
        resetDailyChallenge: function () {
          Garden.dailyChallenge.debugReset();
          menuScreen.render();
        },
        // Sets the player's saved progress level directly (e.g.
        // setUnlockedLevel(15) to unlock the daily challenge), bypassing
        // actually climbing there level by level. Also raises the
        // highest-level-reached watermark to match, so Snowman's own
        // level-10 unlock stays consistent.
        setUnlockedLevel: function (n) {
          Garden.dailyChallenge.debugSetUnlockedLevel(n);
          menuScreen.render();
        },
        // Forces the NEXT rewarded ad (mock mode only - see
        // js/platform-yandex.js's debugSimulateAdError) to resolve as an
        // error instead of granting a reward, so the "ad unavailable"
        // message path can be exercised on demand.
        simulateAdError: function () {
          PlatformAdapter.debugSimulateAdError();
        },
        // Forces the NEXT rewarded ad (mock mode only) to resolve through
        // one specific callback order instead of the normal "always
        // succeeds" sequence - lets the exact orders a live SDK was once
        // reported to use be reproduced on demand (see GAME_DESIGN.md):
        // 'rewarded-close' (default/normal), 'close-then-rewarded' (the
        // reward arrives AFTER the ad already closed), 'error',
        // 'close-no-reward' (declined, no reward), 'stuck' (never calls any
        // terminal callback at all - exercises the safety-timeout recovery).
        simulateAdSequence: function (name) {
          PlatformAdapter.debugSetAdSequence(name);
        },
        // Manual QA only, real-browser-only: simulates an ad overlay
        // stealing window focus without ever giving it back via a real
        // 'focus' event (one of the hypotheses behind the stuck-helper-
        // button bug report - see GAME_DESIGN.md). Not meaningful to
        // automate in the Node test suite (no real window/focus model
        // there); use this after simulateAdSequence(...) in a real browser
        // with ?debug=1 to confirm the fix still leaves everything
        // interactive.
        simulateAdFocusSteal: function () {
          window.dispatchEvent(new Event('blur'));
        },
        state: function () {
          return {
            today: Garden.checkin.getTodayKey(),
            dailyGift: platform.loadDailyGift(),
            winStreak: platform.loadWinStreak(),
            totalStars: platform.loadTotalStars(),
            progressLevel: platform.loadProgress(),
            dailyChallenge: Object.assign({}, platform.loadDailyChallenge(), {
              difficultyLevel: Garden.dailyChallenge.difficultyLevelForDate(Garden.checkin.getTodayKey()),
              doneToday: Garden.dailyChallenge.isDoneToday(),
            }),
          };
        },
      };
      // eslint-disable-next-line no-console
      console.log(
        '[Garden] Debug mode: window.GardenDebug is available - advanceDays(n), jumpToDay(k), resetDailyGift(), setWinStreak(n), setTotalStars(n), resetDailyChallenge(), setUnlockedLevel(n), simulateAdError(), simulateAdSequence(name), simulateAdFocusSteal(), state()'
      );
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
