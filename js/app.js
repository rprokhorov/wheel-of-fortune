(() => {
  'use strict';

  const STORAGE_KEY   = 'wof.items';
  const HISTORY_KEY   = 'wof.history';
  const SETTINGS_KEY  = 'wof.settings';

  const DEFAULT_ITEMS = ['Пицца', 'Суши', 'Бургер', 'Паста', 'Салат', 'Шаурма'];

  const DEFAULT_SETTINGS = {
    removeWinner: false,
    sound: true,
    theme: 'light',
    duration: 20,       // секунды вращения — под длину заглавного трека
    music: 'kalambur',  // id трека из TRACKS | 'none'
    volume: 50          // 0..100
  };

  const PALETTE = [
    '#e5484d', '#f76b15', '#ffb224', '#46a758', '#12a594',
    '#0091ff', '#5b6ef5', '#8e4ec6', '#e93d82', '#697177'
  ];

  // Треки: 20-секундные фрагменты, зацикливаются на всё время вращения.
  const TRACKS = {
    none:     { name: 'Без музыки',      src: null },
    kalambur: { name: 'Деревня дураков', src: 'music/kalambur.m4a' },
    nupogodi: { name: 'Ну, погоди!',     src: 'music/nu-pogodi.m4a' }
  };

  // ---------- Состояние ----------
  let items    = load(STORAGE_KEY, DEFAULT_ITEMS);
  let history  = load(HISTORY_KEY, []);
  let settings = Object.assign({}, DEFAULT_SETTINGS, load(SETTINGS_KEY, {}));

  let angle      = 0;      // текущий поворот колеса, рад
  let spinning   = false;

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas  = $('wheel');
  const ctx     = canvas.getContext('2d');
  const listEl  = $('items');
  const histEl  = $('history');
  const spinBtn = $('spin');
  const modal   = $('modal');

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const val = JSON.parse(raw);
      return val ?? fallback;
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

  const colorOf = (i) => PALETTE[i % PALETTE.length];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ---------- Синхронизация со строкой запроса ----------
  // Параметры: items, duration, music, volume, remove, sound, theme
  function readUrl() {
    const q = new URLSearchParams(location.search);
    if (![...q.keys()].length) return;

    if (q.has('items')) {
      const list = q.get('items').split(',').map(s => s.trim()).filter(Boolean);
      items = list;  // пустой список из URL — валидное состояние
    }
    if (q.has('duration')) {
      const d = parseInt(q.get('duration'), 10);
      if (Number.isFinite(d)) settings.duration = clamp(d, 1, 30);
    }
    if (q.has('volume')) {
      const v = parseInt(q.get('volume'), 10);
      if (Number.isFinite(v)) settings.volume = clamp(v, 0, 100);
    }
    if (q.has('music')) {
      const m = q.get('music');
      settings.music = TRACKS[m] ? m : 'none';
    }
    if (q.has('remove')) settings.removeWinner = isTruthy(q.get('remove'));
    if (q.has('sound'))  settings.sound        = isTruthy(q.get('sound'));
    if (q.has('theme'))  settings.theme        = q.get('theme') === 'dark' ? 'dark' : 'light';
  }

  const isTruthy = (v) => v === '1' || v === 'true' || v === 'yes' || v === 'on';

  function buildQuery() {
    const q = new URLSearchParams();
    q.set('items',    items.join(','));
    q.set('duration', String(settings.duration));
    q.set('music',    settings.music);
    q.set('volume',   String(settings.volume));
    q.set('remove',   settings.removeWinner ? '1' : '0');
    q.set('sound',    settings.sound ? '1' : '0');
    q.set('theme',    settings.theme);
    return q.toString();
  }

  function syncUrl() {
    const url = location.pathname + '?' + buildQuery();
    history_replaceState(url);
  }

  // отдельная обёртка, чтобы не путать с массивом history
  function history_replaceState(url) {
    try { window.history.replaceState(null, '', url); } catch (_) { /* file:// */ }
  }

  // ---------- Отрисовка колеса ----------
  function drawWheel() {
    const size = canvas.width;
    const cx = size / 2, cy = size / 2, r = size / 2 - 10;

    ctx.clearRect(0, 0, size, size);

    if (items.length === 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = cssVar('--border', '#ddd');
      ctx.fill();
      ctx.fillStyle = cssVar('--muted', '#888');
      ctx.font = '600 18px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Добавьте варианты', cx, cy + 70);
      return;
    }

    const step = (Math.PI * 2) / items.length;

    items.forEach((label, i) => {
      const start = angle + i * step;
      const end   = start + step;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, end);
      ctx.closePath();
      ctx.fillStyle = colorOf(i);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.55)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Текст сектора
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(start + step / 2);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';

      const maxWidth = r - 60;
      const fontSize = items.length > 16 ? 12 : items.length > 10 ? 14 : 16;
      ctx.font = `600 ${fontSize}px -apple-system, "Segoe UI", sans-serif`;

      let text = label;
      while (ctx.measureText(text).width > maxWidth && text.length > 1) {
        text = text.slice(0, -1);
      }
      if (text !== label) text = text.slice(0, -1) + '…';

      ctx.shadowColor = 'rgba(0,0,0,.35)';
      ctx.shadowBlur = 3;
      ctx.fillText(text, r - 18, 0);
      ctx.restore();
    });

    // Ободок
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,.15)';
    ctx.lineWidth = 6;
    ctx.stroke();
  }

  function cssVar(name, fallback) {
    return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
  }

  // ---------- Аудио ----------
  let audioCtx = null;

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

  // --- Фоновая музыка ---
  let audioEl = null;

  function startMusic() {
    stopMusic();
    const vol = settings.volume / 100;
    const track = TRACKS[settings.music];
    if (vol === 0 || !track || !track.src) return;

    audioEl = new Audio(track.src);
    audioEl.loop = true;          // трек короче вращения — играет по кругу
    audioEl.volume = vol;
    audioEl.play().catch(() => { /* автоплей заблокирован до жеста */ });
  }

  function stopMusic() {
    if (audioEl) { audioEl.pause(); audioEl = null; }
  }

  // ---------- Вращение ----------
  const easeOut = (t) => 1 - Math.pow(1 - t, 4);

  function spin() {
    if (spinning || items.length === 0) return;
    if (items.length === 1) { finish(0); return; }

    spinning = true;
    spinBtn.disabled = true;

    const step   = (Math.PI * 2) / items.length;
    const winner = Math.floor(Math.random() * items.length);

    // Указатель сверху = угол -PI/2. Центр сектора winner должен прийти туда.
    const targetCenter = -Math.PI / 2;
    const base = targetCenter - (winner * step + step / 2);

    // Обороты пропорциональны длительности — короткое вращение не должно
    // крутиться так же долго, как 30-секундное.
    const turns = Math.max(3, Math.round(settings.duration * 1.6));

    const from = angle;
    let to = base + turns * Math.PI * 2;
    while (to < from + Math.PI * 4) to += Math.PI * 2;

    const duration = settings.duration * 1000;
    const startTs  = performance.now();
    let lastTick   = winner;

    startMusic();

    function frame(now) {
      const t = Math.min((now - startTs) / duration, 1);
      angle = from + (to - from) * easeOut(t);
      drawWheel();

      if (settings.sound) {
        const idx = currentIndex();
        if (idx !== lastTick) { tick(); lastTick = idx; }
      }

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        angle = ((to % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        drawWheel();
        spinning = false;
        spinBtn.disabled = false;
        stopMusic();
        finish(winner);
      }
    }
    requestAnimationFrame(frame);
  }

  function currentIndex() {
    const step = (Math.PI * 2) / items.length;
    let a = (-Math.PI / 2 - angle) % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return Math.floor(a / step) % items.length;
  }

  function finish(idx) {
    const winner = items[idx];
    history.unshift({ name: winner, at: Date.now() });
    if (settings.sound) fanfare();

    $('winner-text').textContent = winner;
    $('winner-text').style.color = colorOf(idx);
    modal.hidden = false;

    if (settings.removeWinner) {
      items.splice(idx, 1);
      angle = 0;
    }
    save();
    renderAll();
  }

  // ---------- Рендер списка ----------
  function renderItems() {
    listEl.innerHTML = '';
    $('counter').textContent = items.length;

    if (items.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Список пуст — добавьте первый вариант';
      listEl.appendChild(li);
      return;
    }

    items.forEach((name, i) => {
      const li = document.createElement('li');

      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = colorOf(i);

      const input = document.createElement('input');
      input.className = 'name';
      input.value = name;
      input.maxLength = 60;
      input.addEventListener('change', () => {
        const v = input.value.trim();
        if (v) { items[i] = v; } else { items.splice(i, 1); }
        save(); renderAll();
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });

      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '×';
      del.title = 'Удалить';
      del.addEventListener('click', () => {
        items.splice(i, 1);
        save(); renderAll();
      });

      li.append(dot, input, del);
      listEl.appendChild(li);
    });
  }

  function renderHistory() {
    histEl.innerHTML = '';
    if (history.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Пока пусто';
      histEl.appendChild(li);
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
      histEl.appendChild(li);
    });
  }

  function renderAll() {
    renderItems();
    renderHistory();
    drawWheel();
  }

  // ---------- Элементы управления ----------
  const durInput  = $('duration');
  const durOut    = $('duration-out');
  const musicSel  = $('music');
  const volInput  = $('volume');
  const volOut    = $('volume-out');
  const volField  = $('volume-field');

  function buildMusicOptions() {
    musicSel.innerHTML = '';
    Object.entries(TRACKS).forEach(([id, t]) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = t.name;
      musicSel.appendChild(opt);
    });
    musicSel.value = settings.music;
  }

  function renderControls() {
    durInput.value = settings.duration;
    durOut.textContent = settings.duration + ' с';

    volInput.value = settings.volume;
    volOut.textContent = settings.volume + '%';
    volField.hidden = settings.music === 'none';

    buildMusicOptions();
  }

  durInput.addEventListener('input', () => {
    settings.duration = clamp(parseInt(durInput.value, 10) || 5, 1, 30);
    durOut.textContent = settings.duration + ' с';
  });
  durInput.addEventListener('change', save);

  volInput.addEventListener('input', () => {
    settings.volume = clamp(parseInt(volInput.value, 10) || 0, 0, 100);
    volOut.textContent = settings.volume + '%';
    if (audioEl) audioEl.volume = settings.volume / 100;
  });
  volInput.addEventListener('change', save);

  musicSel.addEventListener('change', () => {
    settings.music = musicSel.value;
    save(); renderControls();
  });

  // ---------- События ----------
  $('add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('new-item');
    const value = input.value.trim();
    if (!value) return;
    // запятая одновременно разделяет ввод и разделяет items в URL
    value.split(',').map(s => s.trim()).filter(Boolean).forEach(v => items.push(v));
    input.value = '';
    save(); renderAll();
  });

  $('shuffle').addEventListener('click', () => {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    save(); renderAll();
  });

  $('clear').addEventListener('click', () => {
    if (items.length && !confirm('Удалить все варианты?')) return;
    items = [];
    save(); renderAll();
  });

  $('clear-history').addEventListener('click', () => {
    history = [];
    save(); renderHistory();
  });

  $('copy-link').addEventListener('click', async () => {
    const url = location.origin + location.pathname + '?' + buildQuery();
    const btn = $('copy-link');
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = 'Скопировано ✓';
    } catch (_) {
      prompt('Скопируйте ссылку:', url);
      return;
    }
    setTimeout(() => { btn.textContent = 'Скопировать ссылку'; }, 1600);
  });

  $('reset-link').addEventListener('click', () => {
    if (!confirm('Сбросить список и настройки к значениям по умолчанию?')) return;
    items = DEFAULT_ITEMS.slice();
    settings = Object.assign({}, DEFAULT_SETTINGS);
    save(); applyTheme(); renderControls(); renderAll();
  });

  spinBtn.addEventListener('click', spin);
  canvas.addEventListener('click', spin);

  $('modal-close').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') modal.hidden = true;
    const tag = document.activeElement.tagName;
    if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'BUTTON') {
      e.preventDefault();
      modal.hidden ? spin() : (modal.hidden = true);
    }
  });

  const removeChk = $('remove-winner');
  const soundChk  = $('sound-on');
  removeChk.addEventListener('change', () => { settings.removeWinner = removeChk.checked; save(); });
  soundChk.addEventListener('change',  () => { settings.sound = soundChk.checked; save(); });

  // Тема
  const themeBtn = $('theme-toggle');
  function applyTheme() {
    document.documentElement.dataset.theme = settings.theme;
    themeBtn.textContent = settings.theme === 'dark' ? '☀️' : '🌙';
    removeChk.checked = !!settings.removeWinner;
    soundChk.checked  = !!settings.sound;
    drawWheel();
  }
  themeBtn.addEventListener('click', () => {
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
    save(); applyTheme();
  });

  // Экспорт / импорт
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
        items = list.map(String).map(s => s.trim()).filter(Boolean);
        save(); renderAll();
      } catch (_) {
        alert('Не удалось прочитать файл. Ожидается JSON-массив строк.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  window.addEventListener('beforeunload', stopMusic);

  // ---------- Старт ----------
  readUrl();          // URL важнее сохранённого состояния
  applyTheme();
  renderControls();
  renderAll();
  syncUrl();
})();
