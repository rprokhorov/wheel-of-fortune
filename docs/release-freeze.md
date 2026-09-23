# Заморозка 1.6.3

1.6.3 выпущена и развёрнута в production 23 сентября 2026 года после аудита
безопасности. Функциональность заморожена; исправления безопасности выпускаются
отдельными patch-релизами.

- [Релиз v1.6.3](https://github.com/rprokhorov/wheel-of-fortune/releases/tag/v1.6.3),
  неизменяемый коммит `9e572b8a08a39983ad9e9aac1de763ed804c4133`.
- [Релизный CI](https://github.com/rprokhorov/wheel-of-fortune/actions/runs/35888345829):
  тесты, контейнерная smoke-проверка и сканирование всех трёх образов для amd64/arm64 пройдены.
- В production проверены HTTPS, авторизация, заголовки, запись и чтение событий,
  полный розыгрыш в браузере и сохранность прежней истории SQLite.
- Настройки сохранены; резервная копия, прежние образы для отката и digest
  развёрнутых образов сохранены вне репозитория.

Ниже приведена процедура выпуска и обновления других установок. Уже опубликованный
тег `v1.6.3` не следует создавать повторно, переносить или перезаписывать.

## Условия выпуска

1. Пройти `npm test`, `npm run check:release`, npm audit и контейнерную smoke-проверку
   из `SECURITY.md`. Не обходить ошибки security-сканеров.
2. Проверить описания релиза и чистое рабочее дерево; слить подготовленные коммиты в `main`.
3. Дождаться успешной публикации `main` для amd64 и arm64, включая проверки образов.
4. Создать неизменяемый тег и дождаться GitHub Release:

   ```bash
   git tag -a v1.6.3 -m 'Release v1.6.3: security freeze'
   git push origin v1.6.3
   ```

5. Убедиться, что опубликованы **три** образа с `v1.6.3`:
   `wheel-of-fortune`, `wheel-collector`, `wheel-proxy` в `ghcr.io/rprokhorov`.
   Для нового пакета `wheel-proxy` проверить возможность pull с production-сервера
   (видимость пакета или существующая авторизация registry).

## Резервная копия перед обновлением

Следующие команды выполняются **на сервере в каталоге существующего Compose**.
Они не предназначены для запуска на другой установке без проверки её расположения.
Сначала убедитесь, что `docker compose ps` показывает нужные контейнеры.

```bash
umask 077
backup_dir="../wheel-backups/pre-1.6.3-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir/caddy"
cp -p .env docker-compose.yml "$backup_dir/"
cp -p caddy/Caddyfile "$backup_dir/caddy/"
git rev-parse HEAD > "$backup_dir/git-revision"
docker compose images -q > "$backup_dir/image-ids"

docker compose exec -T collector node -e '
  const D=require("better-sqlite3");
  const source=new D(process.env.DB_PATH);
  source.backup("/data/pre-freeze.db").then(() => {
    const copy=new D("/data/pre-freeze.db", {readonly:true});
    if (copy.pragma("integrity_check", {simple:true}) !== "ok") process.exit(1);
    copy.close(); source.close();
  }).catch(() => process.exit(1));
'
docker compose cp collector:/data/pre-freeze.db "$backup_dir/analytics.db"
chmod 600 "$backup_dir/analytics.db" "$backup_dir/.env"
```

Проверьте успешный код возврата каждой команды. Сохраните резервный каталог вне
репозитория; не удаляйте старые Docker-образы до окончания проверки обновления.

## Обновление существующей установки

В 1.6.3 меняется владелец базы: коллектор работает как UID/GID `1000:1000`.
Также сайт переходит на внутренний порт `8080`, а Caddy — на образ `wheel-proxy`.
Пересоздать только сайт и коллектор недостаточно.

```bash
git pull --ff-only
git switch --detach v1.6.3
# В существующем .env заменить только TAG на v1.6.3.
# ORG_SALT, пароль, домен и остальные значения сохранить.
docker compose config --quiet
docker compose pull

# Остановить пишущие процессы перед сменой владельца тома.
docker compose stop collector rollup
docker compose run --rm --no-deps -T --user 0 --cap-add CHOWN \
  --entrypoint chown collector -R 1000:1000 /data < /dev/null
docker compose up -d --force-recreate
```

`chown` выполняется один раз для старого тома и не меняет содержимое SQLite.
Новый том сразу создаётся с правильным владельцем. Не выполняйте `down -v`:
он удаляет рабочие данные и сертификаты.

## Проверка на целевой установке

```bash
docker compose ps
curl --fail --silent --show-error https://wheel.example.com/healthz
curl --fail --silent --show-error https://wheel.example.com/api/health
curl -s -o /dev/null -w '%{http_code}\n' https://wheel.example.com/api/stats
# Последняя команда должна вернуть 401.
```

Замените домен, если используется другой. Проверьте CSP, HSTS и отсутствие прямого
доступа к 8080/8081. Откройте колесо в браузере, выполните розыгрыш, затем войдите в
панель и проверьте приход события, фильтры и журнал сессии. Пароль вводите интерактивно;
не помещайте его в командную строку или отчёт. Убедитесь, что прежняя история сохранилась.

После успешной проверки сохраните digest трёх production-образов рядом с резервной
копией. Только тогда установку можно считать переведённой на замороженный релиз.

## Откат

Схема SQLite совместима с 1.6.2; восстановление данных при обычном откате не нужно.
Верните коммит из `git-revision`, сохранённые Compose/Caddyfile и `.env`, затем:

```bash
docker compose up -d --force-recreate
```

Используйте прежний `TAG` и сохранённые образы. Старый коллектор работал как root
и сможет читать том после `chown`. Не подменяйте базу резервной копией без отдельной
необходимости: это удалит события, записанные после копирования. Восстановление
SQLite выполняется только при остановленных collector/rollup и после сохранения
текущих `.db`, `-wal` и `-shm` вне рабочего тома.

## Сопровождение после заморозки

Изменения функций не планируются. Раз в месяц проверяются уведомления Dependabot,
уязвимости образов и заполнение диска; обнаруженные проблемы исправляются patch-релизом.
Сроки хранения IP/текстов и резервных копий остаются отдельной эксплуатационной настройкой.
