(() => {
  'use strict';

  // Переводы интерфейса. Названия треков не переводятся —
  // это имена собственные, одинаковые в обоих языках.
  const DICT = {
    ru: {
      'app.title': 'Колесо фортуны',
      'hero.eyebrow': 'испытайте удачу',
      'hero.title': 'А ну-ка, крути!',
      'hero.subtitle': 'Колесо всё решит. Мы тут совершенно ни при чём.',

      'result.label': 'Колесо выбрало',
      'result.placeholder': 'Кому же повезёт?',
      'result.spinning': 'Крутится…',
      'result.removed': '{name} — удалён',

      'items.title': 'Список вариантов',
      'items.edit': 'изменить',
      'items.hint': 'По одному варианту на строке',
      'items.apply': 'Применить',
      'items.shuffle': 'Перемешать',
      'items.copyLink': 'Скопировать ссылку',
      'items.export': 'Экспорт',
      'items.import': 'Импорт',
      'items.empty': 'Добавьте варианты',

      'duration.label': 'Время вращения',
      'duration.sec': '{n} сек',

      'spin.button': 'Крутить колесо',
      'spin.again': 'Крутить ещё',

      'music.aria': 'Мелодия вращения',
      'music.none': 'Без музыки',
      'music.volume': 'Громкость',
      'music.note': 'Мелодия играет только во время вращения',
      'music.soundOn': 'Включить звуковые эффекты',
      'music.soundOff': 'Выключить звуковые эффекты',

      'history.title': 'История',
      'history.show': 'показать',
      'history.clear': 'Очистить историю',
      'history.empty': 'Пока пусто',

      'hint.keys': 'Пробел или клик по колесу — тоже крутит.',
      'footer.left': 'Сделано с удачей',
      'footer.right': 'и щепоткой безумия',

      'dialog.eyebrow': 'Колесо выбрало',
      'dialog.name': 'Вариант',
      'dialog.question': 'Удалить его из списка перед следующим вращением?',
      'dialog.remove': 'Да, удалить',
      'dialog.keep': 'Нет, оставить',
      'dialog.lastOne': 'Последний вариант удалить нельзя',

      'toast.copied': 'Ссылка скопирована',
      'toast.copyManual': 'Скопируйте ссылку:',
      'toast.shuffled': 'Перемешано',
      'toast.historyCleared': 'История очищена',
      'toast.emptyList': 'Список не может быть пустым',
      'toast.importFailed': 'Не удалось прочитать файл',
      'toast.imported': 'Импортировано: {n}',
      'toast.itemsCount': 'Вариантов: {n}',
      'toast.remaining': 'Осталось вариантов: {n}',
      'toast.duration': 'Колесо будет крутиться {n} сек',
      'toast.soundOn': 'Звуковые эффекты включены',
      'toast.soundOff': 'Звуковые эффекты выключены',

      'lang.switch': 'English',
      'lang.aria': 'Переключить язык',

      'defaults': ['Пицца', 'Суши', 'Бургер', 'Паста', 'Салат', 'Шаурма']
    },

    en: {
      'app.title': 'Wheel of Fortune',
      'hero.eyebrow': 'try your luck',
      'hero.title': 'Give it a spin!',
      'hero.subtitle': "The wheel decides. We had nothing to do with it.",

      'result.label': 'The wheel picked',
      'result.placeholder': 'Who will it be?',
      'result.spinning': 'Spinning…',
      'result.removed': '{name} — removed',

      'items.title': 'Options',
      'items.edit': 'edit',
      'items.hint': 'One option per line',
      'items.apply': 'Apply',
      'items.shuffle': 'Shuffle',
      'items.copyLink': 'Copy link',
      'items.export': 'Export',
      'items.import': 'Import',
      'items.empty': 'Add some options',

      'duration.label': 'Spin duration',
      'duration.sec': '{n} sec',

      'spin.button': 'Spin the wheel',
      'spin.again': 'Spin again',

      'music.aria': 'Spin soundtrack',
      'music.none': 'No music',
      'music.volume': 'Volume',
      'music.note': 'Music plays only while the wheel spins',
      'music.soundOn': 'Turn sound effects on',
      'music.soundOff': 'Turn sound effects off',

      'history.title': 'History',
      'history.show': 'show',
      'history.clear': 'Clear history',
      'history.empty': 'Nothing yet',

      'hint.keys': 'Space or a click on the wheel also spins it.',
      'footer.left': 'Made with luck',
      'footer.right': 'and a pinch of madness',

      'dialog.eyebrow': 'The wheel picked',
      'dialog.name': 'Option',
      'dialog.question': 'Remove it from the list before the next spin?',
      'dialog.remove': 'Yes, remove',
      'dialog.keep': 'No, keep it',
      'dialog.lastOne': 'The last option cannot be removed',

      'toast.copied': 'Link copied',
      'toast.copyManual': 'Copy the link:',
      'toast.shuffled': 'Shuffled',
      'toast.historyCleared': 'History cleared',
      'toast.emptyList': 'The list cannot be empty',
      'toast.importFailed': 'Could not read the file',
      'toast.imported': 'Imported: {n}',
      'toast.itemsCount': 'Options: {n}',
      'toast.remaining': 'Options left: {n}',
      'toast.duration': 'The wheel will spin for {n} sec',
      'toast.soundOn': 'Sound effects on',
      'toast.soundOff': 'Sound effects off',

      'lang.switch': 'Русский',
      'lang.aria': 'Switch language',

      'defaults': ['Pizza', 'Sushi', 'Burger', 'Pasta', 'Salad', 'Tacos']
    }
  };

  const LANG_KEY = 'wof.lang';

  // Язык берём из URL, затем из сохранённого выбора, затем из браузера
  function detectLang() {
    const fromUrl = new URLSearchParams(location.search).get('lang');
    if (DICT[fromUrl]) return fromUrl;
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (DICT[saved]) return saved;
    } catch (_) { /* приватный режим */ }
    return (navigator.language || '').toLowerCase().startsWith('ru') ? 'ru' : 'en';
  }

  let lang = detectLang();

  // t('toast.imported', { n: 5 }) → 'Импортировано: 5'
  function t(key, vars) {
    let s = (DICT[lang] && DICT[lang][key]) ?? (DICT.ru[key] ?? key);
    if (vars && typeof s === 'string') {
      for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
    }
    return s;
  }

  window.wofI18n = {
    t,
    get lang() { return lang; },
    defaults: () => DICT[lang].defaults.slice(),

    setLang(next) {
      if (!DICT[next] || next === lang) return;
      lang = next;
      try { localStorage.setItem(LANG_KEY, lang); } catch (_) { /* приватный режим */ }
      document.documentElement.lang = lang;
      applyStatic();
      window.dispatchEvent(new CustomEvent('wof:langchange', { detail: { lang } }));
    },

    other: () => (lang === 'ru' ? 'en' : 'ru'),
    applyStatic
  };

  // Проставляет переводы в размеченные элементы:
  // data-i18n — текст, data-i18n-aria — aria-label, data-i18n-ph — placeholder
  function applyStatic() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      el.setAttribute('aria-label', t(el.dataset.i18nAria));
    });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
      el.placeholder = t(el.dataset.i18nPh);
    });
    document.title = t('app.title');
  }

  document.documentElement.lang = lang;

  // Применяем словарь сразу: разметка в HTML написана по-русски,
  // и без этого ?lang=en открывался бы с русскими подписями.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyStatic);
  } else {
    applyStatic();
  }
})();
