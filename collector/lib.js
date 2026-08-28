'use strict';

// Чистые функции коллектора: разбор, нормализация, обогащение.
// Вынесены из server.js, чтобы их можно было проверять юнит-тестами
// без запуска HTTP-сервера и подключения к базе.

const crypto = require('crypto');

// Белый список событий: всё, чего здесь нет, отбрасывается на входе,
// поэтому случайная правка клиента не наполнит базу мусором.
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

const MAX_ITEMS = 30;
const MAX_ITEM_LENGTH = 60;

/** Обрезать строку; пустое и нестроковое дают null. */
const clampStr = (v, max = 120) =>
  (typeof v === 'string' && v ? v.slice(0, max) : null);

/** Зажать число в диапазон; всё нечисловое даёт null. */
function clampInt(value, lo, hi) {
  // Number() слишком покладист: [], '  ' и false он превращает в 0,
  // из-за чего отсутствующий параметр молча стал бы минимумом.
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

/**
 * org_id — хеш IP с постоянной солью. Даёт группировку «одна сеть»,
 * но обратно в IP не разворачивается.
 */
function orgIdFrom(ip, salt) {
  if (!ip) return null;
  return crypto.createHash('sha256')
    .update(salt + '|' + ip)
    .digest('hex')
    .slice(0, 16);
}

/** IP клиента: Caddy проставляет X-Forwarded-For, первый адрес — исходный. */
function clientIp(req) {
  const xff = req && req.headers && req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) {
    const first = xff.split(',')[0].trim();
    if (first) return first;
  }
  return (req && req.socket && req.socket.remoteAddress) || null;
}

/** Грубый разбор UA: нужен класс браузера и ОС, не точная версия. */
function parseUa(ua) {
  if (!ua) return { browser: null, os: null, mobile: 0 };
  const s = String(ua).toLowerCase();

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

  return { browser, os, mobile: /mobile|android|iphone|ipad/.test(s) ? 1 : 0 };
}

/** Домен реферера; мусорный адрес даёт null, а не исключение. */
function hostOf(url) {
  try {
    return new URL(url).hostname.slice(0, 120);
  } catch (_) {
    return null;
  }
}

/**
 * Варианты из колеса. Ограничиваем число и длину, чтобы одно событие
 * не раздулось: 30 — предел списка в самом продукте.
 */
function normalizeItems(raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  const out = raw
    .slice(0, MAX_ITEMS)
    .map((s) => String(s).trim().slice(0, MAX_ITEM_LENGTH))
    .filter(Boolean);
  return out.length ? JSON.stringify(out) : null;
}

/**
 * Профиль списка: пропускаем только известные числовые признаки.
 * Строки сюда попасть не должны — если попали, значит клиент шлёт
 * не то, что мы просили, и это отбрасывается.
 */
function normalizeProfile(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!PROFILE_KEYS.has(k)) continue;
    const n = Number(v);
    if (typeof v !== 'string' && Number.isFinite(n)) out[k] = Math.round(n);
    else if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) {
      out[k] = Math.round(Number(v));
    }
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

/** Отфильтровать props по белому списку ключей. */
function normalizeProps(raw) {
  const props = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      if (!PROP_KEYS.has(k)) continue;
      if (typeof v === 'string') props[k] = v.slice(0, 200);
      else if (typeof v === 'number' && Number.isFinite(v)) props[k] = v;
      else if (typeof v === 'boolean') props[k] = v ? 1 : 0;
    }
  }
  return props;
}

module.exports = {
  EVENTS, PROP_KEYS, PROFILE_KEYS, MAX_ITEMS, MAX_ITEM_LENGTH,
  clampStr, clampInt, orgIdFrom, clientIp, parseUa, hostOf,
  normalizeItems, normalizeProfile, normalizeProps
};
