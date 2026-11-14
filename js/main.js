// Bootstraps the game: wires DOM refs to state.js, render.js, and input.js.
(function (root) {
  document.addEventListener('DOMContentLoaded', function () {
    const Garden = root.Garden;

    const dom = {
      appTitle: document.getElementById('appTitle'),
      levelIndicator: document.getElementById('levelIndicator'),
      scoreDisplay: document.getElementById('scoreDisplay'),
      lives: document.getElementById('livesContainer'),
      patternsToggle: document.getElementById('patternsToggle'),
      replayTutorialButton: document.getElementById('replayTutorialButton'),
      ruleTextBed: document.getElementById('ruleTextBed'),
      ruleTextRowCol: document.getElementById('ruleTextRowCol'),
      ruleTextTouch: document.getElementById('ruleTextTouch'),
      bedTracker: document.getElementById('bedTracker'),
      boardWrap: document.querySelector('.board-wrap'),
      board: document.getElementById('board'),
      winOverlay: document.getElementById('winOverlay'),
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

    const game = Garden.state.createGame({
      onChange: renderer.render,
    });

    const input = Garden.input.attach(dom, game, {
      onTogglePatterns: function (enabled) {
        platform.savePatternsEnabled(enabled);
        renderer.setPatternsEnabled(enabled);
      },
    });

    const initialPatternsEnabled = platform.loadPatternsEnabled();
    renderer.setPatternsEnabled(initialPatternsEnabled);
    input.setPatternsEnabled(initialPatternsEnabled);

    dom.replayTutorialButton.textContent = Garden.i18n.t('replayTutorialButton');
    const tutorial = Garden.tutorial.createTutorial(dom);
    dom.replayTutorialButton.addEventListener('click', function () {
      tutorial.start();
    });
    if (!platform.loadTutorialDone()) tutorial.start();
  });
})(typeof window !== 'undefined' ? window : globalThis);
