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

  // The single source of truth for the daily-challenge button's state -
  // 'locked' (below the unlock level), 'done' (already won today, no
  // reward on a replay), or 'available' (the only state that may ever
  // actually start anything). Pure given the current saved/date state
  // (reads Garden.dailyChallenge.isDoneToday() at call time, never at
  // module-eval time, so this file has no load-order dependency on
  // js/daily-challenge.js - see its own module comment). Exported so both
  // the click handler below AND tests can ask "is this actually startable
  // right now" from one place, rather than trusting a possibly-stale
  // `.disabled`/`dataset.state` already baked into the DOM.
  function challengeState(level) {
    if (shouldShowDailyLock(level)) return 'locked';
    return root.Garden.dailyChallenge.isDoneToday() ? 'done' : 'available';
  }

  // Browser-only: wires the menu screen's buttons and keeps its "Играть" /
  // "Продолжить · Уровень N" label and daily-lock visibility in sync with
  // saved progress. No game-rule logic lives here.
  function createMenuScreen(dom, handlers) {
    const I18n = root.Garden.i18n;
    const Platform = root.Garden.platform;
    const AudioFx = root.Garden.audio;

    // No slot for this in index.html (a brand-new piece of UI) - created
    // once and inserted right after the subtitle, before the menu buttons,
    // so existing menu content/order is never disturbed. Stable hook for
    // Codex's later styling pass: .menu-total-stars.
    const totalStarsEl = document.createElement('p');
    totalStarsEl.className = 'menu-total-stars';
    dom.menuSubtitle.insertAdjacentElement('afterend', totalStarsEl);

    // Daily challenge button: index.html already has the button, an icon
    // svg (originally lock-only), and its caption span (the pre-existing
    // locked teaser) - only the unclaimed-today badge has no slot, so it's
    // created once and appended, same convention as .menu-total-stars
    // above. Stable hooks for Codex's later styling pass: .daily-challenge-btn,
    // data-state="locked|available|done" on the button,
    // .daily-challenge-badge on the badge, and the pre-existing icon svg is
    // repurposed into a generic .daily-challenge-icon with
    // data-icon="lock|gift|check" (one element, three looks - Codex draws
    // the check mark for "done" and a gift glyph for "available") rather
    // than three separate icon elements, since index.html only ever had the
    // one slot and this file can't add markup there.
    dom.dailyChallengeButton.classList.add('daily-challenge-btn');
    const dailyChallengeIcon = dom.dailyChallengeButton.querySelector('.lock-icon');
    if (dailyChallengeIcon) dailyChallengeIcon.classList.add('daily-challenge-icon');
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
      // Re-derives the state fresh at the moment of the click, rather than
      // trusting this button's last-rendered `.disabled`/`dataset.state` -
      // this is the ONE guard that actually decides whether anything
      // happens, so a stale render (or a `?debug=1` call, or a future
      // caller that bypasses the button's own disabled flag some other
      // way) can never slip a click through while locked or already done
      // for today. Fires identically for a mouse click, a touch tap, or a
      // keyboard Enter/Space activation - a real <button> dispatches the
      // exact same 'click' event for all three, and there is no separate
      // keydown handling here to diverge from it. Garden.dailyChallenge.start()
      // keeps its own independent copy of this same eligibility check, so a
      // completed/locked challenge can't be started by a direct call that
      // skips this button entirely either (see its own comment).
      if (challengeState(Platform.loadProgress()) !== 'available') return;
      AudioFx.playEffect('tap');
      handlers.onDailyChallenge();
    });

    function render() {
      // Static (param-free) labels - re-set on every render() call rather
      // than once at construction, so a language switch (js/main.js, which
      // calls menuScreen.render() immediately after I18n.setLang()) picks
      // these up right away without needing a reload. Harmless to re-run
      // every time render() is called for any other reason too.
      dom.menuTitle.textContent = I18n.t('appTitle');
      dom.menuSubtitle.textContent = I18n.t('menuSubtitle');
      dom.howToPlayButton.textContent = I18n.t('howToPlayButton');
      dom.menuSettingsButton.textContent = I18n.t('settingsButtonLabel');

      const level = Platform.loadProgress();
      const saved = Platform.loadBoard(level);
      dom.playButton.textContent = hasProgress(saved)
        ? I18n.t('menuContinueButton', { level })
        : I18n.t('menuPlayButton');

      const state = challengeState(level);
      dom.dailyChallengeButton.hidden = false;
      // Native `disabled` is the primary guard (a real browser never even
      // dispatches 'click'/keyboard activation for it); `aria-disabled` is
      // layered on top purely for assistive-tech semantics, and the click
      // handler above re-derives this same state independently rather than
      // trusting either of these - see its own comment for why.
      dom.dailyChallengeButton.disabled = state !== 'available';
      dom.dailyChallengeButton.setAttribute('aria-disabled', String(state !== 'available'));
      dom.dailyChallengeButton.dataset.state = state;
      if (dailyChallengeIcon) {
        dailyChallengeIcon.hidden = false;
        dailyChallengeIcon.dataset.icon = state === 'locked' ? 'lock' : state === 'done' ? 'check' : 'gift';
      }
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

  const Menu = { hasProgress, shouldShowDailyLock, challengeState, createMenuScreen, DAILY_CHALLENGE_UNLOCK_LEVEL };

  root.Garden = root.Garden || {};
  root.Garden.menu = Menu;
})(typeof window !== 'undefined' ? window : globalThis);
