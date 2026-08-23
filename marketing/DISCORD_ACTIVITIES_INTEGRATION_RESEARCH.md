# Discord Activities: исследование интеграции wheee

Дата: 2026-08-23. Все факты сверены с официальной документацией Discord (страницы `discord.com/developers/docs/*` теперь отдают 301-редирект на `docs.discord.com/developers/*` — цитируются конечные URL). Каждый раздел содержит ссылки на конкретные страницы, которые были реально загружены и проверены. Две статьи официального саппорт-центра разработчиков (`support-dev.discord.com`) не удалось загрузить напрямую (Cloudflare-заглушка) — это отмечено явно в тексте.

---

## TL;DR

**Вердикт: интеграция реалистична и хорошо ложится на существующую платформенную архитектуру.** Discord Activity — это тот же iframe-веб-билд, что и Telegram Mini App, с двумя ключевыми отличиями: (1) весь трафик, включая WSS, идёт через прокси Discord (`{clientId}.discordsays.com`) и требует настройки URL Mappings; (2) авторизация — полноценный OAuth2 (authorize → серверный обмен code→token → authenticate), а не подписанный payload как Telegram initData.

**Объём работ (клиент+сервер): ориентировочно 4–7 дней разработки.**
- Новый адаптер `discord.ts` + `'discord'` в `PlatformType` — по образцу `telegram.ts`: ~1 день.
- Серверный эндпоинт `POST /api/auth/discord` (обмен OAuth2-кода) рядом с `/api/auth/telegram` в `packages/server/src/auth/oauth.ts`: ~0.5 дня.
- Переключение `API_BASE`/`WS_URL` на прокси-домен + настройка URL Mappings: ~0.5 дня.
- Автоматч двух участников инстанса в 1v1 поверх существующего `friend:create/join`: ~1 день.
- Мобильный UX (safe areas, ориентация, PIP/grid-режимы), тестирование на iOS/Android: ~1–2 дня.

**Что блокирует масштабирование, но не разработку:**
- Без верификации приложения Activity запускается только в серверах **до 25 участников** и в ЛС — этого достаточно для разработки и тестов, но не для дистрибуции. Верификация (identity + app verification) — отдельный процесс через Developer Portal, календарно занимает недели.
- Монетизация (Premium Apps / IAP): нужна верификация, team-аккаунт и **доступна только для разработчиков из США/ЕС/Великобритании** — для нас, вероятно, блокер (зависит от юрлица).
- Реклама внутри Activities фактически запрещена Developer Policy — модель «ads» здесь не работает вовсе (для wheee не критично: на web/TG реклама и так выключена).

**Главные технические риски:** латентность WSS через Cloudflare Workers-прокси для realtime-геймплея; WebGL/three.js в мобильном webview Discord; неопределённость с персистентностью localStorage внутри iframe (докой не описана).

---

## 1. Настройка Activity в Developer Portal

Источники:
- Туториал: https://docs.discord.com/developers/activities/building-an-activity
- Локальная разработка: https://docs.discord.com/developers/activities/development-guides/local-development
- Обзор: https://docs.discord.com/developers/activities/overview
- Как устроено: https://docs.discord.com/developers/activities/how-activities-work

Факты из туториала ([building-an-activity](https://docs.discord.com/developers/activities/building-an-activity)):

1. Создать приложение в [Developer Portal](https://discord.com/developers/applications), включить оба installation contexts — «User Install» и «Guild Install»; добавить placeholder redirect URI `https://127.0.0.1`.
2. В разделе **Activities → Settings** включить чекбокс **Enable Activities**. При этом Discord автоматически создаёт дефолтную Entry Point-команду «Launch» (тип 4, `PRIMARY_ENTRY_POINT`) — через неё пользователи запускают Activity из App Launcher ([user-actions](https://docs.discord.com/developers/activities/development-guides/user-actions)).
3. В **Activities → URL Mappings** добавить маппинг с PREFIX `/` на домен фронтенда.
4. Client ID и Client Secret — в `.env`; секрет только на сервере.

Локальная разработка ([local-development](https://docs.discord.com/developers/activities/development-guides/local-development)):
- Два режима: (а) прямой localhost через «Application URL Override» — но тогда трафик **не** проходит через прокси Discord и «any requests made by the application will need to use a full URL instead of a "mapped" URL»; (б) рекомендованный — туннель (`cloudflared tunnel --url http://localhost:3000`), URL туннеля прописывается в URL Mapping. «Your web server can be HTTP and your network tunnel can upgrade the connection to HTTPS».
- Рекомендованный паттерн: «for each developer to have their own "development-only" application» (отдельное dev-приложение на разработчика).
- Запуск в dev: включить Developer Mode (десктоп: Settings → Advanced; мобайл: User Profile → Appearance), зайти в голосовой канал, нажать «Rocket Button» и выбрать своё Activity в Developer Activity Shelf. Приложение должно быть помечено как Embedded и иметь включённые платформы в Supported Platforms.
- Логи: на десктопе — DevTools браузера или PTB-клиент (View → Developer → Toggle Developer Tools); на мобайле — Debug Logs в настройках (DEV ONLY); фильтр по `RpcApplicationLogger`. SDK по умолчанию пересылает `console.log/warn/error/info/debug` в клиент Discord; отключается опцией `disableConsoleLogOverride: true`.
- ⚠️ Безопасность dev-туннелей: «If using a domain you don't control (like free tier services), reset your URL mapping after testing» (защита от перехвата домена).

---

## 2. Сеть: прокси *.discordsays.com, WSS, URL Mappings, CSP

Источники:
- https://docs.discord.com/developers/activities/development-guides/networking
- https://docs.discord.com/developers/activities/development-guides/local-development#url-mapping
- README официального SDK: https://github.com/discord/embedded-app-sdk (raw README загружен и проверен)

### Как работает прокси

Дословно из [networking](https://docs.discord.com/developers/activities/development-guides/networking): «All network traffic is routed through the Discord Proxy for various security reasons. Under the hood we utilize Cloudflare Workers». Прокси скрывает IP пользователей **и** IP серверов приложения и блокирует известные вредоносные URL.

Полный URL строится как `https://{clientId}.discordsays.com{путь}` — пример из доки: при client id `12345678` относительный путь `/foo/bar.jpg` = `https://12345678.discordsays.com/foo/bar.jpg`.

Поддержка протоколов ([networking](https://docs.discord.com/developers/activities/development-guides/networking)):
- **WebSocket — поддерживается** («we currently only support websockets»).
- WebTransport — в работе («we're working with our upstream providers to enable WebTransport»).
- **WebRTC — не поддерживается.**

### URL Mappings (проверено дословно на [local-development#url-mapping](https://docs.discord.com/developers/activities/development-guides/local-development))

- Маппинг = пара PREFIX → TARGET. Пример из доки: PREFIX `/api`, TARGET `some-api.com` — «Now you can make requests to /api from inside of your application, which will be forwarded, via Discord's proxy to some-api.com».
- «URL mappings can utilize any url protocol, (https, **wss**, ftp, etc…), which is why the URL target should not include a protocol» — **один маппинг покрывает и HTTPS, и WSS** на тот же хост. Это ключевой факт для нашего WS-сервера.
- Параметрический маппинг: PREFIX `/google/{subdomain}` → TARGET `{subdomain}.google.com`.
- «Targets must point to a directory; setting a target to a file … is unsupported».
- Порядок важен: «if you have multiple prefix urls with the same initial path, you must place the shortest of the prefix paths last» — т.е. `/foo/bar` должен стоять **выше** `/foo` (а корневой `/` — последним).

### CSP

- Дословно: «Rest assured: other activities will not be able to make requests with your activity's cookie, thanks to the Content Security Policy (CSP) limiting requests only to your own app's proxy». Любой запрос на внешний немаппированный URL падает с ошибкой `blocked:csp`.
- Исключения из CSP (запросы идут напрямую, маппинг не нужен): `https://discord.com/api/`, `https://canary.discord.com/api/`, `https://ptb.discord.com/api/`, `https://cdn.discordapp.com/attachments|avatars|icons/`, `https://media.discordapp.net/attachments|avatars|icons/` ([local-development#exceptions](https://docs.discord.com/developers/activities/development-guides/local-development)).
- Cookies: домен должен совпадать с `{clientId}.discordsays.com`, обязательно `SameSite=None; Partitioned` ([networking#using-cookies](https://docs.discord.com/developers/activities/development-guides/networking)).

### patchUrlMappings()

Из [networking#using-external-resources](https://docs.discord.com/developers/activities/development-guides/networking): для сторонних библиотек, которые ходят на внешние URL, SDK даёт `patchUrlMappings([{prefix: '/foo', target: 'foo.com'}])`. Дословно: «Note: `patchUrlMappings` is modifying your browser's **`fetch`, `WebSocket`, and `XMLHttpRequest.prototype.open`** global variables. Depending on the library, you may see side effects from using this helper function. **It should be used only when necessary.**»

Т.е. патчатся fetch + WebSocket + XHR; рекомендация доки — использовать только для чужого кода, свой код должен сам строить маппированные URL.

### Про префикс `/.proxy/`

Важное уточнение, проверенное прямым поиском по HTML всех актуальных страниц (`networking`, `local-development`, `building-an-activity`, SDK reference): **строка `/.proxy` в текущей официальной документации не встречается ни разу.** Актуальная модель — произвольные PREFIX'ы (`/api` → `some-api.com`). При этом README официального SDK ([github.com/discord/embedded-app-sdk](https://github.com/discord/embedded-app-sdk)) в примере всё ещё использует `fetch('/.proxy/api/token', …)` — это наследие шаблона getting-started (где `/.proxy` был обязательным префиксом маппингов для приложений, созданных после марта 2024). **Открытый вопрос для проверки руками при создании приложения: навязывает ли портал новым приложениям префикс `/.proxy` в UI маппингов.** На план это не влияет — какой бы префикс ни был, он инкапсулируется в одном месте (`config.ts`).

### Последствия для кода wheee

Сейчас в `packages/client/src/lib/config.ts`:
```ts
export const API_BASE = dev ? …:3001 : (import.meta.env.VITE_API_URL || location.origin)
export const WS_URL = API_BASE.replace(/^http(s?)/, 'ws$1') + '/ws'
```
Внутри Activity `location.origin === https://{clientId}.discordsays.com`, поэтому достаточно:
- Маппинги в портале: `/gameapi` → `api.wheee.io` (выше по списку), `/` → хост статики клиента (последним).
- В discord-сборке: `API_BASE = location.origin + '/gameapi'` — тогда существующая формула `WS_URL` даст `wss://{clientId}.discordsays.com/gameapi/ws` → прокси → `wss://api.wheee.io/ws`. Ни один вызов `fetch(`${API_BASE}/api/...`)` менять не нужно.
- `patchUrlMappings()` нам не нужен (сторонних сетевых библиотек нет); аналитика, если появится, — только через отдельный маппинг.
- Ассеты: грузить только с собственного origin (Vite и так собирает всё в бандл); внешние CDN/шрифты будут убиты CSP.
- Кэш: «Discord's application proxy will remove any cache headers for assets whose `content-type` headers include `text/html`» — остальное кэшируется, нужны хэшированные имена файлов (Vite делает из коробки) ([production-readiness#cache-busting](https://docs.discord.com/developers/activities/development-guides/production-readiness)).

---

## 3. Авторизация: authorize → серверный обмен → authenticate

Источники:
- https://docs.discord.com/developers/activities/building-an-activity (шаг OAuth2)
- https://docs.discord.com/developers/developer-tools/embedded-app-sdk (сигнатуры команд)
- https://docs.discord.com/developers/topics/oauth2 (token exchange, скоупы, срок жизни)

### Поток (из туториала)

1. Клиент: `await discordSdk.ready()`, затем `discordSdk.commands.authorize({ client_id, response_type: 'code', prompt: 'none', scope: […] })` → возвращает `{ code }`. Сигнатура по [SDK reference](https://docs.discord.com/developers/developer-tools/embedded-app-sdk): args включают `client_id`, `scope[]`, `response_type?: 'code'`, `prompt?: 'none'`, опциональные `code_challenge`/`code_challenge_method`.
2. Клиент POST'ит `code` на **наш** бэкенд (в туториале — `/api/token`; «single POST route for `/api/token` that allows us to perform the OAuth2 flow from the server securely»).
3. Сервер меняет код на токен: `POST https://discord.com/api/oauth2/token` c `grant_type=authorization_code`, `code`, `redirect_uri`, аутентификация `client_id`/`client_secret` ([topics/oauth2](https://docs.discord.com/developers/topics/oauth2)). **client_secret только на сервере** — дока: «Access tokens and refresh tokens are powerful, and should be treated similarly to passwords».
4. Клиент: `discordSdk.commands.authenticate({ access_token })` → ответ `{ access_token, user, scopes, expires, application }` ([SDK reference](https://docs.discord.com/developers/developer-tools/embedded-app-sdk)).

### Скоупы

Туториал запрашивает `identify`, `guilds`, `applications.commands`. По [topics/oauth2](https://docs.discord.com/developers/topics/oauth2): `identify` — «allows /users/@me without email» (id, username, avatar); `guilds` — список гильдий; `guilds.members.read` — ник/аватар в конкретной гильдии (нужен только если хотим серверные ники). Для wheee достаточно **`identify` + `applications.commands`**; `guilds.members.read` — опционально ради гильдейских ников ([multiplayer-experience#render-avatars-and-names](https://docs.discord.com/developers/activities/development-guides/multiplayer-experience)).

Аватар: `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256` (CDN в исключениях CSP; [multiplayer-experience](https://docs.discord.com/developers/activities/development-guides/multiplayer-experience)).

### Срок жизни сессии

`expires_in` в ответе token-эндпоинта — «how long, in seconds, until the returned access token expires»; в примерах доки — `604800` (7 дней). Есть refresh token (`grant_type=refresh_token`) ([topics/oauth2](https://docs.discord.com/developers/topics/oauth2)). Ответ `authenticate` содержит поле `expires` (строка-дата). Для wheee это неважно: как и с Telegram, наш сервер после проверки выдаёт **собственный JWT** — Discord-токен нужен один раз на логин (и опционально хранится на сервере для activity-instance-проверок).

### Маппинг на PlatformAdapter и сервер

Аналогия с Telegram точная, только «подписанный payload» заменяется на «OAuth2-код»:

| Telegram (сейчас) | Discord (план) |
|---|---|
| `window.Telegram.WebApp.initData` | `authorize()` → `code` |
| `POST /api/auth/telegram { initData }` | `POST /api/auth/discord { code }` |
| `validateTelegramInitData()` (HMAC) в `packages/server/src/auth/oauth.ts:176` | обмен кода на `access_token` + `GET /users/@me` — сам факт успешного обмена и есть криптографическая проверка |
| `upsertUser('telegram', providerId, name, avatar)` | `upsertUser('discord', user.id, user.global_name ?? user.username, avatarUrl)` |
| ответ `{ token, user }` → `getAuthToken()` | то же + `access_token` для `authenticate()` |

Дополнительная серверная проверка «пользователь реально в инстансе» (аналог анти-спуфинга initData): `GET https://discord.com/api/applications/<application_id>/activity-instances/<instance_id>` — «returns a serialized active activity instance … otherwise it returns a 404»; дока прямо рекомендует «verify that a client is in fact in an instance of that activity before allowing the client to participate in any meaningful gameplay». Опционально — криптографические заголовки прокси `X-Signature-Ed25519`, `X-Signature-Timestamp`, `X-Discord-Proxy-Payload` ([multiplayer-experience#preventing-unwanted-activity-sessions](https://docs.discord.com/developers/activities/development-guides/multiplayer-experience)).

Также из [networking#security-considerations](https://docs.discord.com/developers/activities/development-guides/networking): «Do not trust data coming from the Discord client as truth … assume any data coming from the Discord Client could be falsified»; юзернеймы не санитизированы — экранировать при выводе.

---

## 4. Модель инстансов и матчмейкинг 1v1

Источник: https://docs.discord.com/developers/activities/development-guides/multiplayer-experience

- **Инстанс** — общий контекст запуска: «Whether the application is a shared drawing canvas, board game … the two users should have access to the same shared data». Инстанс «generated when a user launches an application»; привязан к каналу/гильдии — формат `location`: `{"id":"gc-<guild>-<channel>","kind":"gc","channel_id":…,"guild_id":…}`. Жизненный цикл: «When all the users of an application in a channel leave or close the application, that instance has finished its lifecycle, and will not be used again».
- `discordSdk.instanceId` — «available as soon as the SDK is constructed, and does not require the SDK to receive a `ready` payload». Дока рекомендует использовать его «as a key to save and load the shared data relevant to an application».
- Участники: `await discordSdk.commands.getInstanceConnectedParticipants()` → `{ participants: User[] }`; подписка на вход/выход: `discordSdk.subscribe(Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE, cb)` (payload `{ participants: User[] }`).
- **Кросс-инстансовое взаимодействие дока не описывает и не запрещает** — прямого запрета матчить игроков из разных инстансов в общую очередь нет (проверено: раздел multiplayer-experience этот вопрос не затрагивает). Значит, глобальная очередь wheee (с бот-фоллбеком) легальна как минимум с точки зрения задокументированных правил.
- Количество игроков: жёсткого лимита нет — «the only real limit is the number of people who can join a Voice call. Be aware of how your Activity will behave when there are 25 or more people in the call» ([design-patterns](https://docs.discord.com/developers/activities/design-patterns)). Для >N игроков дока рекомендует спектейт: «Allow these users to 'spectate' other users who are playing» и «Give those users something to do, even if it's just letting them spectate until they can join without being disruptive».

### План автоматча для wheee (поверх `friend:create/join` из `packages/shared/src/protocol.ts`)

1. При инициализации адаптер получает `instanceId` и список участников.
2. Детеминированный код комнаты: `dc-${instanceId}` (серверу нужно разрешить клиентский код для discord-платформы — сейчас код генерирует сервер и возвращает в `friend:waiting`).
3. Участник с наименьшим Discord user id шлёт `friend:create` (с зарезервированным кодом), остальные — `friend:join` с тем же кодом. При 2 участниках — мгновенный 1v1.
4. Участники сверх двух: `friend:join` вернёт `friend:join_fail` → показываем экран «матч идёт» с кнопками «в общую очередь» (существующий `queue` c бот-фоллбеком) и, позже, спектейт (отдельная фича, у нас уже есть ReplayStore/наблюдение за протоколом — но это вне MVP).
5. Игрок один в инстансе → обычная глобальная очередь + `openInviteDialog()` для зова друзей в канал (требует пермишена `CREATE_INSTANT_INVITE`; «using `getChannelPermissions` (requires OAuth scope `'guilds.members.read'`) is highly recommended»; в ЛС не работает — [user-actions](https://docs.discord.com/developers/activities/development-guides/user-actions)).
6. Событие `ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE` — чтобы подхватывать второго игрока, зашедшего позже.

### Челлендж-ссылки (аналог `?join=CODE` / Telegram startapp)

Источник: https://docs.discord.com/developers/activities/development-guides/growth-and-referrals

- Из Activity: `await discordSdk.commands.shareLink({ message: '…', custom_id: joinCode })` — пользователь шарит ссылку в канал/ЛС.
- У получателя Activity запускается с реферальными данными: **`discordSdk.customId`** (наш код) и **`discordSdk.referrerId`** (snowflake отправителя). Это прямой аналог `?join=CODE`: адаптер читает `customId` и скармливает в существующий флоу friend-join.
- Есть и серверный Quick Links API: `POST /applications/{application_id}/quick-links/` с `custom_id`, title/description/image — эфемерные ссылки с TTL 30 дней (для шаринга вне Discord).
- Дока требует валидации: «Track and validate referrals to prevent abuse», запрет self-referrals.

---

## 5. Поверхности и UX-ограничения

Источники:
- https://docs.discord.com/developers/platform/activities
- https://docs.discord.com/developers/activities/how-activities-work
- https://docs.discord.com/developers/activities/development-guides/mobile
- https://docs.discord.com/developers/activities/development-guides/layout
- https://docs.discord.com/developers/activities/development-guides/user-actions
- https://docs.discord.com/developers/activities/design-patterns

- **Где запускается:** «can be launched in channels, DMs, or from the App Launcher with no external window or separate download required» ([platform/activities](https://docs.discord.com/developers/platform/activities)). Основной вход — Entry Point-команда в App Launcher: «Activities are primarily opened when users invoke your app's Entry Point command in the App Launcher», плюс запуск через interaction callback `LAUNCH_ACTIVITY` (type 12) ([how-activities-work](https://docs.discord.com/developers/activities/how-activities-work)). Классический сценарий — совместный запуск в голосовом канале: «Players can jump in together with friends already in a voice channel».
- **Платформы:** web, iOS, Android; «By default, your Activity will be launchable on web/desktop» — iOS/Android включаются чекбоксами в Activities → Settings ([mobile](https://docs.discord.com/developers/activities/development-guides/mobile)).
- **Safe areas на мобайле:** CSS-переменные `--discord-safe-area-inset-top/bottom/left/right` с фоллбеком на `env(safe-area-inset-*)` ([mobile#mobile-safe-areas](https://docs.discord.com/developers/activities/development-guides/mobile)). У wheee уже есть готовый механизм `setSafeAreaInset()` в `packages/client/src/lib/platform/safeArea.ts` — адаптер просто читает эти переменные (как telegram.ts читает инсеты Telegram).
- **Ориентация:** `setOrientationLockState` с состояниями `UNLOCKED` / `PORTRAIT` / `LANDSCAPE`, отдельные локи для PIP и grid-режима (каскадный фоллбек на `lock_state`); настраивается и в портале, отдельно для телефонов/планшетов ([layout](https://docs.discord.com/developers/activities/development-guides/layout)).
- **Режимы отображения:** focused / picture-in-picture / grid; подписка `ACTIVITY_LAYOUT_MODE_UPDATE` (для старых клиентов — `subscribeToLayoutModeUpdatesCompat`). В PIP стоит приостанавливать тяжёлый рендер. Отдельное событие `ORIENTATION_UPDATE` ([layout](https://docs.discord.com/developers/activities/development-guides/layout)).
- **Hardware acceleration / WebGL:** есть команда `encourageHardwareAcceleration()` — диалог включения аппаратного ускорения; «Switching the Hardware Acceleration setting causes the Discord client to quit and re-launch», поэтому вызывать сразу после инициализации SDK ([user-actions](https://docs.discord.com/developers/activities/development-guides/user-actions)). Для three.js — вызывать обязательно.
- **Термальные состояния:** событие `THERMAL_STATE_UPDATE` (enum NOMINAL/FAIR/SERIOUS/CRITICAL; на Android — только с Android 10+) — можно понижать качество рендера ([mobile#mobile-thermal-states](https://docs.discord.com/developers/activities/development-guides/mobile)).
- **Внешние ссылки:** только через `discordSdk.commands.openExternalLink({ url })` — пользователю показывается подтверждение с опцией «Trust this Domain» ([user-actions](https://docs.discord.com/developers/activities/development-guides/user-actions)). Прямые `window.open`/`<a target=_blank>` из песочницы не работают. Возврат `{ opened: boolean | null }`.
- **Контентные ограничения UX:** дока прямо не рекомендует «prohibitive gates in front of participation (e.g. login wall / paywall)» и запрещает pay-to-win: «monetized unlocks that give unfair advantage to other non-paying players» ([design-patterns](https://docs.discord.com/developers/activities/design-patterns)). Там же: «Small group sessions (3-8 people) show more engagement and retention from users than single-player experiences».
- **SPA:** «The SDK is intended for use by a single-page application» ([how-activities-work](https://docs.discord.com/developers/activities/how-activities-work)) — у wheee и так SPA на Vue.

---

## 6. Монетизация

Источники:
- https://docs.discord.com/developers/monetization/overview
- https://docs.discord.com/developers/monetization/enabling-monetization
- https://docs.discord.com/developers/monetization/implementing-iap-for-activities
- https://docs.discord.com/developers/platform/app-monetization

**Состояние на 2026:** Premium Apps = подписки (user/guild, recurring) + one-time purchases (durable/consumable) через единые SKU & Entitlement API; «App Monetization applies to Bots and Activities»; «Users never leave the platform to subscribe or make a purchase». Монетизированные приложения получают store page в App Directory ([platform/app-monetization](https://docs.discord.com/developers/platform/app-monetization)).

**Требования для включения** (дословно с [enabling-monetization](https://docs.discord.com/developers/monetization/enabling-monetization)):
- «App must be verified»; «App belongs to a developer team»; «Team owner must be at least 18 years old»; verified emails + 2FA у команды;
- ссылки на ToS и Privacy Policy; настроенные payouts; принятие Monetization Terms;
- **география: «Premium Apps is not currently available outside of these regions» — США, ЕС, Великобритания** (расширение обещано). Это ключевой ограничитель для команды wheee — нужно юрлицо/резидентство в этих регионах.
- Выплаты: «Once your app has made its first $100 it will become eligible for payout».

**Revenue share:** на загруженных страницах официальной доки проценты не указаны. По официальной статье саппорт-центра «Premium Apps' Required Support for Monetizing Apps» (https://support-dev.discord.com/hc/en-us/articles/23810643331735 — **страница не загрузилась напрямую, Cloudflare-блок; данные из поискового сниппета этой статьи**): Standard Tier — платформенная комиссия 30%; Growth Tier — 15% на первый $1M выручки команды. Требует перепроверки перед принятием решений.

**IAP внутри Activity** ([implementing-iap-for-activities](https://docs.discord.com/developers/monetization/implementing-iap-for-activities)): SDK-команды `getSkus()` (витрина), `getEntitlements()` (текущие права), `startPurchase(sku_id)` (открывает нативную модалку покупки), событие `ENTITLEMENT_CREATE` по завершении. Безопасность: «Data fetched from the Discord HTTP API from your application's backend servers can be trusted and should be treated as the source of truth» — паттерн «Trust (the SDK), but Verify (via the API)», т.е. выдача перков — только после серверной проверки entitlement.

**Реклама — фактически запрещена.** Официальный Developer Policy (https://support-dev.discord.com/hc/en-us/articles/8563934450327 — сам текст политики через поиск, страница также за Cloudflare): «Do not target users with advertisements or marketing» и запрет включать «any advertisements or other promotions within the functionality enabled by the API or SDK», плюс запрет передачи Discord Data рекламным сетям. Т.е. модель rewarded/interstitial-ads на Discord не переносится — только IAP. Для wheee сейчас это некритично (ads на web/TG и так выключены), но означает, что Discord-канал монетизируется только через Premium Apps, которые нам географически, вероятно, недоступны.

---

## 7. Дистрибуция и дискавери

Источники:
- https://docs.discord.com/developers/discovery/overview
- https://docs.discord.com/developers/discovery/enabling-discovery
- https://docs.discord.com/developers/activities/development-guides/assets-and-metadata (метаданные/арты — см. индекс dev-guides)

- **Поверхности дискавери** ([discovery/overview](https://docs.discord.com/developers/discovery/overview)): App Directory (поиск по имени, категории, страница с «descriptions, images, videos, and links») и **App Launcher** («collections and search from the app shapes icon throughout Discord»; секции Recent Apps, Installed Apps, Curated Collections, Partner, Promoted). Плюс социальное распространение: shareable links и Rich Presence («show what users are doing in your app, driving more users to discover it» — интеграция через `setActivity`, скоуп `rpc.activities.write`).
- **Верификация обязательна для дискавери**: «To enable Discovery for your app, we require your team owner to complete identity and application verification» ([enabling-discovery](https://docs.discord.com/developers/discovery/enabling-discovery)). Процесс: App Verification в портале (критерии — в меню App Verification) → опт-ин в Discovery + метаданные/изображения в Discovery Settings → «it may take up to 24 hours for your app to appear in the App Directory and App Launcher». Верификация же открывает монетизацию.
- **Лимит неверифицированных Activities:** официальная статья саппорт-центра «What are Verified and Unverified Activities?» (https://support-dev.discord.com/hc/en-us/articles/26576097154199 — **прямая загрузка заблокирована Cloudflare; факт из поискового сниппета статьи**): неверифицированные Activities запускаются только в серверах **менее чем с 25 участниками** и в ЛС — режим для разработки и приватных тестов. В самой docs.discord.com этот порог не встретился (проверено поиском по загруженным страницам).
- Featuring (Curated Collections/Promoted) — критерии в доке не описаны; управляется Discord.

Примечание: старый порог «100 серверов» для верификации ботов к Activities не относится — для Activities ограничение сформулировано через размер сервера (см. выше).

---

## 8. План интеграции по шагам (с привязкой к файлам)

### Шаг 0. Developer Portal (0.5 дня, руками)
1. Создать приложение (позже — team-аккаунт, если пойдём в верификацию/монетизацию), включить User+Guild install, redirect URI `https://127.0.0.1`.
2. Activities → Enable Activities; включить платформы Web/iOS/Android; задать orientation lock (рекомендую `UNLOCKED` + проверка, как UI ведёт себя в landscape; либо `PORTRAIT` как в TG-версии).
3. URL Mappings (порядок важен — специфичные выше):
   - `/gameapi` → `api.wheee.io`
   - `/` → прод-хост статики клиента (нужен отдельный хост/путь для discord-сборки, напр. `discord.wheee.io`)
4. Для dev: отдельное приложение на разработчика + `cloudflared tunnel` на локальный Vite (порт 5173), маппинг `/` → туннель.

### Шаг 1. Клиент: адаптер (1–1.5 дня)
- `packages/client/src/lib/platform/types.ts`: `PlatformType = 'web' | 'telegram' | 'yandex' | 'gamepush' | 'discord'`.
- `packages/client/src/lib/platform/detect.ts`: ветка `if (import.meta.env.VITE_PLATFORM === 'discord') return 'discord'` (по образцу yandex/gamepush; сборка `VITE_PLATFORM=discord vite build` — переменная уже прокинута в `packages/client/vite.config.ts`). Дополнительная runtime-страховка: `location.hostname.endsWith('.discordsays.com')`.
- Новый `packages/client/src/lib/platform/discord.ts` (структурно копия `telegram.ts`):
  - `npm i @discord/embedded-app-sdk` в `packages/client`.
  - `init()`: `new DiscordSDK(clientId)` → `encourageHardwareAcceleration()` → `ready()` → `authorize({client_id, response_type:'code', prompt:'none', scope:['identify','applications.commands']})` → `POST ${API_BASE}/api/auth/discord {code}` → сохранить наш JWT (`getAuthToken()`), затем `authenticate({access_token})`. Ретраи как в `loginWithRetry()`.
  - safe areas: прочитать `--discord-safe-area-inset-*` → `setSafeAreaInset()` (модуль `safeArea.ts` уже общий).
  - `getLanguage()`: `userSettingsGetLocale()` (требует скоуп `identify` — см. SDK reference).
  - `canAuth() = true`, `canShowLeaderboard() = true`, `canLinkOut()`: **false в MVP** (все внешние переходы прячем); позже можно `true` с реализацией перехода через `openExternalLink()` — но это требует прокинуть «как открывать ссылку» через адаптер, сейчас ссылки открываются напрямую.
  - Реклама: все ad-методы — `false`/no-op (реклама запрещена политикой, см. §6).
  - `storage`: `createLocalStorage()` из `defaults.ts` на старте; параллельно — задача на серверный прогресс (см. риски).
  - PIP/grid: `subscribeToLayoutModeUpdatesCompat` → мапить на существующие `onPause`/`onResume` (как visibilitychange в telegram.ts).
  - Экспортировать `instanceId`, `customId`, `referrerId`, участников — для матчмейкинга.
- `packages/client/src/lib/config.ts`: для discord-сборки `API_BASE = location.origin + '/gameapi'` (см. §2); формула `WS_URL` остаётся как есть.

### Шаг 2. Сервер: auth-эндпоинт (0.5 дня)
- `packages/server/src/auth/oauth.ts`: `authRoutes.post('/discord', …)` рядом с `/telegram` (строка 198):
  1. принять `{ code }`;
  2. `POST https://discord.com/api/oauth2/token` (`client_id`, `client_secret` из env, `grant_type=authorization_code`, `redirect_uri`);
  3. `GET https://discord.com/api/users/@me` с полученным Bearer;
  4. `upsertUser('discord', user.id, name, avatarUrl)` → наш JWT;
  5. вернуть `{ token, user, access_token }` (access_token нужен клиенту для `authenticate`).
- env на VPS: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`.
- (Фаза 2) проверка инстанса: `GET /applications/{app_id}/activity-instances/{instance_id}` перед допуском в приватную discord-комнату.

### Шаг 3. Автоматч в инстансе (1 день)
- `packages/shared/src/protocol.ts` + `packages/server/src/matchmaking.ts`: разрешить клиентский код комнаты (`friend:create { code?: 'dc-…' }`) для discord-инстансов; идемпотентность: если код занят — вести себя как `friend:join`.
- Клиент: логика из §4 (лидер по min user id создаёт, остальные джойнят; подписка на `ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE`; >2 участников → экран «идёт матч» + глобальная очередь).
- Челлендж-ссылки: кнопка «позвать друга» → `shareLink({custom_id: code})`; на старте читать `discordSdk.customId` → существующий обработчик `?join=CODE`.

### Шаг 4. UX/мобайл-полировка и тесты (1–2 дня)
- Safe areas, ориентация, PIP-пауза рендера, `THERMAL_STATE_UPDATE` → понижение качества.
- Тест WSS-латентности через прокси (пинг-оверлей уже есть в игре? если нет — временный).
- Тест WebGL на Discord iOS/Android + web-клиенте.
- Логи через `RpcApplicationLogger`, при необходимости `captureLog`.

### Шаг 5. Дистрибуция (календарные недели, параллельно)
- Страницы ToS + Privacy Policy (нужны для верификации/монетизации).
- App Verification (identity + app) → Discovery opt-in, метаданные и арты по [assets-and-metadata](https://docs.discord.com/developers/activities/development-guides/assets-and-metadata).
- Rich Presence (`setActivity`, скоуп `rpc.activities.write`) — дешёвый органический дискавери.

---

## Открытые риски и вопросы

1. **Латентность WSS через прокси.** Весь realtime-трафик пойдёт client → Cloudflare Worker → api.wheee.io. Официальных цифр по латентности нет. Нужен замер RTT из Discord-клиента до нашего VPS через `{clientId}.discordsays.com` до начала основной работы. Прямое подключение к api.wheee.io невозможно (CSP).
2. **Cloudflare-бан IP.** [production-readiness#static-ip-addresses](https://docs.discord.com/developers/activities/development-guides/production-readiness): «there is a non-zero chance that you will inherit from a previous bad actor an IP address which has been banned by Cloudflare» — рекомендация закрепить статический egress-IP; проверить, что IP нашего VPS не в бане (иначе прокси не достучится).
3. **WebGL/three.js в мобильном webview Discord.** Дока даёт только `encourageHardwareAcceleration` (десктоп) и термальные события; производительность на среднем Android-устройстве — только эмпирически.
4. **localStorage внутри iframe.** Официальная дока описывает только cookies (`SameSite=None; Partitioned`), про localStorage молчит. Риск: партиционирование/очистка в web-клиенте Discord. Митигация: прогресс хранить на сервере под discord user id (auth и так обязательный) — у нас уже есть `PlatformStorage`-абстракция, можно сделать серверный бэкенд как у GamePush-адаптера.
5. **`/.proxy`-префикс.** В актуальной доке отсутствует, в README SDK ещё встречается. Проверить в UI портала при создании приложения, не навязывается ли префикс новым маппингам. Инкапсулировано в `config.ts` — риск низкий.
6. **Правила клиентского кода комнаты.** Наш сервер сейчас сам генерирует friend-коды; детерминированный `dc-${instanceId}` требует аккуратной защиты от коллизий/захвата чужого инстанса — валидировать через activity-instances API (§3) или подписанные заголовки прокси.
7. **Монетизация географически недоступна?** Premium Apps — только US/EU/UK ([enabling-monetization](https://docs.discord.com/developers/monetization/enabling-monetization)). Если у команды нет юрлица в этих регионах, Discord-канал остаётся чисто дистрибуционным (что тоже ок: реклама там всё равно запрещена).
8. **Порог 25 участников до верификации** — тесты только в маленьких серверах и ЛС; публичный запуск упирается в верификацию (identity + app verification, team-аккаунт). Источник — статья саппорт-центра, которую не удалось загрузить напрямую (Cloudflare): https://support-dev.discord.com/hc/en-us/articles/26576097154199; перепроверить руками.
9. **>2 участников в инстансе.** MVP — «матч идёт» + глобальная очередь; спектейт (рекомендуемый докой паттерн) — отдельная задача.
10. **Матч между инстансами.** Задокументированного запрета нет (проверено по [multiplayer-experience](https://docs.discord.com/developers/activities/development-guides/multiplayer-experience)), но при верификации ревью может задать вопросы к UX — держать понятный экран «играешь с игроком из другого сервера».
11. **Хостинг discord-сборки.** Нужен отдельный origin/путь для сборки с `VITE_PLATFORM=discord` (например `discord.wheee.io`) — root-маппинг указывает на директорию, не на файл.

---

## Использованные источники (все загружены 2026-08-23)

Официальная документация (docs.discord.com — канонический хост discord.com/developers/docs/*, 301):
- https://docs.discord.com/developers/activities/overview
- https://docs.discord.com/developers/activities/how-activities-work
- https://docs.discord.com/developers/activities/building-an-activity
- https://docs.discord.com/developers/activities/development-guides
- https://docs.discord.com/developers/activities/development-guides/local-development
- https://docs.discord.com/developers/activities/development-guides/networking
- https://docs.discord.com/developers/activities/development-guides/multiplayer-experience
- https://docs.discord.com/developers/activities/development-guides/user-actions
- https://docs.discord.com/developers/activities/development-guides/mobile
- https://docs.discord.com/developers/activities/development-guides/layout
- https://docs.discord.com/developers/activities/development-guides/production-readiness
- https://docs.discord.com/developers/activities/development-guides/growth-and-referrals
- https://docs.discord.com/developers/activities/design-patterns
- https://docs.discord.com/developers/developer-tools/embedded-app-sdk
- https://docs.discord.com/developers/topics/oauth2
- https://docs.discord.com/developers/monetization/overview
- https://docs.discord.com/developers/monetization/enabling-monetization
- https://docs.discord.com/developers/monetization/implementing-iap-for-activities
- https://docs.discord.com/developers/platform/app-monetization
- https://docs.discord.com/developers/platform/activities
- https://docs.discord.com/developers/discovery/overview
- https://docs.discord.com/developers/discovery/enabling-discovery

Официальный SDK Discord:
- https://github.com/discord/embedded-app-sdk (README, raw загружен)

Официальный саппорт-центр разработчиков Discord (прямая загрузка заблокирована Cloudflare — факты из поисковых сниппетов, требуют ручной перепроверки):
- https://support-dev.discord.com/hc/en-us/articles/26576097154199-What-are-Verified-and-Unverified-Activities (лимит <25 участников для неверифицированных)
- https://support-dev.discord.com/hc/en-us/articles/23810643331735-Premium-Apps-Required-Support-for-Monetizing-Apps (комиссия 30% / 15% Growth Tier)
- https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy (запрет рекламы)
