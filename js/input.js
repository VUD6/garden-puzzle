// Pointer/touch input. Browser-only; translates DOM events into state.js
// calls and wires the chrome (back/settings/rules buttons, toggles) to the
// renderer and platform.
(function (root) {
  const CellState = root.Garden.grid.CellState;
  const AudioFx = root.Garden.audio;
  const SINK_MS = 140;

  // Generic UI tap tick, wired to every plain chrome button below (back,
  // settings, rules, theme, retry/next-level, the plain toggles) - never the
  // board itself, which already gets its own placeFlower/placeCross/mistake
  // effects from render.js keyed off the actual cell-state transition.
  function tapTick() {
    AudioFx.playEffect('tap');
  }

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

  function wireToggle(buttonEl, onChange) {
    buttonEl.addEventListener('click', function () {
      const next = buttonEl.getAttribute('aria-pressed') !== 'true';
      buttonEl.setAttribute('aria-pressed', String(next));
      onChange(next);
      tapTick();
    });
  }

  function wireBackdropDismiss(overlayEl, onClose) {
    overlayEl.addEventListener('click', function (event) {
      if (event.target === overlayEl) onClose();
    });
  }

  function attach(dom, game, renderer, handlers) {
    let drag = null; // { pointerId, startRow, startCol, mode, moved, visited }

    // Set for the whole time a rewarded ad is open (see startHelperAdFlow
    // below) - checked at the top of every handler that would otherwise let
    // the player keep interacting with the board/chrome while the ad
    // overlay covers it, per GAME_DESIGN.md's "game input is blocked while
    // an ad is open" rule.
    let inputBlocked = false;

    // The helper-button-with-0-charges "watch an ad for +1" flow (see
    // js/helpers.js's needsAd, js/render.js's data-ad hook, and
    // js/yandex.js's showRewardedAd). Pause/stop/mute happen BEFORE the ad
    // is requested; the charge is granted ONLY inside onRewarded; applying
    // the helper (since tapping the ad-state button always means "I want to
    // use this helper") happens only after onClose, and only if this
    // session actually rewarded - never on an error or an early close.
    function startHelperAdFlow(id) {
      const Yandex = root.Garden.yandex;
      const Helpers = root.Garden.helpers;
      if (!Yandex || inputBlocked || Yandex.isAdInProgress()) return;

      inputBlocked = true;
      game.pauseTimer('ad');
      Yandex.gameplayStop();
      AudioFx.setExternalMute('ad', true);

      const started = Yandex.showRewardedAd({
        onRewarded: function () {
          Helpers.addCharges(id, 1);
        },
        onClose: function (rewarded) {
          inputBlocked = false;
          AudioFx.setExternalMute('ad', false);
          game.resumeTimer('ad');
          Yandex.gameplayStart();
          if (rewarded && game.useHelper(id)) AudioFx.playEffect('helperUse');
        },
        onError: function () {
          inputBlocked = false;
          AudioFx.setExternalMute('ad', false);
          game.resumeTimer('ad');
          Yandex.gameplayStart();
          renderer.showAdUnavailableMessage();
        },
      });

      // Belt-and-suspenders: showRewardedAd's own internal guard also
      // refuses a second concurrent ad and returns false without touching
      // anything - undo the pause/mute/stop this call just applied.
      if (!started) {
        inputBlocked = false;
        game.resumeTimer('ad');
        AudioFx.setExternalMute('ad', false);
        Yandex.gameplayStart();
      }
    }

    function applyDragAction(row, col, el) {
      if (drag.mode === 'mark') game.markCellX(row, col);
      else if (drag.mode === 'clear') game.clearCellX(row, col);
      triggerSink(el);
    }

    dom.board.addEventListener('pointerdown', function (event) {
      if (inputBlocked) return;
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
      if (inputBlocked) return;
      tapTick();
      // Daily challenge: there is no "next level" for a once-a-day puzzle -
      // the button is repurposed to "В меню" (see js/render.js's
      // showWinOverlay), so it returns to the menu instead.
      if (game.getSnapshot().mode === 'challenge') {
        handlers.onBack();
      } else {
        game.nextLevel();
      }
    });

    dom.retryButton.addEventListener('click', function () {
      if (inputBlocked) return;
      tapTick();
      game.retryLevel();
    });

    dom.backButton.addEventListener('click', function () {
      if (inputBlocked) return;
      tapTick();
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
        if (inputBlocked) return;

        // A 0-charge, unlocked helper button is in its "watch an ad for +1"
        // state (see js/helpers.js's needsAd/js/render.js's data-ad hook) -
        // tapping it directly starts the rewarded-ad flow instead of
        // useHelper(), no confirmation dialog, per GAME_DESIGN.md.
        const helperInfo = game.getSnapshot().helpers[id];
        if (helperInfo && helperInfo.needsAd) {
          startHelperAdFlow(id);
          return;
        }

        // useHelper() is itself the single source of truth on whether this
        // is allowed right now (charges, lock state, solved state, and the
        // per-helper double-spend lock window all live in state.js) - a
        // disabled button also won't fire 'click' in a real browser, so
        // this is just the call site.
        const used = game.useHelper(id);
        if (used) {
          AudioFx.playEffect('helperUse');
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

    // GameplayAPI.start() only makes sense while an actual level/challenge
    // is open and still in progress - never from the menu's own Settings
    // button (game.pauseTimer('settings') there pauses a timer that isn't
    // even running yet). Idempotent either way (Garden.yandex.gameplayStart
    // itself no-ops if already started), so it's always safe to call.
    function maybeResumeGameplay() {
      const Yandex = root.Garden.yandex;
      if (Yandex && !dom.gameScreen.hidden && game.getSnapshot().status === 'playing') Yandex.gameplayStart();
    }

    // The level timer (see state.js's pauseTimer/resumeTimer) must not keep
    // counting while Settings covers the board - paused here regardless of
    // which button opened it, resumed the moment it's actually closed.
    function closeSettingsAndResumeTimer() {
      renderer.closeSettings();
      game.resumeTimer('settings');
      maybeResumeGameplay();
    }

    dom.settingsButton.addEventListener('click', function () {
      if (inputBlocked) return;
      tapTick();
      game.pauseTimer('settings');
      if (root.Garden.yandex) root.Garden.yandex.gameplayStop();
      renderer.openSettings();
    });
    dom.settingsCloseButton.addEventListener('click', function () {
      if (inputBlocked) return;
      tapTick();
      closeSettingsAndResumeTimer();
    });
    wireBackdropDismiss(dom.settingsOverlay, closeSettingsAndResumeTimer);

    dom.rulesHelpButton.addEventListener('click', function () {
      tapTick();
      renderer.toggleRulesPopup();
    });
    dom.rulesCloseButton.addEventListener('click', function () {
      tapTick();
      renderer.closeRulesPopup();
    });
    wireBackdropDismiss(dom.rulesBar, renderer.closeRulesPopup);

    dom.themeWinterButton.addEventListener('click', function () {
      tapTick();
      handlers.onSelectTheme('winter');
    });
    dom.themeGardenButton.addEventListener('click', function () {
      tapTick();
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
  root.Garden.input = { attach };
})(typeof window !== 'undefined' ? window : globalThis);
