// DOM rendering. Browser-only (uses document); never contains game-rule logic.
// Cell/life DOM nodes are built once per level and updated in place afterwards,
// so one-shot CSS animations (mistake shake, life-drop pop) fire exactly once.
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

  // Visually distinct from the plain "no flower" X: red, bolder, on a soft red disc.
  const WRONG_SVG =
    '<svg viewBox="0 0 24 24">' +
    '<circle cx="12" cy="12" r="11" fill="#c0392b" fill-opacity="0.15"/>' +
    '<g stroke="#c0392b" stroke-width="4" stroke-linecap="round">' +
    '<line x1="7" y1="7" x2="17" y2="17"/><line x1="17" y1="7" x2="7" y2="17"/></g></svg>';

  const DROP_PATH = 'M12 2C12 2 5 10.5 5 15.5A7 7 0 0 0 19 15.5C19 10.5 12 2 12 2Z';

  function markFor(state) {
    if (state === Grid.CellState.FLOWER) return FLOWER_SVG;
    if (state === Grid.CellState.X) return X_SVG;
    if (state === Grid.CellState.WRONG) return WRONG_SVG;
    return '';
  }

  function createRenderer(dom) {
    let cellEls = null; // [row][col] -> .cell element, rebuilt only when the grid changes
    let renderedGrid = null;
    let dropEls = null; // built once; lives persist as a fixed set of 3 icons

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

    function buildBoard(grid) {
      dom.board.style.gridTemplateColumns = 'repeat(' + grid.size + ', 1fr)';
      dom.board.style.gridTemplateRows = 'repeat(' + grid.size + ', 1fr)';
      dom.board.innerHTML = '';

      cellEls = [];
      for (let row = 0; row < grid.size; row++) {
        const rowEls = [];
        for (let col = 0; col < grid.size; col++) {
          const cell = grid.cells[row][col];
          const patternIdx = cell.region % 8;

          const el = document.createElement('div');
          el.dataset.row = String(row);
          el.dataset.col = String(col);

          const patternEl = document.createElement('div');
          patternEl.className = 'cell-pattern pattern-' + patternIdx;

          const markEl = document.createElement('div');
          markEl.className = 'cell-mark';

          el.appendChild(patternEl);
          el.appendChild(markEl);
          dom.board.appendChild(el);
          rowEls.push({ el, markEl, region: cell.region });
        }
        cellEls.push(rowEls);
      }

      syncCells(grid);
    }

    function syncCells(grid) {
      for (let row = 0; row < grid.size; row++) {
        for (let col = 0; col < grid.size; col++) {
          const cell = grid.cells[row][col];
          const ref = cellEls[row][col];
          const className = 'cell region-' + ref.region + (cell.locked ? ' locked' : '');
          if (ref.el.className !== className) ref.el.className = className;

          const mark = markFor(cell.state);
          if (ref.markEl.__mark !== mark) {
            ref.markEl.innerHTML = mark;
            ref.markEl.__mark = mark;
          }
        }
      }
    }

    function triggerMistakeShake(row, col) {
      const ref = cellEls[row][col];
      ref.el.classList.add('shake-once');
      ref.el.addEventListener(
        'animationend',
        function handler() {
          ref.el.classList.remove('shake-once');
          ref.el.removeEventListener('animationend', handler);
        },
        { once: true }
      );
    }

    function buildLives(maxLives) {
      dom.lives.innerHTML = '';
      dropEls = [];
      for (let i = 0; i < maxLives; i++) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.classList.add('drop-filled');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', DROP_PATH);
        svg.appendChild(path);
        dom.lives.appendChild(svg);
        dropEls.push(svg);
      }
    }

    function syncLives(lives, maxLives, losingIndex) {
      for (let i = 0; i < maxLives; i++) {
        const el = dropEls[i];
        const filled = i < lives;

        if (i === losingIndex) {
          el.classList.remove('drop-empty');
          el.classList.add('drop-filled', 'drop-losing');
          el.addEventListener(
            'animationend',
            function handler() {
              el.classList.remove('drop-losing', 'drop-filled');
              el.classList.add('drop-empty');
              el.removeEventListener('animationend', handler);
            },
            { once: true }
          );
        } else {
          el.classList.toggle('drop-filled', filled);
          el.classList.toggle('drop-empty', !filled);
        }
      }
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

      if (!dropEls) buildLives(snapshot.maxLives);
      syncLives(snapshot.lives, snapshot.maxLives, snapshot.mistake ? snapshot.mistake.lostLifeIndex : null);

      if (snapshot.grid !== renderedGrid) {
        buildBoard(snapshot.grid);
        renderedGrid = snapshot.grid;
      } else {
        syncCells(snapshot.grid);
      }

      if (snapshot.mistake) triggerMistakeShake(snapshot.mistake.row, snapshot.mistake.col);

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
