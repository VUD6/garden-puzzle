// Minimal i18n module. All user-facing strings must go through Garden.i18n.t(key).
(function (root) {
  const STRINGS = {
    ru: {
      appTitle: 'Клумба',
      appFullTitle: 'Клумба: цветочная головоломка',
      levelLabel: 'Уровень {level}',
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
      dailyChallengeCaption: 'Откроется на уровне 15',
      milestoneBannerTitle: 'Праздничный уровень!',
      helperNameFinder: 'Искатель',
      helperNameRandom: 'Случайный помощник',
      helperNameSnowman: 'Снеговик',
      helperAriaLabel: '{name}: {count} зарядов',
      helperLockedAriaLabel: '{name}: заблокировано до уровня {level}',
      helperLockedCaption: 'Ур.{level}',
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
      appTitle: 'Garden Bed',
      appFullTitle: 'Garden Bed: a flower puzzle',
      levelLabel: 'Level {level}',
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
      dailyChallengeCaption: 'Unlocks at level 15',
      milestoneBannerTitle: 'Festive level!',
      helperNameFinder: 'Finder',
      helperNameRandom: 'Random helper',
      helperNameSnowman: 'Snowman',
      helperAriaLabel: '{name}: {count} charges',
      helperLockedAriaLabel: '{name}: locked until level {level}',
      helperLockedCaption: 'Lv.{level}',
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

  const I18n = { t, setLang, getLang, setTheme, pluralRu };

  root.Garden = root.Garden || {};
  root.Garden.i18n = I18n;
})(typeof window !== 'undefined' ? window : globalThis);
