// Main menu: pure "Play vs Continue"/daily-lock logic (Node-testable, no DOM)
// plus a small DOM controller for the menu screen itself.
(function (root) {
  const CellState = root.Garden.grid.CellState;
  const DAILY_CHALLENGE_UNLOCK_LEVEL = 15;

  // True once the saved board holds at least one player move beyond the
  // level's pre-placed starting set (any number of given flowers/crosses,
  // see js/levelstart.js): an X, a red X, or a flower the player actually
  // planted (tracked via awardedCells - a given flower is never added
  // there, see state.js). A plain X is only ever locked when it's a
  // pre-placed cross (state.js's startLevel) - a player's own X mark is
  // always unlocked - so the locked check is what keeps a "notes"-type
  // level's pre-placed crosses from counting as progress.
  function hasProgress(saved) {
    if (!saved || !Array.isArray(saved.cells)) return false;
    const awarded = new Set(Array.isArray(saved.awardedCells) ? saved.awardedCells : []);
    for (let row = 0; row < saved.cells.length; row++) {
      const rowCells = saved.cells[row];
      if (!Array.isArray(rowCells)) continue;
      for (let col = 0; col < rowCells.length; col++) {
        const cell = rowCells[col];
        if (!cell) continue;
        if (cell.state === CellState.X && !cell.locked) return true;
        if (cell.state === CellState.WRONG) return true;
        if (cell.state === CellState.FLOWER && awarded.has(row + ',' + col)) return true;
      }
    }
    return false;
  }

  // Whether the daily-challenge button should still show as a locked
  // teaser (below the unlock level) rather than the real, tappable button.
  function shouldShowDailyLock(level) {
    return level < DAILY_CHALLENGE_UNLOCK_LEVEL;
  }

  // Browser-only: wires the menu screen's buttons and keeps its "Играть" /
  // "Продолжить · Уровень N" label and daily-lock visibility in sync with
  // saved progress. No game-rule logic lives here.
  function createMenuScreen(dom, handlers) {
    const I18n = root.Garden.i18n;
    const Platform = root.Garden.platform;
    const AudioFx = root.Garden.audio;

    dom.menuTitle.textContent = I18n.t('appTitle');
    dom.menuSubtitle.textContent = I18n.t('menuSubtitle');
    dom.howToPlayButton.textContent = I18n.t('howToPlayButton');
    dom.menuSettingsButton.textContent = I18n.t('settingsButtonLabel');

    // No slot for this in index.html (a brand-new piece of UI) - created
    // once and inserted right after the subtitle, before the menu buttons,
    // so existing menu content/order is never disturbed. Stable hook for
    // Codex's later styling pass: .menu-total-stars.
    const totalStarsEl = document.createElement('p');
    totalStarsEl.className = 'menu-total-stars';
    dom.menuSubtitle.insertAdjacentElement('afterend', totalStarsEl);

    // Daily challenge button: index.html already has the button, its lock
    // icon, and its caption span (the pre-existing locked teaser) - only the
    // unclaimed-today badge has no slot, so it's created once and appended,
    // same convention as .menu-total-stars above. Stable hooks for Codex's
    // later styling pass: .daily-challenge-btn, data-state="locked|
    // available|done" on the button, .daily-challenge-badge on the badge.
    dom.dailyChallengeButton.classList.add('daily-challenge-btn');
    const dailyChallengeLockIcon = dom.dailyChallengeButton.querySelector('.lock-icon');
    const dailyChallengeBadge = document.createElement('span');
    dailyChallengeBadge.className = 'daily-challenge-badge';
    dailyChallengeBadge.hidden = true;
    dom.dailyChallengeButton.appendChild(dailyChallengeBadge);

    dom.playButton.addEventListener('click', function () {
      AudioFx.playEffect('tap');
      handlers.onPlay();
    });
    dom.howToPlayButton.addEventListener('click', function () {
      AudioFx.playEffect('tap');
      handlers.onHowToPlay();
    });
    dom.menuSettingsButton.addEventListener('click', function () {
      AudioFx.playEffect('tap');
      handlers.onSettings();
    });
    dom.dailyChallengeButton.addEventListener('click', function () {
      // disabled already blocks this in a real browser (locked, or already
      // done for today - no reward on a replay, see js/daily-challenge.js);
      // this guard is just defensive.
      if (dom.dailyChallengeButton.disabled) return;
      AudioFx.playEffect('tap');
      handlers.onDailyChallenge();
    });

    function challengeState(level) {
      if (shouldShowDailyLock(level)) return 'locked';
      return root.Garden.dailyChallenge.isDoneToday() ? 'done' : 'available';
    }

    function render() {
      const level = Platform.loadProgress();
      const saved = Platform.loadBoard(level);
      dom.playButton.textContent = hasProgress(saved)
        ? I18n.t('menuContinueButton', { level })
        : I18n.t('menuPlayButton');

      const state = challengeState(level);
      dom.dailyChallengeButton.hidden = false;
      dom.dailyChallengeButton.disabled = state !== 'available';
      dom.dailyChallengeButton.dataset.state = state;
      if (dailyChallengeLockIcon) dailyChallengeLockIcon.hidden = state !== 'locked';
      dom.dailyChallengeCaption.textContent = I18n.t(
        state === 'locked' ? 'dailyChallengeCaption' : state === 'done' ? 'dailyChallengeDoneCaption' : 'dailyChallengeButtonLabel'
      );
      dailyChallengeBadge.hidden = state !== 'available';

      const totalStars = Platform.loadTotalStars();
      totalStarsEl.textContent = I18n.t('menuTotalStarsLabel', { count: totalStars });
      totalStarsEl.setAttribute('aria-label', I18n.t('menuTotalStarsAriaLabel', { count: totalStars }));
    }

    return { render };
  }

  const Menu = { hasProgress, shouldShowDailyLock, createMenuScreen, DAILY_CHALLENGE_UNLOCK_LEVEL };

  root.Garden = root.Garden || {};
  root.Garden.menu = Menu;
})(typeof window !== 'undefined' ? window : globalThis);
