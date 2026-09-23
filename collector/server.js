'use strict';

// Коллектор событий «Колеса фортуны».
// Принимает пачки событий от браузера, обогащает их гео и сетевыми
// признаками и складывает в SQLite. Внешних зависимостей минимум:
// http из стандартной библиотеки, better-sqlite3 и geoip-lite.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const geoip = require('geoip-lite');

// Чистые функции разбора и нормализации — их проверяют юнит-тесты
const {
  EVENTS, clampStr, clampInt, orgIdFrom, clientIp, parseUa, hostOf,
  normalizeItems, normalizeProfile, normalizeProps
} = require('./lib.js');

const PORT     = Number(process.env.PORT || 8081);
const HOST     = process.env.HOST || '0.0.0.0';
const DB_PATH  = process.env.DB_PATH || '/data/analytics.db';
const SALT     = process.env.ORG_SALT || '';
const DASH_USER = process.env.DASH_USER || 'admin';
const DASH_PASS = process.env.DASH_PASS || '';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const SITE_ORIGIN = process.env.SITE_ORIGIN || '';

if (!SALT) {
  console.error('ORG_SALT не задан. Без постоянной соли org_id несравним между запусками.');
  process.exit(1);
}
if (SALT.startsWith('смените_') || DASH_PASS.startsWith('смените_')) {
  console.error('Замените демонстрационные значения ORG_SALT и DASH_PASS.');
  process.exit(1);
}
if (TRUST_PROXY && !/^https:\/\/[^/]+$/.test(SITE_ORIGIN)) {
  console.error('За прокси требуется SITE_ORIGIN вида https://example.com.');
  process.exit(1);
}

// ---------- База ----------
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

// Миграции для баз, созданных прежними версиями схемы:
// CREATE TABLE IF NOT EXISTS не добавляет колонки в существующую таблицу.
for (const [table, column, type] of [
  ['events', 'item_profile', 'TEXT'],
  ['events', 'items_text', 'TEXT']
]) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!has) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    console.log(`миграция: ${table}.${column} добавлена`);
  }
}

const insert = db.prepare(`
  INSERT INTO events (
    ts, day, name, visitor_id, session_id, wheel_id, org_id,
    ip, country, city, asn_org,
    is_invited, items_count, app_version, screen, lang, tz, referrer_host,
    ua_browser, ua_os, is_mobile, item_profile, items_text, props
  ) VALUES (
    @ts, @day, @name, @visitor_id, @session_id, @wheel_id, @org_id,
    @ip, @country, @city, @asn_org,
    @is_invited, @items_count, @app_version, @screen, @lang, @tz, @referrer_host,
    @ua_browser, @ua_os, @is_mobile, @item_profile, @items_text, @props
  )
`);

// Собственный lower(): встроенный SQLite-вариант не трогает кириллицу
db.function('lower_ru', (s) => (s === null ? null : String(s).toLowerCase()));

const DASHBOARD_HTML = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
const ECHARTS_JS = fs.readFileSync(require.resolve('echarts/dist/echarts.min.js'));
const DASHBOARD_JS = fs.readFileSync(path.join(__dirname, 'dashboard.js'));

const insertMany = db.transaction((rows) => {
  for (const row of rows) insert.run(row);
});

const MAX_BATCH = 50;
const MAX_BODY  = 64 * 1024;





// ---------- Обработка пачки ----------
function normalize(ev, ctx) {
  if (!ev || typeof ev !== 'object') return null;
  if (!EVENTS.has(ev.name)) return null;

  const props = normalizeProps(ev.props);

  const now = new Date();
  return {
    ts:  now.toISOString(),
    day: now.toISOString().slice(0, 10),
    name: ev.name,

    visitor_id: clampStr(ev.visitor_id, 40),
    session_id: clampStr(ev.session_id, 40),
    wheel_id:   clampStr(ev.wheel_id, 40),
    org_id:     ctx.org_id,

    ip:      ctx.ip,
    country: ctx.country,
    city:    ctx.city,
    asn_org: ctx.asn_org,

    is_invited:  ev.is_invited ? 1 : 0,
    items_count: clampInt(ev.items_count, 0, 1000),
    app_version: clampStr(ev.app_version, 40),
    screen:      clampStr(ev.screen, 20),
    lang:        clampStr(ev.lang, 20),
    tz:          clampStr(ev.tz, 60),
    referrer_host: ctx.referrer_host,

    ua_browser: ctx.ua.browser,
    ua_os:      ctx.ua.os,
    is_mobile:  ctx.ua.mobile,

    item_profile: normalizeProfile(ev.item_profile),
    items_text: normalizeItems(ev.items_text),
    props: Object.keys(props).length ? JSON.stringify(props) : null
  };
}



// ---------- Простой rate-limit в памяти ----------
// Защищает от случайного цикла в клиенте. IP здесь только в памяти.
function limiter(limit, totalLimit) {
  const hits = new Map();
  let total = 0;
  setInterval(() => { hits.clear(); total = 0; }, 60_000).unref();
  return ip => {
    if (++total > totalLimit) return true;
    const n = (hits.get(ip) || 0) + 1;
    hits.set(ip, n);
    return n > limit;
  };
}
const eventLimited = limiter(600, 6000);
const authLimited = limiter(30, 1000);
const blockedAuth = new Set();
setInterval(() => blockedAuth.clear(), 60_000).unref();
const privatePaths = new Set(['/api/dashboard', '/api/dashboard/',
  '/api/assets/echarts.min.js', '/api/assets/dashboard.js', '/api/sessions', '/api/stats']);

// ---------- HTTP ----------
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  const reply = (status, headers = {}) => { res.writeHead(status, headers); res.end(); };
  let url;
  try {
    if (!req.url.startsWith('/') || req.url.startsWith('//')) return reply(400);
    url = new URL(req.url, 'http://localhost');
  } catch (_) { return reply(400); }
  const ip = clientIp(req, TRUST_PROXY);
  if (privatePaths.has(url.pathname)) {
    if (blockedAuth.has(ip)) return reply(429, { 'Retry-After': '60' });
    if (!checkAuth(req)) {
      if (authLimited(ip)) {
        if (blockedAuth.size < 1000) blockedAuth.add(ip);
        return reply(429, { 'Retry-After': '60' });
      }
      return reply(401, { 'WWW-Authenticate': 'Basic realm="stats", charset="UTF-8"' });
    }
  }
  if (url.pathname !== '/api/e' && !['GET', 'HEAD'].includes(req.method)) {
    return reply(405, { Allow: 'GET, HEAD' });
  }

  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok\n');
  }

  if (url.pathname === '/api/e') {
    if (req.method !== 'POST') return reply(405, { Allow: 'POST' });
    if (eventLimited(ip)) return reply(429, { 'Retry-After': '60' });
    const origin = SITE_ORIGIN || `http://${req.headers.host}`;
    if (req.headers['sec-fetch-site'] === 'cross-site' ||
        (req.headers.origin && req.headers.origin !== origin)) return reply(403);
    if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') {
      return reply(415);
    }
    if (Number(req.headers['content-length']) > MAX_BODY) return reply(413, { Connection: 'close' });

    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        if (!res.writableEnded) reply(413, { Connection: 'close' });
        chunks.length = 0;
        return;
      }
      chunks.push(c);
    });

    req.on('end', () => {
      if (res.writableEnded) return;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch (_) { return reply(400); }
      if (!body || !Array.isArray(body.events)) return reply(400);
      if (body.events.length > MAX_BATCH) return reply(413);
      try {
        const list = body.events;

        const geo = ip ? geoip.lookup(ip) : null;
        const ctx = {
          ip,
          org_id:  orgIdFrom(ip, SALT),
          country: geo ? geo.country : null,
          city:    geo && geo.city ? geo.city : null,
          asn_org: null,          // заполняется отдельным обогащением, см. README
          referrer_host: hostOf(body.referrer),
          ua: parseUa(req.headers['user-agent'])
        };

        const rows = list.map((ev) => normalize(ev, ctx)).filter(Boolean);
        if (rows.length) insertMany(rows);
        reply(204);
      } catch (_) {
        // Ошибки JSON/SQLite могут содержать пользовательские строки: не логируем их.
        console.error('не удалось сохранить пачку событий');
        reply(500);
      }
    });
    req.on('error', () => { if (!res.writableEnded) reply(400); });
    return;
  }

  if (url.pathname === '/api/dashboard' || url.pathname === '/api/dashboard/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(DASHBOARD_HTML);
  }

  if (url.pathname === '/api/assets/echarts.min.js' || url.pathname === '/api/assets/dashboard.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    return res.end(url.pathname.endsWith('/dashboard.js') ? DASHBOARD_JS : ECHARTS_JS);
  }

  // Журнал сессий: список визитов и покадровая хронология одного из них
  if (url.pathname === '/api/sessions') {
    return respondJson(() => buildSessions(url.searchParams));
  }

  if (url.pathname === '/api/stats') {
    return respondJson(() => buildStats(url.searchParams));
  }

  function respondJson(build) {
    try {
      const json = JSON.stringify(build());
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(json);
    } catch (_) {
      console.error('не удалось построить отчёт');
      reply(500);
    }
  }

  res.writeHead(404);
  res.end();
});

function checkAuth(req) {
  if (!DASH_PASS) return false;   // без пароля статистика закрыта
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const credentials = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const separator = credentials.indexOf(':');
  if (separator < 0) return false;
  const user = credentials.slice(0, separator);
  const pass = credentials.slice(separator + 1);
  // Сравнение постоянного времени, чтобы пароль нельзя было подобрать по таймингу
  const ok = (a, b) => {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  };
  const validUser = ok(user, DASH_USER);
  const validPass = ok(pass, DASH_PASS);
  return validUser && validPass;
}

// ---------- Сводка ----------
function analyticsScope(params) {
  const days = clampInt(params.get('days'), 1, 365) || 30;
  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date(Date.now() - (days - 1) * 86400_000).toISOString().slice(0, 10);
  const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const from = validDate(params.get('from')) ? params.get('from') : defaultFrom;
  const to = validDate(params.get('to')) ? params.get('to') : today;
  const start = from <= to ? from : to;
  const end = from <= to ? to : from;
  const filters = ['e.day BETWEEN ? AND ?'];
  const args = [start, end];
  const category = [
    ['country', 'e.country = ?', null],
    ['action', `EXISTS (SELECT 1 FROM events x WHERE x.session_id = e.session_id
      AND x.day BETWEEN ? AND ? AND x.name = ?)`,
      ['page_view', 'spin_start', 'items_changed', 'link_copied']],
    ['music', `EXISTS (SELECT 1 FROM events x WHERE x.session_id = e.session_id
      AND x.day BETWEEN ? AND ? AND x.name = 'spin_start'
      AND json_extract(x.props, '$.music') = ?)`, ['kalambur', 'nupogodi', 'benny', 'none']],
    ['decision', `EXISTS (SELECT 1 FROM events x WHERE x.session_id = e.session_id
      AND x.day BETWEEN ? AND ? AND x.name = 'decision'
      AND json_extract(x.props, '$.choice') = ?)`, ['remove', 'keep']]
  ];
  const active = {};
  for (const [key, sql, allowed] of category) {
    const value = (params.get(key) || '').trim();
    if (!value || value.length > 50 || (allowed && !allowed.includes(value))) continue;
    active[key] = value;
    filters.push(sql);
    if (key === 'country') args.push(value);
    else args.push(start, end, value);
  }
  return { from: start, to: end, days, active,
    cte: `WITH scoped AS (SELECT e.* FROM events e WHERE ${filters.join(' AND ')})`, args };
}

function buildStats(params) {
  const scope = analyticsScope(params);
  const q = (sql, ...extraArgs) => db.prepare(`${scope.cte} ${sql}`).all(...scope.args, ...extraArgs);
  const one = (sql) => db.prepare(`${scope.cte} ${sql}`).get(...scope.args);

  return {
    period_days: scope.days,
    since: scope.from,
    from: scope.from,
    to: scope.to,
    filters: scope.active,
    totals: one(`
      SELECT
        COUNT(DISTINCT visitor_id) AS visitors,
        COUNT(DISTINCT session_id) AS sessions,
        COUNT(DISTINCT wheel_id)   AS wheels,
        COUNT(DISTINCT org_id)     AS orgs,
        SUM(name = 'page_view')      AS page_views,
        SUM(name = 'spin_complete')  AS spins,
        SUM(name = 'link_copied')    AS links_copied,
        SUM(is_invited = 1 AND name = 'page_view') AS invited_visits
      FROM scoped
    `),
    // Отдельно, потому что это доля посетителей, а не число событий
    items_changed_visitors: one(`
      SELECT COUNT(DISTINCT visitor_id) AS n
      FROM scoped WHERE name = 'items_changed'
    `).n,
    activity: one(`
      SELECT COUNT(DISTINCT CASE WHEN name = 'page_view' THEN session_id END) AS visits,
             COUNT(DISTINCT CASE WHEN name = 'spin_start' THEN session_id END) AS spun,
             COUNT(DISTINCT CASE WHEN name = 'items_changed' THEN session_id END) AS edited,
             COUNT(DISTINCT CASE WHEN name = 'link_copied' THEN session_id END) AS shared
      FROM scoped
    `),
    by_day: q(`
      SELECT day,
             COUNT(DISTINCT visitor_id) AS visitors,
             SUM(name = 'spin_complete') AS spins
      FROM scoped GROUP BY day ORDER BY day
    `),
    music: q(`
      SELECT json_extract(props, '$.music') AS value, COUNT(*) AS count
      FROM scoped WHERE name = 'spin_start'
        AND (? IS NULL OR json_extract(props, '$.music') = ?)
      GROUP BY value ORDER BY count DESC
    `, scope.active.music || null, scope.active.music || null),
    decisions: q(`
      SELECT json_extract(props, '$.choice') AS value, COUNT(*) AS count
      FROM scoped WHERE name = 'decision'
        AND (? IS NULL OR json_extract(props, '$.choice') = ?)
      GROUP BY value
    `, scope.active.decision || null, scope.active.decision || null),
    countries: q(`
      SELECT country AS value, COUNT(DISTINCT visitor_id) AS count
      FROM scoped WHERE country IS NOT NULL
      GROUP BY country ORDER BY count DESC LIMIT 30
    `),
    item_profiles: q(`
      SELECT
        SUM(json_extract(item_profile, '$.looks_like_names') = 1) AS looks_like_names,
        COUNT(*) AS total,
        ROUND(AVG(json_extract(item_profile, '$.len_avg')), 1)     AS avg_len,
        ROUND(AVG(json_extract(item_profile, '$.pct_cyrillic')), 0) AS pct_cyrillic,
        ROUND(AVG(json_extract(item_profile, '$.pct_emoji')), 0)    AS pct_emoji
      FROM scoped
      WHERE name = 'page_view' AND item_profile IS NOT NULL
    `),
    top_items: q(`
      SELECT items_text AS value, COUNT(DISTINCT session_id) AS sessions
      FROM scoped
      WHERE items_text IS NOT NULL
      GROUP BY items_text ORDER BY sessions DESC LIMIT 25
    `),
    top_orgs: q(`
      SELECT org_id AS value,
             MAX(ip) AS ip,
             MAX(country) AS country,
             COUNT(DISTINCT visitor_id) AS visitors,
             SUM(name = 'spin_complete') AS spins
      FROM scoped WHERE org_id IS NOT NULL
      GROUP BY org_id HAVING visitors > 1
      ORDER BY spins DESC LIMIT 20
    `)
  };
}

// ---------- Журнал сессий ----------
function buildSessions(params) {
  const sid = params.get('session');
  const visitor = params.get('visitor');

  // Хронология одной сессии — всё, что человек делал, по порядку
  if (sid) {
    const rows = db.prepare(`
      SELECT ts, name, items_count, item_profile, items_text, props
      FROM events WHERE session_id = ? ORDER BY id LIMIT 1001
    `).all(sid);

    const head = db.prepare(`
      SELECT visitor_id, org_id, country, city, ua_browser, ua_os, is_mobile,
             screen, lang, tz, referrer_host, is_invited, ip
      FROM events WHERE session_id = ? ORDER BY id LIMIT 1
    `).get(sid) || {};

    let prev = null;
    return {
      session_id: sid,
      meta: head,
      truncated: rows.length > 1000,
      events: rows.slice(0, 1000).map((r) => {
        const at = new Date(r.ts).getTime();
        const gap = prev === null ? 0 : Math.round((at - prev) / 1000);
        prev = at;
        return {
          ts: r.ts,
          gap_s: gap,                    // сколько думал перед этим шагом
          name: r.name,
          items_count: r.items_count,
          item_profile: r.item_profile ? JSON.parse(r.item_profile) : null,
          items_text: r.items_text ? JSON.parse(r.items_text) : null,
          props: r.props ? JSON.parse(r.props) : null
        };
      })
    };
  }

  // Фильтры: по человеку, по адресу, по сети, по команде или по
  // содержимому списка. Пустые параметры просто не участвуют.
  const filters = [];
  const args = [];

  const addFilter = (param, sql) => {
    const value = (params.get(param) || '').trim();
    if (value) { filters.push(sql); args.push(value); }
  };

  addFilter('visitor', 'visitor_id = ?');
  addFilter('ip',      'ip = ?');
  addFilter('org',     'org_id = ?');
  addFilter('wheel',   'wheel_id = ?');

  // Свободный поиск: по подстроке в вариантах списка или началу
  // любого идентификатора — чтобы не гадать, что именно копируешь.
  const q = (params.get('q') || '').trim();
  if (q) {
    // LIKE в SQLite игнорирует регистр только для латиницы, поэтому
    // для поиска по спискам приводим обе стороны к нижнему регистру
    // средствами JS-функции lower_ru (см. db.function ниже).
    filters.push(`(
      lower_ru(items_text) LIKE lower_ru(?) OR ip LIKE ? OR
      org_id LIKE ? OR visitor_id LIKE ? OR session_id LIKE ?
    )`);
    args.push(`%${q}%`, `${q}%`, `${q}%`, `${q}%`, `${q}%`);
  }

  // Фильтр применяем к сессии целиком: если событие подошло,
  // показываем весь визит, а не одно совпавшее событие.
  const scopeEnabled = ['days', 'from', 'to', 'country', 'action', 'music', 'decision']
    .some((key) => params.has(key));
  const scope = scopeEnabled ? analyticsScope(params) : null;
  const clauses = [];
  if (scope) clauses.push('session_id IN (SELECT session_id FROM scoped)');
  if (filters.length) clauses.push(`session_id IN (SELECT session_id FROM events WHERE ${filters.join(' AND ')})`);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const limit = clampInt(params.get('limit'), 1, 200) || 50;

  const sessions = db.prepare(`
    ${scope ? scope.cte : ''}
    SELECT
      session_id,
      MIN(ts) AS started_at,
      MAX(ts) AS ended_at,
      COUNT(*) AS events,
      MAX(visitor_id) AS visitor_id,
      MAX(org_id)     AS org_id,
      MAX(country)    AS country,
      MAX(ua_browser) AS browser,
      MAX(ua_os)      AS os,
      MAX(is_mobile)  AS is_mobile,
      MAX(is_invited) AS is_invited,
      MAX(items_count) AS items_count,
      MAX(item_profile) AS item_profile,
      -- последний список за сессию, а не лексикографический максимум:
      -- показываем то, с чем человек в итоге остался
      (SELECT items_text FROM events e2
        WHERE e2.session_id = events.session_id AND e2.items_text IS NOT NULL
        ORDER BY e2.id DESC LIMIT 1) AS items_text,
      MAX(ip)           AS ip,
      SUM(name = 'spin_complete') AS spins,
      SUM(name = 'spin_abandon')  AS abandons,
      SUM(name = 'items_changed') AS edits,
      SUM(name = 'link_copied')   AS shares,
      SUM(name = 'error')         AS errors,
      SUM(name = 'audio_blocked') AS audio_blocked
    FROM events
    ${where}
    GROUP BY session_id
    ORDER BY started_at DESC
    LIMIT ?
  `).all(...(scope ? scope.args : []), ...args, limit);

  return {
    count: sessions.length,
    sessions: sessions.map((s) => Object.assign(s, {
      duration_s: Math.round(
        (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 1000),
      item_profile: s.item_profile ? JSON.parse(s.item_profile) : null,
      items_text: s.items_text ? JSON.parse(s.items_text) : null
    }))
  };
}

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.setTimeout(15_000, socket => socket.destroy());
server.maxHeadersCount = 64;
server.maxConnections = 256;
server.listen(PORT, HOST, () => {
  console.log(`коллектор слушает ${HOST}:${server.address().port}, база ${DB_PATH}`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => { db.close(); process.exit(0); });
  });
}
