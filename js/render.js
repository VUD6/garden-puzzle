// DOM rendering. Browser-only (uses document); never contains game-rule logic.
// Cell/life/bed DOM nodes are built once per level and updated in place
// afterwards, so one-shot CSS animations (shake, life-drop pop, auto-X
// appear) fire exactly once.
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
    let bedEls = null; // [region] -> .bed-icon element
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
      dom.nextLevelButton.textContent = I18n.t('nextLevelButton');
      dom.failTitle.textContent = I18n.t('failTitle');
      dom.failMessage.textContent = I18n.t('failMessage');
      dom.retryButton.textContent = I18n.t('retryButton');
      dom.patternsToggle.textContent = I18n.t('patternsToggleLabel');
      dom.autoXToggle.textContent = I18n.t('autoXToggleLabel');
      dom.ruleTextBed.textContent = I18n.t('ruleBedText');
      dom.ruleTextRowCol.textContent = I18n.t('ruleRowColText');
      dom.ruleTextTouch.textContent = I18n.t('ruleTouchText');
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

    function triggerAutoXAppear(cells) {
      cells.forEach(function (pos, index) {
        const markEl = cellEls[pos.row][pos.col].markEl;
        markEl.style.animationDelay = index * 30 + 'ms';
        markEl.classList.add('auto-x-appear');
        markEl.addEventListener(
          'animationend',
          function handler() {
            markEl.classList.remove('auto-x-appear');
            markEl.style.animationDelay = '';
            markEl.removeEventListener('animationend', handler);
          },
          { once: true }
        );
      });
    }

    function spawnScorePopup(row, col, amount) {
      const cellRect = cellEls[row][col].el.getBoundingClientRect();
      const wrapRect = dom.boardWrap.getBoundingClientRect();

      const popup = document.createElement('div');
      popup.className = 'score-popup';
      popup.textContent = '+' + amount;
      popup.style.left = cellRect.left - wrapRect.left + cellRect.width / 2 + 'px';
      popup.style.top = cellRect.top - wrapRect.top + 'px';

      dom.boardWrap.appendChild(popup);
      popup.addEventListener('animationend', function () { popup.remove(); }, { once: true });
    }

    function buildBedTracker(grid) {
      dom.bedTracker.innerHTML = '';
      bedEls = [];
      for (let region = 0; region < grid.size; region++) {
        const el = document.createElement('div');
        el.className = 'bed-icon region-' + region;

        const mark = document.createElement('div');
        mark.className = 'bed-icon-mark';
        mark.innerHTML = FLOWER_SVG;

        el.appendChild(mark);
        dom.bedTracker.appendChild(el);
        bedEls.push(el);
      }
      syncBedTracker(grid);
    }

    function syncBedTracker(grid) {
      const complete = new Array(grid.size).fill(false);
      for (let row = 0; row < grid.size; row++) {
        for (let col = 0; col < grid.size; col++) {
          const cell = grid.cells[row][col];
          if (cell.state === Grid.CellState.FLOWER) complete[cell.region] = true;
        }
      }
      for (let region = 0; region < grid.size; region++) {
        bedEls[region].classList.toggle('complete', complete[region]);
      }
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
          // Removing (rather than leaving) this class also cancels any
          // still-running pop-fade animation from an earlier loss, which
          // prevents its pending 'animationend' handler from firing later
          // and clobbering a life count that has since been reset (e.g. retry).
          el.classList.remove('drop-losing');
          el.classList.toggle('drop-filled', filled);
          el.classList.toggle('drop-empty', !filled);
        }
      }
    }

    function renderLevel(level) {
      dom.levelIndicator.textContent = I18n.t('levelLabel', { level });
    }

    function renderScore(totalScore) {
      dom.scoreDisplay.textContent = I18n.t('scoreLabel', { score: totalScore });
    }

    function renderResult(perfect, levelScore) {
      dom.winTitle.textContent = I18n.t(perfect ? 'resultPerfect' : 'resultDone');
      dom.winTitle.className = 'result-text ' + (perfect ? 'result-perfect' : 'result-done');
      dom.winMessage.textContent = I18n.t('scoreEarnedLabel', { amount: levelScore });

      // Force a reflow so the pop animation restarts even if winTitle already
      // had the 'result-pop' class from a previous level's win.
      dom.winTitle.classList.remove('result-pop');
      void dom.winTitle.offsetWidth;
      dom.winTitle.classList.add('result-pop');
    }

    function renderOverlays(snapshot) {
      dom.winOverlay.hidden = snapshot.status !== 'won';
      dom.failOverlay.hidden = snapshot.status !== 'lost';
      if (snapshot.status === 'won') renderResult(snapshot.perfect, snapshot.levelScore);
    }

    function render(snapshot) {
      renderLevel(snapshot.level);
      renderScore(snapshot.totalScore);

      if (!dropEls) buildLives(snapshot.maxLives);
      syncLives(snapshot.lives, snapshot.maxLives, snapshot.mistake ? snapshot.mistake.lostLifeIndex : null);

      if (snapshot.grid !== renderedGrid) {
        buildBoard(snapshot.grid);
        buildBedTracker(snapshot.grid);
        renderedGrid = snapshot.grid;
      } else {
        syncCells(snapshot.grid);
        syncBedTracker(snapshot.grid);
      }

      if (snapshot.mistake) triggerMistakeShake(snapshot.mistake.row, snapshot.mistake.col);
      if (snapshot.scoreGain) spawnScorePopup(snapshot.scoreGain.row, snapshot.scoreGain.col, snapshot.scoreGain.amount);
      if (snapshot.autoX && snapshot.autoX.length) triggerAutoXAppear(snapshot.autoX);

      renderOverlays(snapshot);
      fitBoard();
    }

    function setPatternsEnabled(enabled) {
      dom.board.classList.toggle('patterns-off', !enabled);
      dom.patternsToggle.setAttribute('aria-pressed', String(enabled));
    }

    function setAutoXEnabled(enabled) {
      dom.autoXToggle.setAttribute('aria-pressed', String(enabled));
    }

    renderStaticText();

    return { render, setPatternsEnabled, setAutoXEnabled };
  }

  root.Garden = root.Garden || {};
  root.Garden.render = { createRenderer };
})(typeof window !== 'undefined' ? window : globalThis);
