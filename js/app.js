(() => {
  'use strict';

  const STORAGE_KEY  = 'wof.items';
  const HISTORY_KEY  = 'wof.history';
  const SETTINGS_KEY = 'wof.settings';

  // Список по умолчанию зависит от языка интерфейса
  const defaultItems = () =>
    (window.wofI18n ? window.wofI18n.defaults()
                    : ['Пицца', 'Суши', 'Бургер', 'Паста', 'Салат', 'Шаурма']);

  const DEFAULT_SETTINGS = {
    sound: true,
    duration: 20,       // секунды вращения — под длину трека
    music: 'kalambur',  // id трека из TRACKS | 'none'
    volume: 50          // 0..100
  };

  const WHEEL_COLORS = ['#e95448', '#f2b83f', '#4da0ab', '#6aa052', '#8b67a5', '#df7442', '#367f95', '#d94b63'];
  const WHEEL_ICONS  = ['★', '♫', '✦', '♛', '♥', '☀', '◆', '●'];

  // Треки: 20-секундные фрагменты, зацикливаются на всё время вращения.
  const TRACKS = {
    none:     { name: null,                 src: null },   // подпись берётся из словаря
    kalambur: { name: 'Деревня дураков',   src: 'music/kalambur.m4a' },
    nupogodi: { name: 'Ну, погоди!',       src: 'music/nu-pogodi.m4a' },
    benny:    { name: 'Шоу Бенни Хилла',   src: 'music/benny-hill.m4a' }
  };

  // ---------- Состояние ----------
  let items    = load(STORAGE_KEY, defaultItems());
  let history  = load(HISTORY_KEY, []);
  let settings = Object.assign({}, DEFAULT_SETTINGS, load(SETTINGS_KEY, {}));

  let rotation = 0;        // текущий поворот колеса, рад
  let spinning = false;
  let pendingWinner = null;
  let spinsThisSession = 0;   // счётчик для аналитики
  let spinStartedAt = 0;

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas     = $('wheel');
  const ctx        = canvas.getContext('2d');
  const spinBtn    = $('spin');
  const spinText   = spinBtn.querySelector('.spin-button__text');
  const pointer    = $('pointer');
  const resultBox  = $('result-box');
  const resultText = $('result-text');
  const dialog     = $('decision-dialog');
  const equalizer  = $('equalizer');
  const durInput   = $('duration');
  const durOut     = $('duration-out');
  const musicSel   = $('music');
  const volInput   = $('volume');
  const volOut     = $('volume-out');
  const volField   = $('volume-field');
  const soundBtn   = $('sound-on');
  const itemsInput = $('items-input');

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw) ?? fallback;
    } catch (_) {
      return fallback;
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 50)));
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (_) { /* приватный режим — не критично */ }
    syncUrl();
  }

  const clamp   = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Перевод. Если i18n.js не загрузился, возвращаем сам ключ —
  // страница остаётся рабочей, просто с служебными подписями.
  const t = (key, vars) => (window.wofI18n ? window.wofI18n.t(key, vars) : key);

  // Аналитика опциональна: если analytics.js не загрузился или сбор
  // отключён, вызовы превращаются в пустышки.
  const track = (name, props) => { if (window.wofTrack) window.wofTrack(name, props); };
  const setTrackContext = (patch) => { if (window.wofSetContext) window.wofSetContext(patch); };
  const colorOf = (i) => WHEEL_COLORS[i % WHEEL_COLORS.length];
  const iconOf  = (i) => WHEEL_ICONS[i % WHEEL_ICONS.length];

  // ---------- Синхронизация со строкой запроса ----------
  // Параметры: items, duration, music, volume, sound
  function readUrl() {
    const q = new URLSearchParams(location.search);
    if (![...q.keys()].length) return;

    if (q.has('items')) {
      items = q.get('items').split(',').map(s => s.trim()).filter(Boolean);
    }
    if (q.has('duration')) {
      const d = parseInt(q.get('duration'), 10);
      if (Number.isFinite(d)) settings.duration = clamp(d, 1, 20);
    }
    if (q.has('volume')) {
      const v = parseInt(q.get('volume'), 10);
      if (Number.isFinite(v)) settings.volume = clamp(v, 0, 100);
    }
    if (q.has('music')) {
      const m = q.get('music');
      settings.music = TRACKS[m] ? m : 'none';
    }
    if (q.has('sound')) settings.sound = isTruthy(q.get('sound'));
  }

  const isTruthy = (v) => v === '1' || v === 'true' || v === 'yes' || v === 'on';

  function buildQuery() {
    const q = new URLSearchParams();
    q.set('items',    items.join(','));
    q.set('duration', String(settings.duration));
    q.set('music',    settings.music);
    q.set('volume',   String(settings.volume));
    q.set('sound',    settings.sound ? '1' : '0');
    return q.toString();
  }

  function syncUrl() {
    try {
      window.history.replaceState(null, '', location.pathname + '?' + buildQuery());
    } catch (_) { /* file:// */ }
  }

  // ---------- Отрисовка колеса ----------
  function drawWheel() {
    const size = canvas.width;
    const center = size / 2;
    const radius = center - 22;

    ctx.clearRect(0, 0, size, size);

    if (items.length === 0) {
      ctx.save();
      ctx.translate(center, center);
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#e8d5ae';
      ctx.fill();
      ctx.strokeStyle = '#f8d36b';
      ctx.lineWidth = 13;
      ctx.stroke();
      ctx.fillStyle = '#8a5a33';
      ctx.font = '32px Neucha, cursive';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t('items.empty'), 0, 90);
      ctx.restore();
      return;
    }

    const slice = (Math.PI * 2) / items.length;

    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(rotation);

    items.forEach((label, index) => {
      // Сектор 0 центрирован под указателем при rotation = 0
      const start  = -Math.PI / 2 - slice / 2 + index * slice;
      const end    = start + slice;
      const middle = start + slice / 2;

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, start, end);
      ctx.closePath();
      ctx.fillStyle = colorOf(index);
      ctx.fill();
      ctx.strokeStyle = '#613b28';
      ctx.lineWidth = 5;
      ctx.stroke();

      ctx.save();
      ctx.rotate(middle);
      ctx.translate(radius * 0.69, 0);
      ctx.rotate(Math.PI / 2);

      // Иконка с мягкой тенью
      ctx.fillStyle = 'rgba(55, 30, 22, 0.18)';
      ctx.font = '42px Neucha, cursive';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(iconOf(index), 2, -46);
      ctx.fillStyle = '#fff8de';
      ctx.fillText(iconOf(index), 0, -49);

      const labelSize = items.length > 14 ? 13 : items.length > 10 ? 15 : items.length > 7 ? 18 : 23;
      ctx.font = `700 ${labelSize}px Rubik, sans-serif`;
      const short = label.length > 24 ? `${label.slice(0, 23)}…` : label;
      wrapText(ctx, short.toUpperCase(), 0, 2, 142, labelSize + 3);
      ctx.restore();

      // «Гвоздик» на границе сектора
      const pegX = Math.cos(end) * (radius - 11);
      const pegY = Math.sin(end) * (radius - 11);
      ctx.beginPath();
      ctx.arc(pegX, pegY, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#ffe28b';
      ctx.fill();
      ctx.strokeStyle = '#68402b';
      ctx.lineWidth = 3;
      ctx.stroke();
    });

    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#f8d36b';
    ctx.lineWidth = 13;
    ctx.stroke();
    ctx.restore();
  }

  function wrapText(context, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    const lines = [];
    let line = '';

    words.forEach((word) => {
      const test = line ? `${line} ${word}` : word;
      if (context.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    });
    lines.push(line);

    const startY = y - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((textLine, i) => {
      context.strokeStyle = 'rgba(78, 41, 27, 0.24)';
      context.lineWidth = 4;
      context.strokeText(textLine, x, startY + i * lineHeight);
      context.fillStyle = '#fff8de';
      context.fillText(textLine, x, startY + i * lineHeight);
    });
  }

  // ---------- Аудио ----------
  let audioCtx = null;
  let audioEl  = null;

  function ac() {
    if (!audioCtx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function beep(freq, dur, vol, type = 'sine') {
    const c = ac();
    if (!c) return;
    try {
      const osc  = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      osc.connect(gain).connect(c.destination);
      osc.start();
      osc.stop(c.currentTime + dur);
    } catch (_) { /* звук не критичен */ }
  }

  const tick = () => beep(900, 0.04, 0.05, 'square');
  function fanfare() {
    [523, 659, 784, 1047].forEach((f, i) =>
      setTimeout(() => beep(f, 0.28, 0.14, 'triangle'), i * 110));
  }

  function startMusic() {
    stopMusic();
    const vol = settings.volume / 100;
    const track = TRACKS[settings.music];
    if (vol === 0 || !track || !track.src) return;

    audioEl = new Audio(track.src);
    audioEl.loop = true;          // трек короче вращения — играет по кругу
    audioEl.volume = vol;
    audioEl.play()
      .then(() => equalizer.classList.add('is-playing'))
      .catch(() => {
        // Браузер не дал запустить музыку без жеста — важный сигнал:
        // ключевая фишка продукта у этого пользователя не сработала.
        track('audio_blocked', { track: settings.music });
      });
  }

  function stopMusic() {
    if (audioEl) { audioEl.pause(); audioEl = null; }
    equalizer.classList.remove('is-playing');
  }

  // ---------- Вращение ----------
  const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
  const normalizeAngle = (a) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

  function spin() {
    if (spinning || items.length === 0) return;

    spinning = true;
    spinBtn.disabled = true;
    durInput.disabled = true;
    spinBtn.classList.add('is-spinning');
    pointer.classList.add('is-ticking');
    resultBox.classList.remove('is-winning');
    resultText.textContent = t('result.spinning');

    const slice  = (Math.PI * 2) / items.length;
    const winner = Math.floor(Math.random() * items.length);

    // Сектор 0 центрирован под указателем; чтобы туда пришёл winner,
    // колесо доворачивается на -winner*slice.
    const turns = Math.max(3, Math.round(settings.duration * 1.6));
    const from = rotation;
    let to = -winner * slice + turns * Math.PI * 2;
    while (to < from + Math.PI * 4) to += Math.PI * 2;

    const duration = settings.duration * 1000;
    const startTs  = performance.now();
    let lastIndex  = -1;

    spinStartedAt = startTs;
    spinsThisSession += 1;
    track('spin_start', {
      duration_s: settings.duration,
      music: settings.music,
      volume: settings.volume,
      sound_on: settings.sound,
      spin_index: spinsThisSession
    });

    startMusic();

    function frame(now) {
      const t = Math.min((now - startTs) / duration, 1);
      rotation = from + (to - from) * easeOutQuint(t);
      drawWheel();

      if (settings.sound) {
        const idx = currentIndex();
        if (idx !== lastIndex) { tick(); lastIndex = idx; }
      }

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        rotation = normalizeAngle(to);
        drawWheel();
        finishSpin(winner);
      }
    }
    requestAnimationFrame(frame);
  }

  function currentIndex() {
    const slice = (Math.PI * 2) / items.length;
    return Math.round(normalizeAngle(-rotation) / slice) % items.length;
  }

  function finishSpin(winnerIndex) {
    spinning = false;
    spinBtn.disabled = false;
    durInput.disabled = false;
    spinBtn.classList.remove('is-spinning');
    pointer.classList.remove('is-ticking');
    spinText.textContent = t('spin.again');
    stopMusic();

    const winner = items[winnerIndex];
    resultText.textContent = winner;
    resultBox.classList.add('is-winning');

    track('spin_complete', {
      spin_index: spinsThisSession,
      actual_ms: Math.round(performance.now() - spinStartedAt)
    });

    history.unshift({ name: winner, at: Date.now() });
    save();
    renderHistory();

    if (settings.sound) fanfare();
    launchConfetti(colorOf(winnerIndex));

    setTimeout(() => askAboutWinner(winner), 650);
  }

  // ---------- Диалог «удалить или оставить» ----------
  function askAboutWinner(name) {
    pendingWinner = name;
    $('decision-name').textContent = name;
    const isLast = items.length === 1;
    $('remove-btn').disabled = isLast;
    $('decision-hint').textContent = isLast ? t('dialog.lastOne') : '';
    dialog.returnValue = '';
    dialog.showModal();
  }

  dialog.addEventListener('close', () => {
    track('decision', {
      choice: dialog.returnValue === 'remove' ? 'remove' : 'keep',
      items_left: dialog.returnValue === 'remove' ? items.length - 1 : items.length
    });

    if (dialog.returnValue === 'remove' && pendingWinner && items.length > 1) {
      const removed = pendingWinner;
      const idx = items.indexOf(removed);
      if (idx !== -1) items.splice(idx, 1);
      rotation = 0;
      save();
      renderAll();
      resultText.textContent = `${removed} — удалён`;
      showToast(`Осталось вариантов: ${items.length}`);
    }
    pendingWinner = null;
  });

  // ---------- Тост ----------
  let toastTimer = null;
  function showToast(message) {
    const toast = $('toast');
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('is-visible');
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
  }

  // ---------- Конфетти ----------
  const confettiCanvas = $('confetti');
  const confettiCtx = confettiCanvas.getContext('2d');
  const confettiPieces = [];
  let confettiFrame = null;

  function resizeConfetti() {
    const ratio = window.devicePixelRatio || 1;
    confettiCanvas.width  = window.innerWidth * ratio;
    confettiCanvas.height = window.innerHeight * ratio;
    confettiCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function launchConfetti(accent) {
    const colors = [accent, '#f7bd36', '#4da0ab', '#fff6dc', '#df3f36'];
    for (let i = 0; i < 90; i++) {
      confettiPieces.push({
        x: Math.random() * window.innerWidth,
        y: -20 - Math.random() * 120,
        w: 6 + Math.random() * 7,
        h: 9 + Math.random() * 9,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: -1.4 + Math.random() * 2.8,
        vy: 2.4 + Math.random() * 3.2,
        rotation: Math.random() * Math.PI,
        spin: -0.12 + Math.random() * 0.24
      });
    }
    if (!confettiFrame) animateConfetti();
  }

  function animateConfetti() {
    confettiCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    for (let i = confettiPieces.length - 1; i >= 0; i--) {
      const p = confettiPieces[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.04;
      p.rotation += p.spin;

      confettiCtx.save();
      confettiCtx.translate(p.x, p.y);
      confettiCtx.rotate(p.rotation);
      confettiCtx.fillStyle = p.color;
      confettiCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      confettiCtx.restore();

      if (p.y > window.innerHeight + 40) confettiPieces.splice(i, 1);
    }

    if (confettiPieces.length) {
      confettiFrame = requestAnimationFrame(animateConfetti);
    } else {
      confettiCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      confettiFrame = null;
    }
  }

  // ---------- Рендер ----------
  function renderItems() {
    $('counter').textContent = items.length;
    // не перетираем текст, пока пользователь его правит
    if (document.activeElement !== itemsInput) {
      itemsInput.value = items.join('\n');
    }
  }

  function renderHistory() {
    const el = $('history');
    $('history-count').textContent = history.length;
    el.innerHTML = '';

    if (history.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = t('history.empty');
      el.appendChild(li);
      return;
    }

    history.slice(0, 20).forEach((h) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = h.name;
      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = new Date(h.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      li.append(name, time);
      el.appendChild(li);
    });
  }

  function renderAll() {
    renderItems();
    renderHistory();
    drawWheel();
  }

  // ---------- Элементы управления ----------
  function buildMusicOptions() {
    musicSel.innerHTML = '';
    Object.entries(TRACKS).forEach(([id, trackData]) => {
      const opt = document.createElement('option');
      opt.value = id;
      // Имена треков не переводятся — только подпись «Без музыки»
      opt.textContent = trackData.name || t('music.none');
      musicSel.appendChild(opt);
    });
    musicSel.value = settings.music;
  }

  function renderControls() {
    durInput.value = settings.duration;
    durOut.textContent = t('duration.sec', { n: settings.duration });

    volInput.value = settings.volume;
    volOut.textContent = settings.volume + '%';
    volField.hidden = settings.music === 'none';

    soundBtn.classList.toggle('is-muted', !settings.sound);
    soundBtn.setAttribute('aria-pressed', String(!settings.sound));
    soundBtn.setAttribute('aria-label', t(settings.sound ? 'music.soundOff' : 'music.soundOn'));

    buildMusicOptions();
  }

  durInput.addEventListener('input', () => {
    settings.duration = clamp(parseInt(durInput.value, 10) || 20, 1, 20);
    durOut.textContent = t('duration.sec', { n: settings.duration });
  });
  durInput.addEventListener('change', () => {
    save();
    track('duration_changed', { to: settings.duration });
    showToast(`Колесо будет крутиться ${settings.duration} сек`);
  });

  volInput.addEventListener('input', () => {
    settings.volume = clamp(parseInt(volInput.value, 10) || 0, 0, 100);
    volOut.textContent = settings.volume + '%';
    if (audioEl) audioEl.volume = settings.volume / 100;
  });
  volInput.addEventListener('change', save);

  musicSel.addEventListener('change', () => {
    track('music_changed', { from: settings.music, to: musicSel.value });
    settings.music = musicSel.value;
    save();
    renderControls();
  });

  soundBtn.addEventListener('click', () => {
    settings.sound = !settings.sound;
    save();
    renderControls();
    showToast(t(settings.sound ? 'toast.soundOn' : 'toast.soundOff'));
  });

  // ---------- Список ----------
  function setItems(list, source) {
    const before = items.length;
    items = list;
    rotation = 0;
    save();
    renderAll();
    setTrackContext({ items_count: items.length, items });
    track('items_changed', { before, after: items.length, source: source || 'apply' });
  }

  function parseItems(value) {
    const seen = new Set();
    return value
      .split(/[\n,;]+/)
      .map(s => s.trim())
      .filter(s => {
        if (!s) return false;
        const key = s.toLocaleLowerCase('ru');
        if (seen.has(key)) return false;   // дубликаты только запутывают колесо
        seen.add(key);
        return true;
      })
      .slice(0, 30);                       // больше 30 секторов нечитаемо
  }

  $('apply-items').addEventListener('click', () => {
    const list = parseItems(itemsInput.value);
    if (!list.length) {
      showToast(t('toast.emptyList'));
      itemsInput.value = items.join('\n');
      return;
    }
    setItems(list, 'apply');
    showToast(t('toast.itemsCount', { n: list.length }));
  });

  $('shuffle').addEventListener('click', () => {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    setItems(items, 'shuffle');
    showToast(t('toast.shuffled'));
  });

  $('copy-link').addEventListener('click', async () => {
    const url = location.origin + location.pathname + '?' + buildQuery();
    try {
      await navigator.clipboard.writeText(url);
      showToast(t('toast.copied'));
      track('link_copied', { items_count: items.length, music: settings.music });
    } catch (_) {
      prompt(t('toast.copyManual'), url);
    }
  });

  $('clear-history').addEventListener('click', () => {
    history = [];
    save();
    renderHistory();
    showToast(t('toast.historyCleared'));
  });

  $('export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'wheel-items.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('import-btn').addEventListener('click', () => $('import').click());
  $('import').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const list = Array.isArray(data) ? data : data.items;
        if (!Array.isArray(list)) throw new Error('bad format');
        const parsed = parseItems(list.map(String).join('\n'));
        if (!parsed.length) throw new Error('empty');
        setItems(parsed, 'import');
        showToast(t('toast.imported', { n: parsed.length }));
      } catch (_) {
        showToast(t('toast.importFailed'));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // ---------- События ----------
  spinBtn.addEventListener('click', spin);
  canvas.addEventListener('click', spin);

  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement.tagName;
    if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && tag !== 'BUTTON') {
      e.preventDefault();
      if (!dialog.open) spin();
    }
  });

  // Переключение языка
  $('lang-switch').addEventListener('click', () => {
    if (window.wofI18n) window.wofI18n.setLang(window.wofI18n.other());
  });

  // Перерисовываем всё, что построено кодом: статическую разметку
  // обновляет сам i18n, а списки, колесо и подписи — мы.
  window.addEventListener('wof:langchange', () => {
    renderControls();
    renderAll();
    // Результат сбрасываем только если розыгрыша ещё не было:
    // имя победителя переводить не нужно.
    if (!history.length) resultText.textContent = t('result.placeholder');
  });

  window.addEventListener('resize', resizeConfetti);
  window.addEventListener('beforeunload', stopMusic);

  window.addEventListener('pagehide', () => {
    if (!spinning) return;
    const elapsed = performance.now() - spinStartedAt;
    track('spin_abandon', {
      progress_pct: clamp(Math.round((elapsed / (settings.duration * 1000)) * 100), 0, 100),
      spin_index: spinsThisSession
    });
  });

  // ---------- Старт ----------
  const arrivedWithParams = new URLSearchParams(location.search).has('items');

  readUrl();          // URL важнее сохранённого состояния
  resizeConfetti();
  renderControls();
  renderAll();
  syncUrl();

  setTrackContext({
    items_count: items.length,
    items,
    is_invited: arrivedWithParams ? 1 : 0
  });
  track('page_view', {
    has_params: arrivedWithParams ? 1 : 0,
    load_ms: Math.round(performance.now())
  });

  // Шрифты приходят с Google Fonts — перерисовать колесо, когда загрузятся
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(drawWheel);
  }
})();
