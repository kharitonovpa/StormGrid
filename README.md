# wheee

PvP тактическая игра 1v1 на сетке 7×7 с двухсторонней картой. Игроки одновременно
(в тиках) двигаются и меняют рельеф; после 5 тиков приходит катаклизм (ветер и/или
дождь). Цель — чтобы катаклизм убил соперника, а не вас.

Прод: [wheee.io](https://wheee.io) · [ru.wheee.io](https://ru.wheee.io) · Telegram Mini App · Yandex Games · GamePush

## Стек

- **Runtime:** Bun (сервер, пакетный менеджер, тесты)
- **Сервер:** Hono (HTTP) + Bun native WebSocket, SQLite (`bun:sqlite`) + Drizzle ORM
- **Клиент:** Vue 3 + Three.js + Howler, Vite
- **Монорепо:** Bun workspaces

## Структура

```
packages/shared/   @wheee/shared — общие типы, константы, WS-протокол
packages/server/   @wheee/server — game engine, комнаты, matchmaking, auth, БД
packages/client/   @wheee/client — Vue 3 + Three.js фронтенд, платформенные адаптеры
game/              документация (см. ниже)
deploy/            деплой-скрипты, docker-compose, nginx-конфиги
```

## Документация

| Файл | Что внутри |
|------|-----------|
| `game/GAME_DESIGN.md` | Правила игры: доска, роли, тики, ветер/дождь, бонусы, типы данных |
| `game/PLAN.md` | План разработки по фазам (все завершены) |
| `game/INFRASTRUCTURE.md` | Прод-инфраструктура, деплой, платформы, auth, env-переменные |
| `game/TERRA.md` | Архивный дизайн-промпт системы террейна |
| `.cursor/rules/architecture.mdc` | Карта модулей и архитектурные правила |

## Разработка

```bash
bun install

bun run dev:server   # сервер на http://localhost:3001 (WS: /ws)
bun run dev:client   # клиент на http://localhost:5173
```

В dev-режиме клиент сам ходит на `localhost:3001`. Без OAuth-ключей играется
анонимно; `JWT_SECRET` в dev не обязателен (используется небезопасный фоллбек с warning).

Полезные env сервера: `PORT`, `DB_PATH`, `JWT_SECRET`, `TG_BOT_TOKEN`,
`BOT_MATCH_DELAY_MS`, `RECONNECT_GRACE_MS` — полный список в
`deploy/.env.example` и `game/INFRASTRUCTURE.md`.

## Тесты

```bash
bun test   # из корня (запускает тесты packages/server)
```

Unit-тесты (engine, bot, auth, db, ratelimit) работают автономно.
Интеграционные сьюты (`integration`, `watcher`, `architect`, `reconnect`)
подключаются по WebSocket к `localhost:3001` — перед запуском поднимите сервер
с тестовыми параметрами:

```bash
cd packages/server
RECONNECT_GRACE_MS=2000 BOT_MATCH_DELAY_MS=600000 bun src/index.ts
```

(короткий grace нужен тесту forfeit, большая задержка бота — чтобы бот не
вмешивался в матчи тестов).

Сьют `bot-room.test.ts` играет полный раунд на реальных таймерах (~30 с) и может
флакать при параллельном прогоне всех файлов — при падении перезапустите его отдельно:
`bun test src/engine/__tests__/bot-room.test.ts`.

## Деплой

```bash
bun run deploy           # всё: env sync → сервер (PL) → статика (RU) → zip-архивы
bun run deploy:server    # только польский VPS (docker compose)
bun run deploy:ru        # только российский VPS (статика)
bun run deploy:archives  # только wheee-yandex.zip + wheee-gamepush.zip
```

Подробности — `game/INFRASTRUCTURE.md`.
