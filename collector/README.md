# Аналитика «Колеса фортуны»

Свой сбор продуктовых метрик: лёгкий коллектор на Node + SQLite, без внешних
сервисов и без cookie. Живёт на том же домене, что и сайт, поэтому блокировщики
рекламы запросы не режут.

```
браузер → POST /api/e (пачками, sendBeacon)
            ↓
      collector (~30 МБ RAM)
            ↓
      SQLite (WAL) → ночной rollup → /api/stats
```

## Идентификаторы

Аккаунтов в продукте нет, поэтому «пользователь» и «команда» собираются
косвенно. Ни один идентификатор не привязан к личности.

| Поле | Что это | Как получен | Живёт |
|---|---|---|---|
| `visitor_id` | браузер | UUID в `localStorage` | до очистки браузера |
| `session_id` | вкладка | UUID в `sessionStorage` | до закрытия вкладки |
| `wheel_id` | «команда» | SHA-256 отсортированного списка | пока список не менялся |
| `org_id` | «организация» | SHA-256 от IP + постоянная соль | пока не сменился IP |

`wheel_id` считается от **отсортированного** списка, поэтому перемешивание не
создаёт новую «команду». Сами варианты никуда не отправляются — только хеш.

`org_id` даёт группировку «люди из одного офиса»: несколько сотрудников выходят
в интернет через один внешний IP. Обратно в IP хеш не разворачивается.

Связка `org_id` + `wheel_id` — самый точный сигнал: несколько человек с одной
сетью и одним списком почти наверняка одна команда за одним ритуалом.

## События

Общий конверт у всех: `ts`, `visitor_id`, `session_id`, `wheel_id`, `org_id`,
`is_invited`, `items_count`, `app_version`, `screen`, `lang`, `tz`,
`referrer_host`, `ua_browser`, `ua_os`, `is_mobile`, гео.

| Событие | Поля в `props` | Зачем |
|---|---|---|
| `page_view` | `has_params`, `load_ms` | визиты, доля пришедших по ссылке |
| `spin_start` | `duration_s`, `music`, `volume`, `sound_on`, `spin_index` | настройки на момент запуска |
| `spin_complete` | `spin_index`, `actual_ms` | доведённые до конца розыгрыши |
| `spin_abandon` | `progress_pct`, `spin_index` | ушли, не досмотрев |
| `decision` | `choice`, `items_left` | сценарий: раздача без повторов или просто рандом |
| `items_changed` | `before`, `after`, `source` | признак «пришёл со своей задачей» |
| `link_copied` | `items_count`, `music` | ключевая метрика виральности |
| `music_changed` | `from`, `to` | выбирают ли музыку осознанно |
| `duration_changed` | `to` | двигают ли ползунок |
| `audio_blocked` | `track` | у скольких людей не сработал автоплей |
| `error` | `message`, `source_line` | здоровье |

Типы событий и ключи `props` проверяются по белому списку: всё, чего нет
в списке, отбрасывается на входе.

## Хранение

Две таблицы. `events` — сырьё; `daily_rollup` и `daily_breakdown` — суточные
агрегаты, которые живут вечно, поэтому метрики переживают любую чистку сырья.

**IP хранится бессрочно** (`IP_RETENTION_DAYS=0`). Чистка запускается вручную,
когда понадобится:

```bash
# поставить срок в днях и дать ночному джобу подчистить самому
docker compose exec collector sh -c 'IP_RETENTION_DAYS=90 node rollup.js'

# или разово обнулить всё сразу
docker compose exec collector node -e "
  const D=require('better-sqlite3');
  const db=new D(process.env.DB_PATH);
  console.log(db.prepare('UPDATE events SET ip = NULL').run());
"
```

`org_id` считается **в момент записи**, а не выводится из IP при чтении, поэтому
удаление IP не ломает ни группировку, ни историю. Обратный порядок не сработал
бы, поэтому пишем оба поля сразу.

## Приватность

- Не собираем содержимое списков — только количество и хеш
- `localStorage` вместо cookie
- Уважаем Do Not Track, есть явный отказ через `?analytics=off`
- Статистика закрыта Basic Auth

## Эксплуатация

```bash
docker compose logs -f collector
docker compose exec collector node rollup.js            # досчитать вручную
docker compose exec collector node rollup.js 2026-08-26 # пересчитать день
curl -u admin:ПАРОЛЬ https://wheel.rprokhorov.ru/api/stats?days=30
```

Резервная копия базы (безопасно при работающем коллекторе):

```bash
docker compose exec collector node -e "
  const D=require('better-sqlite3');
  new D(process.env.DB_PATH).backup('/data/backup.db').then(()=>console.log('готово'));
"
docker compose cp collector:/data/backup.db ./backup-$(date +%F).db
```

## Переменные окружения

| Переменная | Значение |
|---|---|
| `ORG_SALT` | постоянная соль для `org_id`, **менять нельзя** |
| `DASH_USER` / `DASH_PASS` | доступ к `/api/stats` |
| `IP_RETENTION_DAYS` | `0` — хранить IP бессрочно |
| `DB_PATH` | путь к базе, по умолчанию `/data/analytics.db` |

## Что не покрыто

`asn_org` (название провайдера или компании) в схеме есть, но пока не
заполняется: для него нужна база ASN или reverse-DNS в момент запроса.
Гео определяется по `geoip-lite` и **приблизительно** — VPN и корпоративные
прокси смещают картину, так что для «в каких странах вообще пользуются» этого
хватает, а для точных выводов нет.
