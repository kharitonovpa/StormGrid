# wheee — тексты для Discord App Directory / Discovery

Готовые блоки под поля портала (спеки полей — `marketing/DISCORD_VERIFICATION_RESEARCH.md`, раздел «Что подготовить заранее»). Дата: 2026-08-24.

## Идентификаторы

| Поле | Значение |
|---|---|
| Название | wheee |
| App ID / Client ID | 1541107251346153492 |
| Install URL | https://discord.com/oauth2/authorize?client_id=1541107251346153492 |
| ToS / Privacy | https://wheee.io/terms · https://wheee.io/privacy |
| Категория/жанр | Games · PvP / tactics / casual |
| Скоупы и зачем (для формы верификации) | `identify` — показать имя/аватар игрока в матче и таблице лидеров; `applications.commands` — Entry Point-команда Launch |
| Данные пользователей (для формы) | только id/username/avatar из `identify`; хранится связка discord-id → игровой профиль (имя, аватар, статистика матчей); рекламным сетям не передаётся |

## Теги (1–5)

`pvp` · `1v1` · `multiplayer` · `strategy` · `arcade`

## App Description (лимит 400)

EN (329):

```
wheee is a 1v1 storm-tactics duel. You and your rival stand on opposite faces of the same floating island — every hill you raise on your side is a pit on theirs. Five quick moves, then the storm decides who gets blown off the map. Hop into a voice channel together and you're matched instantly. A match takes 1–3 minutes.
```

## Summary (лимит 200)

EN (166):

```
1v1 PvP duel on a two-sided map. Raise walls, dig pits, read the forecast — the storm blows the loser off the map. Join a voice channel together and play instantly.
```

## Expanded Description для Discovery (markdown, EN)

```
**wheee** is a 1v1 storm-tactics duel built for playing with the people already in your voice channel: two of you open the Activity — and you're in a match. No lobbies, no waiting.

You and your rival are crops — Wheat, Rice or Corn — standing on opposite faces of the same floating slab. Every hill you raise on your side is a pit on theirs. Read the wind forecast, build shelter, dig traps, and when the cataclysm hits, whoever prepared worse gets blown off the map or drowned in a flooded hollow.

- **Instant duels in voice channels** — two people in the Activity are matched automatically
- **Real-time simultaneous moves** — no waiting for turns; a match takes 1–3 minutes
- **The two-sided map** — your terrain is your opponent's, inverted
- **Wind pushes, rain floods, lightning strikes the highest crown** — survive all three
- **Challenge friends** — share an invite right into the chat
- **Win streaks** grow a badge; one loss takes it away
- **Spectate** live matches and score points predicting the winner

No ads, no paywalls. Open and play.
```

## Expanded Description (RU-локализация)

```
**wheee** — штормовая PvP-дуэль 1 на 1, сделанная для игры с теми, кто уже сидит с вами в войсе: двое открыли Activity — и вы уже в матче. Без лобби и ожиданий.

Ты и соперник — злаки (Пшеница, Рис или Кукуруза) на противоположных сторонах одного парящего острова. Каждый холм на твоей стороне — яма на его. Читай прогноз ветра, строй укрытия, копай ловушки — а когда налетит катаклизм, хуже подготовившегося сдует с карты или утопит в затопленной низине.

- **Мгновенные дуэли в голосовых каналах** — двое в Activity матчатся автоматически
- **Одновременные ходы в реальном времени** — матч идёт 1–3 минуты
- **Двусторонняя карта** — твой рельеф это рельеф соперника, вывернутый наизнанку
- **Ветер сносит, дождь топит, молния бьёт в самую высокую вершину** — переживи всё
- **Вызови друга** — инвайт улетает прямо в чат
- **Серии побед** растят значок; одно поражение — и он сгорает
- **Смотри чужие матчи** и зарабатывай очки, угадывая победителя

Без рекламы и платных преимуществ. Открыл — играешь.
```

## Entry Point-команда «Launch»

Description (EN, показывается в App Launcher):

```
Start a 1–3 minute storm duel — auto-matched with whoever's in your voice channel.
```

`description_localizations.ru`:

```
Штормовая дуэль на 1–3 минуты — соперник найдётся прямо в вашем голосовом канале.
```

Как применить (получить command id: `GET /applications/{app_id}/commands` с Bot-токеном/Bearer):

```
PATCH https://discord.com/api/v10/applications/1541107251346153492/commands/{command_id}
{
  "description": "Start a 1–3 minute storm duel — auto-matched with whoever's in your voice channel.",
  "description_localizations": { "ru": "Штормовая дуэль на 1–3 минуты — соперник найдётся прямо в вашем голосовом канале." }
}
```

## Custom Link (43:24 картинка + title + description)

- Title EN: `Storm duel challenge` / RU: `Вызов на штормовую дуэль`
- Description EN: `Accept the challenge — one gust decides it all.` / RU: `Прими вызов — один порыв решает всё.`

## Media Carousel (до 5)

1. Cover art (16:9, с логотипом) — переиспользовать обложку из GamePush-комплекта;
2. Скриншот: лобби с выбором персонажа;
3. Скриншот: матч в разгар шторма (молния);
4. Скриншот: экран победы со стриком;
5. (опц.) YouTube-ролик ≤30с — public/unlisted.

Готовые арт-исходники: `icon-1024.png` (иконка), обложка и скрины 1080×1920 в `marketing/telegram-listings/` — горизонтальные 16:9 версии надо доснять.

## Support Server

Отдельный Discord-сервер «wheee» с включённым **Community** (Server Settings → Enable Community). Каналы-минимум: #announcements, #support, #matchmaking. Указывается в Discovery Settings — обязателен.
