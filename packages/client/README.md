# @wheee/client

Vue 3 + Three.js фронтенд игры wheee. Клиент **не считает игровые правила** —
только рендерит состояние, полученное от сервера по WebSocket.

## Запуск

```bash
bun run dev      # vite dev server, API ожидается на localhost:3001
bun run build    # vue-tsc -b && vite build
```

## Структура

```
src/
├── main.ts                 # initPlatform() → setLanguage() → mount App
├── App.vue                 # оркестратор: сцена, режимы (lobby/play/watch/architect/replay)
├── components/             # UI-оверлеи и HUD (Lobby, GameHud, Watcher/ArchitectHud, ...)
├── composables/            # useGameSocket, useGameState, useAuth
└── lib/
    ├── terrain|water|wind|rain|player|preview|compass|nameplate|interaction.ts
    │                       # визуальные системы (фабрики create*System)
    ├── models|audio|celebrate|lobbyDemo|replayPlayer|i18n|noise|config|constants.ts
    └── platform/           # адаптеры web / telegram / yandex / gamepush
```

Карта модулей и правила — в `.cursor/rules/architecture.mdc` (корень репо).

## Платформенные сборки

| Target | Команда | Особенности |
|--------|---------|-------------|
| Web (prod) | `VITE_API_URL=https://api.wheee.io vite build` | base `/` |
| RU mirror | `VITE_API_URL="" vite build` | same-origin API |
| Yandex Games | `deploy/deploy-yandex.sh` | base `./`, инжект `/sdk.js`, вырезаются Google Fonts / TG SDK |
| GamePush | `deploy/deploy-gamepush.sh` | base `./`, инжект GP SDK (нужны `VITE_GP_PROJECT_ID`, `VITE_GP_PUBLIC_TOKEN`) |

Трансформации `index.html` делает `platformHtmlPlugin` в `vite.config.ts`.
Деплой целиком описан в `game/INFRASTRUCTURE.md`.
