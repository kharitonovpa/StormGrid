# StormGrid — Development Plan

---

## Phase 0 — Shared Foundation ✅ DONE

> Монорепо (Bun workspaces), общие типы, dev-инфраструктура

- ✅ Monorepo: `packages/shared`, `packages/server`, `packages/client`
- ✅ Shared types: `@stormgrid/shared` — `GameState`, `Action`, `Player`, `ForecastData`, `BonusType`, `WatcherState`, etc.
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

## Phase 2b — Auth + Persistence (future)

> OAuth2, PostgreSQL, Redis — когда понадобится сохранение прогресса

| # | Задача | Детали |
|---|--------|--------|
| 2b.1 | Auth — OAuth2 | Google + GitHub OAuth. JWT access/refresh tokens. Cookie-based sessions |
| 2b.2 | User model + DB | PostgreSQL: `users(id, provider, provider_id, name, avatar, created_at)`. Drizzle ORM |
| 2b.3 | Matchmaking Redis | Redis-backed очередь вместо in-memory |
| 2b.4 | Match history | Сохранение результатов матчей в БД |

---

## Phase 3 — Client Network Integration ✅ DONE

> Фронтенд подключен к серверу, играбельный 1v1 с двухсторонней картой

- ✅ WS protocol types moved to `@stormgrid/shared`
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
| 7.1 | Character visuals | 3 уникальных пламени / маркера для Wheat, Rice, Corn |
| 7.2 | Sound design | Ambient, wind, rain, tick countdown, death, victory |
| 7.3 | Mobile-friendly | Touch input, responsive HUD |
| 7.4 | ✅ Reconnect handling | Переподключение при потере WS, восстановление state |
| 7.5 | Replay system | Сохранение match log → просмотр повтора |
| 7.6 | Leaderboard | Рейтинг игроков и наблюдателей (по очкам предсказаний) |
| 7.7 | Deploy | Docker compose: server + Postgres + Redis. Фронт на CDN (Vercel / Cloudflare Pages) |
| 7.8 | Rate limiting & anti-cheat | Throttle actions, validate timing, server-side only |

---

## Execution Order & Dependencies

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4
                                        │            │
                                        ▼            ▼
                                     Phase 5 ◄── Phase 6
                                        │
                                        ▼
                                     Phase 7
```

* **Phase 0 + 1** можно делать параллельно (monorepo setup + engine в отдельном пакете)
* **Phase 4, 5, 6** можно частично параллелить после Phase 3
* **Phase 7** — финальная полировка

---

## Immediate Next Step → Phase 7: Polish & Production

Фазы 0–6 завершены. Следующий шаг — финальная полировка:
1. **Character visuals** — уникальные маркеры для Wheat, Rice, Corn
2. **Sound design** — ambient, wind, rain, tick countdown, death, victory
3. **Mobile-friendly** — touch input, responsive HUD
4. **Reconnect handling** — восстановление при потере WS
