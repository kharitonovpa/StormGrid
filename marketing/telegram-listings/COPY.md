# wheee — тексты для листингов Telegram-каталогов

Готовые блоки под формы каталогов. Везде, где есть лимит длины, рядом указана
длина строки — берите тот вариант, который влезает.

## Идентификаторы

| Поле | Значение |
|---|---|
| Название | wheee |
| Название (RU-витрины) | Уиии |
| Mini App link | https://t.me/wheee_game_bot/play |
| Бот | @wheee_game_bot |
| Сайт | https://wheee.io (RU: https://ru.wheee.io) |
| Категория | Games (жанр: PvP / tactics / casual) |
| Цена | Free, без криптовалюты и платежей |
| Языки интерфейса | EN, RU (автоопределение) |

## Слоган (короткая строка)

- EN (33): `One gust. One grid. No mercy.`
- EN (26): `PvP storm tactics in 1v1`
- RU (36): `Один порыв. Одна сетка. Без пощады.`

## Короткое описание (~100–140 символов)

- EN (124): `1v1 PvP duel on a two-sided grid. Raise walls, dig pits, read the forecast — and let the storm blow your rival off the map.`
- RU (122): `PvP-дуэль 1 на 1 на двусторонней карте. Строй стены, копай ямы, читай прогноз — и пусть буря сдует соперника с поля.`

## Длинное описание

### EN

```
wheee is a 1v1 storm-tactics duel that fits in your pocket. Matches take 1–3
minutes: five quick moves, then the cataclysm hits.

You and your rival are crops — Wheat, Rice or Corn — standing on opposite faces
of the same floating slab. Every hill you raise on your side is a pit on
theirs. Read the wind forecast, build shelter, dig traps, and when the storm
comes, whoever prepared worse gets blown off the map or drowned in a flooded
hollow.

• Real-time 1v1 PvP with simultaneous moves — no waiting for turns
• The two-sided map: your terrain is your opponent's, inverted
• Wind pushes, rain floods — survive both
• Win streaks grow a badge; one loss takes it away
• Challenge a friend by link, or queue up against the world
• Spectate live matches and score points predicting the winner

No ads between moves, no paywalls, no crypto. Open and play.
```

### RU

```
wheee — штормовая PvP-дуэль 1 на 1, которая помещается в карман. Матч идёт
1–3 минуты: пять быстрых ходов — и налетает катаклизм.

Ты и соперник — злаки (Пшеница, Рис или Кукуруза) на противоположных сторонах
одной парящей плиты. Каждый холм на твоей стороне — яма на его. Читай прогноз
ветра, строй укрытия, копай ловушки — а когда придёт буря, тот, кто
подготовился хуже, улетит с карты или утонет в затопленной впадине.

• PvP 1 на 1 в реальном времени, ходы одновременные — никакого ожидания
• Двусторонняя карта: твой рельеф — это рельеф соперника наоборот
• Ветер сдувает, дождь топит — переживи и то и другое
• Серия побед растит значок; одно поражение его забирает
• Зови друга по ссылке или вставай в очередь против всего мира
• Смотри чужие матчи и зарабатывай очки, предсказывая победителя

Без рекламы между ходами, без платежей, без крипты. Открыл — и играешь.
```

## Ответы на типовые поля форм

- **What makes your app unique?** (EN): `The two-sided map: both players stand on opposite faces of the same slab, so every move is an attack and a defense at once. Full matches in under 3 minutes, real-time simultaneous turns.`
- **Monetization**: `Rewarded/interstitial ads on some platforms; the Telegram version is currently free of ads and payments.`
- **TON integration**: `None yet.`
- **Contact**: pavel.kharitonov@unimatch.dev (или ваш @username — подставьте сами)

## Ассеты (что куда)

| Ассет | Файл | Размер |
|---|---|---|
| Иконка квадратная | `packages/client/public/icon-1024.png` | 1024×1024, без текста |
| Иконка круглая | `packages/client/public/favicon-512.png` | 512×512 |
| Обложка/постер EN | `packages/client/public/cover-1920x1080.png` | 1920×1080, с названием |
| Обложка/постер RU | `packages/client/public/cover-ru-1920x1080.png` | 1920×1080 |
| Скриншоты портрет | `screens/upload/{en,ru}-portrait/` | 720×1280, 8–9 шт |
| Скриншоты ландшафт | `screens/upload/{en,ru}-landscape/` | 1280×720, 5 шт |

Производные размеры под конкретные каталоги — см. `CHECKLIST.md` (генерируются
sips'ом из этих исходников).
