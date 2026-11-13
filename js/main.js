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
      autoXToggle: document.getElementById('autoXToggle'),
      ruleTextBed: document.getElementById('ruleTextBed'),
      ruleTextRowCol: document.getElementById('ruleTextRowCol'),
      ruleTextTouch: document.getElementById('ruleTextTouch'),
      bedTracker: document.getElementById('bedTracker'),
      boardWrap: document.querySelector('.board-wrap'),
      board: document.getElementById('board'),
      winOverlay: document.getElementById('winOverlay'),
      winTitle: document.getElementById('winTitle'),
      winMessage: document.getElementById('winMessage'),
      nextLevelButton: document.getElementById('nextLevelButton'),
      failOverlay: document.getElementById('failOverlay'),
      failTitle: document.getElementById('failTitle'),
      failMessage: document.getElementById('failMessage'),
      retryButton: document.getElementById('retryButton'),
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
      onToggleAutoX: function (enabled) {
        platform.saveAutoXEnabled(enabled);
        game.setAutoXEnabled(enabled);
        renderer.setAutoXEnabled(enabled);
      },
    });

    const initialPatternsEnabled = platform.loadPatternsEnabled();
    renderer.setPatternsEnabled(initialPatternsEnabled);
    input.setPatternsEnabled(initialPatternsEnabled);

    const initialAutoXEnabled = platform.loadAutoXEnabled();
    game.setAutoXEnabled(initialAutoXEnabled);
    renderer.setAutoXEnabled(initialAutoXEnabled);
    input.setAutoXEnabled(initialAutoXEnabled);
  });
})(typeof window !== 'undefined' ? window : globalThis);
