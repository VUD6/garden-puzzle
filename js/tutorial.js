// First-launch tutorial: a small hand-made 4x4 level (never generated/solved)
// that teaches the five core rules one at a time on a dimmed board where
// only the relevant cells are interactive. Browser-only (DOM); no game-rule
// logic lives here - it just stages a tiny fixed grid and watches taps.
(function (root) {
  const Grid = root.Garden.grid;
  const I18n = root.Garden.i18n;
  const AudioFx = root.Garden.audio;
  const CellState = Grid.CellState;
  const DOUBLE_TAP_WINDOW_MS = root.Garden.state.DOUBLE_TAP_WINDOW_MS;
  const ADVANCE_DELAY_MS = 550;

  const SIZE = 4;
  // One flower, pre-chosen at (0,1); regions are shaped only so that bed,
  // the fixed row/column, and its 8 neighbors give small, clean highlight
  // sets for each step below. The other three regions/flowers implied by
  // this partition are never asked for - the tutorial never requires a full
  // solve.
  const REGION_OF = [
    [0, 0, 1, 1],
    [2, 0, 1, 1],
    [2, 2, 3, 1],
    [2, 3, 3, 3],
  ];

  const STEPS = [
    { type: 'flower', cells: [{ row: 0, col: 1 }], messageKey: 'tutorialStep1', hand: { row: 0, col: 1 } },
    { type: 'mark', cells: [{ row: 0, col: 0 }, { row: 1, col: 1 }], messageKey: 'tutorialStep2' },
    {
      type: 'mark',
      cells: [{ row: 0, col: 2 }, { row: 0, col: 3 }, { row: 2, col: 1 }, { row: 3, col: 1 }],
      messageKey: 'tutorialStep3',
    },
    { type: 'mark', cells: [{ row: 1, col: 0 }, { row: 1, col: 2 }], messageKey: 'tutorialStep4' },
    { type: 'mark', cells: [{ row: 2, col: 3 }, { row: 3, col: 0 }], messageKey: 'tutorialStep5' },
  ];

  function cellKey(row, col) {
    return row + ',' + col;
  }

  function createTutorial(dom) {
    const markFor = root.Garden.render.markFor;

    let cellEls = null; // [row][col] -> { el, markEl }
    let cellStates = null; // [row][col] -> { state, locked }
    let stepIndex = 0;
    let pending = null; // Set of 'row,col' still needing an action this step
    let lastTap = null;
    let pendingOnComplete = function () {};

    function buildBoard() {
      dom.tutorialBoard.style.gridTemplateColumns = 'repeat(' + SIZE + ', 1fr)';
      dom.tutorialBoard.style.gridTemplateRows = 'repeat(' + SIZE + ', 1fr)';
      dom.tutorialBoard.innerHTML = '';

      cellEls = [];
      for (let row = 0; row < SIZE; row++) {
        const rowEls = [];
        for (let col = 0; col < SIZE; col++) {
          const el = document.createElement('div');
          el.dataset.row = String(row);
          el.dataset.col = String(col);

          const patternEl = document.createElement('div');
          patternEl.className = 'cell-pattern pattern-' + (REGION_OF[row][col] % 8);

          const markEl = document.createElement('div');
          markEl.className = 'cell-mark';

          el.appendChild(patternEl);
          el.appendChild(markEl);
          dom.tutorialBoard.appendChild(el);

          rowEls.push({ el, markEl });
        }
        cellEls.push(rowEls);
      }
    }

    // Resets every cell back to empty/unlocked - run on every start() call
    // (not just the first), so replaying the tutorial after it already
    // marked up the board doesn't reuse stale flower/X state.
    function resetCellStates() {
      cellStates = [];
      for (let row = 0; row < SIZE; row++) {
        const rowStates = [];
        for (let col = 0; col < SIZE; col++) {
          rowStates.push({ state: CellState.EMPTY, locked: false });
        }
        cellStates.push(rowStates);
      }
    }

    function isActiveCell(row, col) {
      const step = STEPS[stepIndex];
      if (!step) return false;
      return step.cells.some((c) => c.row === row && c.col === col);
    }

    function renderCells() {
      const step = STEPS[stepIndex];
      for (let row = 0; row < SIZE; row++) {
        for (let col = 0; col < SIZE; col++) {
          const ref = cellEls[row][col];
          const cs = cellStates[row][col];
          const active = step && isActiveCell(row, col);
          let className = 'cell region-' + REGION_OF[row][col];
          if (cs.locked) className += ' locked';
          className += active ? ' tutorial-active' : ' tutorial-dim';
          ref.el.className = className;

          const mark = markFor(cs.state, REGION_OF[row][col]);
          if (ref.markEl.__mark !== mark) {
            ref.markEl.innerHTML = mark;
            ref.markEl.__mark = mark;
          }
        }
      }
    }

    function positionHand(cellPos) {
      if (!cellPos) {
        dom.tutorialHand.hidden = true;
        return;
      }
      const ref = cellEls[cellPos.row][cellPos.col];
      const cellRect = ref.el.getBoundingClientRect();
      const wrapRect = dom.tutorialBoard.parentElement.getBoundingClientRect();
      dom.tutorialHand.style.left = cellRect.left - wrapRect.left + cellRect.width / 2 + 'px';
      dom.tutorialHand.style.top = cellRect.top - wrapRect.top + cellRect.height / 2 + 'px';
      dom.tutorialHand.hidden = false;
    }

    function renderStep() {
      const step = STEPS[stepIndex];
      dom.tutorialBubble.textContent = I18n.t(step.messageKey);
      renderCells();
      positionHand(step.hand);
    }

    function startStep(index) {
      stepIndex = index;
      const step = STEPS[stepIndex];
      pending = new Set(step.cells.map((c) => cellKey(c.row, c.col)));
      lastTap = null;
      renderStep();
    }

    function showFinal() {
      dom.tutorialHand.hidden = true;
      dom.tutorialPlay.hidden = true;
      dom.tutorialFinalTitle.textContent = I18n.t('tutorialDoneTitle');
      dom.tutorialFinalText.textContent = I18n.t('tutorialDoneText');
      dom.tutorialGotItButton.textContent = I18n.t('tutorialGotItButton');
      dom.tutorialFinal.hidden = false;
    }

    function advance() {
      if (stepIndex + 1 >= STEPS.length) {
        showFinal();
        return;
      }
      dom.tutorialPlay.hidden = false;
      startStep(stepIndex + 1);
    }

    function completeCell(row, col) {
      pending.delete(cellKey(row, col));
      renderCells();
      if (pending.size === 0) {
        setTimeout(advance, ADVANCE_DELAY_MS);
      }
    }

    function handleTap(row, col) {
      if (!isActiveCell(row, col)) return;
      const cs = cellStates[row][col];
      if (cs.locked) return;
      const step = STEPS[stepIndex];

      if (step.type === 'flower') {
        const now = Date.now();
        const isDouble =
          lastTap &&
          lastTap.row === row &&
          lastTap.col === col &&
          now - lastTap.time <= DOUBLE_TAP_WINDOW_MS &&
          cs.state === CellState.X;

        if (isDouble) {
          lastTap = null;
          cs.state = CellState.FLOWER;
          cs.locked = true;
          dom.tutorialHand.hidden = true;
          AudioFx.playEffect('placeFlower');
          completeCell(row, col);
          return;
        }

        lastTap = { row, col, time: now };
        if (cs.state === CellState.EMPTY) {
          cs.state = CellState.X;
          renderCells();
        }
        return;
      }

      // 'mark' steps: a single tap marks and locks the cell - these cells
      // are being shown off-limits for a flower, so there's nothing to undo.
      if (cs.state === CellState.EMPTY) {
        cs.state = CellState.X;
        cs.locked = true;
        AudioFx.playEffect('placeCross');
        completeCell(row, col);
      }
    }

    function onBoardPointerUp(event) {
      const cellEl = event.target.closest ? event.target.closest('.cell') : null;
      if (!cellEl) return;
      handleTap(parseInt(cellEl.dataset.row, 10), parseInt(cellEl.dataset.col, 10));
    }

    // onComplete fires once the player dismisses the final "Got it!" screen.
    // Used by the menu's Play button on first launch to enter the game right
    // after the tutorial finishes; omitted when replaying from the menu or
    // settings, where simply closing the overlay reveals the screen beneath.
    function start(onComplete) {
      pendingOnComplete = typeof onComplete === 'function' ? onComplete : function () {};
      dom.tutorialPlay.hidden = false;
      dom.tutorialFinal.hidden = true;
      dom.tutorialOverlay.hidden = false;
      if (!cellEls) buildBoard();
      resetCellStates();
      startStep(0);
    }

    function finish() {
      root.Garden.platform.saveTutorialDone(true);
      dom.tutorialOverlay.hidden = true;
      const onComplete = pendingOnComplete;
      pendingOnComplete = function () {};
      onComplete();
    }

    dom.tutorialBoard.addEventListener('pointerup', onBoardPointerUp);
    dom.tutorialGotItButton.addEventListener('click', function () {
      AudioFx.playEffect('tap');
      finish();
    });
    window.addEventListener('resize', function () {
      if (!dom.tutorialOverlay.hidden) positionHand(STEPS[stepIndex] && STEPS[stepIndex].hand);
    });

    return { start };
  }

  root.Garden = root.Garden || {};
  root.Garden.tutorial = { createTutorial };
})(typeof window !== 'undefined' ? window : globalThis);
