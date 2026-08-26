-- Схема аналитики «Колеса фортуны».
-- Сырые события живут в events, ночной джоб схлопывает их в daily_rollup.

PRAGMA journal_mode = WAL;      -- параллельное чтение дашбордом во время записи
PRAGMA synchronous = NORMAL;    -- достаточно надёжно, заметно быстрее FULL

CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT    NOT NULL,          -- ISO 8601, UTC
  day          TEXT    NOT NULL,          -- YYYY-MM-DD, для группировок и rollup
  name         TEXT    NOT NULL,          -- тип события

  -- Идентификаторы
  visitor_id   TEXT,                      -- браузер (localStorage)
  session_id   TEXT,                      -- вкладка (sessionStorage)
  wheel_id     TEXT,                      -- «команда»: хеш отсортированного списка
  org_id       TEXT,                      -- «организация»: хеш IP + постоянная соль

  -- Сеть. ip хранится бессрочно; чистка запускается вручную,
  -- org_id при этом остаётся и аналитику не ломает.
  ip           TEXT,
  country      TEXT,
  city         TEXT,
  asn_org      TEXT,

  -- Общий контекст
  is_invited   INTEGER,                   -- пришёл по ссылке с параметрами
  items_count  INTEGER,
  app_version  TEXT,
  screen       TEXT,
  lang         TEXT,
  tz           TEXT,
  referrer_host TEXT,
  ua_browser   TEXT,
  ua_os        TEXT,
  is_mobile    INTEGER,

  -- Признаки списка: длина, язык, похоже ли на имена. JSON.
  item_profile TEXT,

  -- Сами варианты из колеса. Собираются на время внутреннего
  -- тестирования, чтобы разбирать пользовательский опыт. JSON-массив.
  items_text   TEXT,

  -- Поля конкретных событий (см. README коллектора)
  props        TEXT                       -- JSON
);

CREATE INDEX IF NOT EXISTS idx_events_day       ON events(day);
CREATE INDEX IF NOT EXISTS idx_events_name_day  ON events(name, day);
CREATE INDEX IF NOT EXISTS idx_events_visitor   ON events(visitor_id, day);
CREATE INDEX IF NOT EXISTS idx_events_wheel     ON events(wheel_id, day);
CREATE INDEX IF NOT EXISTS idx_events_org       ON events(org_id, day);
CREATE INDEX IF NOT EXISTS idx_events_session   ON events(session_id);

-- Суточные агрегаты. Живут вечно, поэтому метрики переживают любую чистку сырья.
CREATE TABLE IF NOT EXISTS daily_rollup (
  day               TEXT PRIMARY KEY,
  visitors          INTEGER NOT NULL DEFAULT 0,
  sessions          INTEGER NOT NULL DEFAULT 0,
  wheels            INTEGER NOT NULL DEFAULT 0,  -- уникальных «команд»
  orgs              INTEGER NOT NULL DEFAULT 0,  -- уникальных «организаций»
  page_views        INTEGER NOT NULL DEFAULT 0,
  spins_started     INTEGER NOT NULL DEFAULT 0,
  spins_completed   INTEGER NOT NULL DEFAULT 0,
  spins_abandoned   INTEGER NOT NULL DEFAULT 0,
  links_copied      INTEGER NOT NULL DEFAULT 0,
  invited_visits    INTEGER NOT NULL DEFAULT 0,
  items_changed     INTEGER NOT NULL DEFAULT 0,
  decisions_remove  INTEGER NOT NULL DEFAULT 0,
  decisions_keep    INTEGER NOT NULL DEFAULT 0,
  audio_blocked     INTEGER NOT NULL DEFAULT 0,
  errors            INTEGER NOT NULL DEFAULT 0,
  spins_with_music  INTEGER NOT NULL DEFAULT 0,
  avg_items         REAL,
  avg_duration_s    REAL,
  updated_at        TEXT NOT NULL
);

-- Разрезы, которые не влезают в одну строку суток
CREATE TABLE IF NOT EXISTS daily_breakdown (
  day        TEXT NOT NULL,
  dimension  TEXT NOT NULL,               -- music | country | browser | os | duration
  value      TEXT NOT NULL,
  count      INTEGER NOT NULL,
  PRIMARY KEY (day, dimension, value)
);

-- Служебная таблица: докуда досчитан rollup, чтобы джоб был идемпотентным
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
