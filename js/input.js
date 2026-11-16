// Pointer/touch input. Browser-only; translates DOM events into state.js
// calls and wires the chrome (back/settings/rules buttons, toggles) to the
// renderer and platform.
(function (root) {
  const CellState = root.Garden.grid.CellState;
  const SINK_MS = 140;

  function cellFromElement(el) {
    const cellEl = el && el.closest ? el.closest('.cell') : null;
    if (!cellEl) return null;
    return { row: parseInt(cellEl.dataset.row, 10), col: parseInt(cellEl.dataset.col, 10), el: cellEl };
  }

  function triggerSink(el) {
    el.classList.add('cell-sinking');
    setTimeout(function () {
      el.classList.remove('cell-sinking');
    }, SINK_MS);
  }

  const DOUBLE_TAP_WINDOW_MS = root.Garden.state.DOUBLE_TAP_WINDOW_MS;

  // iOS double-tap-zoom guard: iOS Safari-engine browsers can still trigger
  // their native double-tap-to-zoom gesture on a fast double-tap even with
  // touch-action: none/manipulation set (a long-standing WebKit quirk,
  // worse still in third-party WKWebView wrappers like Yandex Browser on
  // iOS - see css/style.css's touch-action block and js/main.js's
  // gesturestart guard for the rest of the fix). Since planting a piece IS
  // a deliberate double-tap, this cancels just the *second* touchend's
  // default when it lands on the same cell within the same window
  // state.js's own double-tap promotion uses, which stops the zoom without
  // touching the pointer-event-driven tap/drag logic below - that logic
  // already finished reacting to the gesture by the time touchend fires,
  // and this listener only ever calls preventDefault(), never game logic.
  // Exported so js/tutorial.js's own board can reuse it instead of
  // duplicating it.
  function attachDoubleTapZoomGuard(boardEl) {
    let lastTouchEnd = null; // { cellEl, time }
    boardEl.addEventListener(
      'touchend',
      function (event) {
        const hit = cellFromElement(event.target);
        const now = Date.now();
        if (hit && lastTouchEnd && lastTouchEnd.cellEl === hit.el && now - lastTouchEnd.time <= DOUBLE_TAP_WINDOW_MS) {
          event.preventDefault();
        }
        lastTouchEnd = hit ? { cellEl: hit.el, time: now } : null;
      },
      { passive: false }
    );
  }

  function wireToggle(buttonEl, onChange) {
    buttonEl.addEventListener('click', function () {
      const next = buttonEl.getAttribute('aria-pressed') !== 'true';
      buttonEl.setAttribute('aria-pressed', String(next));
      onChange(next);
    });
  }

  function wireBackdropDismiss(overlayEl, onClose) {
    overlayEl.addEventListener('click', function (event) {
      if (event.target === overlayEl) onClose();
    });
  }

  function attach(dom, game, renderer, handlers) {
    let drag = null; // { pointerId, startRow, startCol, mode, moved, visited }

    attachDoubleTapZoomGuard(dom.board);

    function applyDragAction(row, col, el) {
      if (drag.mode === 'mark') game.markCellX(row, col);
      else if (drag.mode === 'clear') game.clearCellX(row, col);
      triggerSink(el);
    }

    dom.board.addEventListener('pointerdown', function (event) {
      const hit = cellFromElement(event.target);
      if (!hit) return;

      const cell = game.getSnapshot().grid.cells[hit.row][hit.col];
      let mode = null;
      if (!cell.locked) {
        if (cell.state === CellState.EMPTY) mode = 'mark';
        else if (cell.state === CellState.X) mode = 'clear';
      }

      drag = { pointerId: event.pointerId, startRow: hit.row, startCol: hit.col, mode, moved: false, visited: new Set() };
      triggerSink(hit.el);
      dom.board.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    dom.board.addEventListener('pointermove', function (event) {
      if (!drag || event.pointerId !== drag.pointerId) return;

      const hit = cellFromElement(document.elementFromPoint(event.clientX, event.clientY));
      if (!hit) return;

      if (!drag.moved && (hit.row !== drag.startRow || hit.col !== drag.startCol)) {
        drag.moved = true;
        if (drag.mode) {
          drag.visited.add(drag.startRow + ',' + drag.startCol);
          applyDragAction(drag.startRow, drag.startCol, hit.el);
        }
      }

      if (!drag.moved || !drag.mode) return;

      const key = hit.row + ',' + hit.col;
      if (drag.visited.has(key)) {
        triggerSink(hit.el);
        return;
      }
      drag.visited.add(key);
      applyDragAction(hit.row, hit.col, hit.el);
    });

    function endDrag(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.moved) game.tapCell(drag.startRow, drag.startCol);
      if (dom.board.hasPointerCapture(event.pointerId)) dom.board.releasePointerCapture(event.pointerId);
      drag = null;
    }

    dom.board.addEventListener('pointerup', endDrag);
    dom.board.addEventListener('pointercancel', endDrag);

    dom.nextLevelButton.addEventListener('click', function () {
      game.nextLevel();
    });

    dom.retryButton.addEventListener('click', function () {
      game.retryLevel();
    });

    dom.backButton.addEventListener('click', function () {
      handlers.onBack();
    });

    const helperButtonsById = {
      finder: dom.helperButtonFinder,
      random: dom.helperButtonRandom,
      snowman: dom.helperButtonSnowman,
    };

    Object.keys(helperButtonsById).forEach(function (id) {
      const buttonEl = helperButtonsById[id];
      buttonEl.addEventListener('click', function () {
        // useHelper() is itself the single source of truth on whether this
        // is allowed right now (charges, lock state, solved state, and the
        // per-helper double-spend lock window all live in state.js) - a
        // disabled button also won't fire 'click' in a real browser, so
        // this is just the call site.
        const used = game.useHelper(id);
        if (used) {
          // Nothing else changes state during the lock window, so nothing
          // would otherwise flip this button's disabled state back on once
          // it expires. Deliberately touches only the button - re-running
          // the full renderer.render() here with a plain getSnapshot()
          // would be missing this tick's transient fields (winFill, ...)
          // and could re-trigger the win-overlay branch with stale data
          // while a win's fill-wave animation is still in flight.
          setTimeout(function () {
            buttonEl.disabled = !game.canUseHelper(id);
          }, root.Garden.state.HELPER_LOCK_MS);
        }
      });
    });

    dom.settingsButton.addEventListener('click', function () {
      renderer.openSettings();
    });
    dom.settingsCloseButton.addEventListener('click', function () {
      renderer.closeSettings();
    });
    wireBackdropDismiss(dom.settingsOverlay, renderer.closeSettings);

    dom.rulesHelpButton.addEventListener('click', function () {
      renderer.toggleRulesPopup();
    });
    dom.rulesCloseButton.addEventListener('click', function () {
      renderer.closeRulesPopup();
    });
    wireBackdropDismiss(dom.rulesBar, renderer.closeRulesPopup);

    dom.themeWinterButton.addEventListener('click', function () {
      handlers.onSelectTheme('winter');
    });
    dom.themeGardenButton.addEventListener('click', function () {
      handlers.onSelectTheme('garden');
    });

    wireToggle(dom.patternsToggle, function (enabled) {
      handlers.onTogglePatterns(enabled);
    });
    wireToggle(dom.reduceMotionToggle, function (enabled) {
      handlers.onToggleReduceMotion(enabled);
    });
    wireToggle(dom.vibrationToggle, function (enabled) {
      handlers.onToggleVibration(enabled);
    });
  }

  root.Garden = root.Garden || {};
  root.Garden.input = { attach, attachDoubleTapZoomGuard };
})(typeof window !== 'undefined' ? window : globalThis);
