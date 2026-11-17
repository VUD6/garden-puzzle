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
    const renderer = Garden.render.createRenderer(dom);
    const prefersReducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    function applyThemeButtons(themeId) {
      dom.themeWinterButton.classList.toggle('active', themeId === 'winter');
      dom.themeGardenButton.classList.toggle('active', themeId === 'garden');
    }

    // Applied before the game is constructed below, so the very first board
    // build already uses the right theme's bed colors/piece art instead of
    // flashing the wrong theme for one frame.
    applyThemeButtons(renderer.setTheme(platform.loadTheme()));

    const game = Garden.state.createGame({
      onChange: renderer.render,
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
      tutorial.start(function () {
        game.resumeTimer('tutorial');
        if (typeof onComplete === 'function') onComplete();
      });
    }

    // Active-play timer: pause while the tab is hidden/backgrounded or the
    // window loses focus, resume once it's visible/focused again - see
    // state.js's pauseTimer/resumeTimer. No idle timeout: an uninterrupted,
    // visible session keeps counting no matter how long it runs.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) game.pauseTimer('visibility');
      else game.resumeTimer('visibility');
    });
    window.addEventListener('pagehide', function () {
      game.pauseTimer('pagehide');
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

    function enterGame() {
      router.showScreen('game');
      resetZoomIfStuck();
      // The board was last sized while the game screen was hidden (clientWidth/
      // Height both 0 then), so it needs a fresh render now that it's visible.
      renderer.render(game.getSnapshot());
    }

    function returnToMenu() {
      menuScreen.render();
      checkinScreen.render();
      router.showScreen('menu');
      resetZoomIfStuck();
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
        renderer.openSettings();
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

    menuScreen.render();
    checkinScreen.render();
    platform.gameReady();
    router.leaveLoading();
    resetZoomIfStuck();

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
        state: function () {
          return {
            today: Garden.checkin.getTodayKey(),
            dailyGift: platform.loadDailyGift(),
            winStreak: platform.loadWinStreak(),
            totalStars: platform.loadTotalStars(),
          };
        },
      };
      // eslint-disable-next-line no-console
      console.log(
        '[Garden] Debug mode: window.GardenDebug is available - advanceDays(n), jumpToDay(k), resetDailyGift(), setWinStreak(n), setTotalStars(n), state()'
      );
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
