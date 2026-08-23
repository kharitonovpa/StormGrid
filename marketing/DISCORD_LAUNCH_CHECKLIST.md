# Discord Activity: чеклист запуска (ручные шаги)

Код (адаптер `discord.ts`, эндпоинт `POST /api/auth/discord`, автоматч по инстансу, хост `discord.wheee.io` в `deploy/nginx.conf`) уже смержен. Этот документ — только то, что нельзя сделать из кода: DNS, сертификат, Developer Portal, env, dev-петля, гейт по латентности, прод-проверка. Все технические факты про Discord сверены с `marketing/DISCORD_ACTIVITIES_INTEGRATION_RESEARCH.md` — ссылки на разделы даны по ходу.

Выполнять по порядку — пункты 1–4 блокируют друг друга, 5 нужен только на время разработки, 6–7 — гейты перед объявлением фичи готовой, 8 — отдельный трек, можно параллельно.

**Проще через визард**: `bash scripts/discord-launch-wizard.sh` — интерактивно проводит по всем пунктам (открывает нужные страницы, сам проверяет DNS/сертификат/хост, заливает ключи на VPS по ssh, помнит введённое между перезапусками). Порядок в визарде чуть отличается: деплой идёт до сертификата, потому что до пересборки nginx на VPS не знает хост `discord.wheee.io` и ACME-челлендж на него не отработает.

---

## 1. DNS

A-запись `discord.wheee.io` → `64.176.74.237` (Польский VPS, тот же сервер, что держит `api.wheee.io`; см. `PL_VPS_HOST` в `deploy/deploy-all.sh` и `deploy/deploy.sh`).

Проверить после прописки: `dig +short discord.wheee.io` должен вернуть `64.176.74.237`.

## 2. Сертификат

Все три домена (`ru.wheee.io`, `api.wheee.io`, `discord.wheee.io`) в `deploy/nginx.conf` используют один и тот же сертификат `/etc/letsencrypt/live/ru.wheee.io/{fullchain,privkey}.pem` — новый домен нужно добавить в этот же сертификат (`--expand`), не выпускать отдельный.

На VPS (`ssh root@64.176.74.237`, каталог `/opt/wheee/deploy`):

```bash
cd /opt/wheee/deploy
docker compose run --rm certbot certonly --webroot -w /var/www/certbot --expand \
  -d ru.wheee.io -d api.wheee.io -d discord.wheee.io
docker compose restart nginx
```

**Проверить перед запуском**: команда выше — вероятный вариант (стандартный webroot-паттерн для nginx+certbot в docker compose), но `docker-compose.yml` в этом воркспейсе не показывает, что и `nginx`, и `certbot` монтируют общий каталог `/var/www/certbot` — том `certbot-etc` есть, а webroot-тома нет. Значит на проде либо (а) настроен дополнительный volume для webroot, который не попал в этот файл, либо (б) сертификат там выпускается иначе (например, `--standalone` с временной остановкой nginx, как это делает `deploy/setup-ru-vps.sh` для отдельного Russian VPS через `certbot --nginx`, но это другой сервер и другой механизм — host-certbot, не docker). Перед запуском команды: зайти на `64.176.74.237` и посмотреть, как выпущен текущий `ru.wheee.io` cert (`docker compose config`, `history`, `crontab -l` на предмет renew-хука) — если там `--webroot`, проверить фактический смонтированный путь; если `--standalone` или `certbot --nginx` на хосте (не в контейнере) — использовать тот же способ вместо команды выше.

## 3. Developer Portal

https://discord.com/developers/applications

1. Создать приложение (прод). Отдельно — по dev-приложению на каждого разработчика (нужно для локальной разработки, см. §5).
2. Installation → включить оба контекста: **User Install** и **Guild Install**. Redirect URI: `https://127.0.0.1`.
3. Activities → Settings → **Enable Activities**. Supported Platforms: только **Web** — мобильные (iOS/Android) в v1 выключить.
4. Activities → URL Mappings — добавить **строго в этом порядке** (специфичный префикс выше корневого, см. `DISCORD_ACTIVITIES_INTEGRATION_RESEARCH.md` §2 «Порядок важен»):
   - PREFIX `/gameapi` → TARGET `api.wheee.io`
   - PREFIX `/` → TARGET `discord.wheee.io`
5. Записать **Client ID** и **Client Secret** — уйдут в env (§4).
6. Отметить в UI: если портал сам подставляет префикс `/.proxy` в маппинги (в текущей официальной документации такого префикса нет, но README SDK его ещё использует — см. исследование §2 «Про префикс `/.proxy/`») — вписать сюда фактический префикс и поменять одну строку в `packages/client/src/lib/config.ts` (`API_BASE = location.origin + '/gameapi'` → с найденным префиксом).

## 4. Переменные окружения

`DISCORD_CLIENT_ID` и `DISCORD_CLIENT_SECRET` читает сервер (`packages/server/src/auth/oauth.ts:341-342`), `VITE_DISCORD_CLIENT_ID` — клиентская сборка (`packages/client/src/lib/platform/discord.ts:56,190`) и build-arg в `deploy/docker-compose.yml:21`.

Ни одной из трёх переменных сейчас нет в `deploy/.env.example` — добавить туда (с пустыми значениями, как остальные секреты в файле) и в реальный `deploy/.env` на VPS (тот же файл, что уже содержит `JWT_SECRET`, `GOOGLE_CLIENT_ID` и т.д.):

```
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
VITE_DISCORD_CLIENT_ID=
```

`VITE_DISCORD_CLIENT_ID` = тот же Client ID из шага 3.

После правки `deploy/.env` на VPS — прогнать sync + пересборку:

```bash
bash deploy/deploy-all.sh --server
```

(это `sync-env.sh` + `git pull` + `docker compose up -d --build` на Польском VPS — см. `deploy/deploy-all.sh`).

## 5. Dev-петля

Туннели вместо прямого адреса (проксирование Discord работает только через URL Mappings, localhost напрямую не промаппить):

```bash
cloudflared tunnel --url http://localhost:5173   # клиент (Vite)
cloudflared tunnel --url http://localhost:3001   # сервер
```

В dev-приложении (не в проде!) выставить URL Mappings на адреса туннелей: `/` → туннель клиента, `/gameapi` → туннель сервера.

Поднять оба процесса локально:

```bash
bun run dev:client   # packages/client: vite (порт 5173)
bun run dev:server   # packages/server: bun --watch (порт 3001)
```

Клиент собрать под Discord-платформу:

```bash
VITE_PLATFORM=discord VITE_DISCORD_CLIENT_ID=<dev app client id> bun run dev:client
```

Запуск в Discord: Settings → Advanced → Developer Mode → зайти в голосовой канал → Rocket Button → выбрать своё Activity в Developer Activity Shelf.

⚠️ После тестов на чужих доменах (бесплатные туннели) — сбросить URL Mapping обратно на что-то нейтральное. Это защита от перехвата: пока маппинг висит на туннеле, который вам не принадлежит бессрочно, его может подхватить кто-то другой (см. исследование §1, предупреждение доки про dev-туннели).

## 6. Первый замер (гейт на дальнейшую полировку)

Прежде чем вкладываться в доводку Discord-версии — измерить, во сколько обходится проксирование Discord:

1. RTT до `wss://api.wheee.io/ws` **через Activity** (внутри Discord, реальный прокси-путь) — медиана из нескольких десятков пингов.
2. RTT до того же `wss://api.wheee.io/ws` **напрямую**, с того же компьютера, вне Discord.
3. Порог: медиана прокси-RTT из ЕС должна быть **< 150 мс**. Если хуже — realtime 1v1 через прокси может ощущаться хуже, чем в web/Telegram-версии; тогда полировку геймплея откладывать, сначала разбираться с латентностью.
4. Параллельно проверить, что Activity вообще грузится — то есть что egress-IP Польского VPS не забанен Cloudflare (см. исследование, риск №2: «non-zero chance» унаследовать забаненный IP от предыдущего владельца).

## 7. Прод-проверка

После деплоя (`discord.wheee.io` доступен, сертификат покрывает домен, Developer Portal настроен на прод-приложение):

1. Двое человек заходят в один голосовой канал (сервер — до 25 участников, порог для неверифицированных Activities, см. §8 и исследование §7) → запускают Activity → должен сработать автоматч 1v1 без ручного создания комнаты.
2. Один из участников зовёт друга через `shareLink()` (кнопка приглашения в игре) → у получателя ссылки Activity стартует и матчит его по коду из `customId`.
3. В аналитике: `platform: 'discord'` должен появиться в ответе `GET /api/events/summary` (поле `platforms` — см. `packages/server/src/index.ts`, `getPlatformSummary`). Если STATS_TOKEN закрыт — эндпоинт всё равно доступен с токеном.

## 8. Параллельный трек (не блокирует запуск в v1)

Отдельно от основного запуска, календарно дольше:

- **Team-аккаунт** в Developer Portal (сейчас приложение может висеть на личном аккаунте — для верификации и монетизации нужна команда).
- **Identity + App Verification** — обязательное условие для Discovery и снятия лимита в 25 участников на сервер (исследование §7). Процесс идёт через Developer Portal, календарно — недели.
- **Метаданные и арты** — иконки, описание, скриншоты/видео для App Directory: см. `marketing/DISCORD_ACTIVITIES_INTEGRATION_RESEARCH.md` §7 и раздел assets-and-metadata в доке Discord.
- **Discovery opt-in** — после верификации, в Discovery Settings; появление в App Directory/App Launcher — до 24 часов после включения (исследование §7).

Монетизация (Premium Apps) сюда сознательно не включена: доступна только разработчикам из США/ЕС/Великобритании (исследование §6) — отдельное решение, зависящее от юрлица.
