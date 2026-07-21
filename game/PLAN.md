# wheee — Development Plan

---

## Phase 0 — Shared Foundation ✅ DONE

> Монорепо (Bun workspaces), общие типы, dev-инфраструктура

- ✅ Monorepo: `packages/shared`, `packages/server`, `packages/client`
- ✅ Shared types: `@wheee/shared` — `GameState`, `Action`, `Player`, `ForecastData`, `BonusType`, `WatcherState`, etc.
- ✅ Dev scripts: `bun test`, `bun run dev:client`, `bun run dev:server`
- ✅ Runtime: Bun (package manager + test runner + server runtime)

---

## Phase 1 — Game Engine ✅ DONE

> Детерминированный серверный движок, покрытый тестами

- ✅ `GameEngine` class — round lifecycle, phase management, architect override
- ✅ Tick resolver — simultaneous moves (8-dir king movement), raise/lower, conflict resolution
- ✅ Wind resolver — upwind shielding scan, downwind push, pit fall, edge death, two-sided height perception
- ✅ Rain resolver — BFS basin detection, separate flooding per player side (floodedCellsA/B), drowning
- ✅ Forecast generator — wind every cataclysm (55% wind-only, 45% wind+rain), wind candidates, rain probability
- ✅ Win/lose + bonus system — death check, draw, bonus activation
- ✅ Two-sided gameplay — `stateForPlayer()` negates board for B, `resultForPlayer()` sends per-player flood data
- ✅ Action inversion — Player B's raise ↔ lower inverted on server before canonical apply
- ✅ Terrain under player — can modify cell occupied by any player
- ✅ Unit tests (bun:test) — tick, wind, rain, engine lifecycle, two-sided inversion

---

## Phase 2a — Playable Game Server ✅ DONE

> In-memory мультиплеер: Hono + Bun WebSocket, комнаты, матчмейкинг, tick timer (39 tests pass)

- ✅ `protocol.ts` — typed WS messages (ClientMessage / ServerMessage union types)
- ✅ `Room.ts` — game room: GameEngine + tick timer + player slots + broadcast
- ✅ `RoomManager.ts` — room registry, create/get/cleanup
- ✅ `matchmaking.ts` — in-memory queue, auto-pair
- ✅ `index.ts` — Hono HTTP (`/health`, `/`) + Bun native WS (`/ws`), message routing
- ✅ Integration test — two WS clients connect, queue, match, play through ticks

## Phase 2b — Auth + Persistence ✅ DONE

> SQLite (bun:sqlite) + Drizzle ORM, OAuth2, match history. Redis не нужен (single-instance).

- ✅ `bun:sqlite` + Drizzle ORM — WAL mode, zero extra containers, in-process DB
- ✅ Schema: `users`, `matches`, `replays` tables + migrations (drizzle-kit)
- ✅ Auth — Google + GitHub OAuth2, JWT cookies (HS256), popup flow with `postMessage`
- ✅ WS upgrade extracts `userId` from cookie (`WsData.userId`)
- ✅ Client `useAuth` composable — `login()` / `logout()` / `fetchMe()`, reactive user state
- ✅ LobbyOverlay — Sign In dropdown (Google/GitHub), user avatar chip, Sign Out
- ✅ Match history — `saveMatch()` on game end, `GET /api/me/matches` (authenticated)
- ✅ Replay persistence — replays saved to SQLite, API falls back to DB
- ✅ Docker volume for SQLite file persistence across container restarts
- ✅ Tests: JWT sign/verify, cookie parsing, DB CRUD (12 new tests, 66 core tests pass)

**Решение:** SQLite вместо PostgreSQL (встроен в Bun, 3-6x быстрее, zero infra). Redis убран — matchmaking остаётся in-memory (single server). Миграция на PostgreSQL через Drizzle — смена драйвера, если понадобится.

---

## Phase 3 — Client Network Integration ✅ DONE

> Фронтенд подключен к серверу, играбельный 1v1 с двухсторонней картой

- ✅ WS protocol types moved to `@wheee/shared`
- ✅ `useGameSocket` composable — typed WS connection + action submission
- ✅ `useGameState` composable — reactive store (phase, tick, players, board)
- ✅ `terrain.ts` — `applyBoardState()` + `resetFlat()` for server state sync
- ✅ `player.ts` — two players (A + B), `applyPositions()`, 8-dir king movement, wind slide animation with fade-out on death
- ✅ `preview.ts` — action preview system: displacement-line grid for raise/lower, gradient ribbon for move
- ✅ `LobbyOverlay.vue` — character select (Wheat/Rice/Corn placeholders) + Play button
- ✅ `GameHud.vue` — tick countdown bar, round info, phase display
- ✅ `GameOverOverlay.vue` — win/lose/draw screen + Play Again
- ✅ `App.vue` — full integration: server state drives terrain + players, actions via WS, preview on action submit, delayed game:end during weather animation

**Результат:** Lobby → Queue → Match → Ticks (с action preview) → Weather (с wind animation) → Game Over → Play Again

---

## Phase 4 — VFX, Forecast & Visual Polish ✅ DONE

> Цель: визуальная обратная связь, VFX, UI подсказки для игрока

- ✅ Phase-aware VFX — wind, rain, water effects appear only during weather phase
- ✅ Dynamic wind direction — VFX wind direction set by server per cataclysm
- ✅ Wind push animation — players visually slide along wind path, fade-out on death
- ✅ Delayed game:end popup — death popup waits for wind animation to finish
- ✅ `ForecastPanel.vue` — wind direction + rain probability display (минималистичный: иконки без текста, барометр внутри компаса)
- ✅ `compass.ts` — 3D compass system in scene
- ✅ Action preview — displacement-line grid (raise/lower) + gradient ribbon (move)
- ✅ Wind Vane — интегрирован в компас, плавная анимация направления
- ✅ Rain Barometer — иконка погоды внутри компаса (☀️/🌤/⛅/🌧/⛈)
- ✅ Broken instrument state — хаотичные показания при поломке наблюдателем

**Результат:** игрок видит прогноз; если наблюдатель сломал прибор — информация теряется.

---

## Phase 5 — Watcher Mode ✅ DONE

> Цель: наблюдатель с собственными механиками

- ✅ Watcher join flow — кнопка «Watch» в лобби → `watch:join` → сервер назначает на активный матч → `watch:assigned` с полным состоянием
- ✅ Watcher camera — `TrackballControls` с неограниченным вращением (видит обе стороны карты), авто-фокус на выбранном игроке
- ✅ Predict Winner UI — кнопки A/B во время forecast, выбранное состояние сохраняется (dimmed/chosen), disabled после выбора
- ✅ Predict Move UI — клик на игрока → показ ходов, клик на клетку → raise/lower предикция, авто-определение цели по стороне карты
- ✅ Break Instrument — кнопки Vane/Baro (1 раз за матч), ломает у обоих игроков, визуал трещины на иконке
- ✅ Watcher scoreboard — очки с анимацией, история предсказаний (цветные точки ✓/×)
- ✅ Auto-rotation — `watcher:redirect` → авто-переподключение к следующему матчу
- ✅ Celebration animation — салют из клетки при верном предсказании хода, попап при угадывании победителя
- ✅ Dual-surface interaction — клики и превью корректно работают на обеих сторонах карты

**Результат:** наблюдатель смотрит матчи подряд, предсказывает, ломает приборы, копит очки.

---

## Phase 6 — Architect Mode ✅ DONE

> Цель: ручное управление катаклизмами

- ✅ Architect join — кнопка «Architect» в лобби (фиолетовая тема) → `architect:join` → назначение на активный матч (макс 1 на комнату)
- ✅ Weather picker UI — `ArchitectHud.vue`: выбор типа погоды (Wind/Storm/Rain), направления ветра (N/E/S/W), обратный отсчёт 8с, кнопка Confirm
- ✅ Bonus placement UI — кнопки Time/Intel/Clear Sky → клик на клетку для размещения, серверная валидация (bounds, не на игроке)
- ✅ Architect view — полная каноническая карта, `TrackballControls`, оба игрока видны на своих сторонах
- ✅ Fallback — если архитектор не отвечает за 8с (`ARCHITECT_DECISION_MS`), игра продолжается с авто-сгенерированной погодой
- ✅ Protocol — 4 клиентских + 3 серверных типа сообщений, `WsData.role` расширен на `'architect'`
- ✅ Engine — `GameEngine.placeBonus()` + существующий `setWeatherDecision()`, `broadcastSpectators()` для архитектора + вотчеров
- ✅ Tests — 8 интеграционных тестов (join, no match, max 1, tick broadcast, set weather, place bonus, fallback, game:end)

**Результат:** Architect как game-master управляет погодой и бонусами. 62 теста pass.

---

## Phase 7 — Polish & Production (1–2 недели)

| # | Задача | Детали |
|---|--------|--------|
| 7.1 | ✅ Character visuals | GLB-модели (Meshy AI) для Wheat, Rice, Corn. Матовые PBR-материалы (roughness 0.92, metalness 0), пастельные цвета, per-character масштаб. 3D-превью с вращением и покачиванием в лобби |
| 7.2 | ✅ Sound design | Howler.js audio system: ambient pads, music loops, weather loops (wind/rain), 19 SFX (terrain, move, wind push, death, tick countdown, UI clicks, match found, victory/defeat/draw, watcher predictions, instrument break, architect confirm). VolumeControl component with mute + Music/SFX sliders. localStorage persistence |
| 7.3 | ✅ Mobile-friendly | Touch input (pointerdown/up, synthetic click suppression, touch hover highlight), responsive HUD/Lobby/Overlays (media queries 640px), viewport clamping для radial menu, CharacterPreview fluid sizing, bugfix: flood BFS bounds check |
| 7.4 | ✅ Reconnect handling | Переподключение при потере WS, восстановление state |
| 7.5 | ✅ Replay system | Snapshot-based replay: сервер записывает кадры (GameState + weather), HTTP API для списка/загрузки, клиент с step/play/pause, анимация катаклизмов |
| 7.6 | ✅ Leaderboard | `user_stats` table (wins/losses/draws/watcherScore), auto-update on match end, `/api/leaderboard/players` + `/watchers`, `LeaderboardPanel.vue` с табами Players/Watchers, gold/silver/bronze ранги |
| 7.7 | ✅ Deploy | Docker compose (Bun + nginx), Dockerfile multi-stage build, Cloudflare Pages (global) + direct nginx (RU), api.wheee.io direct to origin Warsaw |
| 7.8 | ✅ Rate limiting & anti-cheat | Token bucket per connection (25 burst / 15/sec), message size limit (1KB), invalid message flood disconnect (5 streak), server-side validation |

---

## Phase 8 — Multi-Platform & Growth ✅ DONE

> Цель: дистрибуция на нескольких платформах из одной кодовой базы

- ✅ **Platform Adapter layer** — `lib/platform/`: единый интерфейс `PlatformAdapter` (auth, ads, pause/resume, language), адаптеры Web / Telegram / Yandex / GamePush, детекция через `VITE_PLATFORM` + runtime
- ✅ **Telegram Mini App** — условная загрузка TG SDK в `index.html`, auth через `initData` (HMAC-проверка на сервере, `TG_BOT_TOKEN`), JWT в памяти + `?token=` для WS
- ✅ **Yandex Games** — `deploy-yandex.sh` → `wheee-yandex.zip`; YaGames SDK, LoadingAPI/GameplayAPI, fullscreen + rewarded ads (15s timeout), auth `getPlayer({signed:true})` → `/api/auth/yandex` (опц. проверка подписи `YANDEX_SECRET_KEY`)
- ✅ **GamePush (Pikabu Games)** — `deploy-gamepush.sh` → `wheee-gamepush.zip`; SDK через `onGPInit` callback, preloader/fullscreen/rewarded ads, auth `gp.player` → `/api/auth/gamepush`
- ✅ **Бот-матчмейкинг** — `engine/bot.ts` + авто-матч с ботом через `BOT_MATCH_DELAY_MS` (30 с) ожидания в очереди; человекоподобные задержки 1–4 с
- ✅ **i18n** — `lib/i18n.ts` (en/ru), язык из платформы, реактивные строки
- ✅ **Russian mirror** — `ru.wheee.io` (Timeweb VPS, reverse proxy в Варшаву, обход ТСПУ), multi-domain cookie `.wheee.io`
- ✅ **SEO** — robots.txt, sitemap.xml, hreflang, OG/Twitter meta, Yandex Webmaster verification
- ✅ **Onboarding & polish** — обучающий practice-матч с ботом (untimed-тики + TutorialHud, заменил StoriesOverlay-слайды), lobby demo-синематик, nameplates с флагами, UserAvatar fallback для CSP-платформ, HTTP rate limiting, платформенные origin-проверки auth

Подробности деплоя и платформ — в `INFRASTRUCTURE.md`.

---

## Execution Order & Dependencies

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4
                                        │            │
                                        ▼            ▼
                                     Phase 5 ◄── Phase 6
                                        │
                                        ▼
                                     Phase 7 ──► Phase 8
```

* **Phase 0 + 1** можно делать параллельно (monorepo setup + engine в отдельном пакете)
* **Phase 4, 5, 6** можно частично параллелить после Phase 3
* **Phase 7** — полировка, **Phase 8** — платформы и дистрибуция

---

## Status: All Phases Complete

Все фазы (0–8 + 2b) завершены. Игра в проде: `wheee.io`, `ru.wheee.io`, Telegram Mini App, Yandex Games, GamePush.

Тесты: `bun test` в `packages/server` — 104 теста в 13 файлах (unit: engine/bot/auth/db/ratelimit; integration-сьюты `integration`/`watcher`/`architect`/`reconnect` требуют запущенного локально сервера:
`RECONNECT_GRACE_MS=2000 BOT_MATCH_DELAY_MS=600000 bun src/index.ts`).
