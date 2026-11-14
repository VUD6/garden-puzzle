// Minimal i18n module. All user-facing strings must go through Garden.i18n.t(key).
(function (root) {
  const STRINGS = {
    ru: {
      appTitle: 'Клумба',
      appFullTitle: 'Клумба: цветочная головоломка',
      levelLabel: 'Уровень {level}',
      winMessage: 'Все цветы посажены правильно.',
      nextLevelButton: 'Следующий уровень',
      failTitle: 'Капли закончились',
      failMessage: 'Попробуйте снова.',
      retryButton: 'Повторить',
      patternsToggleLabel: 'Узоры на клумбах',
      scoreLabel: 'Очки: {score}',
      scoreEarnedLabel: 'Очки за уровень: +{amount}',
      resultPerfect: 'Идеально!',
      resultDone: 'Готово!',
      ruleBedText: '1 цветок на клумбу',
      ruleRowColText: '1 цветок в ряду и столбце',
      ruleTouchText: 'Цветы не касаются друг друга',
      rankGardener: 'Садовник',
      rankSkilledGardener: 'Умелый садовник',
      rankMasterGardener: 'Мастер-садовник',
      bestTimeLabel: 'Лучшее время: {time}',
    },
    en: {
      appTitle: 'Garden Bed',
      appFullTitle: 'Garden Bed: a flower puzzle',
      levelLabel: 'Level {level}',
      winMessage: 'Every flower is planted correctly.',
      nextLevelButton: 'Next level',
      failTitle: 'Out of water drops',
      failMessage: 'Try again.',
      retryButton: 'Retry',
      patternsToggleLabel: 'Bed patterns',
      scoreLabel: 'Score: {score}',
      scoreEarnedLabel: 'Level score: +{amount}',
      resultPerfect: 'Perfect!',
      resultDone: 'Done!',
      ruleBedText: '1 flower per bed',
      ruleRowColText: '1 flower per row and column',
      ruleTouchText: "Flowers can't touch",
      rankGardener: 'Gardener',
      rankSkilledGardener: 'Skilled gardener',
      rankMasterGardener: 'Master gardener',
      bestTimeLabel: 'Best time: {time}',
    },
  };

  let currentLang = 'ru';

  function setLang(lang) {
    if (STRINGS[lang]) currentLang = lang;
  }

  function getLang() {
    return currentLang;
  }

  function t(key, params) {
    const dict = STRINGS[currentLang] || STRINGS.ru;
    let str = dict[key] || key;
    if (params) {
      for (const paramKey of Object.keys(params)) {
        str = str.replace('{' + paramKey + '}', params[paramKey]);
      }
    }
    return str;
  }

  const I18n = { t, setLang, getLang };

  root.Garden = root.Garden || {};
  root.Garden.i18n = I18n;
})(typeof window !== 'undefined' ? window : globalThis);
