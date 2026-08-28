// Чистая логика колеса: без DOM, canvas и localStorage.
// Вынесена отдельно, чтобы её можно было проверять юнит-тестами
// и переиспользовать в браузере через глобальный wofCore.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.wofCore = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TAU = Math.PI * 2;

  const LIMITS = {
    duration: [1, 20],
    volume: [0, 100],
    maxItems: 30,
    maxItemLength: 60
  };

  /** Зажать число в диапазон; всё нечисловое даёт null. */
  function clampInt(value, lo, hi) {
    // Принимаем только числа и непустые строки. Number() слишком
    // покладист: [], '  ' и false он превращает в 0, из-за чего
    // мусорный параметр молча становился бы минимумом диапазона.
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return null;
      return Math.min(hi, Math.max(lo, Math.round(value)));
    }
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return null;
    return Math.min(hi, Math.max(lo, Math.round(n)));
  }

  function clamp(value, lo, hi) {
    return Math.min(hi, Math.max(lo, value));
  }

  const isTruthy = (v) => v === '1' || v === 'true' || v === 'yes' || v === 'on';

  /** Привести угол к диапазону [0, 2π). */
  const normalizeAngle = (a) => ((a % TAU) + TAU) % TAU;

  /** Замедление в конце вращения. */
  const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);

  /**
   * Итоговый угол, при котором сектор winner окажется под указателем.
   * Сектор 0 центрирован под указателем при rotation = 0, поэтому
   * колесо доворачивается на -winner * slice плюс целые обороты.
   */
  function targetRotation(winner, total, from, turns) {
    const slice = TAU / total;
    let to = -winner * slice + turns * TAU;
    while (to < from + Math.PI * 4) to += TAU;
    return to;
  }

  /** Сколько оборотов делать при заданной длительности. */
  const turnsForDuration = (seconds) => Math.max(3, Math.round(seconds * 1.6));

  /** Индекс сектора, стоящего под указателем при данном повороте. */
  function sectorAt(rotation, total) {
    if (!total) return -1;
    const slice = TAU / total;
    return Math.round(normalizeAngle(-rotation) / slice) % total;
  }

  /**
   * Разобрать пользовательский ввод в список вариантов.
   * Разделители — перевод строки, запятая, точка с запятой.
   * Дубликаты отсеиваются без учёта регистра, список ограничен 30.
   */
  function parseItems(value) {
    const seen = new Set();
    return String(value ?? '')
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter((s) => {
        if (!s) return false;
        const key = s.toLocaleLowerCase('ru');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, LIMITS.maxItems);
  }

  /**
   * Прочитать состояние из строки запроса.
   * Некорректные значения зажимаются в допустимый диапазон,
   * а не роняют страницу.
   */
  function readState(search, tracks, defaults) {
    const q = new URLSearchParams(search || '');
    const state = Object.assign({}, defaults);
    if (![...q.keys()].length) return state;

    if (q.has('items')) {
      state.items = q.get('items').split(',').map((s) => s.trim()).filter(Boolean);
    }

    const duration = clampInt(q.get('duration'), ...LIMITS.duration);
    if (duration !== null) state.duration = duration;

    const volume = clampInt(q.get('volume'), ...LIMITS.volume);
    if (volume !== null) state.volume = volume;

    if (q.has('music')) {
      const m = q.get('music');
      state.music = tracks && tracks[m] ? m : 'none';
    }
    if (q.has('sound')) state.sound = isTruthy(q.get('sound'));

    return state;
  }

  /** Собрать строку запроса из состояния. */
  function buildQuery(state) {
    const q = new URLSearchParams();
    q.set('items', (state.items || []).join(','));
    q.set('duration', String(state.duration));
    q.set('music', state.music);
    q.set('volume', String(state.volume));
    q.set('sound', state.sound ? '1' : '0');
    return q.toString();
  }

  /**
   * Признаки списка: по ним видно, для чего используют колесо,
   * при этом сами варианты никуда не отправляются.
   */
  function profileItems(items) {
    if (!items || !items.length) return null;
    const lens = items.map((s) => String(s).trim().length);
    const sum = lens.reduce((a, b) => a + b, 0);

    let cyr = 0, latin = 0, emoji = 0, oneWord = 0, capitalized = 0;
    for (const raw of items) {
      const s = String(raw).trim();
      if (/[а-яё]/i.test(s)) cyr++;
      if (/[a-z]/i.test(s)) latin++;
      if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s)) emoji++;
      if (!/\s/.test(s)) oneWord++;
      if (/^[A-ZА-ЯЁ]/.test(s)) capitalized++;
    }

    const n = items.length;
    return {
      n,
      len_avg: Math.round(sum / n),
      len_min: Math.min(...lens),
      len_max: Math.max(...lens),
      // Короткие одиночные слова с заглавной — почти наверняка имена
      looks_like_names:
        (oneWord / n > 0.8 && capitalized / n > 0.8 && sum / n < 14) ? 1 : 0,
      pct_cyrillic: Math.round((cyr / n) * 100),
      pct_latin: Math.round((latin / n) * 100),
      pct_emoji: Math.round((emoji / n) * 100),
      pct_one_word: Math.round((oneWord / n) * 100)
    };
  }

  return {
    TAU, LIMITS,
    clamp, clampInt, isTruthy,
    normalizeAngle, easeOutQuint,
    targetRotation, turnsForDuration, sectorAt,
    parseItems, readState, buildQuery, profileItems
  };
}));
