// DOM rendering. Browser-only (uses document); never contains game-rule logic.
// Cell/life/bed/star DOM nodes are built once per level (or once ever, for
// lives/stars) and updated in place afterwards, so one-shot CSS animations
// (shake, life-drop pop, win-fill wave, bloom, mark-pop, star pop) fire
// exactly once per real transition.
(function (root) {
  const Grid = root.Garden.grid;
  const I18n = root.Garden.i18n;
  const Platform = root.Garden.platform;
  const Themes = root.Garden.themes;
  const Helpers = root.Garden.helpers;
  const AudioFx = root.Garden.audio;

  // Single reusable piece-art lookup: swapping the active theme only means
  // asking Themes for a different bed-color list and a different pieceArt
  // function - markFor() and every caller (board, bed tracker, tutorial,
  // win screen) just ask this for an SVG string.
  function pieceSvgFor(region) {
    const theme = Themes.getCurrentTheme();
    const hex = theme.bedColors[(region || 0) % theme.bedColors.length];
    return theme.pieceArt(hex);
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

  // --- Helper icons: ask the active theme for real art first (Themes.
  // getCurrentTheme().helperIconSvg(id)); if the theme has none (returns
  // null/undefined) or doesn't implement it, fall back to a plain letter
  // glyph per helper, routed through this one function so no other call
  // site (checkin.js's reward preview, this file's own render loop) needs
  // to change once a theme fills in real art. ---
  const HELPER_GLYPH_BY_ID = { finder: 'F', random: '?', snowman: 'S' };

  function helperFallbackGlyph(id) {
    const glyph = HELPER_GLYPH_BY_ID[id] || '?';
    return (
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<text x="12" y="17" font-size="13" font-weight="700" text-anchor="middle" font-family="sans-serif" fill="currentColor">' +
      glyph +
      '</text></svg>'
    );
  }

  function helperIconFor(id) {
    const theme = Themes.getCurrentTheme();
    const themed = theme.helperIconSvg && theme.helperIconSvg(id);
    return themed || helperFallbackGlyph(id);
  }

  // Shared lock glyph - identical to the one already used on the main
  // menu's daily-challenge teaser - shown on any locked helper button
  // instead of its normal icon (currently just Snowman, below level 10).
  const HELPER_LOCK_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

  const HELPER_NAME_KEY = { finder: 'helperNameFinder', random: 'helperNameRandom', snowman: 'helperNameSnowman' };

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
    if (state === Grid.CellState.FLOWER) return pieceSvgFor(region || 0);
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

    const helperEls = {
      finder: { button: dom.helperButtonFinder, icon: dom.helperIconFinder, badge: dom.helperBadgeFinder, lockCaption: dom.helperLockCaptionFinder },
      random: { button: dom.helperButtonRandom, icon: dom.helperIconRandom, badge: dom.helperBadgeRandom, lockCaption: dom.helperLockCaptionRandom },
      snowman: { button: dom.helperButtonSnowman, icon: dom.helperIconSnowman, badge: dom.helperBadgeSnowman, lockCaption: dom.helperLockCaptionSnowman },
    };

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
      dom.themeLabelText.textContent = I18n.t('themeSettingLabel');
      dom.themeWinterButton.textContent = I18n.t('themeOptionWinter');
      dom.themeGardenButton.textContent = I18n.t('themeOptionGarden');
      dom.patternsToggleLabelText.textContent = I18n.t('patternsToggleLabel');
      dom.reduceMotionLabelText.textContent = I18n.t('reduceMotionLabel');
      dom.vibrationLabelText.textContent = I18n.t('vibrationLabel');
      dom.vibrationUnsupportedNote.textContent = I18n.t('vibrationUnsupportedNote');
      dom.settingsCloseButton.setAttribute('aria-label', I18n.t('closeButtonLabel'));
      dom.replayTutorialButton.textContent = I18n.t('replayTutorialButton');
      dom.milestoneBannerTitle.textContent = I18n.t('milestoneBannerTitle');
      // Collapsed to a single short phrase (the title above) - the caption
      // used to repeat the same idea ("Особый уровень"/"A special level").
      // Left in the markup (Codex's to restyle/remove) but never populated.
      dom.milestoneBannerCaption.hidden = true;
    }

    // Refreshes every themed icon that's baked as static innerHTML rather
    // than recomputed on every render: the 3 mascot slots (loading screen,
    // menu, tutorial bubble) plus each unlocked helper button's icon (see
    // helperIconFor above). Locked buttons keep HELPER_LOCK_SVG - that one
    // isn't theme-derived - so they're skipped here and left for
    // renderHelperButton to redraw once unlocked.
    function refreshThemedIcons() {
      const theme = Themes.getCurrentTheme();
      const mascot = Themes.mascotSvg(theme.wantsSantaHat);
      dom.loadingMascot.innerHTML = mascot;
      dom.menuMascot.innerHTML = mascot;
      dom.tutorialMascot.innerHTML = mascot;
      Object.keys(helperEls).forEach(function (id) {
        const els = helperEls[id];
        if (!els.button.classList.contains('is-locked')) {
          els.icon.innerHTML = helperIconFor(id);
        }
      });
    }

    function renderHelperButton(id, info) {
      const els = helperEls[id];
      els.button.classList.toggle('is-locked', info.locked);
      els.button.classList.toggle('is-disabled', !info.locked && info.charges <= 0);
      els.button.disabled = !info.canUse;

      els.icon.innerHTML = info.locked ? HELPER_LOCK_SVG : helperIconFor(id);
      els.badge.hidden = info.locked;
      if (!info.locked) els.badge.textContent = String(info.charges);
      els.lockCaption.hidden = !info.locked;

      if (info.locked) {
        els.lockCaption.textContent = I18n.t('helperLockedCaption', { level: Helpers.SNOWMAN_UNLOCK_LEVEL });
        els.button.setAttribute(
          'aria-label',
          I18n.t('helperLockedAriaLabel', { name: I18n.t(HELPER_NAME_KEY[id]), level: Helpers.SNOWMAN_UNLOCK_LEVEL })
        );
      } else {
        els.button.setAttribute('aria-label', I18n.t('helperAriaLabel', { name: I18n.t(HELPER_NAME_KEY[id]), count: info.charges }));
      }
    }

    function renderHelpers(helpersSnapshot) {
      Object.keys(helperEls).forEach(function (id) {
        renderHelperButton(id, helpersSnapshot[id]);
      });
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
          // Hook for the design agent's styling of pre-placed cells (pieces
          // and crosses, see js/levelstart.js) - never read by game logic.
          if (cell.given) el.dataset.given = 'true';

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

    // helperPlant (optional {row, col}): under reduce motion, a cell planted
    // by Finder/Random plays a plain fade instead of the full bloom+sparkle
    // flourish - it happens without the player's own tap gesture, so some
    // feedback still needs to show something changed, but it stays minimal.
    function syncCells(grid, helperPlant) {
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
            const isPlantedByHelper = helperPlant && helperPlant.row === row && helperPlant.col === col;
            if (cell.state === Grid.CellState.FLOWER) {
              if (isPlantedByHelper && reducedMotion) {
                triggerOneShotAnim(ref.markEl, 'helper-plant-fade');
              } else {
                triggerOneShotAnim(ref.markEl, 'mark-bloom');
                spawnSparkles(row, col);
              }
              AudioFx.playEffect('placeFlower');
            } else if (cell.state === Grid.CellState.X) {
              triggerOneShotAnim(ref.markEl, 'mark-pop');
              AudioFx.playEffect('placeCross');
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
        mark.innerHTML = pieceSvgFor(region);

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
      const livesAriaKey = I18n.pluralRu(lives, ['livesAriaLabelOne', 'livesAriaLabelFew', 'livesAriaLabelMany']);
      dom.lives.setAttribute('aria-label', I18n.t(livesAriaKey, { count: lives }));

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

    // The win-screen streak elements have no slot in index.html (this is a
    // brand-new piece of UI, unlike the daily gift's popup which could
    // reuse existing markup) - built once, lazily, and inserted into the
    // existing win-overlay card, right before the "next level" button, so
    // existing win-screen content/order is never disturbed. Stable hooks
    // for Codex's later styling pass: .win-streak, .win-streak-hint,
    // .win-streak-bonus (the last reusing the same .reward-badge/
    // helper-reward-icons markup pattern the milestone reward already uses).
    let winStreakEls = null;
    function ensureWinStreakEls() {
      if (winStreakEls) return winStreakEls;

      const streakText = document.createElement('p');
      streakText.className = 'win-streak';

      const hintText = document.createElement('p');
      hintText.className = 'win-streak-hint';

      const bonusBadge = document.createElement('div');
      bonusBadge.className = 'reward-badge win-streak-bonus';
      bonusBadge.hidden = true;
      const bonusIcons = document.createElement('span');
      bonusIcons.className = 'helper-reward-icons';
      const bonusAmount = document.createElement('span');
      bonusBadge.appendChild(bonusIcons);
      bonusBadge.appendChild(bonusAmount);

      const card = dom.nextLevelButton.parentElement;
      card.insertBefore(streakText, dom.nextLevelButton);
      card.insertBefore(hintText, dom.nextLevelButton);
      card.insertBefore(bonusBadge, dom.nextLevelButton);

      winStreakEls = { streakText, hintText, bonusBadge, bonusIcons, bonusAmount };
      return winStreakEls;
    }

    function showWinOverlay(snapshot) {
      AudioFx.playEffect('win', { rating: snapshot.rating });
      dom.winFlower.innerHTML = pieceSvgFor(0);
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

      // Milestone reward: +1 charge of each helper, shown only on the
      // milestone level's first-ever completion (see state.js's
      // finishLevel) - same reward-badge/reward-pop markup and animation
      // the daily check-in's reward already uses, so Reduce Motion is
      // honored for free via the existing html.reduce-motion CSS override.
      if (snapshot.milestoneReward) {
        dom.milestoneRewardIcons.innerHTML = Helpers.HELPER_IDS.map(helperIconFor).join('');
        dom.milestoneRewardAmount.textContent = '+' + snapshot.milestoneReward.amount;
        dom.milestoneRewardBadge.hidden = false;
        triggerOneShotAnim(dom.milestoneRewardBadge, 'reward-pop');
        AudioFx.playEffect('reward');
      } else {
        dom.milestoneRewardBadge.hidden = true;
      }

      // Win streak: shown from the 2nd consecutive win on (snapshot.streak
      // is null entirely on a replay of an already-completed level, which
      // never extends or breaks the streak - see state.js's finishLevel).
      const streakEls = ensureWinStreakEls();
      if (snapshot.streak !== null && snapshot.streak >= 2) {
        streakEls.streakText.hidden = false;
        streakEls.streakText.textContent = I18n.t('winStreakLabel', { count: snapshot.streak });
        streakEls.hintText.hidden = false;
        streakEls.hintText.textContent = I18n.t('winStreakHint', { count: snapshot.winsUntilStreakBonus });
      } else {
        streakEls.streakText.hidden = true;
        streakEls.hintText.hidden = true;
      }

      if (snapshot.streakBonus) {
        streakEls.bonusIcons.innerHTML = helperIconFor(snapshot.streakBonus.helperId);
        streakEls.bonusAmount.textContent = '+' + snapshot.streakBonus.amount;
        streakEls.bonusBadge.hidden = false;
        streakEls.bonusBadge.setAttribute(
          'aria-label',
          I18n.t('winStreakBonusAriaLabel', {
            name: I18n.t(HELPER_NAME_KEY[snapshot.streakBonus.helperId]),
            amount: snapshot.streakBonus.amount,
          })
        );
        triggerOneShotAnim(streakEls.bonusBadge, 'reward-pop');
        AudioFx.playEffect('reward');
      } else {
        streakEls.bonusBadge.hidden = true;
      }

      dom.winOverlay.hidden = false;
    }

    function render(snapshot) {
      renderLevel(snapshot.level);
      renderScore(snapshot.totalScore);
      // canUse already folds in each helper's double-spend lock window (see
      // state.js canUseHelper/HELPER_LOCK_MS), so this is the only check needed.
      renderHelpers(snapshot.helpers);

      if (!dropEls) buildLives(snapshot.maxLives);
      syncLives(snapshot.lives, snapshot.maxLives, snapshot.mistake ? snapshot.mistake.lostLifeIndex : null);

      // Styling hooks for the design agent (js/levelstart.js's start type/
      // level kind) - never read by game logic, so safe to set unconditionally.
      dom.boardWrap.dataset.startType = snapshot.startType;
      dom.boardWrap.dataset.levelKind = snapshot.levelKind;

      if (snapshot.grid !== renderedGrid) {
        buildBoard(snapshot.grid);
        buildBedTracker(snapshot.grid);
        renderedGrid = snapshot.grid;
        rulesPopupOpen = false;
        applyRulesMode(snapshot.level);
        // Shown for the whole time a milestone level is open, hidden
        // otherwise - toggled only on actually entering a (new) level.
        dom.milestoneBanner.hidden = snapshot.levelKind !== 'milestone';
        if (snapshot.levelKind === 'milestone') AudioFx.playEffect('milestoneStart');
      } else {
        syncCells(snapshot.grid, snapshot.helperPlant);
        syncBedTracker(snapshot.grid);
      }

      if (snapshot.mistake) {
        triggerMistakeShake(snapshot.mistake.row, snapshot.mistake.col);
        if (vibrationEnabled) Platform.vibrate(120);
        // The fatal mistake (the one that actually spends the last life)
        // plays the "lose" phrase instead of the plain mistake bonk - the
        // fail overlay appears on this exact same tick.
        AudioFx.playEffect(snapshot.status === 'lost' ? 'lose' : 'mistake');
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

    // Resolves/applies the theme's CSS token overrides (Themes.applyTheme),
    // switches the i18n piece-name axis to match, and refreshes everything
    // already on screen that bakes theme-derived content into static
    // strings: the rule/tutorial text and every already-drawn piece-art SVG
    // (bed colors themselves update for free via the CSS custom properties,
    // but a planted flower/gingerbread's own markup has its colors baked in
    // at draw time, so it needs an explicit refresh). Returns the resolved
    // theme id so the caller can reflect it in the settings UI.
    function setTheme(themeId) {
      const resolved = Themes.applyTheme(themeId);
      I18n.setTheme(resolved);
      renderStaticText();
      refreshThemedIcons();
      if (renderedGrid) {
        buildBedTracker(renderedGrid);
        syncCells(renderedGrid);
      }
      return resolved;
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
    refreshThemedIcons();
    spawnParticles();

    return {
      render,
      setPatternsEnabled,
      setReducedMotion,
      setVibrationEnabled,
      setTheme,
      toggleRulesPopup,
      closeRulesPopup,
      openSettings,
      closeSettings,
    };
  }

  root.Garden = root.Garden || {};
  root.Garden.render = { createRenderer, markFor, pieceSvgFor, helperIconFor, triggerOneShotAnim };
})(typeof window !== 'undefined' ? window : globalThis);
