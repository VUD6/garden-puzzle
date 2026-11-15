// Main menu: pure "Play vs Continue"/daily-lock logic (Node-testable, no DOM)
// plus a small DOM controller for the menu screen itself.
(function (root) {
  const CellState = root.Garden.grid.CellState;
  const DAILY_CHALLENGE_UNLOCK_LEVEL = 15;

  // True once the saved board holds at least one player move beyond the
  // pre-placed starting flower: an X, a red X, or a flower the player
  // actually planted (tracked via awardedCells - the pre-placed flower is
  // never added there, see state.js).
  function hasProgress(saved) {
    if (!saved || !Array.isArray(saved.cells)) return false;
    const awarded = new Set(Array.isArray(saved.awardedCells) ? saved.awardedCells : []);
    for (let row = 0; row < saved.cells.length; row++) {
      const rowCells = saved.cells[row];
      if (!Array.isArray(rowCells)) continue;
      for (let col = 0; col < rowCells.length; col++) {
        const cell = rowCells[col];
        if (!cell) continue;
        if (cell.state === CellState.X || cell.state === CellState.WRONG) return true;
        if (cell.state === CellState.FLOWER && awarded.has(row + ',' + col)) return true;
      }
    }
    return false;
  }

  // The daily challenge (roadmap step 7) doesn't exist yet, so its button
  // only shows as a locked teaser before the level it will unlock at.
  function shouldShowDailyLock(level) {
    return level < DAILY_CHALLENGE_UNLOCK_LEVEL;
  }

  // Browser-only: wires the menu screen's buttons and keeps its "Играть" /
  // "Продолжить · Уровень N" label and daily-lock visibility in sync with
  // saved progress. No game-rule logic lives here.
  function createMenuScreen(dom, handlers) {
    const I18n = root.Garden.i18n;
    const Platform = root.Garden.platform;

    dom.menuTitle.textContent = I18n.t('appTitle');
    dom.menuSubtitle.textContent = I18n.t('menuSubtitle');
    dom.howToPlayButton.textContent = I18n.t('howToPlayButton');
    dom.menuSettingsButton.textContent = I18n.t('settingsButtonLabel');
    dom.dailyChallengeCaption.textContent = I18n.t('dailyChallengeCaption');

    dom.playButton.addEventListener('click', handlers.onPlay);
    dom.howToPlayButton.addEventListener('click', handlers.onHowToPlay);
    dom.menuSettingsButton.addEventListener('click', handlers.onSettings);

    function render() {
      const level = Platform.loadProgress();
      const saved = Platform.loadBoard(level);
      dom.playButton.textContent = hasProgress(saved)
        ? I18n.t('menuContinueButton', { level })
        : I18n.t('menuPlayButton');
      dom.dailyChallengeButton.hidden = !shouldShowDailyLock(level);
    }

    return { render };
  }

  const Menu = { hasProgress, shouldShowDailyLock, createMenuScreen, DAILY_CHALLENGE_UNLOCK_LEVEL };

  root.Garden = root.Garden || {};
  root.Garden.menu = Menu;
})(typeof window !== 'undefined' ? window : globalThis);
