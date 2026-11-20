// Minimal i18n module. All user-facing strings must go through Garden.i18n.t(key).
(function (root) {
  const STRINGS = {
    ru: {
      appTitle: 'Клумба',
      appFullTitle: 'Клумба: цветочная головоломка',
      levelLabel: 'Уровень {level}',
      // Challenge-mode-only variants (js/render.js): the top pill and the
      // win screen's score/time lines read differently for a daily
      // challenge attempt - never used for a normal level.
      challengeLevelLabel: 'Испытание',
      challengeScoreEarnedLabel: 'Очки за испытание: +{amount}',
      challengeTimeLabel: 'Время: {time}',
      winMessage: 'Все цветы посажены правильно.',
      nextLevelButton: 'Следующий уровень',
      failTitle: 'Леденцы закончились',
      failMessage: 'Попробуйте снова.',
      // Lives are candy canes, not water drops - these three cover the
      // Russian singular/few/many plural forms (see I18n.pluralRu), used
      // for the lives aria-label (e.g. "Осталось 2 леденца").
      livesAriaLabelOne: 'Осталось {count} леденец',
      livesAriaLabelFew: 'Осталось {count} леденца',
      livesAriaLabelMany: 'Осталось {count} леденцов',
      retryButton: 'Повторить',
      patternsToggleLabel: 'Узоры на клумбах',
      scoreLabel: 'Очки: {score}',
      scoreEarnedLabel: 'Очки за уровень: +{amount}',
      resultPerfect: 'Идеально!',
      resultDone: 'Готово!',
      ruleBedText: '1 цветок на клумбу',
      ruleRowColText: '1 цветок в ряду и столбце',
      ruleTouchText: 'Цветы не касаются друг друга',
      rankGardener: 'Пряничный новичок',
      rankSkilledGardener: 'Пряничный мастер',
      rankMasterGardener: 'Пряничный волшебник',
      bestTimeLabel: 'Лучшее время: {time}',
      winStreakLabel: 'Серия: {count}',
      winStreakHint: 'Побед до бонуса: {count}',
      winStreakBonusAriaLabel: 'Бонус за серию побед: {name} +{amount}',
      menuTotalStarsLabel: '★ {count}',
      menuTotalStarsAriaLabel: 'Всего звёзд: {count}',
      replayTutorialButton: 'Обучение',
      tutorialStep1: 'Дважды коснитесь клетки, чтобы посадить цветок',
      tutorialStep2: 'На одной клумбе — один цветок',
      tutorialStep3: 'Один цветок в каждом ряду и столбце',
      tutorialStep4: 'Цветы не касаются друг друга, даже по диагонали',
      tutorialStep5: 'Коснитесь пустых клеток, чтобы отметить их крестиком',
      tutorialDoneTitle: 'Отлично!',
      tutorialDoneText: 'Вы знаете все правила. Удачной игры!',
      tutorialGotItButton: 'Понятно!',
      backButtonLabel: 'Назад',
      settingsButtonLabel: 'Настройки',
      settingsTitle: 'Настройки',
      reduceMotionLabel: 'Меньше анимации',
      vibrationLabel: 'Вибрация при ошибке',
      vibrationUnsupportedNote: 'Не поддерживается на этом устройстве',
      sfxToggleLabel: 'Звуковые эффекты',
      musicToggleLabel: 'Музыка',
      closeButtonLabel: 'Закрыть',
      rulesHelpButtonLabel: 'Правила',
      rulesPopupTitle: 'Правила',
      loadingStatusText: 'Загрузка…',
      menuSubtitle: 'Уютная головоломка',
      menuPlayButton: 'Играть',
      menuContinueButton: 'Продолжить · Уровень {level}',
      howToPlayButton: 'Как играть',
      dailyChallengeCaption: 'Ежедневное испытание · с 15 уровня',
      dailyChallengeButtonLabel: 'Ежедневное испытание',
      dailyChallengeDoneCaption: 'Испытание выполнено',
      challengeBackToMenuButton: 'В меню',
      milestoneBannerTitle: 'Праздничный уровень!',
      helperNameFinder: 'Искатель',
      helperNameRandom: 'Случайный помощник',
      helperNameSnowman: 'Снеговик',
      helperAriaLabel: '{name}: {count} зарядов',
      helperLockedAriaLabel: '{name}: заблокировано до уровня {level}',
      helperLockedCaption: 'Ур.{level}',
      // Rewarded-ad "+1 charge" helper state (Yandex Games SDK integration).
      helperAdChargeLabel: '+1',
      helperAdAriaLabel: '{name}: посмотреть рекламу за +1 заряд',
      adUnavailableMessage: 'Реклама сейчас недоступна. Попробуйте позже.',
      leaderboardButtonLabel: 'Таблица лидеров',
      leaderboardTitle: 'Таблица лидеров',
      leaderboardEmpty: 'Пока нет результатов',
      winBeatPercentLabel: 'Вы обыграли {percent}% игроков',
      dailyCheckinButtonLabel: 'Ежедневная награда',
      dailyGiftDayLabel: 'День {day} из 7',
      dailyGiftComeBackTomorrow: 'Приходи завтра',
      dailyGiftDayStateClaimed: 'получено',
      dailyGiftDayStateToday: 'доступно сегодня',
      dailyGiftDayStatePaused: 'ждёт следующего дня',
      dailyGiftDayStateUpcoming: 'впереди',
      checkinClaimButton: 'Забрать',
      checkinClaimedButton: 'Награда получена',
      themeSettingLabel: 'Тема',
      themeOptionWinter: 'Зима',
      themeOptionGarden: 'Сад',
      // Localization (RU+EN). Language-switcher option labels are
      // deliberately IDENTICAL in both dictionaries - a language picker
      // conventionally shows each language's own native name (an
      // "endonym"), never translated into whichever language happens to
      // be active right now.
      langSettingLabel: 'Язык',
      langOptionRu: 'Русский',
      langOptionEn: 'English',
      metaDescription:
        '«Клумба» — уютная головоломка о цветах и садовых клумбах с зимним пряничным оформлением. Сажайте цветы по правилам, собирайте звёзды и проходите ежедневные испытания.',
      // The 4th plural form I18n.plural() needs for English's one/other
      // split (see its own comment) - Russian never actually branches into
      // "other" (its own one/few/many split already covers every count),
      // so this is present purely so the ru/en key sets stay identical;
      // same text as livesAriaLabelMany, which is what a Russian caller's
      // "other" would have meant anyway if it were ever reached.
      livesAriaLabelOther: 'Осталось {count} леденцов',
      // MOCK-ONLY (js/platform-yandex.js's dev/test leaderboard data) -
      // the player's own placeholder row label, never shown with a real
      // Yandex account. The other 10 mock entries are arbitrary sample
      // names, deliberately left untranslated (see that file's own
      // comment) - a person's name isn't "translated" the way UI copy is.
      leaderboardMockSelfLabel: 'Вы (мок)',
      // Winter-theme variants of the piece-name-bearing rule/tutorial text
      // above; see I18n.setTheme() - looked up as "<key>_winter" first,
      // falling back to the plain (garden) key when no themed variant exists.
      ruleBedText_winter: '1 пряник на цвет',
      ruleRowColText_winter: '1 пряник в ряду и столбце',
      ruleTouchText_winter: 'Пряники не касаются друг друга',
      tutorialStep1_winter: 'Дважды коснитесь клетки, чтобы поставить пряник',
      tutorialStep2_winter: 'На одной клумбе — один пряник',
      tutorialStep3_winter: 'Один пряник в каждом ряду и столбце',
      tutorialStep4_winter: 'Пряники не касаются друг друга, даже по диагонали',
    },
    en: {
      // Game name for EN - "Flowerbed: Gingerbread Puzzle" (short:
      // "Flowerbed") per this localization task's explicit spec, replacing
      // the earlier placeholder "Garden Bed" naming - flagged in the
      // report for review.
      appTitle: 'Flowerbed',
      appFullTitle: 'Flowerbed: Gingerbread Puzzle',
      levelLabel: 'Level {level}',
      challengeLevelLabel: 'Challenge',
      challengeScoreEarnedLabel: 'Challenge score: +{amount}',
      challengeTimeLabel: 'Time: {time}',
      winMessage: 'Every flower is planted correctly.',
      nextLevelButton: 'Next level',
      failTitle: 'Out of candy canes',
      failMessage: 'Try again.',
      // English only needs singular vs. plural, but reuses the same
      // 3-slot pluralRu lookup (see I18n.pluralRu) by repeating the plural
      // form for both the "few" and "many" slots.
      livesAriaLabelOne: '{count} candy cane left',
      livesAriaLabelFew: '{count} candy canes left',
      livesAriaLabelMany: '{count} candy canes left',
      retryButton: 'Retry',
      patternsToggleLabel: 'Bed patterns',
      scoreLabel: 'Score: {score}',
      scoreEarnedLabel: 'Level score: +{amount}',
      resultPerfect: 'Perfect!',
      resultDone: 'Done!',
      ruleBedText: '1 flower per bed',
      ruleRowColText: '1 flower per row and column',
      ruleTouchText: "Flowers can't touch",
      rankGardener: 'Gingerbread rookie',
      rankSkilledGardener: 'Gingerbread expert',
      rankMasterGardener: 'Gingerbread wizard',
      bestTimeLabel: 'Best time: {time}',
      winStreakLabel: 'Streak: {count}',
      winStreakHint: 'Wins until bonus: {count}',
      winStreakBonusAriaLabel: 'Win-streak bonus: {name} +{amount}',
      menuTotalStarsLabel: '★ {count}',
      menuTotalStarsAriaLabel: 'Total stars: {count}',
      replayTutorialButton: 'Tutorial',
      tutorialStep1: 'Double tap to plant a flower',
      tutorialStep2: 'One flower per bed',
      tutorialStep3: 'One flower per row and column',
      tutorialStep4: "Flowers can't touch, not even diagonally",
      tutorialStep5: 'Tap empty cells to mark them with X',
      tutorialDoneTitle: 'Got it!',
      tutorialDoneText: 'You know all the rules now. Happy planting!',
      tutorialGotItButton: 'Got it!',
      backButtonLabel: 'Back',
      settingsButtonLabel: 'Settings',
      settingsTitle: 'Settings',
      reduceMotionLabel: 'Reduce motion',
      vibrationLabel: 'Vibrate on mistake',
      vibrationUnsupportedNote: 'Not supported on this device',
      sfxToggleLabel: 'Sound effects',
      musicToggleLabel: 'Music',
      closeButtonLabel: 'Close',
      rulesHelpButtonLabel: 'Rules',
      rulesPopupTitle: 'Rules',
      loadingStatusText: 'Loading…',
      menuSubtitle: 'A cozy puzzle',
      menuPlayButton: 'Play',
      menuContinueButton: 'Continue · Level {level}',
      howToPlayButton: 'How to play',
      dailyChallengeCaption: 'Daily challenge · from level 15',
      dailyChallengeButtonLabel: 'Daily challenge',
      dailyChallengeDoneCaption: 'Challenge completed',
      challengeBackToMenuButton: 'Back to menu',
      milestoneBannerTitle: 'Festive level!',
      helperNameFinder: 'Finder',
      helperNameRandom: 'Random helper',
      helperNameSnowman: 'Snowman',
      helperAriaLabel: '{name}: {count} charges',
      helperLockedAriaLabel: '{name}: locked until level {level}',
      helperLockedCaption: 'Lv.{level}',
      helperAdChargeLabel: '+1',
      helperAdAriaLabel: '{name}: watch an ad for +1 charge',
      adUnavailableMessage: 'Ad is not available right now. Please try again later.',
      leaderboardButtonLabel: 'Leaderboard',
      leaderboardTitle: 'Leaderboard',
      leaderboardEmpty: 'No scores yet',
      winBeatPercentLabel: 'You beat {percent}% of players',
      dailyCheckinButtonLabel: 'Daily reward',
      dailyGiftDayLabel: 'Day {day} of 7',
      dailyGiftComeBackTomorrow: 'Come back tomorrow',
      dailyGiftDayStateClaimed: 'claimed',
      dailyGiftDayStateToday: 'available today',
      dailyGiftDayStatePaused: 'waiting for the next day',
      dailyGiftDayStateUpcoming: 'upcoming',
      checkinClaimButton: 'Claim',
      checkinClaimedButton: 'Reward claimed',
      themeSettingLabel: 'Theme',
      themeOptionWinter: 'Winter',
      themeOptionGarden: 'Garden',
      langSettingLabel: 'Language',
      langOptionRu: 'Русский',
      langOptionEn: 'English',
      metaDescription:
        'Flowerbed: a cozy flower-planting puzzle with a festive gingerbread look. Plant every bed by the rules, earn stars, and take on daily challenges.',
      livesAriaLabelOther: '{count} candy canes left',
      leaderboardMockSelfLabel: 'You (mock)',
      ruleBedText_winter: '1 gingerbread per color',
      ruleRowColText_winter: '1 gingerbread per row and column',
      ruleTouchText_winter: "Gingerbreads can't touch",
      tutorialStep1_winter: 'Double tap to place a gingerbread',
      tutorialStep2_winter: 'One gingerbread per bed',
      tutorialStep3_winter: 'One gingerbread per row and column',
      tutorialStep4_winter: "Gingerbreads can't touch, not even diagonally",
    },
  };

  let currentLang = 'ru';
  // The active theme's id, used only to pick between "<key>_<theme>" string
  // variants (see t() below) for the handful of strings that mention the
  // piece's name (rule cards, tutorial) - mirrors Garden.themes.DEFAULT_THEME_ID
  // as a default so a module that forgets to call setTheme() still behaves.
  let currentTheme = 'winter';

  function setLang(lang) {
    if (STRINGS[lang]) currentLang = lang;
  }

  function getLang() {
    return currentLang;
  }

  function setTheme(themeId) {
    currentTheme = themeId;
  }

  function t(key, params) {
    const dict = STRINGS[currentLang] || STRINGS.ru;
    const themedKey = key + '_' + currentTheme;
    let str = Object.prototype.hasOwnProperty.call(dict, themedKey) ? dict[themedKey] : dict[key] || key;
    if (params) {
      for (const paramKey of Object.keys(params)) {
        str = str.replace('{' + paramKey + '}', params[paramKey]);
      }
    }
    return str;
  }

  // Russian pluralization: picks forms[0] ("one") for n=1/21/31/... (not
  // 11), forms[1] ("few") for n=2-4/22-24/... (not 12-14), and forms[2]
  // ("many") for everything else (0, 5-20, 25-30, ...), matching the
  // standard Slavic singular/few/many split - callers only need to pass
  // plain, count-agnostic word forms (e.g. ['леденец', 'леденца',
  // 'леденцов']); `count` itself is never appended here, since callers
  // combine the returned form with their own "{count} ..." template via
  // I18n.t(). English has no "few" distinction, so a caller only needs to
  // repeat the same plural string for forms[1] and forms[2] to get a
  // correct 2-way singular/plural split from the exact same function.
  function pluralRu(n, forms) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
    return forms[2];
  }

  // The real one/few/many <-> one/other plural helper this localization
  // task asked for - genuinely branches by the CURRENT language, unlike
  // pluralRu above (kept only for backward compatibility with its own
  // direct callers/tests - it always applies the Russian rule, which only
  // happens to also produce correct English output when the caller passes
  // the exact same form for both "few" and "many", and ONLY for counts
  // that never reach a Russian "one" category English wouldn't agree with,
  // e.g. 21, 31, 101... - a latent mismatch this function avoids entirely
  // by picking the category per language first).
  //
  // `forms` is an object naming which i18n KEY to use for each CLDR-style
  // category - `{ one, few, many, other }` - not a literal word (same
  // "caller finishes the lookup via I18n.t(key, {count})" convention
  // pluralRu's own callers already use). English only ever needs
  // `one`/`other`; Russian only ever needs `one`/`few`/`many` - callers
  // should still provide all four for every count-driven string (see
  // GAME_DESIGN.md's Localization section) so the ru/en dictionaries keep
  // an identical key set even though each language's logic only visits a
  // subset of them.
  function plural(n, forms) {
    if (currentLang === 'en') {
      const category = n === 1 ? 'one' : 'other';
      return forms[category] != null ? forms[category] : forms.other;
    }
    const mod10 = n % 10;
    const mod100 = n % 100;
    let category;
    if (mod10 === 1 && mod100 !== 11) category = 'one';
    else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) category = 'few';
    else category = 'many';
    return forms[category] != null ? forms[category] : forms.many;
  }

  // Normalizes any BCP-47-ish locale code to one of this game's two
  // supported languages - deliberately simple per spec: "ru" if the code
  // starts with "ru" (covers "ru", "ru-RU", ...), "en" for literally
  // everything else - no special-casing of Russian-adjacent locales
  // (be/kk/uk/uz, ...) onto "ru".
  function normalizeLangCode(code) {
    return typeof code === 'string' && code.toLowerCase().indexOf('ru') === 0 ? 'ru' : 'en';
  }

  // The one-time initial-language decision, in priority order: an explicit
  // saved choice (already reconciled with the cloud's own "lang" field by
  // js/cloudsave.js's merge policy - see GAME_DESIGN.md) beats everything;
  // absent that, the platform's own reported language (e.g. Yandex's
  // ysdk.environment.i18n.lang, via Garden.platformAdapter.getLanguage());
  // absent that, the browser's own navigator.language; absent even that,
  // "en" (no signal at all to go on). js/main.js calls this TWICE - a quick
  // boot-time guess before the platform adapter's handshake and the cloud
  // merge have necessarily resolved yet (so `platformLanguage` is often
  // still unanswered this early), then again once both have actually
  // settled, correcting the UI in place if the guess was wrong - see
  // GAME_DESIGN.md's "Language selection" section. Pure and injectable for
  // tests either way. A corrupted/unrecognized saved value is treated
  // exactly like "nothing saved" (falls through to the next source), never
  // trusted as-is.
  function resolveInitialLang(saved, platformLanguage, navigatorLanguage) {
    if (saved === 'ru' || saved === 'en') return saved;
    if (platformLanguage) return normalizeLangCode(platformLanguage);
    if (navigatorLanguage) return normalizeLangCode(navigatorLanguage);
    return 'en';
  }

  // Generic declarative refresh for elements that have no dedicated
  // render()/refresh of their own to re-run on a language switch (see
  // GAME_DESIGN.md's Localization section for exactly which elements use
  // this vs. their own JS-side refresh) - `[data-i18n]` sets textContent
  // (or, with a `data-i18n-attr` also present, that named attribute
  // instead - e.g. "content" for a <meta> tag); `[data-i18n-aria]` sets
  // aria-label. Safe to call repeatedly, and safe with no DOM at all
  // (Node tests). `scopeRoot` defaults to the whole document, but a caller
  // may pass a specific subtree (e.g. a just-created popup) instead.
  function applyDomTranslations(scopeRoot) {
    if (typeof document === 'undefined') return;
    const scope = scopeRoot || document;
    scope.querySelectorAll('[data-i18n]').forEach(function (el) {
      const key = el.getAttribute('data-i18n');
      const attr = el.getAttribute('data-i18n-attr');
      if (attr) el.setAttribute(attr, t(key));
      else el.textContent = t(key);
    });
    scope.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
    });
  }

  // The RU/EN switch settings row - no slot in index.html (a brand-new
  // piece of UI), so built once in JS and inserted into the existing
  // settings card, same "no slot" convention js/audio.js's own
  // createSettingsRows/js/menu.js's/js/checkin.js's additions already use.
  // Mirrors the existing `.theme-switch`/`.theme-option` markup shape
  // (two option buttons in a `role="group"` wrapper) so Codex's existing
  // theme-switch styling likely already mostly applies. Stable hooks for
  // Codex's later styling pass: `.setting-lang`, `.lang-switch`,
  // `.lang-option`, `data-lang-id="ru"|"en"` and `.active`/`aria-pressed`
  // on whichever option is currently selected. `onSelect(langId)` is
  // called on every tap, even of the already-active option (the caller
  // decides whether that's a no-op) - this file never touches
  // localStorage/the cloud itself, matching the layering every other
  // settings control here already uses.
  function createSettingsRow(dom, onSelect) {
    if (typeof document === 'undefined' || !dom || !dom.replayTutorialButton) return null;
    const card = dom.replayTutorialButton.parentElement;
    if (!card || card.querySelector('.setting-lang')) return null; // idempotent

    const row = document.createElement('div');
    row.className = 'settings-row setting-lang';

    const label = document.createElement('span');
    label.className = 'settings-row-label';
    label.setAttribute('data-i18n', 'langSettingLabel');
    label.textContent = t('langSettingLabel');

    const switchEl = document.createElement('div');
    switchEl.className = 'lang-switch';
    switchEl.setAttribute('role', 'group');

    function buildOption(langId, labelKey) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lang-option';
      button.dataset.langId = langId;
      button.setAttribute('data-i18n', labelKey);
      button.textContent = t(labelKey);
      switchEl.appendChild(button);
      return button;
    }

    const ruButton = buildOption('ru', 'langOptionRu');
    const enButton = buildOption('en', 'langOptionEn');

    row.appendChild(label);
    row.appendChild(switchEl);
    card.insertBefore(row, dom.replayTutorialButton);

    function applyActive(langId) {
      ruButton.classList.toggle('active', langId === 'ru');
      enButton.classList.toggle('active', langId === 'en');
      ruButton.setAttribute('aria-pressed', String(langId === 'ru'));
      enButton.setAttribute('aria-pressed', String(langId === 'en'));
    }

    [ruButton, enButton].forEach(function (button) {
      button.addEventListener('click', function () {
        // Lazy reference, same reasoning as every other cross-module call
        // in this codebase: js/i18n.js loads first (before js/audio.js),
        // so this can only ever be resolved at click time, never at
        // module-load time.
        if (root.Garden.audio) root.Garden.audio.playEffect('tap');
        onSelect(button.dataset.langId);
      });
    });

    return { row, applyActive };
  }

  // Test-only access to the raw dictionaries (private to this closure
  // otherwise) - for key-parity/placeholder-parity checks across ru/en.
  // Never called from any real game code path; `_` prefix matches this
  // codebase's existing test-hook convention (_configureForTests, ...).
  function _allKeys(lang) {
    return Object.keys(STRINGS[lang] || {});
  }

  function _rawValue(lang, key) {
    return STRINGS[lang] ? STRINGS[lang][key] : undefined;
  }

  const I18n = {
    t,
    setLang,
    getLang,
    setTheme,
    pluralRu,
    plural,
    normalizeLangCode,
    resolveInitialLang,
    applyDomTranslations,
    createSettingsRow,
    _allKeys,
    _rawValue,
  };

  root.Garden = root.Garden || {};
  root.Garden.i18n = I18n;
})(typeof window !== 'undefined' ? window : globalThis);
