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

Discord принимает **ссылки**, а не загрузку файлов (в поле сказано: «Поддерживаемые ссылки: видеоролики YouTube, .png, .jpeg, .gif, .webp»). Поэтому кадры лежат в `packages/client/public/press/` и уезжают на статику вместе с клиентом — вставлять в портал именно эти URL:

| № | URL | Что на кадре |
|---|---|---|
| 1 | `https://wheee.io/press/01-lobby.jpg` | лобби: логотип, выбор из трёх злаков, кнопка Play |
| 2 | `https://wheee.io/press/02-gameplay.jpg` | ход: радиальное меню RAISE / LOWER на клетке, счётчик раунда, компас |
| 3 | `https://wheee.io/press/03-cataclysm.jpg` | катаклизм: бейдж CATACLYSM, дождь, оба игрока на поле |
| 4 | `https://wheee.io/press/04-victory.jpg` | победа: «Victory!» с причиной, затопленная карта |

Все четыре — 1920×1080, JPEG, сняты 2026-08-27 с текущей сборки. Первым в карусели ставить лобби: она крутится сама, и лучший кадр должен быть первым.

⚠️ URL заработают только после деплоя статики (`bun run deploy:ru` + Cloudflare Pages подхватит push в main). До этого поле принимать ссылки будет, а картинки не отрисуются.

Из портальных архивов Яндекса и GamePush каталог `press/` вырезается — см. `STORE_DIRS` в `deploy/strip-store-assets.sh`.

## Video Preview для Activity Shelf

`marketing/discord-directory/assets/shelf-preview.mp4` — **загружается файлом** (Activities → Art Assets), не ссылкой.

640×360 · h264 · 30 fps · 10.000 с · 736 КБ — вписывается в спеку (640×360, mp4, ≤10 с, ≤1 МБ). Показывает дугу «ход → катаклизм → затопление ямы».

Промо-ролик `marketing/promo/wheee-promo-1080x1920-en.mp4` для этого слота не годится: портретный, 19.6 с, 7 МБ — мимо по всем четырём параметрам. Он остаётся для CrazyGames/GamePush.

⚠️ Молнии ни в одном из отснятых матчей не выпало, поэтому в кадрах её нет — только ветер и дождь. Если нужен кадр с молнией, снимать отдельно.

## Support Server

Отдельный Discord-сервер «wheee» с включённым **Community** (Server Settings → Enable Community). Каналы-минимум: #announcements, #support, #matchmaking. Указывается в Discovery Settings — обязателен.
