// DOM rendering. Browser-only (uses document); never contains game-rule logic.
(function (root) {
  const Grid = root.Garden.grid;
  const I18n = root.Garden.i18n;

  const FLOWER_SVG =
    '<svg viewBox="0 0 24 24"><g fill="#e8678b">' +
    '<circle cx="12" cy="7" r="4"/><circle cx="12" cy="17" r="4"/>' +
    '<circle cx="7" cy="12" r="4"/><circle cx="17" cy="12" r="4"/></g>' +
    '<circle cx="12" cy="12" r="3.4" fill="#fbe36b"/></svg>';

  const X_SVG =
    '<svg viewBox="0 0 24 24" stroke="#9a8f84" stroke-width="3" stroke-linecap="round" fill="none">' +
    '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

  const DROP_PATH = 'M12 2C12 2 5 10.5 5 15.5A7 7 0 0 0 19 15.5C19 10.5 12 2 12 2Z';

  function dropSvg(filled) {
    const cls = filled ? 'drop-filled' : 'drop-empty';
    return '<svg viewBox="0 0 24 24" class="' + cls + '"><path d="' + DROP_PATH + '"/></svg>';
  }

  function markFor(state) {
    if (state === Grid.CellState.FLOWER) return FLOWER_SVG;
    if (state === Grid.CellState.X) return X_SVG;
    return '';
  }

  function createRenderer(dom) {
    function fitBoard() {
      const available = Math.min(dom.boardWrap.clientWidth, dom.boardWrap.clientHeight);
      const size = Math.max(0, Math.min(available, 560));
      dom.board.style.width = size + 'px';
      dom.board.style.height = size + 'px';
    }

    window.addEventListener('resize', fitBoard);
    window.addEventListener('orientationchange', fitBoard);

    function renderStaticText() {
      dom.appTitle.textContent = I18n.t('appTitle');
      document.title = I18n.t('appFullTitle');
      dom.winTitle.textContent = I18n.t('winTitle');
      dom.winMessage.textContent = I18n.t('winMessage');
      dom.nextLevelButton.textContent = I18n.t('nextLevelButton');
      dom.failTitle.textContent = I18n.t('failTitle');
      dom.failMessage.textContent = I18n.t('failMessage');
      dom.retryButton.textContent = I18n.t('retryButton');
      dom.patternsToggle.textContent = I18n.t('patternsToggleLabel');
    }

    function renderBoard(grid) {
      dom.board.style.gridTemplateColumns = 'repeat(' + grid.size + ', 1fr)';
      dom.board.style.gridTemplateRows = 'repeat(' + grid.size + ', 1fr)';

      const html = [];
      for (let row = 0; row < grid.size; row++) {
        for (let col = 0; col < grid.size; col++) {
          const cell = grid.cells[row][col];
          const patternIdx = cell.region % 8;
          html.push(
            '<div class="cell region-' + cell.region + '" data-row="' + row + '" data-col="' + col + '">' +
              '<div class="cell-pattern pattern-' + patternIdx + '"></div>' +
              '<div class="cell-mark">' + markFor(cell.state) + '</div>' +
            '</div>'
          );
        }
      }
      dom.board.innerHTML = html.join('');
    }

    function renderLives(lives, maxLives) {
      const icons = [];
      for (let i = 0; i < maxLives; i++) icons.push(dropSvg(i < lives));
      dom.lives.innerHTML = icons.join('');
    }

    function renderLevel(level) {
      dom.levelIndicator.textContent = I18n.t('levelLabel', { level });
    }

    function renderOverlays(status) {
      dom.winOverlay.hidden = status !== 'won';
      dom.failOverlay.hidden = status !== 'lost';
    }

    function render(snapshot) {
      renderLevel(snapshot.level);
      renderLives(snapshot.lives, snapshot.maxLives);
      renderBoard(snapshot.grid);
      renderOverlays(snapshot.status);
      fitBoard();
    }

    function setPatternsEnabled(enabled) {
      dom.board.classList.toggle('patterns-off', !enabled);
      dom.patternsToggle.setAttribute('aria-pressed', String(enabled));
    }

    renderStaticText();

    return { render, setPatternsEnabled };
  }

  root.Garden = root.Garden || {};
  root.Garden.render = { createRenderer };
})(typeof window !== 'undefined' ? window : globalThis);
