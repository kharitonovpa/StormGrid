# Листинги wheee в Telegram-каталогах — пошаговый чек-лист

Тексты для копипасты — в `COPY.md`. Техническая подготовка уже сделана кодом
(отмечено ✅). Порядок — по убыванию отдачи. Актуально на 07.08.2026.

## Уже сделано (не требует действий)

- ✅ Бот отвечает на `/start` по-английски (RU-клиентам — по-русски) с кнопкой
  Play — требование модерации tapps.center. Webhook: `api.wheee.io/api/tg/webhook`.
- ✅ Описания бота (короткое ≤120 и полное ≤512, EN+RU) заданы через Bot API —
  видны в профиле бота и в поиске Telegram.
- ✅ Terms + Privacy: https://wheee.io/terms и https://wheee.io/privacy —
  каталоги спрашивают обе ссылки.
- ✅ Скриншоты 1080×1920 для профиля бота: `botfather-1080x1920/` (3 EN + 3 RU).

---

## 1. Вкладка Apps в самом Telegram (≈15 мин, важнее всех каталогов)

Официальный «магазин миниаппов» Telegram — вкладка Apps в глобальном поиске.
Включается только вручную через @BotFather:

1. @BotFather → `/mybots` → @wheee_game_bot → **Bot Settings → Main Mini App**
   → задать URL `https://wheee.io`.
2. Там же (App Settings) загрузить:
   - **скриншоты** — 3 файла из `botfather-1080x1920/` (EN-набор; RU можно
     добавить как локализацию, если BotFather предложит);
   - **demo-видео** (опционально, 30–60 сек геймплея — сильно поднимает
     конверсию карточки; можно добавить позже);
   - **иконку бота** (Edit Botpic), файл: `packages/client/public/favicon-512.png`.
3. Проверка: игра открывается по короткой ссылке t.me/wheee_game_bot и бот
   появляется в поиске Telegram по слову «wheee».

Ранжирование в «Popular Apps» завязано на запуски и выручку в Stars — с нашим
трафиком туда рано, но карточка в поиске появляется сразу и бесплатно.

## 2. FindMini.app (≈10 мин, модерация ~24 ч)

Форма: https://www.findmini.app/submit/ — бесплатно.

| Поле | Что вставить |
|---|---|
| App link | `https://t.me/wheee_game_bot/play` |
| Name | `wheee` |
| Category | Games |
| Languages | English, Russian |
| Icon | `packages/client/public/favicon-512.png` (лимит: квадрат ≥256px, <1 МБ) |
| Screenshots | до 10 шт **одного размера** — берите `screens/upload/en-portrait/*.png` (720×1280, все <400 КБ) |
| Short description EN (≤20 слов) | `1v1 storm duel on a two-sided grid: raise walls, dig pits, and blow your rival off the map.` (19 слов) |
| Short description RU (≤20 слов) | `Штормовая дуэль 1 на 1: строй стены, копай ямы и сдуй соперника с карты.` (14 слов) |
| Full description EN / RU | длинные тексты из `COPY.md` |
| Contact | ваш @username |

После публикации: поставить ссылку на карточку FindMini с сайта/соцсетей —
они это учитывают при выборе featured.

## 3. Telegram Apps Center (tapps.center) — с оговоркой

Каталог на перезапуске (баннер «Something new is coming», в вебе остались
только Web3-категории). Web3-интеграция для листинга **не требуется** (это
подтверждено в доках TON), но живой ли сейчас приём — надо проверить изнутри:

1. Открыть @tapps_bot → если есть кнопка «Submit app» / «Add app» — идти по ней.
   Исторический путь модерации: @app_moderation_bot.
2. Понадобятся: name, tagline (из `COPY.md`), описание, **6 скриншотов**
   (совет из опыта прошедших модерацию: скриншоты «как реклама», а не сырой UI —
   наши store-скриншоты подходят), ссылки на Terms/Privacy (✅ готовы),
   англоязычный ответ бота на /start (✅ готов).
3. Модерация ~3–8 дней.
4. ⚠️ TON-фичеринг (Trending Apps, @trendingapps) требовал приложений
   «exclusively on TON» — нам без крипто-интеграции он недоступен; портал
   builders.ton.org закрыт. Не тратьте на него время.
5. ⚠️ telegramappscenter.com — фейковый сайт-двойник, не подавать туда.

## 4. GitHub-списки (≈5 мин на PR, могу сделать я)

- https://github.com/telegram-mini-apps-dev/awesome-telegram-mini-apps —
  PR-строка (в конец категории, формат по CONTRIBUTING):
  `- [wheee](https://t.me/wheee_game_bot/play) - 1v1 PvP storm-tactics duel on a two-sided grid.`
- Аналогичный список: https://github.com/telesearch/Telegram-Mini-Apps-List

Скажите — открою оба PR от вашего GitHub-аккаунта через gh CLI.

## 5. Опционально / по остаточному принципу

- **tgapp.ru** — RU-каталог, форма «Добавить приложение» (может не открываться
  не из RU — попробуйте с RU-IP). Бесплатно.
- **tgmini.net** — приёма через форму нет, писать в их Telegram-канал.
- **PlayDeck (@play_deck)** — это не каталог, а издатель (The Open Platform):
  листинг через bizdev (t.me/qshepel) и интеграцию их SDK. Имеет смысл, только
  если захотите издательскую сделку — вернуться к этому после первых цифр D1.
- **RU-каналы с обзорами миниаппов** (@topminiappstelegram и пр.) — платные
  посты; отложить до момента, когда метрики удержания подтверждены.

## Как поймём, что сработало

В аналитике (`/api/events/summary`) события с `platform=telegram` начнут расти;
Telegram-заходы отделяются от порталов по полю platform. Точка контроля —
через неделю после подач.
