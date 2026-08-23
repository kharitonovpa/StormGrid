# Discord Activity v1 — дизайн

Дата: 2026-08-23. Основание: исследование `marketing/DISCORD_ACTIVITIES_INTEGRATION_RESEARCH.md` (все факты о платформе сверены с официальной докой Discord там; здесь не дублируются).

## Цель

Запустить wheee как Discord Activity: игра открывается в войс-канале/ЛС Discord, игрок логинится Discord-аккаунтом, двое участников одного инстанса автоматически попадают в 1v1-матч друг с другом. Канал чисто дистрибуционный: реклама запрещена политикой Discord, IAP географически недоступен — монетизации в v1 нет по построению.

## Скоуп v1 (утверждён)

Ядро + автоматч: адаптер, auth, сеть через прокси, автоматч по инстансу, shareLink-инвайты. Хостинг discord-сборки — поддомен `discord.wheee.io` на существующем PL VPS.

**Вне скоупа v1:** мобайл-полировка (thermal-события, orientation-локи), спектейт для 3+ участников, серверная верификация activity-instance, серверный storage прогресса, Rich Presence (`setActivity`), верификация приложения и листинг в App Directory (параллельный ручной трек, не код).

## Архитектура

Четыре блока, каждый зеркалит существующий паттерн репо:

| Блок | Где | Образец |
|---|---|---|
| Клиентский адаптер | `packages/client/src/lib/platform/discord.ts` | `telegram.ts` |
| Auth-эндпоинт | `packages/server/src/auth/oauth.ts` → `POST /api/auth/discord` | `POST /api/auth/telegram` (строка ~198) |
| Автоматч | `packages/shared/src/protocol.ts` + `packages/server/src/matchmaking.ts` | существующий friend-протокол |
| Инфра/деплой | `deploy/deploy-discord.sh`, nginx-блок `discord.wheee.io`, визард для Developer Portal | `deploy/deploy-gamepush.sh` |

Новая зависимость: `@discord/embedded-app-sdk` в `packages/client`.

## 1. Сборка и детекция

- Новый вариант сборки `VITE_PLATFORM=discord` (переменная уже прокинута в `packages/client/vite.config.ts`).
- `types.ts`: `PlatformType` += `'discord'`.
- `detect.ts`: ветка `VITE_PLATFORM === 'discord'` (как yandex/gamepush) + runtime-страховка `location.hostname.endsWith('.discordsays.com')` → `'discord'`.
- Клиенту нужен client id для конструктора SDK и `authorize()`: env `VITE_DISCORD_CLIENT_ID` (задаётся в deploy-discord.sh; секрета в клиенте нет).

## 2. Сеть

- `config.ts`: для discord-платформы `API_BASE = location.origin + '/gameapi'`. Существующая формула `WS_URL = API_BASE.replace(/^http(s?)/,'ws$1') + '/ws'` даёт `wss://{clientId}.discordsays.com/gameapi/ws` → прокси Discord → `api.wheee.io/ws`. Никакие вызовы `fetch(${API_BASE}/api/...)` не меняются.
- URL Mappings в Developer Portal (порядок: специфичные выше): `/gameapi` → `api.wheee.io`; `/` → `discord.wheee.io` (последним).
- Если портал навяжет новым приложениям префикс `/.proxy` (открытый вопрос из исследования, §2) — меняется только константа пути в `config.ts`.
- `patchUrlMappings()` не используем: сторонних сетевых библиотек нет, весь свой код ходит через `API_BASE`.
- Ассеты — только собственный origin (Vite бандлит всё сам; внешних CDN в билде нет — CSP их убил бы).

## 3. Auth

Поток в `discord.ts # init()`:

1. `new DiscordSDK(VITE_DISCORD_CLIENT_ID)`
2. `encourageHardwareAcceleration()` (three.js; вызывать до тяжёлой инициализации — переключение перезапускает клиент Discord)
3. `await sdk.ready()`
4. `authorize({ client_id, response_type: 'code', prompt: 'none', scope: ['identify', 'applications.commands'] })` → `{ code }`
5. `POST ${API_BASE}/api/auth/discord { code }` — ретраи по образцу `loginWithRetry()` из telegram.ts
6. Ответ `{ token, user, access_token }`: `token` — наш JWT (отдаётся из `getAuthToken()`), затем `authenticate({ access_token })`.

Сервер (`oauth.ts`):

1. Принять `{ code }`.
2. `POST https://discord.com/api/oauth2/token` — `grant_type=authorization_code`, `code`, `redirect_uri`, аутентификация `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET` (новые env на VPS, добавить в `deploy/sync-env.sh`-контур).
3. `GET https://discord.com/api/users/@me` с полученным Bearer.
4. `upsertUser('discord', user.id, user.global_name ?? user.username, avatarUrl)` — существующая функция; avatarUrl = `https://cdn.discordapp.com/avatars/{id}/{avatar}.png?size=256` при наличии `user.avatar`, иначе null. Юзернеймы Discord не санитизированы — существующее экранирование вывода имён обязано покрывать и их (проверить, что имена выводятся как текст, не HTML).
5. Вернуть `{ token, user, access_token }`.

Ошибки: любой сбой шагов 4–6 на клиенте → анонимный режим, игра доступна (точно как telegram.ts при недоступном initData). Сбой обмена кода на сервере → 401, клиент ретраит и падает в анонима. Серверная анти-спуфинг проверка activity-instance (`GET /applications/{app_id}/activity-instances/{instance_id}`) — фаза 2.

## 4. Автоматч в инстансе

Протокол — минимальное расширение с семантикой **create-or-join**:

- `FriendCreateMsg` += `code?: string`.
- Сервер (`matchmaking.ts # createInvite`): клиентский код принимается **только** с префиксом `dc-` (иначе игнорируется и генерируется обычный код). Если код свободен — паркуем invite как сейчас (`friend:waiting`). Если код уже занят живым invite'ом — ведём себя как `friend:join` на этот код (матч стартует). Это убирает гонку без выборов лидера: оба клиента шлют `friend:create { code: 'dc-<instanceId>' }`, первый создаёт, второй джойнится.
- Нормализация регистра: существующий `joinInvite` делает `code.toUpperCase()` — детерминированный код нормализуем к верхнему регистру на клиенте при формировании (`'dc-' + instanceId` → uppercase), сервер хранит и сравнивает как сейчас.
- Занятый код с мёртвым сокетом создателя — существующий sweep/readyState-механизм уже отрабатывает.

Клиентская логика (в `discord.ts` + точка входа лобби):

- На старте: `getInstanceConnectedParticipants()`; подписка `Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE`.
- Участников ≥ 2 → авто-отправка `friend:create { code }` (оба конца).
- Участник один → обычное лобби: глобальная очередь с бот-фоллбеком работает без изменений; при появлении второго участника (событие) — предлагаем автоматч, если игрок ещё не в матче/очереди (в очереди — не дёргаем, очередь важнее: человек мог сознательно выбрать её).
- Третий и далее участник: к моменту его `friend:create` код уже свободен (invite удаляется при старте матча первой пары), поэтому create-or-join запаркует его как новый invite — участники инстанса матчатся **попарно** (P3 ждёт P4 и т.д.). Клиент различает исходы по ответу: `friend:waiting` = «ты ждёшь следующего игрока» — экран «в канале идёт матч, ждём соперника» с кнопкой ухода в глобальную очередь; старт матча = автоматч сработал. `friend:join_fail` в этом флоу — только деградация (гонка с умершим сокетом), обрабатывается так же, как waiting-экран, повторным create.
- «Позвать друга»: `shareLink({ custom_id: joinCode })` вместо копирования URL; на старте адаптер читает `discordSdk.customId` и скармливает в существующий обработчик `?join=CODE`. `referrerId` пишем в аналитику (prop у существующего события открытия), логики на нём в v1 нет.

## 5. Контракт адаптера

| Метод | Значение |
|---|---|
| `canAuth`, `canShowLeaderboard` | `true` |
| `canLinkOut` | `false` (все внешние переходы спрятаны, как на порталах; `openExternalLink()` — потом, если понадобится) |
| реклама (`isRewardedAvailable`, `showPreloader/Interstitial/Rewarded`, sticky) | `false`/no-op — запрещена Developer Policy |
| `storage` | `createLocalStorage()`; риск партиционирования известен, серверный storage — отдельная задача |
| `sound` | `createLocalSound()` |
| `getLanguage()` | `userSettingsGetLocale()`, фоллбек `'en'` |
| safe areas | CSS-переменные `--discord-safe-area-inset-*` → существующий `setSafeAreaInset()`; подписка на изменение — при наличии события, иначе одноразово на init |
| `onPause`/`onResume` | PIP/grid: `subscribeToLayoutModeUpdatesCompat` — PIP/grid → pause, focused → resume; плюс visibilitychange как в telegram.ts |
| аналитика | platform-поле существующей аналитики получает `'discord'` автоматически через `detectPlatform()` |

## 6. Инфра и деплой

- `deploy/deploy-discord.sh` по образцу `deploy-gamepush.sh`: `VITE_PLATFORM=discord VITE_API_URL="" VITE_DISCORD_CLIENT_ID=… bunx vite build` → rsync на VPS в директорию `discord.wheee.io` (как деплоится wheee.io в `deploy.sh`).
- nginx: новый server-блок `discord.wheee.io` (статика + существующий certbot-контур), в `deploy/nginx.conf`.
- DNS: A-запись `discord.wheee.io` → PL VPS (ручной шаг).
- Developer Portal (только руками владельца): создание приложения, Enable Activities, платформы, URL Mappings, client id/secret. Оформляется интерактивным bash-визардом (скилл wizard) на этапе реализации; отдельное dev-приложение для локальной разработки через `cloudflared tunnel` на Vite.

## 7. Тестирование

- Юнит: create-or-join в matchmaking — клиентский код с префиксом `dc-` (создание, идемпотентный второй create → матч, третий create после старта матча → новый invite (попарный матчинг), невалидный префикс → серверный код, TTL/мёртвый сокет). В существующий ws-сьют (env для запуска: живой `:3001`, `RECONNECT_GRACE_MS=2000 BOT_MATCH_DELAY_MS=800 BOT_MATCH_DELAY_LONG_MS=800`; `matchmaking-delay.test.ts` — без delay-переменных).
- Auth-эндпоинт: юнит с замоканным Discord API (обмен кода, /users/@me, аватар null/есть, 401 при отказе).
- Ручное: dev-приложение + `cloudflared tunnel`; **первый чек после настройки портала — замер RTT WSS через прокси** (главный риск канала) и проверка, что egress-IP VPS не забанен Cloudflare; полный флоу вдвоём в войс-канале (<25 участников — ок до верификации).

## Риски (унаследованы из исследования, §Открытые риски)

Латентность прокси (меряем до полировки), WebGL в мобильном webview (мобайл вне скоупа v1), localStorage-партиционирование (митигация — серверный storage, фаза 2), `/.proxy`-префикс (инкапсулирован в config.ts), порог 25 участников до верификации (не блокирует разработку).
