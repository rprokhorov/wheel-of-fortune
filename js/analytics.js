(() => {
  'use strict';

  // Клиентский сбор продуктовых метрик.
  // Работает по принципу «не мешать»: любая ошибка внутри не должна
  // ломать колесо, поэтому всё завёрнуто в try/catch, а отправка идёт
  // пачками через sendBeacon.

  const ENDPOINT = '/api/e';
  const APP_VERSION = '1.4.0';
  const FLUSH_MS = 5000;
  const MAX_QUEUE = 40;

  // Отказ от сбора: Do Not Track или ?analytics=off
  const params = new URLSearchParams(location.search);
  const optedOut =
    navigator.doNotTrack === '1' ||
    window.doNotTrack === '1' ||
    params.get('analytics') === 'off';

  if (optedOut) {
    window.wofTrack = () => {};
    window.wofSetContext = () => {};
    return;
  }

  // ---------- Идентификаторы ----------
  const uuid = () =>
    (crypto.randomUUID ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        }));

  function persistentId(store, key) {
    try {
      let id = store.getItem(key);
      if (!id) { id = uuid(); store.setItem(key, id); }
      return id;
    } catch (_) {
      return null;      // приватный режим — считаем визит анонимным
    }
  }

  const visitorId = persistentId(localStorage, 'wof.visitor');
  const sessionId = persistentId(sessionStorage, 'wof.session');

  // wheel_id — отпечаток «команды». Хешируем отсортированный список,
  // чтобы перемешивание не порождало новую команду. Сами значения
  // никуда не отправляются, только хеш.
  let wheelId = null;

  async function computeWheelId(items) {
    try {
      if (!items || !items.length) { wheelId = null; return; }
      const normalized = items
        .map((s) => String(s).trim().toLocaleLowerCase('ru'))
        .sort()
        .join('|');
      const bytes = new TextEncoder().encode(normalized);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      wheelId = [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 16);
    } catch (_) {
      wheelId = null;   // crypto.subtle недоступен вне HTTPS — не страшно
    }
  }

  // Признаки списка вместо самих строк: по ним видно, для чего
  // используют колесо (имена, задачи, обеды), но ни одно настоящее
  // имя на сервер не уезжает.
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
      // Короткие слова с заглавной буквы — почти наверняка имена людей
      looks_like_names: (oneWord / n > 0.8 && capitalized / n > 0.8 && sum / n < 14) ? 1 : 0,
      pct_cyrillic: Math.round((cyr / n) * 100),
      pct_latin: Math.round((latin / n) * 100),
      pct_emoji: Math.round((emoji / n) * 100),
      pct_one_word: Math.round((oneWord / n) * 100)
    };
  }

  // ---------- Очередь ----------
  const queue = [];
  let flushTimer = null;
  let context = { items_count: 0, is_invited: 0 };

  function flush(useBeacon) {
    if (!queue.length) return;
    const batch = queue.splice(0, queue.length);
    const payload = JSON.stringify({
      referrer: document.referrer || null,
      events: batch
    });

    try {
      if (useBeacon && navigator.sendBeacon) {
        // Переживает закрытие вкладки — главный сценарий для spin_abandon
        navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'application/json' }));
      } else {
        fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        }).catch(() => {});
      }
    } catch (_) { /* сбор метрик не может ломать сайт */ }
  }

  function track(name, props) {
    try {
      queue.push({
        name,
        visitor_id: visitorId,
        session_id: sessionId,
        wheel_id: wheelId,
        is_invited: context.is_invited ? 1 : 0,
        items_count: context.items_count,
        app_version: APP_VERSION,
        screen: `${window.innerWidth}x${window.innerHeight}`,
        lang: navigator.language || null,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        item_profile: context.item_profile || null,
        items_text: context.items_text || null,
        props: props || {}
      });

      if (queue.length >= MAX_QUEUE) flush(false);
      if (!flushTimer) {
        flushTimer = setTimeout(() => { flushTimer = null; flush(false); }, FLUSH_MS);
      }
    } catch (_) { /* см. выше */ }
  }

  // ---------- Публичный интерфейс ----------
  window.wofTrack = track;

  window.wofSetContext = (patch) => {
    context = Object.assign(context, patch || {});
    if (patch && patch.items) {
      computeWheelId(patch.items);
      context.item_profile = profileItems(patch.items);
      // Сами варианты: нужны для разбора пользовательского опыта
      // на внутреннем тестировании. Ограничиваем длину, чтобы
      // случайная вставка полотна текста не раздула события.
      context.items_text = patch.items
        .slice(0, 30)
        .map((s) => String(s).trim().slice(0, 60));
    }
  };

  // Досылаем хвост очереди, когда вкладку скрывают или закрывают
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
  window.addEventListener('pagehide', () => flush(true));

  // Необработанные ошибки — сигнал здоровья продукта
  window.addEventListener('error', (e) => {
    track('error', {
      message: String(e.message || '').slice(0, 200),
      source_line: e.lineno || 0
    });
  });
})();
