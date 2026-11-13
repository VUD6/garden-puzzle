// Bootstraps the game: wires DOM refs to state.js, render.js, and input.js.
(function (root) {
  document.addEventListener('DOMContentLoaded', function () {
    const Garden = root.Garden;

    const dom = {
      appTitle: document.getElementById('appTitle'),
      levelIndicator: document.getElementById('levelIndicator'),
      lives: document.getElementById('livesContainer'),
      patternsToggle: document.getElementById('patternsToggle'),
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
    });

    const initialPatternsEnabled = platform.loadPatternsEnabled();
    renderer.setPatternsEnabled(initialPatternsEnabled);
    input.setPatternsEnabled(initialPatternsEnabled);
  });
})(typeof window !== 'undefined' ? window : globalThis);
