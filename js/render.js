// DOM rendering. Browser-only (uses document); never contains game-rule logic.
// Cell/life/bed/star DOM nodes are built once per level (or once ever, for
// lives/stars) and updated in place afterwards, so one-shot CSS animations
// (shake, life-drop pop, win-fill wave, star pop) fire exactly once.
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
  const STAR_PATH = 'M12 2l2.9 6.26L22 9.27l-5 5.13L18.18 22 12 18.56 5.82 22 7 14.4l-5-5.13 7.1-1.01L12 2z';

  const RANK_KEY_BY_RATING = { 1: 'rankGardener', 2: 'rankSkilledGardener', 3: 'rankMasterGardener' };

  const WAVE_STAGGER_MS = 35;
  const WAVE_DURATION_MS = 250;

  function markFor(state) {
    if (state === Grid.CellState.FLOWER) return FLOWER_SVG;
    if (state === Grid.CellState.X) return X_SVG;
    if (state === Grid.CellState.WRONG) return WRONG_SVG;
    return '';
  }

  function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes + ':' + String(seconds).padStart(2, '0');
  }

  function createRenderer(dom) {
    let cellEls = null; // [row][col] -> .cell element, rebuilt only when the grid changes
    let bedEls = null; // [region] -> .bed-icon element
    let renderedGrid = null;
    let dropEls = null; // built once; lives persist as a fixed set of 3 icons
    let starEls = null; // built once; rating persists as a fixed set of 3 icons

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

    // Plays a staggered "wave" of appear animations over cells that just got
    // auto-filled with X on level completion, then calls onDone once the last
    // one finishes so the win overlay can appear right after.
    function triggerWinFillWave(cells, onDone) {
      if (!cells.length) {
        onDone();
        return;
      }

      cells.forEach(function (pos, index) {
        const markEl = cellEls[pos.row][pos.col].markEl;
        markEl.style.animationDelay = index * WAVE_STAGGER_MS + 'ms';
        markEl.classList.add('wave-appear');
      });

      const totalMs = (cells.length - 1) * WAVE_STAGGER_MS + WAVE_DURATION_MS;
      setTimeout(function () {
        cells.forEach(function (pos) {
          const markEl = cellEls[pos.row][pos.col].markEl;
          markEl.classList.remove('wave-appear');
          markEl.style.animationDelay = '';
        });
        onDone();
      }, totalMs);
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

    function buildStars() {
      dom.starsContainer.innerHTML = '';
      starEls = [];
      for (let i = 0; i < 3; i++) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.classList.add('star-empty');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', STAR_PATH);
        svg.appendChild(path);
        dom.starsContainer.appendChild(svg);
        starEls.push(svg);
      }
    }

    function syncStars(rating) {
      for (let i = 0; i < 3; i++) {
        starEls[i].classList.toggle('star-filled', i < rating);
        starEls[i].classList.toggle('star-empty', i >= rating);
      }
      // Force a reflow so the staggered pop restarts on every win, even back
      // to back with the same rating.
      dom.starsContainer.classList.remove('star-pop');
      void dom.starsContainer.offsetWidth;
      dom.starsContainer.classList.add('star-pop');
    }

    function renderLevel(level) {
      dom.levelIndicator.textContent = I18n.t('levelLabel', { level });
    }

    function renderScore(totalScore) {
      dom.scoreDisplay.textContent = I18n.t('scoreLabel', { score: totalScore });
    }

    function showWinOverlay(snapshot) {
      dom.winTitle.textContent = I18n.t(snapshot.perfect ? 'resultPerfect' : 'resultDone');
      dom.winTitle.className = 'result-text ' + (snapshot.perfect ? 'result-perfect' : 'result-done');
      dom.winTitle.classList.remove('result-pop');
      void dom.winTitle.offsetWidth;
      dom.winTitle.classList.add('result-pop');

      if (!starEls) buildStars();
      syncStars(snapshot.rating);
      dom.rankTitle.textContent = I18n.t(RANK_KEY_BY_RATING[snapshot.rating]);

      dom.winMessage.textContent = I18n.t('scoreEarnedLabel', { amount: snapshot.levelScore });
      dom.bestTimeLine.textContent = I18n.t('bestTimeLabel', { time: formatTime(snapshot.bestTimeSeconds) });

      dom.winOverlay.hidden = false;
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

      dom.failOverlay.hidden = snapshot.status !== 'lost';

      if (snapshot.status === 'won' && snapshot.winFill) {
        dom.winOverlay.hidden = true;
        triggerWinFillWave(snapshot.winFill, function () {
          showWinOverlay(snapshot);
        });
      } else {
        dom.winOverlay.hidden = snapshot.status !== 'won';
      }

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
  root.Garden.render = { createRenderer, markFor };
})(typeof window !== 'undefined' ? window : globalThis);
