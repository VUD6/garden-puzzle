// DOM rendering. Browser-only (uses document); never contains game-rule logic.
// Cell/life/bed/star DOM nodes are built once per level (or once ever, for
// lives/stars) and updated in place afterwards, so one-shot CSS animations
// (shake, life-drop pop, win-fill wave, bloom, mark-pop, star pop) fire
// exactly once per real transition.
(function (root) {
  const Grid = root.Garden.grid;
  const I18n = root.Garden.i18n;
  const Platform = root.Garden.platform;

  // Must stay in sync with --region-0..7 in css/style.css: the flower's
  // own color is derived from the bed's hue at draw time (not a separate
  // hardcoded token per region), so this is the one place that needs to
  // know what a bed actually looks like.
  const REGION_COLORS = ['#c97b84', '#6f9bc4', '#cdb15a', '#6fb08a', '#a888c9', '#cc8c5c', '#5cb3a8', '#c47bb0'];

  // Rose-spiral layout: three rings of petals, each smaller and rotated a
  // bit further than the last, opening outer-to-inner. Reused for every
  // flower in the game (board, bed tracker, tutorial, win screen).
  const ROSE_RINGS = [
    { count: 6, angleOffset: 0, delayBase: 0, path: 'M12 5C13.8 7 14.2 9.4 12 12C9.8 9.4 10.2 7 12 5Z', shade: 'outer' },
    { count: 5, angleOffset: 30, delayBase: 110, path: 'M12 7C13.3 8.4 13.6 10 12 12C10.4 10 10.7 8.4 12 7Z', shade: 'middle' },
    { count: 4, angleOffset: 55, delayBase: 210, path: 'M12 9C12.9 9.8 13.1 10.6 12 12C10.9 10.6 11.1 9.8 12 9Z', shade: 'inner' },
  ];
  const RING_DELAY_STEP_MS = 20;

  function clamp(value, lo, hi) {
    return Math.max(lo, Math.min(hi, value));
  }

  function hexToHsl(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
  }

  function hsl(h, s, l) {
    return 'hsl(' + h.toFixed(0) + ' ' + clamp(s, 0, 100).toFixed(0) + '% ' + clamp(l, 0, 100).toFixed(0) + '%)';
  }

  // Three shades for the rose's three rings, all pushed well away from
  // the bed's own lightness (lighter bed -> darker flower, darker bed ->
  // lighter flower) so the flower reads clearly at a glance even on a
  // small 8x8 tile, then nudged a little further in that same direction
  // ring by ring for some depth - each stage clamped on its own so the
  // inner ring can never collapse to pure black/white.
  function flowerPalette(region) {
    const bed = hexToHsl(REGION_COLORS[(region || 0) % REGION_COLORS.length]);
    const sign = bed.l > 52 ? -1 : 1;
    const flowerL = clamp(bed.l + sign * 42, 12, 90);
    const flowerS = clamp(bed.s + 20, 35, 95);
    const step = sign * 7;
    return {
      outer: hsl(bed.h, flowerS, flowerL),
      middle: hsl(bed.h, clamp(flowerS - 10, 30, 95), clamp(flowerL + step, 10, 92)),
      inner: hsl(bed.h, clamp(flowerS - 18, 25, 95), clamp(flowerL + step * 2, 8, 94)),
    };
  }

  // Single reusable "rose spiral" flower component: swapping the art
  // style later only means changing this one function - markFor() and
  // every caller (board, bed tracker, tutorial, win screen) just ask it
  // for an SVG string.
  function flowerSvgFor(region) {
    const palette = flowerPalette(region);
    let petals = '';
    ROSE_RINGS.forEach(function (ring) {
      for (let i = 0; i < ring.count; i++) {
        const angle = ring.angleOffset + (360 / ring.count) * i;
        const delay = ring.delayBase + i * RING_DELAY_STEP_MS;
        petals +=
          '<g transform="rotate(' + angle + ' 12 12)">' +
          '<path class="petal" style="animation-delay:' + delay + 'ms" fill="' + palette[ring.shade] + '" d="' + ring.path + '"/>' +
          '</g>';
      }
    });
    return '<svg viewBox="0 0 24 24">' + petals + '<circle cx="12" cy="12" r="1.3" fill="var(--flower-center)"/></svg>';
  }

  const X_SVG =
    '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none">' +
    '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

  // Visually distinct from the plain "no flower" X: red, bolder, on a soft red disc.
  const WRONG_SVG =
    '<svg viewBox="0 0 24 24">' +
    '<circle cx="12" cy="12" r="11" fill="var(--mark-wrong-bg)"/>' +
    '<g stroke="var(--mark-wrong)" stroke-width="4" stroke-linecap="round">' +
    '<line x1="7" y1="7" x2="17" y2="17"/><line x1="17" y1="7" x2="7" y2="17"/></g></svg>';

  const DROP_PATH = 'M12 2C12 2 5 10.5 5 15.5A7 7 0 0 0 19 15.5C19 10.5 12 2 12 2Z';
  const STAR_PATH = 'M12 2l2.9 6.26L22 9.27l-5 5.13L18.18 22 12 18.56 5.82 22 7 14.4l-5-5.13 7.1-1.01L12 2z';

  const RANK_KEY_BY_RATING = { 1: 'rankGardener', 2: 'rankSkilledGardener', 3: 'rankMasterGardener' };

  const WAVE_STAGGER_MS = 35;
  const WAVE_DURATION_MS = 250;
  const RULES_INLINE_MAX_LEVEL = 5;
  const PARTICLE_COUNT = 10;

  // One uniform gap between every cell (same bed or not - beds are told
  // apart only by color), scaled down on bigger boards so cells stay a
  // comfortable minimum size on phones, but never below ~3px.
  function gapForSize(size) {
    if (size <= 4) return 8;
    if (size === 5) return 7;
    if (size === 6) return 6;
    if (size === 7) return 4.5;
    return 3;
  }

  function markFor(state, region) {
    if (state === Grid.CellState.FLOWER) return flowerSvgFor(region || 0);
    if (state === Grid.CellState.X) return X_SVG;
    if (state === Grid.CellState.WRONG) return WRONG_SVG;
    return '';
  }

  function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes + ':' + String(seconds).padStart(2, '0');
  }

  function triggerOneShotAnim(el, className) {
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
  }

  function createRenderer(dom) {
    let cellEls = null; // [row][col] -> .cell element, rebuilt only when the grid changes
    let bedEls = null; // [region] -> .bed-icon element
    let renderedGrid = null;
    let dropEls = null; // built once; lives persist as a fixed set of 3 icons
    let starEls = null; // built once; rating persists as a fixed set of 3 icons
    let reducedMotion = false;
    let vibrationEnabled = true;
    let rulesPopupOpen = false;
    let rulesInline = true;

    function fitBoard() {
      const available = Math.min(dom.boardWrap.clientWidth, dom.boardWrap.clientHeight);
      const size = Math.max(0, Math.min(available, 560));
      dom.board.style.width = size + 'px';
      dom.board.style.height = size + 'px';
    }

    window.addEventListener('resize', fitBoard);
    window.addEventListener('orientationchange', fitBoard);

    function renderStaticText() {
      document.title = I18n.t('appFullTitle');
      dom.loadingTitle.textContent = I18n.t('appTitle');
      dom.loadingStatusText.textContent = I18n.t('loadingStatusText');
      dom.nextLevelButton.textContent = I18n.t('nextLevelButton');
      dom.failTitle.textContent = I18n.t('failTitle');
      dom.failMessage.textContent = I18n.t('failMessage');
      dom.retryButton.textContent = I18n.t('retryButton');
      dom.ruleTextBed.textContent = I18n.t('ruleBedText');
      dom.ruleTextRowCol.textContent = I18n.t('ruleRowColText');
      dom.ruleTextTouch.textContent = I18n.t('ruleTouchText');
      dom.rulesPopupTitle.textContent = I18n.t('rulesPopupTitle');
      dom.rulesHelpButton.setAttribute('aria-label', I18n.t('rulesHelpButtonLabel'));
      dom.rulesCloseButton.setAttribute('aria-label', I18n.t('closeButtonLabel'));
      dom.backButton.setAttribute('aria-label', I18n.t('backButtonLabel'));
      dom.settingsButton.setAttribute('aria-label', I18n.t('settingsButtonLabel'));
      dom.settingsTitleText.textContent = I18n.t('settingsTitle');
      dom.patternsToggleLabelText.textContent = I18n.t('patternsToggleLabel');
      dom.reduceMotionLabelText.textContent = I18n.t('reduceMotionLabel');
      dom.vibrationLabelText.textContent = I18n.t('vibrationLabel');
      dom.vibrationUnsupportedNote.textContent = I18n.t('vibrationUnsupportedNote');
      dom.settingsCloseButton.setAttribute('aria-label', I18n.t('closeButtonLabel'));
      dom.replayTutorialButton.textContent = I18n.t('replayTutorialButton');
    }

    function buildBoard(grid) {
      dom.board.classList.remove('board-complete');
      dom.board.style.gridTemplateColumns = 'repeat(' + grid.size + ', 1fr)';
      dom.board.style.gridTemplateRows = 'repeat(' + grid.size + ', 1fr)';
      dom.board.style.gap = gapForSize(grid.size) + 'px';
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
          rowEls.push({ el, markEl, region: cell.region, prevState: cell.state });
        }
        cellEls.push(rowEls);
      }

      syncCells(grid);
    }

    function spawnSparkles(row, col) {
      if (reducedMotion) return;
      const cellRect = cellEls[row][col].el.getBoundingClientRect();
      const wrapRect = dom.boardWrap.getBoundingClientRect();
      const cx = cellRect.left - wrapRect.left + cellRect.width / 2;
      const cy = cellRect.top - wrapRect.top + cellRect.height / 2;
      const count = 4;
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
        const dist = 16 + Math.random() * 10;
        const sx = Math.cos(angle) * dist;
        const sy = Math.sin(angle) * dist - 6;

        const el = document.createElement('div');
        el.className = 'sparkle';
        el.style.left = cx + 'px';
        el.style.top = cy + 'px';
        el.style.setProperty('--sx', sx + 'px');
        el.style.setProperty('--sy', sy + 'px');
        dom.boardWrap.appendChild(el);
        el.addEventListener('animationend', function () { el.remove(); }, { once: true });
      }
    }

    function syncCells(grid) {
      for (let row = 0; row < grid.size; row++) {
        for (let col = 0; col < grid.size; col++) {
          const cell = grid.cells[row][col];
          const ref = cellEls[row][col];
          const className = 'cell region-' + ref.region + (cell.locked ? ' locked' : '');
          if (ref.el.className !== className) ref.el.className = className;

          const mark = markFor(cell.state, ref.region);
          if (ref.markEl.__mark !== mark) {
            ref.markEl.innerHTML = mark;
            ref.markEl.__mark = mark;
          }

          ref.markEl.classList.toggle('mark-flower', cell.state === Grid.CellState.FLOWER);

          if (cell.state !== ref.prevState) {
            if (cell.state === Grid.CellState.FLOWER) {
              triggerOneShotAnim(ref.markEl, 'mark-bloom');
              spawnSparkles(row, col);
            } else if (cell.state === Grid.CellState.X) {
              triggerOneShotAnim(ref.markEl, 'mark-pop');
            }
            ref.prevState = cell.state;
          }
        }
      }
    }

    function applyBoardComplete(grid) {
      dom.board.classList.add('board-complete');
      for (let row = 0; row < grid.size; row++) {
        for (let col = 0; col < grid.size; col++) {
          const cell = grid.cells[row][col];
          if (cell.state === Grid.CellState.FLOWER) {
            cellEls[row][col].markEl.style.animationDelay = ((row + col) % 5) * 0.18 + 's';
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
        mark.innerHTML = flowerSvgFor(region);

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

    function applyRulesMode(level) {
      rulesInline = level <= RULES_INLINE_MAX_LEVEL;
      dom.rulesHelpButton.hidden = rulesInline;
      dom.rulesBar.classList.toggle('popup-mode', !rulesInline);
      dom.rulesBar.hidden = rulesInline ? false : !rulesPopupOpen;
    }

    function toggleRulesPopup() {
      if (rulesInline) return;
      rulesPopupOpen = !rulesPopupOpen;
      dom.rulesBar.hidden = !rulesPopupOpen;
    }

    function closeRulesPopup() {
      rulesPopupOpen = false;
      if (!rulesInline) dom.rulesBar.hidden = true;
    }

    function showWinOverlay(snapshot) {
      dom.winFlower.innerHTML = flowerSvgFor(0);
      triggerOneShotAnim(dom.winFlower, 'mark-bloom');

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
        rulesPopupOpen = false;
        applyRulesMode(snapshot.level);
      } else {
        syncCells(snapshot.grid);
        syncBedTracker(snapshot.grid);
      }

      if (snapshot.mistake) {
        triggerMistakeShake(snapshot.mistake.row, snapshot.mistake.col);
        if (vibrationEnabled) Platform.vibrate(120);
      }
      if (snapshot.scoreGain) spawnScorePopup(snapshot.scoreGain.row, snapshot.scoreGain.col, snapshot.scoreGain.amount);

      dom.failOverlay.hidden = snapshot.status !== 'lost';

      if (snapshot.status === 'won' && snapshot.winFill) {
        dom.winOverlay.hidden = true;
        triggerWinFillWave(snapshot.winFill, function () {
          applyBoardComplete(snapshot.grid);
          showWinOverlay(snapshot);
        });
      } else {
        dom.winOverlay.hidden = snapshot.status !== 'won';
      }

      fitBoard();
    }

    function setPatternsEnabled(enabled) {
      dom.board.classList.toggle('patterns-on', enabled);
    }

    function setReducedMotion(enabled) {
      reducedMotion = enabled;
      document.documentElement.classList.toggle('reduce-motion', enabled);
    }

    function setVibrationEnabled(enabled) {
      vibrationEnabled = enabled;
    }

    function openSettings() {
      dom.settingsOverlay.hidden = false;
    }

    function closeSettings() {
      dom.settingsOverlay.hidden = true;
    }

    function spawnParticles() {
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const duration = 14 + Math.random() * 10;
        const el = document.createElement('div');
        el.className = 'particle';
        el.style.left = Math.random() * 100 + '%';
        el.style.setProperty('--size', (3 + Math.random() * 4).toFixed(1) + 'px');
        el.style.setProperty('--dur', duration.toFixed(1) + 's');
        el.style.setProperty('--delay', '-' + (Math.random() * duration).toFixed(1) + 's');
        el.style.setProperty('--drift', ((Math.random() - 0.5) * 60).toFixed(0) + 'px');
        dom.ambientParticles.appendChild(el);
      }
    }

    renderStaticText();
    spawnParticles();

    return {
      render,
      setPatternsEnabled,
      setReducedMotion,
      setVibrationEnabled,
      toggleRulesPopup,
      closeRulesPopup,
      openSettings,
      closeSettings,
    };
  }

  root.Garden = root.Garden || {};
  root.Garden.render = { createRenderer, markFor, flowerSvgFor };
})(typeof window !== 'undefined' ? window : globalThis);
