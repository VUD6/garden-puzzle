// Pointer/touch input. Browser-only; translates DOM events into state.js calls.
(function (root) {
  function attach(dom, game, handlers) {
    let patternsEnabled = true;

    dom.board.addEventListener('pointerup', function (event) {
      const cellEl = event.target.closest('.cell');
      if (!cellEl) return;
      const row = parseInt(cellEl.dataset.row, 10);
      const col = parseInt(cellEl.dataset.col, 10);
      game.tapCell(row, col);
    });

    dom.nextLevelButton.addEventListener('click', function () {
      game.nextLevel();
    });

    dom.retryButton.addEventListener('click', function () {
      game.retryLevel();
    });

    dom.patternsToggle.addEventListener('click', function () {
      patternsEnabled = !patternsEnabled;
      handlers.onTogglePatterns(patternsEnabled);
    });

    return {
      setPatternsEnabled: function (enabled) {
        patternsEnabled = enabled;
      },
    };
  }

  root.Garden = root.Garden || {};
  root.Garden.input = { attach };
})(typeof window !== 'undefined' ? window : globalThis);
