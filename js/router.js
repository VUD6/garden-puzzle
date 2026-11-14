// Simple screen router: show/hide between the loading screen, the main
// menu, and the game. No frameworks, no build step - just toggling the
// `hidden` attribute on three sibling screens.
(function (root) {
  const LOADING_FADE_MS = 300;
  const HANG_TIMEOUT_MS = 5000;

  function createRouter(dom, options) {
    options = options || {};
    const fadeMs = options.fadeMs || LOADING_FADE_MS;
    const hangTimeoutMs = options.hangTimeoutMs || HANG_TIMEOUT_MS;

    let left = false;
    const hangTimer = setTimeout(leaveLoading, hangTimeoutMs);

    function showScreen(name) {
      dom.menuScreen.hidden = name !== 'menu';
      dom.gameScreen.hidden = name !== 'game';
    }

    // Called once initialization (i18n/settings/saves) is ready. Fades the
    // loading screen out over ~300ms and reveals the menu underneath it
    // immediately, so the fade doesn't delay anything. Also the target of
    // the hang-protection timeout, so a stalled init still reaches the menu.
    function leaveLoading() {
      if (left) return;
      left = true;
      clearTimeout(hangTimer);
      dom.loadingScreen.classList.add('screen-fade-out');
      showScreen('menu');
      setTimeout(function () {
        dom.loadingScreen.hidden = true;
      }, fadeMs);
    }

    return { leaveLoading, showScreen };
  }

  const Router = { createRouter, LOADING_FADE_MS, HANG_TIMEOUT_MS };

  root.Garden = root.Garden || {};
  root.Garden.router = Router;
})(typeof window !== 'undefined' ? window : globalThis);
