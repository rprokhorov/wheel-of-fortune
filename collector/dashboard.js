'use strict';

const $ = (id) => document.getElementById(id);
const num = (n) => (n == null ? '0' : Number(n).toLocaleString('ru-RU'));
const pct = (a, b) => (!b ? '0%' : Math.round((a / b) * 100) + '%');
const esc = (s) => String(s ?? '—').replace(/[<>&"]/g, (c) => (
  { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

const TRACK_NAMES = {
  kalambur: 'Деревня дураков',
  nupogodi: 'Ну, погоди!',
  benny: 'Шоу Бенни Хилла',
  none: 'Без музыки'
};
const filters = { days: '30', from: '', to: '', action: '', music: '', decision: '', country: '' };
let metricRequest = 0;
let metricsReady = false;
const filterNames = { action: 'Действие', music: 'Музыка', decision: 'Решение', country: 'Страна' };
const decisionNames = { remove: 'Удалить победителя', keep: 'Оставить' };
const actionNames = { page_view: 'Визиты', spin_start: 'Покрутили',
  items_changed: 'Меняли список', link_copied: 'Скопировали ссылку' };
const dateLabel = (day) => day ? day.split('-').reverse().join('.') : '';

function queryFilters() {
  return new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
}

function updateControls() {
  $('date-from').value = filters.from;
  $('date-to').value = filters.to;
  $('period').value = filters.from || filters.to ? 'custom' : filters.days;
  const active = Object.entries(filterNames).filter(([key]) => filters[key]);
  const period = filters.from || filters.to
    ? `Период: ${dateLabel(filters.from) || 'начало'} — ${dateLabel(filters.to) || 'сегодня'}` : '';
  $('active-filters').innerHTML = `
    <span>${period || 'Выделите дни на графике или выберите категорию в таблице'}</span>
    ${active.map(([key, label]) => `<button data-remove="${key}"
      title="Убрать фильтр">${label}: ${esc(key === 'music' ? TRACK_NAMES[filters[key]] :
        key === 'decision' ? decisionNames[filters[key]] :
          key === 'action' ? actionNames[filters[key]] : filters[key])} ×</button>`).join('')}
    ${(active.length || period) ? '<button class="reset" id="reset-filters">Сбросить всё</button>' : ''}
    ${active.length ? '<span>Показаны сессии с выбранным действием; другие графики учитывают все действия этих сессий.</span>' : ''}`;
  document.querySelectorAll('[data-remove]').forEach((button) => {
    button.onclick = () => { filters[button.dataset.remove] = ''; refresh(); };
  });
  if ($('reset-filters')) $('reset-filters').onclick = () => {
    Object.assign(filters, { days: '30', from: '', to: '', action: '', music: '', decision: '', country: '' });
    sessionFilter = {};
    refresh();
  };
}

function refresh() {
  updateControls();
  if (tab === 'metrics') load(); else loadSessions(sessionFilter);
}

async function load(updateTrend = true) {
  const request = ++metricRequest;
  if (!metricsReady) {
    $('metric-status').hidden = false;
    $('metric-status').textContent = 'Загружаю данные…';
  }
  try {
    const trendParams = new URLSearchParams({ days: filters.days });
    for (const key of ['action', 'music', 'decision', 'country'])
      if (filters[key]) trendParams.set(key, filters[key]);
    const requests = [fetch(`/api/stats?${queryFilters()}`, { credentials: 'same-origin' })];
    if (updateTrend) requests.push(fetch(`/api/stats?${trendParams}`, { credentials: 'same-origin' }));
    const responses = await Promise.all(requests);
    if (responses.some((response) => !response.ok)) throw new Error('Не удалось получить метрики');
    const data = await responses[0].json();
    const trend = updateTrend ? await responses[1].json() : null;
    if (request === metricRequest) {
      render(data, trend, updateTrend);
      metricsReady = true;
    }
  } catch (err) {
    if (request === metricRequest) {
      $('metric-status').hidden = false;
      $('metric-status').textContent = `Не удалось загрузить данные: ${err.message}`;
    }
  }
}

const charts = {};
let trendRows = [];
let suppressZoom = false;
let zoomTimer = null;

function initCharts() {
  if (!window.echarts) throw new Error('Библиотека графиков не загрузилась');
  for (const [key, id] of Object.entries({
    trend: 'trend-chart', activity: 'activity-chart', music: 'music-chart',
    decision: 'decision-chart', country: 'country-chart'
  })) charts[key] = echarts.init($(id), null, { renderer: 'svg' });

  charts.trend.on('datazoom', () => {
    if (suppressZoom || !trendRows.length) return;
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => {
      const zoom = charts.trend.getOption().dataZoom[0];
      const index = (percent) => Math.max(0, Math.min(trendRows.length - 1,
        Math.round((percent / 100) * (trendRows.length - 1))));
      filters.from = trendRows[index(zoom.start)].day;
      filters.to = trendRows[index(zoom.end)].day;
      updateControls();
      load(false);
    }, 250);
  });

  for (const key of ['activity', 'music', 'decision', 'country']) {
    charts[key].on('click', (event) => {
      if (!event.data || !event.data.raw) return;
      const filterKey = key === 'activity' ? 'action' : key;
      filters[filterKey] = filters[filterKey] === event.data.raw ? '' : event.data.raw;
      refresh();
    });
  }
  window.addEventListener('resize', () => Object.values(charts).forEach((chart) => chart.resize()));
}

function render(d, trend, updateTrend) {
  const t = d.totals || {};
  const activity = d.activity || {};
  for (const [id, value] of Object.entries({
    'stat-visitors': t.visitors, 'stat-wheels': t.wheels, 'stat-orgs': t.orgs,
    'stat-spins': t.spins, 'stat-shares': t.links_copied,
    'stat-invited': t.invited_visits
  })) $(id).textContent = num(value);
  $('share-hint').textContent = pct(activity.shared, activity.visits) + ' сессий';
  $('invited-hint').textContent = pct(t.invited_visits, t.page_views) + ' визитов';
  $('metric-status').hidden = true;

  if (updateTrend) renderTrend(trend.by_day || []);
  renderCategory(charts.activity, [
    { value: 'page_view', count: activity.visits || 0 },
    { value: 'spin_start', count: activity.spun || 0 },
    { value: 'items_changed', count: activity.edited || 0 },
    { value: 'link_copied', count: activity.shared || 0 }
  ].filter((row) => !filters.action || row.value === filters.action),
  (value) => actionNames[value] || value, 'action', '#f7bd36');
  renderCategory(charts.music, (d.music || []).filter((row) => !filters.music || row.value === filters.music),
    (value) => TRACK_NAMES[value] || value, 'music', '#3d9ca8');
  renderCategory(charts.decision, (d.decisions || []).filter((row) => !filters.decision || row.value === filters.decision),
    (value) => decisionNames[value] || value, 'decision', '#df3f36');
  renderCategory(charts.country, (d.countries || []).filter((row) => !filters.country || row.value === filters.country),
    (value) => value, 'country', '#6a9f50');
  $('top-items').innerHTML = topItems(d.top_items || []);
  $('org-table').innerHTML = orgTable(d.top_orgs || []);
}

function renderTrend(rawDays) {
  trendRows = fillGaps(rawDays);
  const labels = trendRows.map((row) => row.day);
  const first = filters.from ? Math.max(0, labels.indexOf(filters.from)) : 0;
  const last = filters.to && labels.includes(filters.to) ? labels.indexOf(filters.to) : Math.max(0, labels.length - 1);
  const denominator = Math.max(1, labels.length - 1);
  suppressZoom = true;
  charts.trend.setOption({
    animationDurationUpdate: 250,
    color: ['#3d9ca8', '#df3f36'],
    legend: { top: 0, data: ['Посетители', 'Розыгрыши'] },
    tooltip: { trigger: 'axis' },
    grid: { left: 46, right: 22, top: 38, bottom: 88 },
    xAxis: { type: 'category', data: labels, boundaryGap: true,
      axisLabel: { formatter: (value) => value.slice(8) + '.' + value.slice(5, 7), hideOverlap: true } },
    yAxis: { type: 'value', minInterval: 1 },
    dataZoom: [
      { type: 'slider', xAxisIndex: 0, bottom: 17, height: 26,
        start: first / denominator * 100, end: last / denominator * 100,
        minSpan: 100 / Math.max(1, labels.length) },
      { type: 'inside', xAxisIndex: 0 }
    ],
    series: [
      { name: 'Посетители', type: 'bar', data: trendRows.map((row) => row.visitors || 0),
        barMaxWidth: 20, itemStyle: { borderRadius: [3, 3, 0, 0] } },
      { name: 'Розыгрыши', type: 'bar', data: trendRows.map((row) => row.spins || 0),
        barMaxWidth: 20, itemStyle: { borderRadius: [3, 3, 0, 0] } }
    ]
  }, { notMerge: true });
  suppressZoom = false;
  $('day-table').innerHTML = dayTable(trendRows);
}

function renderCategory(chart, rows, labelFn, filterKey, color) {
  const shown = rows.slice(0, 15).reverse();
  const element = chart.getDom();
  element.style.height = `${Math.max(230, shown.length * 32 + 60)}px`;
  chart.resize();
  chart.setOption({
    animationDurationUpdate: 250,
    grid: { left: 145, right: 34, top: 12, bottom: 16 },
    tooltip: { trigger: 'item', formatter: (params) => `${esc(params.name)}: ${num(params.value)}` },
    xAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#8a7a68' }, splitLine: { lineStyle: { color: '#e2dbcd' } } },
    yAxis: { type: 'category', data: shown.map((row) => labelFn(row.value)),
      axisLabel: { width: 135, overflow: 'truncate', color: '#2d2723' } },
    series: [{ type: 'bar', barMaxWidth: 20,
      data: shown.map((row) => ({ name: labelFn(row.value), value: row.count || 0,
        raw: row.value,
        itemStyle: { color: filterKey && filters[filterKey] === row.value ? '#a92227' : color,
          borderRadius: [0, 3, 3, 0] } })) }]
  }, { notMerge: true });
}

function topItems(rows) {
  if (!rows.length) return '<p class="empty">Пока нет данных</p>';
  return `<table>
    <tr><th>Список</th><th class="num">Сессий</th></tr>
    ${rows.map((r) => {
      let items = [];
      try { items = JSON.parse(r.value) || []; } catch (_) { items = []; }
      return `<tr>
        <td><div class="items-list">${items.map((x) => `<span>${esc(x)}</span>`).join('')}</div></td>
        <td class="num">${num(r.sessions)}</td>
      </tr>`;
    }).join('')}
  </table>`;
}

function orgTable(rows) {
  if (!rows.length) return '<p class="empty">Пока нет организаций, где колесом пользуется больше одного человека</p>';
  return `<table>
    <tr><th>IP</th><th>Идентификатор сети</th><th class="num">Участники</th><th class="num">Розыгрыши</th></tr>
    ${rows.map((r) => `<tr>
      <td><code class="ip">${esc(r.ip)}</code> ${esc(r.country || '')}</td>
      <td><code>${esc(r.value)}</code></td>
      <td class="num">${num(r.visitors)}</td>
      <td class="num">${num(r.spins)}</td>
    </tr>`).join('')}
  </table>`;
}

// Дозаполнение пропущенных дат нулями
function fillGaps(days) {
  if (days.length < 2) return days;
  const byDay = new Map(days.map((d) => [d.day, d]));
  const out = [];
  const cursor = new Date(days[0].day + 'T00:00:00Z');
  const last = new Date(days[days.length - 1].day + 'T00:00:00Z');

  // Ограничение на всякий случай: за год цикл всё равно не уйдёт
  for (let guard = 0; cursor <= last && guard < 400; guard++) {
    const key = cursor.toISOString().slice(0, 10);
    out.push(byDay.get(key) || { day: key, visitors: 0, spins: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

// Таблица под графиком: точные числа по каждому дню, если нужно свериться
function dayTable(days) {
  const rows = [...days].reverse();
  return `<details class="day-table">
    <summary><span>Числа по дням</span><i>показать</i></summary>
    <table>
      <tr><th>Дата</th><th class="num">Посетители</th><th class="num">Розыгрыши</th></tr>
      ${rows.map((d) => `<tr>
        <td>${esc(d.day)}</td>
        <td class="num">${num(d.visitors)}</td>
        <td class="num">${num(d.spins)}</td>
      </tr>`).join('')}
    </table>
  </details>`;
}

// ---------- Сессии ----------

const EVENT_LABELS = {
  page_view: 'зашёл на сайт',
  spin_start: 'запустил вращение',
  spin_complete: 'розыгрыш завершён',
  spin_abandon: 'ушёл во время вращения',
  decision: 'решение',
  items_changed: 'правил список',
  link_copied: 'скопировал ссылку',
  music_changed: 'сменил музыку',
  duration_changed: 'сменил длительность',
  audio_blocked: 'музыка не запустилась',
  error: 'ошибка'
};

const SOURCE_LABELS = {
  apply: 'вручную', import: 'импорт', shuffle: 'перемешал', remove: 'удалил победителя'
};

function stepDetail(e) {
  const p = e.props || {};
  switch (e.name) {
    case 'page_view':
      return (p.has_params ? 'по ссылке с параметрами' : 'напрямую') +
             (e.items_count ? `, ${e.items_count} вариантов` : '');
    case 'spin_start':
      return `${p.duration_s} с, ${TRACK_NAMES[p.music] || p.music}` +
             (p.sound_on ? '' : ', звук выключен');
    case 'spin_complete':
      return `${Math.round((p.actual_ms || 0) / 1000)} с`;
    case 'spin_abandon':
      return `дошёл до ${p.progress_pct}%`;
    case 'decision':
      return (p.choice === 'remove' ? 'удалить победителя' : 'оставить') +
             `, осталось ${p.items_left}`;
    case 'items_changed':
      return `${p.before} → ${p.after} (${SOURCE_LABELS[p.source] || p.source})`;
    case 'music_changed':
      return `${TRACK_NAMES[p.from] || p.from} → ${TRACK_NAMES[p.to] || p.to}`;
    case 'duration_changed':
      return `${p.to} с`;
    case 'audio_blocked':
      return TRACK_NAMES[p.track] || p.track || '';
    case 'error':
      return p.message || '';
    default:
      return '';
  }
}

function profileHint(pr) {
  if (!pr) return '';
  const bits = [];
  if (pr.looks_like_names) bits.push('похоже на имена');
  else if (pr.len_avg > 20) bits.push('длинные формулировки');
  if (pr.pct_emoji > 30) bits.push('с эмодзи');
  if (pr.pct_cyrillic > 60) bits.push('кириллица');
  else if (pr.pct_latin > 60) bits.push('латиница');
  bits.push(`≈${pr.len_avg} симв.`);
  return bits.join(' · ');
}

const hhmm = (ts) => new Date(ts).toLocaleString('ru-RU',
  { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

let sessionFilter = {};

async function loadSessions(filter) {
  sessionFilter = filter || {};
  const root = $('sessions-view');
  root.innerHTML = '<p class="empty">Загружаю…</p>';
  try {
    const qs = queryFilters();
    Object.entries(sessionFilter).filter(([, value]) => value)
      .forEach(([key, value]) => qs.set(key, value));
    const res = await fetch(`/api/sessions?${qs}`,
      { credentials: 'same-origin' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    renderSessions(await res.json());
  } catch (err) {
    root.innerHTML = `<div class="err">Не удалось загрузить: ${esc(err.message)}</div>`;
  }
}

// Метки активных фильтров — чтобы было видно, что именно отфильтровано
const FILTER_LABELS = {
  q: 'поиск', visitor: 'посетитель', ip: 'IP', org: 'сеть', wheel: 'команда'
};

function renderSessions(d) {
  const rows = d.sessions || [];
  const active = Object.entries(sessionFilter).filter(([, v]) => v);

  $('sessions-view').innerHTML = `
    <div class="filter">
      <input id="q" placeholder="IP, хеш сети, visitor_id или слово из списка"
             value="${esc(sessionFilter.q || '')}">
      <button class="tag" id="q-apply" style="cursor:pointer;padding:7px 13px">Найти</button>
      ${active.length ? '<button class="tag" id="q-clear" style="cursor:pointer;padding:7px 13px">Сбросить</button>' : ''}
    </div>
    ${active.length ? `<p class="meta-line" style="padding-left:0">
      Фильтр: ${active.map(([k, v]) =>
        `<span class="tag">${esc(FILTER_LABELS[k] || k)}: ${esc(v)}</span>`).join(' ')}
      · найдено сессий: ${rows.length}
    </p>` : ''}
    <div class="panel">
      ${rows.length ? rows.map(sessionRow).join('')
        : '<p class="empty">Ничего не найдено</p>'}
    </div>`;

  $('q-apply').onclick = () => loadSessions({ q: $('q').value.trim() });
  $('q').onkeydown = (e) => { if (e.key === 'Enter') $('q-apply').click(); };
  if ($('q-clear')) $('q-clear').onclick = () => loadSessions({});

  document.querySelectorAll('.sess__head').forEach((el) => {
    el.onclick = () => toggleSession(el.dataset.sid);
  });

  // Клик по IP, сети или посетителю — фильтр по этому значению
  document.querySelectorAll('[data-filter]').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      loadSessions({ [el.dataset.filter]: el.dataset.value });
    };
  });
}

function sessionRow(s) {
  const tags = [];
  if (s.is_invited) tags.push('<span class="tag tag--invited">по ссылке</span>');
  if (s.edits) tags.push(`<span class="tag">правок: ${s.edits}</span>`);
  if (s.shares) tags.push('<span class="tag tag--share">поделился</span>');
  if (s.abandons) tags.push(`<span class="tag">ушёл: ${s.abandons}</span>`);
  if (s.audio_blocked) tags.push('<span class="tag tag--err">музыка не пошла</span>');
  if (s.errors) tags.push(`<span class="tag tag--err">ошибок: ${s.errors}</span>`);
  const pr = profileHint(s.item_profile);
  if (pr) tags.push(`<span class="tag">${esc(pr)}</span>`);

  return `<div class="sess">
    <div class="sess__head" data-sid="${esc(s.session_id)}">
      <span class="sess__when">${hhmm(s.started_at)}</span>
      <span class="sess__tags">${tags.join('')}</span>
      <span class="step__det">
        <code class="ip clickable" data-filter="ip" data-value="${esc(s.ip || '')}"
              title="Показать все визиты с этого адреса">${esc(s.ip || '—')}</code> ·
        ${esc(s.country || '—')} · ${esc(s.browser || '—')} · ${s.is_mobile ? 'моб.' : 'десктоп'}
      </span>
      <span><span class="dots">${'●'.repeat(Math.min(s.spins || 0, 8))}</span> ${s.duration_s}с</span>
    </div>
    ${s.items_text && s.items_text.length ? `
      <div class="items-list" style="padding:0 4px 8px 100px">
        ${s.items_text.map((x) => `<span>${esc(x)}</span>`).join('')}
      </div>` : ''}
    <div class="sess__body" id="body-${esc(s.session_id)}" hidden></div>
  </div>`;
}

async function toggleSession(sid) {
  const box = $('body-' + sid);
  if (!box) return;
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '<p class="empty">Загружаю…</p>';

  try {
    const res = await fetch(`/api/sessions?session=${encodeURIComponent(sid)}`,
      { credentials: 'same-origin' });
    const d = await res.json();
    const m = d.meta || {};
    box.innerHTML = `
      <p class="meta-line" style="padding-left:0">
        IP <code class="ip clickable" data-filter="ip" data-value="${esc(m.ip || '')}">${esc(m.ip)}</code> ·
        visitor <code class="clickable" data-filter="visitor" data-value="${esc(m.visitor_id || '')}">${esc(m.visitor_id)}</code> ·
        сеть <code class="clickable" data-filter="org" data-value="${esc(m.org_id || '')}">${esc(m.org_id)}</code> ·
        ${esc(m.city || m.country || '—')} · ${esc(m.os || '')} ${esc(m.browser || '')} ·
        ${esc(m.screen || '')} · ${esc(m.tz || '')}
        ${m.referrer_host ? ' · из ' + esc(m.referrer_host) : ''}
      </p>
      ${d.truncated ? '<p class="meta-line">Показаны первые 1000 событий этой сессии.</p>' : ''}
      ${(d.events || []).map((e) => `
        <div class="step">
          <span class="step__t">${new Date(e.ts).toLocaleTimeString('ru-RU')}</span>
          <span class="step__gap">${e.gap_s ? '+' + e.gap_s + 'с' : ''}</span>
          <span>
            <span class="step__name">${esc(EVENT_LABELS[e.name] || e.name)}</span>
            <span class="step__det">${esc(stepDetail(e))}</span>
            ${e.name === 'items_changed' && e.items_text ? `
              <div class="items-list">
                ${e.items_text.map((x) => `<span>${esc(x)}</span>`).join('')}
              </div>` : ''}
          </span>
        </div>`).join('')}`;
  } catch (err) {
    box.innerHTML = `<div class="err">${esc(err.message)}</div>`;
  }
}

// ---------- Вкладки ----------
let tab = 'metrics';

function switchTab(next) {
  tab = next;
  $('tab-metrics').classList.toggle('on', tab === 'metrics');
  $('tab-sessions').classList.toggle('on', tab === 'sessions');
  $('metrics-view').hidden = tab !== 'metrics';
  $('sessions-view').hidden = tab !== 'sessions';
  if (tab === 'metrics') Object.values(charts).forEach((chart) => chart.resize());
  refresh();
}

$('tab-metrics').onclick = () => switchTab('metrics');
$('tab-sessions').onclick = () => switchTab('sessions');
$('period').addEventListener('change', () => {
  if ($('period').value === 'custom') return;
  filters.days = $('period').value;
  filters.from = '';
  filters.to = '';
  refresh();
});
for (const [id, key] of [['date-from', 'from'], ['date-to', 'to']]) {
  $(id).addEventListener('change', () => {
    filters[key] = $(id).value;
    if (filters.from && filters.to && filters.from > filters.to)
      [filters.from, filters.to] = [filters.to, filters.from];
    refresh();
  });
}
try {
  initCharts();
  refresh();
} catch (error) {
  $('metric-status').textContent = error.message;
}
