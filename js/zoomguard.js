// iOS/WebKit double-tap-zoom + pinch-zoom guard: the JS half of the fix
// (see css/style.css's touch-action block at the top of that file for the
// CSS half - touch-action alone is not reliable enough on iOS Safari-engine
// browsers, a long-standing WebKit quirk, worse still in third-party
// WKWebView wrappers like Yandex Browser on iOS). Pure enough to unit-test
// in Node: these functions only ever touch the event object they're handed
// (event.target.closest(), event.preventDefault()) - never real
// document/window APIs themselves. js/main.js is what actually wires the
// returned handlers to real document-level listeners.
(function (root) {
  // Screens where a fast double-tap is an expected gameplay gesture (board
  // double-tap-to-plant) or where pinch-zoom would break a fixed layout.
  // Deliberately does NOT include the settings/check-in/win/fail overlays -
  // a low-vision player can still pinch-zoom their text, and none of them
  // are double-tapped as part of normal play.
  const GUARDED_SCREENS_SELECTOR = '.loading-screen, .menu-screen, .game-screen, .tutorial-overlay';

  // Mirrors state.js's own DOUBLE_TAP_WINDOW_MS (300ms) with a little
  // slack - this guard only ever calls preventDefault(), it doesn't need
  // to match that window exactly, just comfortably cover it.
  const DOUBLE_TAP_ZOOM_WINDOW_MS = 350;

  function isGuardedTarget(target) {
    return !!(target && target.closest && target.closest(GUARDED_SCREENS_SELECTOR));
  }

  // The nearest "tappable unit" a touchend's target belongs to: a .cell
  // (board/tutorial board), a button, or - for a bare background tap - the
  // guarded screen itself. Resolving to this rather than comparing the raw
  // event.target means two touchends that land on different child nodes
  // of the very same cell/button (e.g. .cell-mark then .cell-pattern) still
  // count as "the same target" for the check below, while two taps on two
  // different cells/buttons never do.
  function zoomGuardKey(target) {
    if (!target || !target.closest) return null;
    return target.closest('.cell') || target.closest('button') || target.closest(GUARDED_SCREENS_SELECTOR) || null;
  }

  // Blocks pinch-zoom: 'gesturestart'/'gesturechange'/'gestureend' are
  // WebKit-only, non-standard events (they simply never fire on Chrome/
  // Firefox/Android, so no feature-detection is needed) - preventDefault()-
  // ing them is the one reliable way to block a pinch gesture on iOS
  // regardless of the viewport meta tag (iOS has ignored user-scalable=no
  // for pinch since iOS 10).
  function createPinchGuard() {
    return function handleGesture(event) {
      if (isGuardedTarget(event.target)) event.preventDefault();
    };
  }

  // Cancels only the *second* touchend within DOUBLE_TAP_ZOOM_WINDOW_MS of
  // a touchend on the SAME target (not just "any previous touchend
  // anywhere", which would also misfire across two unrelated taps on
  // different buttons/cells) - and only inside the guarded screens, never
  // for a text input (defensive; none exist in this app today) or any
  // scrollable popup (settings/check-in/win/fail - not in
  // GUARDED_SCREENS_SELECTOR at all). Only ever calls preventDefault() on
  // the event it's handed - never any game logic - so it's safe to wire at
  // document level regardless of what else is listening; the board/
  // tutorial's own tap/drag/double-tap-to-plant logic is entirely
  // pointer-event-driven (see js/input.js, js/tutorial.js) and has already
  // finished reacting to the gesture by the time touchend fires.
  function createDoubleTapZoomGuard() {
    let lastTouchEnd = null; // { key, time }
    return function handleTouchEnd(event) {
      const target = event.target;
      if (!isGuardedTarget(target) || (target && target.closest && target.closest('input, textarea, select'))) {
        lastTouchEnd = null;
        return false;
      }

      const key = zoomGuardKey(target);
      const now = Date.now();
      let prevented = false;
      if (key && lastTouchEnd && lastTouchEnd.key === key && now - lastTouchEnd.time <= DOUBLE_TAP_ZOOM_WINDOW_MS) {
        event.preventDefault();
        prevented = true;
      }
      lastTouchEnd = key ? { key, time: now } : null;
      return prevented;
    };
  }

  const ZoomGuard = {
    GUARDED_SCREENS_SELECTOR,
    DOUBLE_TAP_ZOOM_WINDOW_MS,
    isGuardedTarget,
    zoomGuardKey,
    createPinchGuard,
    createDoubleTapZoomGuard,
  };

  root.Garden = root.Garden || {};
  root.Garden.zoomGuard = ZoomGuard;
})(typeof window !== 'undefined' ? window : globalThis);
