# Discord: рычаги роста/трафика для верифицированного Activity (wheee)

Дата исследования: **2026-08-31 / 2026-09-01**.
Контекст: wheee только что прошёл App Verification и Discovery opt-in (`is_verified:true`, `is_discoverable:true` — подтверждено публичным RPC-эндпоинтом `GET https://discord.com/api/v10/applications/1541107251346153492/rpc`). Вопрос уже не «как верифицироваться» (это закрыто в `DISCORD_VERIFICATION_RESEARCH.md`), а «что реально гонит трафик после этого».

**Методология и оговорка об источниках.** Канонические доки `docs.discord.com` читались напрямую. `support-dev.discord.com`, `support-apps.discord.com` и часть `support.discord.com` **блокируются Cloudflare при прямом фетче (HTTP 403)** — как и в `DISCORD_VERIFICATION_RESEARCH.md`. В отличие от того документа, в этой сессии **инструмент фетча не смог достучаться до web.archive.org вообще** (не Cloudflare-403, а отказ самого инструмента) — поэтому Wayback-снапшоты в этот раз недоступны как метод. Взамен для заблокированных страниц использовались **точные цитаты из поисковых сниппетов** (Google/Bing через веб-поиск), которые в нескольких случаях независимо повторялись в разных запросах слово-в-слово — это даёт разумную, но не полную уверенность в точности цитаты. Такие места помечены «⚠️ не подтверждено прямым чтением, только поисковым сниппетом с указанием статьи-источника». Всё остальное, что не удалось подтвердить первоисточником вообще, помечено «⚠️ не подтверждено первоисточником».

---

## TL;DR — чеклист на ближайшие 1–2 недели

**Ничего не ждать от Discord, делать сразу:**
1. Переписать Summary/Description в Discovery Settings под конверсию: первая фраза — проблема/ценность, а не общие слова (best practices doc, ниже §1). Теги уже стоят близко к оптимальным (`1v1, arcade, multiplayer, pvp, strategy`).
2. Install URL (OAuth2) — расставить на wheee.io, в соцсетях, в биографиях — это прямая ссылка на установку, не требует ничего от Discord.
3. Включить/проверить Rich Presence (`setActivity`) — бесплатный органический канал «друзья видят, что я играю».
4. Начать растить саппорт-сервер как полноценное коммьюнити (девлоги, патчноуты) — нужен уже сейчас для Discovery-чеклиста, и это же задел на Server Discovery (см. §3) — порог 1000+ участников и 8+ недель возраста, так что часы стоит запускать уже сегодня.
5. Локализовать Discovery-описание (en+ru минимум) — по опыту Playroom (Death by AI) локализация была топ-1 запрошенной фичей игроков и напрямую била по виральности (§4).
6. Точечный аутрич в нишевые PvP/arcade Discord-серверы (через Disboard) с моделью «не продавай, проси фидбек» — по опыту инди-разработчика (§3), даёт скромный, но реальный прирост.
7. Гильдийные механики поверх уже готового `shareLink()` — лидерборды, «позови друга сыграть 1v1» — по опыту Playroom это «Discord's Real superpower» (§3, §4).

**Требует времени/кооперации Discord (не планировать на 1-2 недели):**
8. Пропагация в App Directory/Launcher после Enable Discovery — до 24–30 часов (уже задокументировано в `DISCORD_VERIFICATION_RESEARCH.md`).
9. DDevs-сервер: Developer Spotlight Stage Events, Buildathon, App Directory Peer Review, Activities Tournaments — бесплатно, но календарно/по отбору, не «получить фичеринг за неделю» (§2).
10. Dev Scrolls newsletter, Curated Collections/Promoted-плейсменты — самономинации не задокументировано, решение за Discord (§2).
11. Discord Quests — технически применимо к embedded Activities (прецедент Krunker Strike FRVR), но продаётся только через sales-команду; по вторичным данным минимальный бюджет ~$100–150K — нереалистично для инди на этом этапе (§2).
12. Verified Server (Claim Your Game) для саппорт-сервера — требует привязанной Steam-страницы; у wheee её нет — сейчас недоступно (§2, §3).

---

## 1. Как Discovery/App Directory реально показывает Activities пользователям

Источники: [discovery/overview](https://docs.discord.com/developers/discovery/overview) (прочитан напрямую), [discovery/best-practices](https://docs.discord.com/developers/discovery/best-practices) (прочитан напрямую); «Welcome to the App Directory!» (support-apps, id 26501737399575 — заблокирован Cloudflare, цитаты через поисковые сниппеты, дважды воспроизведены дословно в разных запросах).

### Поверхности (задокументированные)

- **App Directory** — «a searchable hub where they can browse by name, category, or collection» ([discovery/overview](https://docs.discord.com/developers/discovery/overview)).
- **App Launcher** — секции: **Recent Apps** («apps you've recently used or installed will appear at the top»), **Installed Apps**, **Curated Collections** («a mix of user favorites, staff picks, and recommended apps»), **Partner Apps** (тег «Partner» — коллаборации Discord), **Promoted Apps** («apps given more visibility in the App Launcher or App Directory») ([discovery/overview](https://docs.discord.com/developers/discovery/overview), прочитан напрямую).
- **Activity Shelf** (иконка-ракета в голосовом канале) — механика подтверждена в уже прочитанном напрямую доке [local-development](https://docs.discord.com/developers/activities/development-guides/local-development) (см. `DISCORD_ACTIVITIES_INTEGRATION_RESEARCH.md` §1): «Rocket Button» открывает Activity shelf. Дока прямо описывает только **Developer Activity Shelf** (там видны только приложения разработчика/команды); отдельного текста про то, что видят обычные пользователи в непривилегированном Shelf (рекомендации/популярное/недавнее), в проверенных страницах **нет** — ⚠️ по аналогии с App Launcher (Recent/Curated/Promoted) вероятно устроено похоже, но прямого подтверждения для именно voice-channel Shelf не найдено.
- **«Друзья играют» (Activity Status)** — уже задокументировано в `DISCORD_VERIFICATION_RESEARCH.md` §4 дословной цитатой: «friends and members in their servers will be able to see when they are playing your Activity or if they have played it recently» (support-dev, через Wayback в прошлой сессии).
- **Rich Presence** — `setActivity`, скоуп `rpc.activities.write`: «driving more users to discover it» ([discovery/overview](https://docs.discord.com/developers/discovery/overview), см. также `DISCORD_ACTIVITIES_INTEGRATION_RESEARCH.md` §7).
- **Категории/браузинг** — App Directory сортирует приложения «into relevant categories» (support-apps snippet, ⚠️ не подтверждено прямым чтением).
- **Editorial/featured** — «Apps can be featured in the App Directory or App Launcher as part of a curated collection or promotion» ([discovery/overview](https://docs.discord.com/developers/discovery/overview), прочитан напрямую) — критерии отбора **не описаны**.
- **Социальное распространение** — shareable-ссылки на профиль/стор-страницу приложения ([discovery/overview](https://docs.discord.com/developers/discovery/overview)).

### Что влияет на ранжирование (задокументированное)

- **App Launcher search**: «Search ranking is determined by relevance to the query and popularity based on usage» ([discovery/overview](https://docs.discord.com/developers/discovery/overview), прочитан напрямую, дословная цитата).
- **App Directory (категории + поиск)**: «sorted into relevant categories using a model informed by app names, descriptions, tags, and other information provided by developers… listed in order of popularity **based on the number of servers they're in**» (support-apps «Welcome to the App Directory!», id 26501737399575 — ⚠️ не подтверждено прямым чтением, только поисковым сниппетом, но дословная фраза совпала в двух независимых поисковых запросах).
- **Что НЕ задокументировано как фактор ранжирования** (искали целенаправленно, не нашли ни в одном первоисточнике): рейтинги/отзывы пользователей (публичной системы рейтингов у Activities не найдено), явная «свежесть»/recency, явный «retention» как метрика. ⚠️ Отсутствие в найденных доках не равно отсутствию в реальности — просто Discord нигде не публикует эти факторы явно.
- **Полнота листинга как фактор appearance (не ranking)**: `best-practices` подчёркивает описание/визуалы/теги как conversion-факторы, а не подтверждённые ranking-факторы — дословно документация **не** раскрывает алгоритм ранжирования за пределами «popularity based on usage / number of servers».
- Best-practices, дословно: Summary (200 симв., «grab the user's attention and quickly convey the value of your app»), Expanded Description («showcase why a user should install your app, and the best functionality your app has to offer», начинать с «an attention grabbing sentence that describes a problem a user might want to solve»), теги — «think of up to five words that describe your app… what categories your app would fit under or keywords users would type into the search bar», визуалы — «Add images and gifs to your Product Page», активный саппорт-сервер как сигнал легитимности ([discovery/best-practices](https://docs.discord.com/developers/discovery/best-practices), прочитан напрямую).

**Вывод для wheee**: единственный документированный количественный ranking-сигнал — это по сути install base («number of servers» / «popularity based on usage»), т.е. рычаг циклический (расти, чтобы расти). Прямые самостоятельные рычаги — только conversion-оптимизация текста/визуалов и поддержание активного саппорт-сервера, что не двигает ranking напрямую, но повышает конверсию тех, кто уже увидел листинг.

---

## 2. Официальные программы продвижения для разработчиков

### Discord Quests (спонсируемая реклама)

Источники: [discord.com/ads/quests-faq](https://discord.com/ads/quests-faq) (прочитан напрямую), [discord.com/blog/our-quest-to-support-game-developers](https://discord.com/blog/our-quest-to-support-game-developers) (прочитан напрямую), [discord.com/quests-success-stories/krunker-strike-frvr](https://discord.com/quests-success-stories/krunker-strike-frvr), [discord.com/build-case-studies/frvr](https://discord.com/build-case-studies/frvr) (прочитан напрямую).

- **Индустрия-eligibility**, дословно: «At the moment, we're focusing on customers in the Gaming and Media & Entertainment industries» ([quests-faq](https://discord.com/ads/quests-faq), прочитан напрямую).
- **Стоимость**: публично не раскрывается — «Our Sales team can discuss Quest campaign costs with you, and the price will depend on variables like campaign reach, geographies, and more» (там же). ⚠️ Найден вторичный источник (документ на scribd.com, «Discord Quests Rate Card») с цифрами «$100K минимум для Game Quests, $150K для Video Quests / custom avatar decorations» — **это не первоисточник Discord**, к цифрам относиться со скепсисом, но список реальных спонсоров (Blizzard, EA, Capcom, Tencent, Nexon, HoYoverse, Theorycraft — все со страницы [discord.com/developers/success-stories](https://discord.com/developers/success-stories), прочитанной напрямую) косвенно подтверждает, что это enterprise-продукт, а не self-serve инструмент для инди.
- **Применимо ли к embedded Activities, а не только к desktop-клиент играм — да, подтверждено прецедентом**: **Krunker Strike FRVR** — это именно Embedded App SDK Activity (запускается из Activity-списка в голосовом канале, «to play you just need to join a voice channel and start Krunker Strike FRVR from the Activities list» — search snippet), и именно на нём Discord запустил «the first ever "in-game" Quest» — «Over 300,000 Discord players participated… leading to a 33% increase in player count during the first week» (Krunker Strike FRVR success story, search snippet, вторично подтверждено кейс-стади FRVR: [discord.com/build-case-studies/frvr](https://discord.com/build-case-studies/frvr), прочитан напрямую). Значит, ограничение «Quests только для полноценных desktop-игр» **не подтверждается** — платформенно Quests открыт и embedded Activities, вопрос только в бюджете/отборе.
- **Вывод для wheee**: технически применимо, практически — не сейчас (бюджет и, вероятно, отбор по масштабу недоступны небольшой инди-команде).

### Developer Spotlight / Buildathon / DDevs-сервер

Источник: [discord.com/blog/ddevs-celebrates-250k-members](https://discord.com/blog/ddevs-celebrates-250k-members) (прочитан напрямую; пост датирован декабрём 2023 — цифра «250k участников» на 2026 год не переподтверждена, ⚠️ устарела).

- **Developer Spotlight Stage Events** — подтверждено дословно как формат: «Featured discussions with app creators (e.g., Tourney Bot team)», топики — «development processes and best practices». Это прямой ответ на вопрос про «Developer Spotlight»: программа существует, но её **механика отбора не описана** ⚠️ (нет публичной формы заявки/критериев).
- **DDevs Buildathon** — «week-long challenge for developers to create projects», «winning submissions showcased in dedicated server channels» — ближайший аналог «официального хакатона»; отдельного полноценного «Discord Hackathon» бренда/программы вне DDevs **не найдено** (целевой поиск ничего не дал за пределами сторонних хакатонов, не связанных с Discord).
- **Code && Chat** — «biweekly sessions where Discord Staff collaborate with community members» — прямой канал обратной связи от стаффа.
- **Platform Updates Stage Events** — ведёт Developer Relations team.
- **App Directory Peer Review sessions** и **Activities Tournaments** — упомянуты как регулярные события DDevs, но их точный формат/периодичность/условия участия **не удалось подтвердить** ни в одном прочитанном первоисточнике (найдены только названия в перечислении, ⚠️ детали неизвестны — надо смотреть на месте, зайдя на сервер).
- Отдельного **«verified apps channel»** в DDevs, упомянутого в задании как гипотеза, **подтвердить не удалось** — ⚠️ не найдено ни в одном источнике.

### Newsletter / блог

- **Discord Dev Scrolls** — «your go-to monthly round up for the latest product updates, partner successes, events, and technical changes» ([discord.com/developers/developer-newsletter](https://discord.com/developers/developer-newsletter), прочитан напрямую). Формат подписки — email-форма на странице. Раздел «partner successes» / «Developer Case Studies» подразумевает, что отдельные разработчики попадают в выпуски, но **процесса самономинации не описано** ⚠️ — похоже на редакционный выбор Discord.

### «Claim Your Game» / Verified Server Program (для СЕРВЕРА, не для Activity)

Источники: [discord.com/blog/claim-your-game](https://discord.com/blog/claim-your-game) (прочитан напрямую), «Verified Server Requirements for Game Publishers and Developers» (support.discordapp.com, id 115001987272 — ⚠️ не подтверждено прямым чтением, только поисковым сниппетом), докстраница [docs.discord.com/developers/platform/claim-your-game](https://docs.discord.com/developers/platform/claim-your-game) (обнаружена в поиске, не прочитана напрямую в этой сессии — ⚠️ пометка).

- Это **отдельная программа от App Verification/Discovery** — она про сервер игры (community server), а не про листинг Activity в App Directory.
- Дословно про выгоду: «Your newly verified server will be listed higher in Discovery so players can find it quickly» — то есть здесь ранжирование в **Server Discovery** явно повышается верификацией сервера (в отличие от App Directory, где такой явной формулировки не нашлось).
- **Требования (жёсткий блокер для wheee прямо сейчас)**: «Your game must be on Steam, and the Steam store page must link to your Discord server»; «Your game must be a playable, fully-released game on Steam, with early access counting as released, but games with only a "Coming Soon" store page, wishlist page, demo, or playtest are not eligible»; «Your Discord application must be assigned to a development team… the server owner must be a member of your Team». **wheee.io — не Steam-игра**, значит эта программа сейчас **недоступна**, пока/если wheee не выйдет на Steam. Это прямой ответ на подпункт вопроса 3 про cross-promotion через собственный сервер: механизм «верифицированный игровой сервер → бонус в Discovery» существует, но заперт за Steam-присутствием.

---

## 3. Рычаги под полным контролем разработчика (без одобрения Discord)

### Оптимизация листинга App Directory (сверх уже задокументированных в `DISCORD_VERIFICATION_RESEARCH.md` спек ассетов)

См. §1 — конкретно: (а) переписать Summary (200 симв.) под «проблема → ценность» вместо нейтрального описания; (б) первая строка Expanded Description — «почему стоит установить», не общие слова; (в) добавить gif/скриншот геймплея в Media Carousel как рекомендует best-practices («Add images and gifs to your Product Page»); (г) держать саппорт-сервер видимо живым (апдейты, ответы) — задокументированный сигнал легитимности, хоть и не подтверждённый как прямой ranking-фактор.

### Install-ссылки

Install URL (OAuth2 URL Generator) — уже настраивается для Discovery-чеклиста (см. `DISCORD_VERIFICATION_RESEARCH.md` §5) — эту же ссылку можно свободно постить где угодно (wheee.io, соцсети, стрим-описания) без всякого участия Discord.

### Собственный community-сервер → Server Discovery (отдельная механика от App Discovery)

Источник: «Enabling Server Discovery» (support.discord.com, id 360030843331 — ⚠️ **не подтверждено прямым чтением** (403), цитата через поисковый сниппет, воспроизведена в двух формулировках схоже): «A server must have at least 1,000 members to qualify, and servers need to be at least 8 weeks old to be in Discovery», плюс требования модерации/safety и обозначение сервера как Community.

- Это подтверждает: да, cross-promotion правдоподобен, но **порог реальный и не мгновенный** — 1000+ участников и 8+ недель возраста. Для свежего саппорт-сервера wheee это не «рычаг на 1-2 недели», а долгая игра — но часы стоит запускать сразу, т.к. 8-недельный таймер не ускорить никакими усилиями.
- Server Discovery ≠ App Directory Discovery: это два разных каталога (серверов и приложений соответственно), оба потенциально полезны, но регулируются разными критериями входа.

### Реферальные/шеринговые механики (уже частично реализовано)

`shareLink()` и `custom_id`/`referrer_id` уже описаны и подтверждены в `DISCORD_ACTIVITIES_INTEGRATION_RESEARCH.md` §4 (growth-and-referrals doc, прочитан напрямую) — это де-факто уже готовый self-serve рычаг: осталось использовать его продуктово (см. рекомендации Playroom ниже).

### Тактики инди-комьюнити (документированные внешними источниками — не Discord)

- **Точечный аутрич в нишевые серверы** (модель из [indiehackers.com/post/a-guide-to-launching-on-discord](https://www.indiehackers.com/post/a-guide-to-launching-on-discord-84c5e4bf47), прочитан напрямую — это описание собственного опыта индюка-разработчика, полу-первичный источник): найти топикал-серверы через Disboard.org, зайти в 10+ крупных активных серверов по нише, **не продавать** («Discord users do not like ads… most servers do not allow promoting products»), встроиться в органичный разговор, продукт предлагать как просьбу о фидбеке, а не рекламу. Результат в этом конкретном кейсе — скромный: «20-30 registered users (50% user base increase)» — то есть работает, но ожидания нужно калибровать под маленький, ранний проект, не под масштабный рост.
- **r/discordapp, r/discord_bots, Product Hunt** — целевого первичного источника именно про Discord Activities **не найдено**. Единственная найденная релевантная мысль («Reddit and Discord likely work better [чем Product Hunt] для нишевой аудитории») — это общий совет из стартап-гайда по лончам (indiehackers, вторично), не специфичный для Activities. ⚠️ Помечаю как неподтверждённое для этой конкретной вертикали.
- **Стример/YouTube-аутрич специфично под Activities** — целевого первичного источника (девлог/интервью разработчика Activity про именно эту тактику) **не найдено** в этом прогоне исследования. ⚠️ Правдоподобно, но не задокументировано никем из найденных разработчиков Activities.
- **Гильдийные/социальные механики как рост-рычаг** — прямая рекомендация из девлога Playroom (см. §4): «This is Discord's Real superpower!» про лидерборды/clan-vs-clan механики поверх серверов — это буквально то, что уже частично покрыто существующей архитектурой wheee (`friend:create/join`, guildId-трекинг), просто нужно продуктово усилить приглашение/соревновательность внутри гильдии.

---

## 4. Кейс-стади других разработчиков Activities

### Krunker Strike FRVR (FRVR) — прямой аналог по механике (Embedded App SDK Activity)

Источник: [discord.com/build-case-studies/frvr](https://discord.com/build-case-studies/frvr) (прочитан напрямую, официальный кейс-стади Discord).

- Дословно: «What's unique about Discord is that users come to Discord to play games with their friends. So when you launch a game on Discord, it lives in a place where players already hang out. Since the game is effortlessly discoverable and launchable for those in voice chat…»
- Результат: **«Krunker Strike's player base has more than doubled since releasing on Discord»**. Конкретных цифр по App Directory/Launcher трафику кейс не даёт — упор именно на органику через голосовые каналы/друзей, а не на конкретный маркетинговый канал.
- Позже — успешная Discord Quest (см. §2): 300k+ участников, +33% игроков за первую неделю кампании.

### Playroom — Death by AI (Embedded App SDK Activity)

Источники: [discord.com/build-case-studies/playroom](https://discord.com/build-case-studies/playroom) (прочитан напрямую, официальный кейс-стади Discord), [playroom.substack.com/p/discord-activity-playbook](https://playroom.substack.com/p/discord-activity-playbook) (прочитан напрямую — авторский девлог/плейбук от команды Playroom, полу-первичный источник, автор — сотрудник компании-разработчика).

- Официальный кейс-стади: «launched the game in one region… Within days, they saw a surge in users joining the Playroom server and sharing positive feedback»; **~7 млн пользователей за недели**; **>70% сессий с 3+ друзьями** в первую неделю; ссылка на встроенные шеринг-механики — цитата CTO: «We didn't have to develop a custom UI for inviting friends and users have multiple ways to share or join the game».
- Плейбук (более тактический, авторский): пиковые цифры — «5 million users playing within the first week», «50,000 users per hour» на пике, «700,000 users in a single day», «400,000 daily active players (Discord + Web)»; «85% of games are played by 3 or more people in the session».
- **Ключевая тактическая мысль плейбука — гильдийные механики**: «This is Discord's Real superpower!» — клан-vs-клан соревнования и серверные лидерборды как виральный драйвер.
- **Локализация — топ-1 запрошенная фича**: «Localization was players' "#1 requested feature"» — прямой аргумент локализовать листинг/UI wheee пораньше.
- **Задокументированное ограничение платформы**, важное для решения «нужен ли саппорт-сервер»: «There is no efficient way to notify users about new content unless they are part of your server» — то есть ре-engagement вне собственного сервера практически не работает, что усиливает аргумент растить именно саппорт-сервер как канал удержания, а не только как чеклист-пункт для Discovery.
- Рекомендация по жанру-таргету: ориентироваться на «mid-core and AA casual games» вроде «Overcooked, Fall Guys, Jackbox, Among Us» — не пытаться конкурировать с полноценными платформенными играми.

### Mojiworks — Chef Showdown (Embedded App SDK Activity)

Источник: [discord.com/build-case-studies/mojiworks](https://discord.com/build-case-studies/mojiworks) (прочитан напрямую, официальный кейс-стади Discord).

- **1 млн игроков в первый уикенд запуска**, **14+ млн игроков** суммарно, **«3x average session times» по сравнению с другими платформами**.
- Рост шёл через **полгода закрытого тестирования в собственном Discord-сервере** до глобального запуска — «shared builds and gathered feedback from dedicated players over six months before global launch, which shaped the Activity's user experience» — прямое подтверждение ценности саппорт-сервера как канала не только Discovery-чеклиста, но и полноценного pre-launch playtesting-контура.
- ⚠️ Не строго релевантно wheee, но заслуживает упоминания: тестирование Mojiworks показало, что «collaborative gameplay led to +50% new user retention and +30% play time» **по сравнению с** competitive-режимами. wheee — конкурентный 1v1 PvP по дизайну; это не повод менять геймплей, но стоит держать в уме при формулировке Discovery-описания/визуалов (подчёркивать социальность/друзей, а не только соревновательность) — это интерпретация, не прямая рекомендация из источника.

### Прочие запрошенные тайтлы — что нашлось, а что нет

- **Sketch Heads, Poker Night, Bobble League, Watch Together, Chess in the Park** — **первичных девлогов/интервью/кейс-стади от самих разработчиков не найдено** в этом прогоне исследования. Это прямой пробел; вероятно, часть из них — внутренние Discord-продукты (Watch Together, возможно Poker Night), а не сторонние студии, поэтому «девлога сторонней команды» может просто не существовать. ⚠️ Флагирую как неподтверждённый/отсутствующий кейс, не как «есть, но не нашли».
- **Gartic Phone** — только вторичный источник (Fandom-вики), не официальный кейс-стади: Activity существовала на Discord с 15.03.2023 по ~30.06.2025 (позже снята), у собственного Discord-сервера игры — «over 500,000 members» — что скорее говорит о том, что готовое комьюнити предшествовало и, вероятно, стало причиной партнёрства с Discord, а не наоборот. ⚠️ Полностью вторичный источник, к фактам относиться осторожно.
- **Krunker Strike FRVR / Death by AI / Chef Showdown** — единственные три тайтла из запрошенного списка (плюс не запрошенный, но найденный) с подтверждённым официальным кейс-стади Discord именно как **Embedded App SDK Activities** (не путать с обширным списком на [discord.com/developers/success-stories](https://discord.com/developers/success-stories), прочитанном напрямую, где большинство записей — это полноценные внешние игры с Discord Social SDK/Rich Presence/Quests, а не embedded Activities, т.е. другая модель интеграции, менее прямо сопоставимая с wheee).

---

## 5. Монетизация ↔ Discovery-плейсмент: реальный ли это trade-off

Источник: уже прочитанный напрямую в `DISCORD_ACTIVITIES_INTEGRATION_RESEARCH.md` §6 [docs.discord.com/developers/platform/app-monetization](https://docs.discord.com/developers/platform/app-monetization): «Monetized applications get store page in App Directory».

- Это единственная задокументированная связь монетизации и App Directory — **дополнительная стор-страница**, а не подтверждённое повышение ранжирования базового листинга.
- В §1 показано, что единственный явно задокументированный ranking-фактор в App Directory — «popularity based on the number of servers they're in» / в App Launcher — «popularity based on usage». Ни один прочитанный источник не называет `is_monetized`/Premium Apps как отдельный вход в эту модель.
- ⚠️ Логически можно предположить, что стор-страница как дополнительная точка входа/вовлечения косвенно увеличивает usage-сигналы — но это инференс, не факт из источника.
- **Вывод**: trade-off, о котором пишет команда wheee («не монетизируемся — вдруг это стоит нам видимости»), **по задокументированным фактам не подтверждается**. Отказ от Premium Apps (по географической причине — США/ЕС/Великобритания-only, уже задокументировано) не стоит wheee ranking-позиций в App Directory/Launcher — только той самой отдельной стор-страницы, которая всё равно бесполезна без товара на продажу.

---

## 6. Практический чеклист (см. TL;DR выше — здесь развёрнуто с источниками)

| # | Действие | Зависит от Discord? | Источник обоснования |
|---|---|---|---|
| 1 | Переписать Summary/Description под best-practices (проблема→ценность, конкретика) | Нет | [discovery/best-practices](https://docs.discord.com/developers/discovery/best-practices) |
| 2 | Расставить Install URL на wheee.io/соцсети | Нет | OAuth2 URL Generator, `DISCORD_VERIFICATION_RESEARCH.md` §5 |
| 3 | Включить/проверить Rich Presence (`setActivity`) | Нет | [discovery/overview](https://docs.discord.com/developers/discovery/overview) |
| 4 | Растить саппорт-сервер как коммьюнити (девлоги, апдейты) — запускает часы к порогу Server Discovery (1000 участников / 8 недель) | Нет (но эффект — с задержкой) | support.discord.com «Enabling Server Discovery» (⚠️ снипет) |
| 5 | Локализовать Discovery-описание (en+ru) | Нет | Playroom playbook: локализация — «#1 requested feature» |
| 6 | Точечный аутрич в нишевые Discord-серверы (Disboard) по модели «фидбек, не реклама» | Нет | indiehackers.com гайд, реальный кейс +20-30 пользователей |
| 7 | Гильдийные механики (лидерборды, «зови друга на 1v1») поверх `shareLink()` | Нет | Playroom playbook: «Discord's Real superpower» |
| 8 | Ждать пропагацию после Enable Discovery (до 24–30ч) | Да | `DISCORD_VERIFICATION_RESEARCH.md` §5 |
| 9 | Зайти в DDevs-сервер, следить за Buildathon/Activities Tournaments/Developer Spotlight | Да (отбор/календарь Discord) | discord.com/blog/ddevs-celebrates-250k-members |
| 10 | Dev Scrolls newsletter — не планировать, редакционный выбор Discord | Да | discord.com/developers/developer-newsletter |
| 11 | Discord Quests — не сейчас, enterprise-продукт | Да (sales + бюджет) | discord.com/ads/quests-faq, ⚠️ вторичные цифры бюджета |
| 12 | Verified Server (Claim Your Game) для саппорт-сервера | Да, и заблокировано отсутствием Steam-страницы | discord.com/blog/claim-your-game |

---

## Источники

Прочитаны напрямую (docs.discord.com / discord.com):
- https://docs.discord.com/developers/discovery/overview
- https://docs.discord.com/developers/discovery/best-practices
- https://docs.discord.com/developers/activities/development-guides/growth-and-referrals
- https://discord.com/developers/success-stories
- https://discord.com/ads/quests-faq
- https://discord.com/blog/our-quest-to-support-game-developers
- https://discord.com/blog/claim-your-game
- https://discord.com/blog/build-where-the-world-plays
- https://discord.com/blog/ddevs-celebrates-250k-members
- https://discord.com/developers/developer-newsletter
- https://discord.com/build-case-studies/frvr
- https://discord.com/build-case-studies/playroom
- https://discord.com/build-case-studies/mojiworks
- https://playroom.substack.com/p/discord-activity-playbook (авторский девлог команды-разработчика Playroom, полу-первичный источник)
- https://www.indiehackers.com/post/a-guide-to-launching-on-discord-84c5e4bf47 (авторский пост инди-разработчика, полу-первичный источник)

Ранее прочитаны напрямую (переиспользованы факты, не перечитывались повторно в этой сессии — см. соответствующие доки):
- https://docs.discord.com/developers/platform/app-monetization (см. `DISCORD_ACTIVITIES_INTEGRATION_RESEARCH.md` §6)
- support-dev статья «What are Verified and Unverified Activities?» — Activity Status quote (см. `DISCORD_VERIFICATION_RESEARCH.md` §4)

Не удалось прочитать напрямую — **Cloudflare 403**, факты взяты из поисковых сниппетов (Wayback в этой сессии оказался недоступен инструменту):
- «Welcome to the App Directory!» (support-apps, id 26501737399575) — ranking factor «number of servers»
- «Verified Server Requirements for Game Publishers and Developers» (support.discordapp.com, id 115001987272)
- «Enabling Server Discovery» (support.discord.com, id 360030843331)
- «Activity Sharing on Discord FAQ» (support.discord.com, id 7931156448919) — не удалось получить содержимое вообще (403, без полезного сниппета)
- «How to Discover and Add Apps» / «How to Use Apps» (support-apps.discord.com) — не удалось получить содержимое вообще (403)

Обнаружены, но не прочитаны в этой сессии (⚠️ пометка, требуют перепроверки при необходимости):
- https://docs.discord.com/developers/platform/claim-your-game

Вторичные источники (⚠️ не первоисточники, использованы только там, где первичных данных не нашлось):
- scribd.com «Discord Quests Rate Card» — цифры минимального бюджета Quests ($100–150K)
- discord.fandom.com — история Gartic Phone как Activity (2023–2025) и размер её отдельного Discord-сервера
- indiehackers.com — тактика точечного аутрича (сам пост полу-первичный — это отчёт разработчика о собственном опыте, но не Discord-first-party и не специфичен для Activities)
