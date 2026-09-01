# Discord Rich Presence — дизайн

Дата: 2026-09-01. Основание: `docs/superpowers/specs/2026-08-23-discord-activity-v1-design.md` (§13 явно вынес `setActivity` из v1) + `marketing/DISCORD_GROWTH_LEVERS_RESEARCH.md` (Rich Presence — единственный бесплатный органический канал обнаружения, не требующий одобрения Discord).

## Цель

Показывать друзьям игрока в Discord, что он сейчас делает в wheee («Ищет соперника», «В матче» и т.п.) через стандартную карточку статуса. Это канал открытия игры «друг увидел — заинтересовался», отдельный от уже существующих shareLink-приглашений.

## Скоуп (утверждён)

Текстовый статус (`details`), обновляемый на переходах между укрупнёнными фазами игры. Локализация EN/RU.

**Вне скоупа этой итерации** (сознательно, обсуждено и отклонено при брейнсторминге):
- Кнопка присоединения (`party`/`secrets.join` + подписка на `ACTIVITY_JOIN`) — доставка этого события до Activity (в отличие от нативных Discord Game SDK-игр) не подтверждена ни одним источником; откладываем до отдельного решения о его добавлении.
- Детали матча в статусе (ник соперника, счёт, раунд) — общая формулировка выбрана осознанно: меньше вопросов приватности, меньше поводов для отказа при будущих ревью Discord.
- Presence на основе бейджа/стрика (`badgeFor()` — см. серверный streak, `wheee-growth-context`) — отдельная идея, не в этой итерации.

## Маппинг фаз

`ClientPhase` (`packages/client/src/composables/useGameState.ts`) → укрупнённая корзина статуса:

| `ClientPhase` | Корзина | `details` (RU / EN) |
|---|---|---|
| `lobby` | `lobby` | «В лобби» / «In the lobby» |
| `queue`, `architect_queue` | `queue` | «Ищет соперника» / «Looking for an opponent» |
| `friend_wait` | `waiting_friend` | «Ждёт друга» / «Waiting for a friend» |
| `forecast`, `ticking`, `weather` | `in_match` | «В матче» / «In a match» |
| `finished` | — (не обновляем) | статус остаётся «В матче» до следующего перехода — фаза длится секунды |
| `watching`, `watch_queue` | `watching` | «Смотрит повтор» / «Watching a replay» |

`type: 0` (Playing). Верхнюю строку карточки («Playing wheee») Discord рисует сам из имени приложения — поле `name` не входит в `SetActivityInput` (проверено по типам `@discord/embedded-app-sdk@2.5.0`, `output/commands/setActivity.d.ts`), переопределить нельзя и не нужно.

## Архитектура

Три новых элемента, каждый ложится на существующий паттерн:

| Элемент | Где | Образец |
|---|---|---|
| Чистая функция маппинга | `packages/client/src/lib/platform/discordPresence.ts` (новый файл) — `presenceBucketForPhase(phase: ClientPhase): PresenceBucket` | — (нет прямого образца, но небольшой чистый модуль в духе `safeArea.ts`) |
| SDK-free мост | `discordBridge.ts` — `setDiscordPresence(bucket: PresenceBucket): void`, no-op пока адаптер не зарегистрировал хендл | `shareDiscordLink`, `onDiscordParticipantCount` (тот же файл) |
| SDK-вызов | `discord.ts` — новый хендл `setPresence` в `registerDiscordHandles`, вызывает `sdk.commands.setActivity` | `shareLink`-хендл в том же файле |

Название файла `discordPresence.ts`, а не расширение `discordBridge.ts` — маппинг фаз в текст не обязан тянуть тип `PresenceBucket` в основной мост-файл; разделение держит `discordBridge.ts` тонким (сейчас 55 строк, только SDK-free геттеры).

## 1. Скоуп OAuth

`sdk.commands.authorize({ ..., scope: ['identify', 'applications.commands', 'rpc.activities.write'] })` в `loginWithRetry()` — новый скоуп в существующем массиве, без структурных изменений auth-потока.

## 2. Вызов setActivity

В `discord.ts # init()`, в блоке `if (authed) { ... }` (тот же гейт, что у `userSettingsGetLocale`/`getInstanceConnectedParticipants` — RPC-команды не отвечают до `authenticate()`):

```ts
setPresence: (bucket: PresenceBucket) => {
  sdk.commands.setActivity({
    activity: { type: 0, details: PRESENCE_TEXT[this.locale][bucket] },
  }).catch(() => {}) // presence — не критичный путь, тихо глотаем сбой
},
```

`PRESENCE_TEXT` — объект `{ en: {...}, ru: {...} }` в `discordPresence.ts`, ключи — значения `PresenceBucket`. Локаль читаем в момент вызова (`this.locale`, уже установлен из `userSettingsGetLocale()` до регистрации хендлов), отдельного i18n-провайдера подключать не нужно — это не UI-текст в разметке, а данные для SDK-вызова. `userSettingsGetLocale()` возвращает произвольный BCP-47 код (не только `en`/`ru`) — словарь на любой ключ вне `PRESENCE_TEXT` фоллбечит на `en` (`PRESENCE_TEXT[locale] ?? PRESENCE_TEXT.en`), а не падает.

## 3. Триггер из App.vue

```ts
watch(() => game.phase.value, (phase) => {
  setDiscordPresence(presenceBucketForPhase(phase))
}, { immediate: true })
```

`presenceBucketForPhase('finished')` возвращает `null` — `setDiscordPresence(null)` не вызывает `setActivity` (фаза статуса не меняется, ждём следующий переход). Дедупликация на смене корзины (не самого `ClientPhase` — три игровых подфазы `forecast`/`ticking`/`weather` не должны бомбить `setActivity` на каждый тик) держится внутри `setDiscordPresence`: хранит последнюю отправленную корзину, не шлёт повтор. Официального rate-limit для `setActivity` в доках не нашли (см. `marketing/DISCORD_ACTIVITIES_INTEGRATION_RESEARCH.md`) — при такой частоте (единицы вызовов за сессию) это не риск, отдельный троттлинг не нужен.

`watch` живёт в `App.vue` рядом с остальными platform-side-effect'ами (аналогично существующим вызовам аналитики на смену фазы), не в composable — `discordPresence`/`discordBridge` ничего не знают про Vue.

## 4. Тестирование

- Юнит: `presenceBucketForPhase` — таблица маппинга целиком, включая `finished → null`. Юнит на дедуп в `setDiscordPresence` (два вызова с одной корзиной подряд → один реальный `setActivity`).
- Ручное (обязательно, автотестами не покрыть): dev-контур из `DISCORD_LAUNCH_CHECKLIST.md` §5 (dev-приложение + `cloudflared tunnel`). Один аккаунт проходит все фазы (лобби → очередь/приглашение → матч → повтор), второй аккаунт (друг в списке) глазами проверяет каждую строчку статуса на своей карточке профиля. Отдельно проверить EN и RU (сменить `userSettingsGetLocale` можно только сменой языка в самом Discord-клиенте тестового аккаунта).

## Риски

- **Без подтверждённого rate-limit** — если `setActivity` всё же лимитирован жёстче, чем «единицы вызовов за сессию», текущая дедуп-схема всё равно укладывается: при обычной игре это 4–6 вызовов (лобби → очередь → матч → [повтор]).
- **Presence может не проявиться в проде до полного прогрева SDK-сессии** (аналогично тому, как участники/локаль недоступны до `authenticate()`) — уже учтено тем же гейтом `if (authed)`.
- Прочие риски канала (латентность прокси, `/.proxy`-префикс, порог 25 участников) — не новые, унаследованы из `2026-08-23-discord-activity-v1-design.md`, эта фича их не касается.
