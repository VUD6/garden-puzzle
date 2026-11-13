// Minimal i18n module. All user-facing strings must go through Garden.i18n.t(key).
(function (root) {
  const STRINGS = {
    ru: {
      appTitle: 'Клумба',
      appFullTitle: 'Клумба: цветочная головоломка',
      levelLabel: 'Уровень {level}',
      winTitle: 'Уровень пройден!',
      winMessage: 'Все цветы посажены правильно.',
      nextLevelButton: 'Следующий уровень',
      failTitle: 'Капли закончились',
      failMessage: 'Попробуйте снова.',
      retryButton: 'Повторить',
      patternsToggleLabel: 'Узоры на клумбах',
    },
    en: {
      appTitle: 'Garden Bed',
      appFullTitle: 'Garden Bed: a flower puzzle',
      levelLabel: 'Level {level}',
      winTitle: 'Level complete!',
      winMessage: 'Every flower is planted correctly.',
      nextLevelButton: 'Next level',
      failTitle: 'Out of water drops',
      failMessage: 'Try again.',
      retryButton: 'Retry',
      patternsToggleLabel: 'Bed patterns',
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
