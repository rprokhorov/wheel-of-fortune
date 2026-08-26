'use strict';

// Ночной джоб: схлопывает сырые события в суточные агрегаты.
// Агрегаты живут вечно, поэтому метрики переживают любую чистку сырья.
// Джоб идемпотентен — повторный запуск за тот же день просто перезапишет строку.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || '/data/analytics.db';
// 0 означает «хранить IP бессрочно»; чистка запускается вручную.
const IP_RETENTION_DAYS = Number(process.env.IP_RETENTION_DAYS || 0);

const db = new Database(DB_PATH);
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

const dayArg = process.argv[2];
const days = dayArg ? [dayArg] : pendingDays();

function pendingDays() {
  // Пересчитываем всё, что появилось после последнего успешного rollup.
  const last = db.prepare(`SELECT value FROM meta WHERE key = 'rollup_until'`).get();
  const rows = db.prepare(`
    SELECT DISTINCT day FROM events
    WHERE day < date('now') AND (? IS NULL OR day > ?)
    ORDER BY day
  `).all(last ? last.value : null, last ? last.value : null);
  return rows.map((r) => r.day);
}

const upsertRollup = db.prepare(`
  INSERT INTO daily_rollup (
    day, visitors, sessions, wheels, orgs, page_views,
    spins_started, spins_completed, spins_abandoned, links_copied,
    invited_visits, items_changed, decisions_remove, decisions_keep,
    audio_blocked, errors, spins_with_music, avg_items, avg_duration_s, updated_at
  ) VALUES (
    @day, @visitors, @sessions, @wheels, @orgs, @page_views,
    @spins_started, @spins_completed, @spins_abandoned, @links_copied,
    @invited_visits, @items_changed, @decisions_remove, @decisions_keep,
    @audio_blocked, @errors, @spins_with_music, @avg_items, @avg_duration_s, @updated_at
  )
  ON CONFLICT(day) DO UPDATE SET
    visitors = excluded.visitors, sessions = excluded.sessions,
    wheels = excluded.wheels, orgs = excluded.orgs,
    page_views = excluded.page_views,
    spins_started = excluded.spins_started,
    spins_completed = excluded.spins_completed,
    spins_abandoned = excluded.spins_abandoned,
    links_copied = excluded.links_copied,
    invited_visits = excluded.invited_visits,
    items_changed = excluded.items_changed,
    decisions_remove = excluded.decisions_remove,
    decisions_keep = excluded.decisions_keep,
    audio_blocked = excluded.audio_blocked,
    errors = excluded.errors,
    spins_with_music = excluded.spins_with_music,
    avg_items = excluded.avg_items,
    avg_duration_s = excluded.avg_duration_s,
    updated_at = excluded.updated_at
`);

const clearBreakdown = db.prepare(`DELETE FROM daily_breakdown WHERE day = ?`);
const insertBreakdown = db.prepare(`
  INSERT INTO daily_breakdown (day, dimension, value, count)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(day, dimension, value) DO UPDATE SET count = excluded.count
`);

function rollupDay(day) {
  const row = db.prepare(`
    SELECT
      COUNT(DISTINCT visitor_id) AS visitors,
      COUNT(DISTINCT session_id) AS sessions,
      COUNT(DISTINCT wheel_id)   AS wheels,
      COUNT(DISTINCT org_id)     AS orgs,
      SUM(name = 'page_view')       AS page_views,
      SUM(name = 'spin_start')      AS spins_started,
      SUM(name = 'spin_complete')   AS spins_completed,
      SUM(name = 'spin_abandon')    AS spins_abandoned,
      SUM(name = 'link_copied')     AS links_copied,
      SUM(name = 'page_view' AND is_invited = 1) AS invited_visits,
      SUM(name = 'items_changed')   AS items_changed,
      SUM(name = 'decision' AND json_extract(props, '$.choice') = 'remove') AS decisions_remove,
      SUM(name = 'decision' AND json_extract(props, '$.choice') = 'keep')   AS decisions_keep,
      SUM(name = 'audio_blocked')   AS audio_blocked,
      SUM(name = 'error')           AS errors,
      SUM(name = 'spin_start' AND json_extract(props, '$.music') != 'none') AS spins_with_music,
      AVG(CASE WHEN name = 'page_view' THEN items_count END) AS avg_items,
      AVG(CASE WHEN name = 'spin_start'
               THEN json_extract(props, '$.duration_s') END) AS avg_duration_s
    FROM events WHERE day = ?
  `).get(day);

  upsertRollup.run(Object.assign({ day, updated_at: new Date().toISOString() },
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === null ? null : v]))));

  // Разрезы
  clearBreakdown.run(day);
  const dims = {
    music: `SELECT json_extract(props, '$.music') AS v, COUNT(*) AS c
            FROM events WHERE name = 'spin_start' AND day = ? GROUP BY v`,
    duration: `SELECT json_extract(props, '$.duration_s') AS v, COUNT(*) AS c
               FROM events WHERE name = 'spin_start' AND day = ? GROUP BY v`,
    country: `SELECT country AS v, COUNT(DISTINCT visitor_id) AS c
              FROM events WHERE day = ? AND country IS NOT NULL GROUP BY v`,
    browser: `SELECT ua_browser AS v, COUNT(DISTINCT visitor_id) AS c
              FROM events WHERE day = ? AND ua_browser IS NOT NULL GROUP BY v`,
    os: `SELECT ua_os AS v, COUNT(DISTINCT visitor_id) AS c
         FROM events WHERE day = ? AND ua_os IS NOT NULL GROUP BY v`
  };

  for (const [dim, sql] of Object.entries(dims)) {
    for (const r of db.prepare(sql).all(day)) {
      if (r.v === null) continue;
      insertBreakdown.run(day, dim, String(r.v), r.c);
    }
  }

  return row;
}

const run = db.transaction(() => {
  for (const day of days) {
    const r = rollupDay(day);
    console.log(`${day}: посетителей ${r.visitors}, розыгрышей ${r.spins_completed}`);
  }
  if (days.length) {
    db.prepare(`
      INSERT INTO meta (key, value) VALUES ('rollup_until', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(days[days.length - 1]);
  }
});

run();

// Чистка сырых IP. При IP_RETENTION_DAYS = 0 не делаем ничего:
// org_id уже посчитан при записи, поэтому удаление IP аналитику не ломает.
if (IP_RETENTION_DAYS > 0) {
  const cutoff = new Date(Date.now() - IP_RETENTION_DAYS * 86400000)
    .toISOString().slice(0, 10);
  const res = db.prepare(`UPDATE events SET ip = NULL WHERE ip IS NOT NULL AND day < ?`).run(cutoff);
  if (res.changes) console.log(`очищено IP у ${res.changes} событий старше ${cutoff}`);
}

db.exec('PRAGMA optimize');
db.close();
console.log(days.length ? 'rollup завершён' : 'нечего пересчитывать');
