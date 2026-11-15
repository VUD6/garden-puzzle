// Bootstraps the game: wires DOM refs to state.js, render.js, and input.js.
(function (root) {
  document.addEventListener('DOMContentLoaded', function () {
    const Garden = root.Garden;

    const dom = {
      ambientParticles: document.getElementById('ambientParticles'),
      loadingScreen: document.getElementById('loadingScreen'),
      loadingTitle: document.getElementById('loadingTitle'),
      loadingStatusText: document.getElementById('loadingStatusText'),
      menuScreen: document.getElementById('menuScreen'),
      menuTitle: document.getElementById('menuTitle'),
      menuSubtitle: document.getElementById('menuSubtitle'),
      menuSeedsPill: document.getElementById('menuSeedsPill'),
      menuSeedsDisplay: document.getElementById('menuSeedsDisplay'),
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
      checkinClaimRewardAmount: document.getElementById('checkinClaimRewardAmount'),
      checkinClaimButton: document.getElementById('checkinClaimButton'),
      checkinCloseButton: document.getElementById('checkinCloseButton'),
      gameScreen: document.getElementById('gameScreen'),
      backButton: document.getElementById('backButton'),
      settingsButton: document.getElementById('settingsButton'),
      levelIndicator: document.getElementById('levelIndicator'),
      scoreDisplay: document.getElementById('scoreDisplay'),
      seedsPill: document.getElementById('seedsPill'),
      seedsDisplay: document.getElementById('seedsDisplay'),
      lives: document.getElementById('livesContainer'),
      hintButton: document.getElementById('hintButton'),
      hintButtonLabel: document.getElementById('hintButtonLabel'),
      hintCostAmount: document.getElementById('hintCostAmount'),
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
      seedReward: document.getElementById('seedReward'),
      seedRewardAmount: document.getElementById('seedRewardAmount'),
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
      tutorialBubble: document.getElementById('tutorialBubble'),
      tutorialFinal: document.getElementById('tutorialFinal'),
      tutorialFinalTitle: document.getElementById('tutorialFinalTitle'),
      tutorialFinalText: document.getElementById('tutorialFinalText'),
      tutorialGotItButton: document.getElementById('tutorialGotItButton'),
    };

    const platform = Garden.platform;
    const renderer = Garden.render.createRenderer(dom);
    const prefersReducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const game = Garden.state.createGame({
      onChange: renderer.render,
    });

    const router = Garden.router.createRouter(dom);
    const tutorial = Garden.tutorial.createTutorial(dom);

    function enterGame() {
      router.showScreen('game');
      // The board was last sized while the game screen was hidden (clientWidth/
      // Height both 0 then), so it needs a fresh render now that it's visible.
      renderer.render(game.getSnapshot());
    }

    function returnToMenu() {
      menuScreen.render();
      checkinScreen.render();
      router.showScreen('menu');
    }

    const checkinScreen = Garden.checkin.createCheckinScreen(dom, {
      onClaimed: function () {
        menuScreen.render();
      },
    });

    const menuScreen = Garden.menu.createMenuScreen(dom, {
      onPlay: function () {
        if (!platform.loadTutorialDone()) {
          tutorial.start(enterGame);
        } else {
          enterGame();
        }
      },
      onHowToPlay: function () {
        tutorial.start();
      },
      onSettings: function () {
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
      tutorial.start();
    });

    menuScreen.render();
    checkinScreen.render();
    platform.gameReady();
    router.leaveLoading();
  });
})(typeof window !== 'undefined' ? window : globalThis);
