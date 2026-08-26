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

const PORT     = Number(process.env.PORT || 8081);
const DB_PATH  = process.env.DB_PATH || '/data/analytics.db';
const SALT     = process.env.ORG_SALT || '';
const DASH_USER = process.env.DASH_USER || 'admin';
const DASH_PASS = process.env.DASH_PASS || '';

if (!SALT) {
  console.error('ORG_SALT не задан. Без постоянной соли org_id несравним между запусками.');
  process.exit(1);
}

// ---------- База ----------
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

// Миграции для баз, созданных прежними версиями схемы:
// CREATE TABLE IF NOT EXISTS не добавляет колонки в существующую таблицу.
for (const [table, column, type] of [['events', 'item_profile', 'TEXT']]) {
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
    ua_browser, ua_os, is_mobile, item_profile, props
  ) VALUES (
    @ts, @day, @name, @visitor_id, @session_id, @wheel_id, @org_id,
    @ip, @country, @city, @asn_org,
    @is_invited, @items_count, @app_version, @screen, @lang, @tz, @referrer_host,
    @ua_browser, @ua_os, @is_mobile, @item_profile, @props
  )
`);

const DASHBOARD_HTML = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');

const insertMany = db.transaction((rows) => {
  for (const row of rows) insert.run(row);
});

// ---------- Разрешённые события и поля ----------
// Белый список: всё, чего здесь нет, отбрасывается. Так случайная
// правка клиента не наполнит базу мусором.
const EVENTS = new Set([
  'page_view', 'spin_start', 'spin_complete', 'spin_abandon',
  'decision', 'items_changed', 'link_copied', 'music_changed',
  'duration_changed', 'audio_blocked', 'error'
]);

const PROP_KEYS = new Set([
  'has_params', 'load_ms', 'duration_s', 'music', 'volume', 'sound_on',
  'spin_index', 'actual_ms', 'progress_pct', 'choice', 'items_left',
  'before', 'after', 'source', 'from', 'to', 'track', 'message', 'source_line'
]);

const PROFILE_KEYS = new Set([
  'n', 'len_avg', 'len_min', 'len_max', 'looks_like_names',
  'pct_cyrillic', 'pct_latin', 'pct_emoji', 'pct_one_word'
]);

const MAX_BATCH = 50;
const MAX_BODY  = 64 * 1024;

// ---------- Утилиты ----------
const clampStr = (v, max = 120) =>
  typeof v === 'string' && v ? v.slice(0, max) : null;

const clampInt = (v, lo, hi) => {
  // null и '' Number() превращает в 0, поэтому отсеиваем их явно:
  // иначе отсутствующий параметр зажимался бы в нижнюю границу.
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, Math.round(n)));
};

// org_id: хеш IP с постоянной солью. Даёт группировку «одна сеть»,
// но в обратную сторону не разворачивается.
function orgIdFrom(ip) {
  if (!ip) return null;
  return crypto.createHash('sha256').update(SALT + '|' + ip).digest('hex').slice(0, 16);
}

function clientIp(req) {
  // Caddy проставляет X-Forwarded-For; берём первый адрес — исходный клиент.
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) {
    const first = xff.split(',')[0].trim();
    if (first) return first;
  }
  return req.socket.remoteAddress || null;
}

// Грубый разбор UA: нужен только класс браузера и ОС, не точная версия.
function parseUa(ua) {
  if (!ua) return { browser: null, os: null, mobile: 0 };
  const s = ua.toLowerCase();
  let browser = 'other';
  if (s.includes('edg/')) browser = 'edge';
  else if (s.includes('opr/') || s.includes('opera')) browser = 'opera';
  else if (s.includes('yabrowser')) browser = 'yandex';
  else if (s.includes('firefox')) browser = 'firefox';
  else if (s.includes('chrome') || s.includes('crios')) browser = 'chrome';
  else if (s.includes('safari')) browser = 'safari';

  let os = 'other';
  if (s.includes('android')) os = 'android';
  else if (s.includes('iphone') || s.includes('ipad') || s.includes('ios')) os = 'ios';
  else if (s.includes('mac os')) os = 'macos';
  else if (s.includes('windows')) os = 'windows';
  else if (s.includes('linux')) os = 'linux';

  const mobile = /mobile|android|iphone|ipad/.test(s) ? 1 : 0;
  return { browser, os, mobile };
}

function hostOf(url) {
  try {
    return new URL(url).hostname.slice(0, 120);
  } catch (_) {
    return null;
  }
}

// ---------- Обработка пачки ----------
function normalize(ev, ctx) {
  if (!ev || typeof ev !== 'object') return null;
  if (!EVENTS.has(ev.name)) return null;

  const props = {};
  if (ev.props && typeof ev.props === 'object') {
    for (const [k, v] of Object.entries(ev.props)) {
      if (!PROP_KEYS.has(k)) continue;
      if (typeof v === 'string') props[k] = v.slice(0, 200);
      else if (typeof v === 'number' && Number.isFinite(v)) props[k] = v;
      else if (typeof v === 'boolean') props[k] = v ? 1 : 0;
    }
  }

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
    props: Object.keys(props).length ? JSON.stringify(props) : null
  };
}

// Профиль списка: пропускаем только известные числовые признаки.
// Строки сюда попасть не должны — если попали, значит клиент шлёт
// не то, что мы просили, и это отбрасывается.
function normalizeProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!PROFILE_KEYS.has(k)) continue;
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = Math.round(n);
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

// ---------- Простой rate-limit в памяти ----------
// Защищает от случайного цикла в клиенте. IP здесь только в памяти.
const hits = new Map();
setInterval(() => hits.clear(), 60_000).unref();

function rateLimited(ip) {
  if (!ip) return false;
  const n = (hits.get(ip) || 0) + 1;
  hits.set(ip, n);
  return n > 600;                 // 600 запросов в минуту с одного адреса
}

// ---------- HTTP ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  res.setHeader('Cache-Control', 'no-store');

  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok\n');
  }

  if (url.pathname === '/api/e' && req.method === 'POST') {
    const ip = clientIp(req);
    if (rateLimited(ip)) {
      res.writeHead(429);
      return res.end();
    }

    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        res.writeHead(413);
        res.end();
        req.destroy();
        return;
      }
      chunks.push(c);
    });

    req.on('end', () => {
      if (res.writableEnded) return;
      // Отвечаем сразу: клиенту незачем ждать записи в базу.
      res.writeHead(204);
      res.end();

      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const list = Array.isArray(body.events) ? body.events.slice(0, MAX_BATCH) : [];
        if (!list.length) return;

        const geo = ip ? geoip.lookup(ip) : null;
        const ctx = {
          ip,
          org_id:  orgIdFrom(ip),
          country: geo ? geo.country : null,
          city:    geo && geo.city ? geo.city : null,
          asn_org: null,          // заполняется отдельным обогащением, см. README
          referrer_host: hostOf(body.referrer),
          ua: parseUa(req.headers['user-agent'])
        };

        const rows = list.map((ev) => normalize(ev, ctx)).filter(Boolean);
        if (rows.length) insertMany(rows);
      } catch (err) {
        console.error('не удалось разобрать пачку:', err.message);
      }
    });
    return;
  }

  if (url.pathname === '/api/dashboard' || url.pathname === '/api/dashboard/') {
    if (!checkAuth(req)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="stats"' });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(DASHBOARD_HTML);
  }

  // Журнал сессий: список визитов и покадровая хронология одного из них
  if (url.pathname === '/api/sessions') {
    if (!checkAuth(req)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="stats"' });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(buildSessions(url.searchParams), null, 2));
  }

  if (url.pathname === '/api/stats') {
    if (!checkAuth(req)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="stats"' });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(buildStats(url.searchParams), null, 2));
  }

  res.writeHead(404);
  res.end();
});

function checkAuth(req) {
  if (!DASH_PASS) return false;   // без пароля статистика закрыта
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const [user, pass] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
  // Сравнение постоянного времени, чтобы пароль нельзя было подобрать по таймингу
  const ok = (a, b) => {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  };
  return ok(user, DASH_USER) && ok(pass, DASH_PASS);
}

// ---------- Сводка ----------
function buildStats(params) {
  const days = clampInt(params.get('days'), 1, 365) || 30;
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const q = (sql, ...args) => db.prepare(sql).all(...args);

  return {
    period_days: days,
    since,
    totals: db.prepare(`
      SELECT
        COUNT(DISTINCT visitor_id) AS visitors,
        COUNT(DISTINCT session_id) AS sessions,
        COUNT(DISTINCT wheel_id)   AS wheels,
        COUNT(DISTINCT org_id)     AS orgs,
        SUM(name = 'page_view')      AS page_views,
        SUM(name = 'spin_complete')  AS spins,
        SUM(name = 'link_copied')    AS links_copied,
        SUM(is_invited = 1 AND name = 'page_view') AS invited_visits
      FROM events WHERE day >= ?
    `).get(since),
    // Отдельно, потому что это доля посетителей, а не число событий
    items_changed_visitors: db.prepare(`
      SELECT COUNT(DISTINCT visitor_id) AS n
      FROM events WHERE name = 'items_changed' AND day >= ?
    `).get(since).n,
    by_day: q(`
      SELECT day,
             COUNT(DISTINCT visitor_id) AS visitors,
             SUM(name = 'spin_complete') AS spins
      FROM events WHERE day >= ? GROUP BY day ORDER BY day
    `, since),
    music: q(`
      SELECT json_extract(props, '$.music') AS value, COUNT(*) AS count
      FROM events WHERE name = 'spin_start' AND day >= ?
      GROUP BY value ORDER BY count DESC
    `, since),
    decisions: q(`
      SELECT json_extract(props, '$.choice') AS value, COUNT(*) AS count
      FROM events WHERE name = 'decision' AND day >= ?
      GROUP BY value
    `, since),
    countries: q(`
      SELECT country AS value, COUNT(DISTINCT visitor_id) AS count
      FROM events WHERE day >= ? AND country IS NOT NULL
      GROUP BY country ORDER BY count DESC LIMIT 30
    `, since),
    item_profiles: q(`
      SELECT
        SUM(json_extract(item_profile, '$.looks_like_names') = 1) AS looks_like_names,
        COUNT(*) AS total,
        ROUND(AVG(json_extract(item_profile, '$.len_avg')), 1)     AS avg_len,
        ROUND(AVG(json_extract(item_profile, '$.pct_cyrillic')), 0) AS pct_cyrillic,
        ROUND(AVG(json_extract(item_profile, '$.pct_emoji')), 0)    AS pct_emoji
      FROM events
      WHERE name = 'page_view' AND item_profile IS NOT NULL AND day >= ?
    `, since),
    top_orgs: q(`
      SELECT org_id AS value,
             COUNT(DISTINCT visitor_id) AS visitors,
             SUM(name = 'spin_complete') AS spins
      FROM events WHERE day >= ? AND org_id IS NOT NULL
      GROUP BY org_id HAVING visitors > 1
      ORDER BY spins DESC LIMIT 20
    `, since)
  };
}

// ---------- Журнал сессий ----------
function buildSessions(params) {
  const sid = params.get('session');
  const visitor = params.get('visitor');

  // Хронология одной сессии — всё, что человек делал, по порядку
  if (sid) {
    const rows = db.prepare(`
      SELECT ts, name, items_count, item_profile, props
      FROM events WHERE session_id = ? ORDER BY id
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
      events: rows.map((r) => {
        const at = new Date(r.ts).getTime();
        const gap = prev === null ? 0 : Math.round((at - prev) / 1000);
        prev = at;
        return {
          ts: r.ts,
          gap_s: gap,                    // сколько думал перед этим шагом
          name: r.name,
          items_count: r.items_count,
          item_profile: r.item_profile ? JSON.parse(r.item_profile) : null,
          props: r.props ? JSON.parse(r.props) : null
        };
      })
    };
  }

  // Все визиты одного человека — чтобы видеть возвраты
  const where = visitor ? 'WHERE visitor_id = ?' : '';
  const args = visitor ? [visitor] : [];
  const limit = clampInt(params.get('limit'), 1, 200) || 50;

  const sessions = db.prepare(`
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
  `).all(...args, limit);

  return {
    count: sessions.length,
    sessions: sessions.map((s) => Object.assign(s, {
      duration_s: Math.round(
        (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 1000),
      item_profile: s.item_profile ? JSON.parse(s.item_profile) : null
    }))
  };
}

server.listen(PORT, () => {
  console.log(`коллектор слушает :${PORT}, база ${DB_PATH}`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => { db.close(); process.exit(0); });
  });
}
