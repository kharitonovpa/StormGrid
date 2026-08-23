# Куда ещё публиковать wheee: каналы дистрибуции за пределами GamePush

Дата: 2026-08-23.
Контекст: wheee — 1v1 PvP HTML5-игра (three.js/WebGL), EN/RU, требует realtime-бэкенд (WSS/XHR к api.wheee.io). Уже покрыто через GamePush: CrazyGames, Yandex Games, VK Games, OK Games, Moi Mir, GameDistribution, YouTube Playables, GamePix, WG Playground, Pikabu Games, портал GamePush; плюс Telegram Mini App + каталоги.

Методика: только первоисточники (официальные dev-порталы и документация). Каждое утверждение снабжено ссылкой на страницу, которую я реально открыл. Если страницу открыть не удалось (403/404/таймаут) — это указано явно.

---

## TL;DR — топ-5 по соотношению «усилия / аудитория»

1. **Discord Activities** — рекомендую (M). Websockets к своему бэкенду официально поддержаны через прокси `*.discordsays.com` + URL Mappings; аудитория играет группами друзей — это напрямую решает проблему ликвидности 1v1 PvP. Монетизация IAP встроена.
2. **Poki (напрямую)** — рекомендую с оговоркой (M). 90M+ игроков; мультиплеер с внешним сервером явно разрешён (исключение из блокировки внешних запросов). Оговорка: их основной формат — web-эксклюзив на 5 лет, что конфликтует с текущей дистрибуцией; целиться в неэксклюзивную сделку или обсуждать условия.
3. **Lagged** — рекомендую (S). Открытый приём игр, 50% AdSense-revshare, заявленные 20M игроков, простой JS SDK.
4. **RuStore (обёртка APK)** — рекомендую для RU (S/M). Публикация бесплатна, физлица допущены; с 01.02.2026 IAP физлицам/самозанятым отключены — монетизация рекламой остаётся (комиссии за сторонние платёжные решения нет).
5. **VK Play (каталог, self-publishing)** — возможно/рекомендую для RU (S/M). Принимают браузерные игры, физлица допущены, комиссия 5% (developer получает 95%).

Бонус-ход: **перевести CrazyGames с GamePush на прямой аккаунт** — убирает комиссию GamePush 20–40%; CrazyGames эксклюзива не требует. Требует координации, чтобы не получить дубль-листинг (см. §5).

---

## 1. Прямые HTML5-порталы (не в списке GamePush)

### 1.1 Poki — рекомендую (с оговоркой про эксклюзив)

- **Что это**: крупнейший западный портал веб-игр. Первоисточник заявляет маркетинг на **«90+ million players»** ([sdk.poki.com/deals](https://sdk.poki.com/deals)).
- **Сделки** ([sdk.poki.com/deals](https://sdk.poki.com/deals)):
  - *Web Exclusive* (предпочитаемый ими формат, ~5 лет): игра публикуется в вебе только на Poki (Steam/моб. сторы/консоли — можно; **Discord и YouTube Playables считаются вебом и запрещены**). Revshare: **100%**, если игрок пришёл сам, **50%**, если привёл Poki.
  - *Non-exclusive*: **разовая фиксированная лицензионная выплата**, без revshare и маркетинга.
- **Технические требования** ([sdk.poki.com/new-requirements](https://sdk.poki.com/new-requirements)): Poki **блокирует все внешние запросы по умолчанию**, но делает **явное исключение для мультиплеерных игр с внешними серверами** — требуется актуальный Privacy Statement. Начальная загрузка < 8 МБ (у wheee с three.js надо проверить и, вероятно, дробить бандл), 16:9, работа в инкогнито и при адблоке, SDK-события (gameplayStart/Stop, commercialBreak).
- **Подача**: форма на [developers.poki.com](https://developers.poki.com/) (сам сайт — JS-приложение, контент через WebFetch не читается; условия проверены по sdk.poki.com).
- **Вердикт**: **рекомендую** — единственный из больших порталов, где мультиплеер с нашим бэкендом прописан в требованиях явно. Но web-эксклюзив несовместим с текущей сеткой дистрибуции: либо non-exclusive (flat fee), либо переговоры. Усилие: **M**.

### 1.2 CrazyGames напрямую (vs через GamePush) — возможно (миграция)

- Подача через [developer.crazygames.com](https://developer.crazygames.com/); двухэтапный запуск: Basic (7–21 день теста, минимум 7 дней + 500 плеев) → Full (SDK + QA, включается монетизация) ([docs.crazygames.com](https://docs.crazygames.com/)).
- FAQ ([docs.crazygames.com/faq/](https://docs.crazygames.com/faq/)): **эксклюзив не требуется**; **«we only host the game files»** — мультиплеер-бэкенд свой, это норма для платформы; SDK даёт invite-links для мультиплеера; выплаты от €100/мес.
- Точный процент revshare в доках не публикуется (проверено: [docs.crazygames.com/faq/](https://docs.crazygames.com/faq/) его не называет).
- **Смысл прямого аккаунта**: GamePush берёт комиссию 20–40% (см. §5.1), прямой аккаунт — 0% сверху + прямой доступ к их multiplayer-фичам (invite links, лобби).
- **Риск**: одна игра из двух источников (агрегатор + прямая подача) = дубль и вероятный реджект; мигрировать надо согласованно (снять с дистрибуции GamePush → подать напрямую).
- **Вердикт**: **возможно** — выгодно по деньгам, но операционно аккуратно. Усилие: **M**.

### 1.3 itch.io — рекомендую (как дешёвый плацдарм, не как источник трафика)

- HTML5-игры загружаются ZIP-ом и работают в iframe; **внешние API разрешены при условии HTTPS**: «If your project tries to load files or talk to an API on another domain, then that domain must be requested with HTTPS» ([itch.io/docs/creators/html5](https://itch.io/docs/creators/html5)). WSS к api.wheee.io пройдёт.
- Лимиты: 1000 файлов, 500 МБ распакованно, 200 МБ на файл ([там же](https://itch.io/docs/creators/html5)).
- Монетизация HTML5-игр — только донаты ([там же](https://itch.io/docs/creators/html5)).
- **Вердикт**: **рекомендую** — усилие **S** (просто залить текущий билд), аудитория маленькая, но это канал к инди-комьюнити, стримерам и фидбеку; денег не даст.

### 1.4 Newgrounds — возможно (первоисточник не верифицирован)

- Официальные страницы (newgrounds.com/wiki/*) отдают **403 для автоматических запросов — верифицировать напрямую не удалось**; проверить вручную.
- По вторичным данным (вики-справочник сообщества [Wikigrounds](https://newgrounds.fandom.com/wiki/Revenue_Sharing)): открытая загрузка, revshare с рекламы, выплаты от $50. Не первоисточник — перепроверить.
- **Вердикт**: **возможно** — усилие S, но аудитория нишевая и требования к внешним запросам неизвестны.

### 1.5 CoolMathGames — скорее нет

- Официальный dev-портал: [developers.coolmathgames.com](https://developers.coolmathgames.com/). Требования при принятии: **«Remove any external links»**, убрать рекламу, добавить их SDK; подача через Google Form; аудитория — «Millions of players every month» (без точных цифр).
- По их же форме подачи ([coolmathgames.com/submit-a-game](https://www.coolmathgames.com/submit-a-game), найдено поиском): игры должны быть «thinking games», без счётчиков статистики, «report back» запрещён — это фактически запрещает наш бэкенд.
- **Вердикт**: **скорее нет** — реалтайм-PvP с внешним сервером противоречит их ограничениям на внешние вызовы; жанрово тоже мимо.

### 1.6 Armor Games — скорее нет

- Официальная страница разработчиков отдала **404**, саппорт-статья ([support.armorgames.com](https://support.armorgames.com/hc/en-us/articles/221224447-Sponsoring-and-licensing)) — **403; первоисточник не верифицирован**.
- По их комьюнити-форуму (первоисточник платформы, найден поиском: [armorgames.com/community/thread/11497628](https://armorgames.com/community/thread/11497628/submit-game-for-sponsorship)): модель — точечное спонсорство/лицензирование по e-mail, а не открытый аплоад.
- **Вердикт**: **скорее нет** — закрытая кураторская модель, низкая вероятность и долгий цикл; можно отправить письмо «на всякий» (усилие S).

### 1.7 Kongregate — нет

- Приём новых игр закрыт с 1 июля 2020 (новости: [Engadget](https://www.engadget.com/kongregate-stops-accepting-new-games-july-22nd-191508621.html), [Game Developer](https://www.gamedeveloper.com/game-platforms/kongregate-shuts-off-game-submissions-as-flash-s-final-days-approach)). Свежая статья в их саппорте про подачу игр существует, но отдаёт **403 — проверить вручную** ([blog.kongregate.com](https://blog.kongregate.com/hc/en-us/articles/44205164389005)). Примечание: GamePush в своих доках упоминает Kongregate среди платформ дистрибуции ([docs.gamepush.com/docs/distribution/](https://docs.gamepush.com/docs/distribution/)) — если он вам нужен, вероятно, он уже доступен через GamePush.
- **Вердикт**: **нет** как самостоятельный канал.

### 1.8 Y8 / id.net — возможно

- Загрузка: [y8.com/upload](https://www.y8.com/upload) → редиректит на `developer.y8.com/games?new=1` (кабинет за логином; проверен сам редирект). HTML5/WebGL принимаются, revshare включается после одобрения «Studio» через саппорт (официальный форум Y8: [forum.y8.com/t/how-to-upload-html5-games/26969](https://forum.y8.com/t/how-to-upload-html5-games/26969) — там же упоминание требования «low outgoing links»).
- Первопартийных цифр аудитории на dev-страницах нет.
- **Вердикт**: **возможно** — усилие S, старый портал с длинным хвостом трафика; политика по внешнему бэкенду отдельно не описана — выяснится на модерации.

### 1.9 Lagged — рекомендую

- Dev-портал: [lagged.dev](https://lagged.dev/) — «Submit your games to Lagged.com and start earning today», **«20 million gamers on the web»**, **«50% revenue share with Google Adsense»** (прямое партнёрство, отчётность и выплаты через Google), JS SDK / Unity plugin / Construct addon.
- Политика по мультиплееру/внешним вызовам на главной не описана — уточнить при подаче.
- **Вердикт**: **рекомендую** — открытая подача, понятная монетизация, усилие **S** (SDK простой).

### 1.10 Miniplay — возможно

- Док-портал: [ssl.miniplay.com/dev/docs/overview](https://ssl.miniplay.com/dev/docs/overview): игры в sandboxed iframe; **«if you need any server-side language … you must host it by yourself»** — то есть свой бэкенд предполагается архитектурой платформы; есть server-to-server API, своя валюта (Minicoins) с revshare от транзакций.
- Первопартийных цифр аудитории нет.
- **Вердикт**: **возможно** — испаноязычный охват (плюс к EN/RU не самый целевой), усилие M из-за их API.

### 1.11 Kizi / Agame — не подавать напрямую (overlap)

- Kizi и Agame принадлежат Azerion (Agame — через покупку Spil Games: [azerion.com](https://www.azerion.com/azerion-buys-spil-games-portals-business-to-become-casual-gaming-leader/)); GameDistribution — тоже Azerion. Игра уже идёт в GameDistribution через GamePush → эти порталы покрываются тем же фидом. Прямая подача = риск дубля.
- **Вердикт**: **нет** (уже покрыто косвенно).

### 1.12 Playhop — не подавать (overlap)

- Playhop — это площадка Яндекса для ЕС: юридический документ Яндекса о таргетинге игр на ЕС прямо оперирует «third-party platforms like Playhop.com», споры — на games-dsa@playhop.com ([yandex.com/legal/gamesforeurope](https://yandex.com/legal/gamesforeurope/index.html)). Публикация в Яндекс Играх (уже есть через GamePush) и есть путь на Playhop — отдельного канала нет; надо лишь включить международную дистрибуцию в кабинете Яндекса.
- **Вердикт**: **нет** как «новый» канал; **проверить, что в Яндекс-кабинете включён показ на Playhop/ЕС** — бесплатный прирост.

---

## 2. Мессенджеры и соцплатформы

### 2.1 Discord Activities — рекомендую

- Activities — веб-приложения в iframe с Embedded App SDK ([docs.discord.com/developers/activities/overview](https://docs.discord.com/developers/activities/overview)).
- **Сеть**: весь трафик — через прокси Discord `https://{clientId}.discordsays.com`; **WebSockets поддержаны полностью**, WebRTC — нет; внешние API подключаются через **URL Mappings** в Developer Portal, SDK-функция `patchUrlMappings()` перепатчивает fetch/WebSocket под маппинги; CSP ограничивает запросы прокси-доменом ([docs.discord.com/developers/activities/development-guides/networking](https://docs.discord.com/developers/activities/development-guides/networking)). Для wheee: завести маппинг `/api → api.wheee.io` — архитектурно совместимо.
- **Монетизация**: встроенные one-time purchases и подписки (SKU/Entitlements), «App Monetization applies to Bots and Activities» ([docs.discord.com/developers/monetization/overview](https://docs.discord.com/developers/monetization/overview)); детальные пороги/проценты в обзорной странице не указаны.
- **Дискавери**: App Directory + App Launcher (поиск, коллекции, staff picks); включается в дашборде ([docs.discord.com/developers/discovery/overview](https://docs.discord.com/developers/discovery/overview)). Первопартийных чисел аудитории по Activities нет.
- **Вердикт**: **рекомендую** — лучший фит для 1v1 PvP: люди сидят в войсе группами (мгновенная ликвидность матчей), EN-аудитория, техтребования совместимы. Усилие **M** (SDK + прокси-патчи + авторизация).

### 2.2 Facebook Instant Games — возможно (окно меняется прямо сейчас)

- Платформа активна: «the primary game platform on Facebook and Messenger», HTML5 SDK ([developers.facebook.com/docs/games/instant-games/](https://developers.facebook.com/docs/games/instant-games/)).
- Новый режим доступа — **Zero Permission Access / Network Enabled Zero Permissions**: профили игроков без прямого доступа разработчика к данным; требует **бизнес-верификацию Meta и App Review**, возможны доп. контракты ([developers.facebook.com/docs/features-reference/instant-games-zero-permission-access](https://developers.facebook.com/docs/features-reference/instant-games-zero-permission-access)).
- Сроки (вторичный источник, на страницах Meta напрямую не подтвердил): новые игры с 01.08.2025 обязаны использовать Zero Permissions; «Web Games» (канвас на facebook.com) закрываются 30.09.2026 ([ppc.land](https://ppc.land/meta-announces-web-games-sunset-by-september-2026/)) — **перепроверить в консоли Meta**.
- Слово «Network Enabled» — про сетевые социальные фичи Meta; разрешение на собственный бэкенд в открытых доках явно не описано (страница NEZP-overview контента через WebFetch не отдала).
- **Вердикт**: **возможно** — большая аудитория, но: бизнес-верификация, платформа в фазе перестройки, RU-аудитории нет. Усилие **L**.

### 2.3 TikTok Mini Games — скорее нет

- Официальная справка ([ads.tiktok.com/help/article/how-to-develop-tiktok-mini-games](https://ads.tiktok.com/help/article/how-to-develop-tiktok-mini-games)): издатель обязан быть **зарегистрированным бизнесом** + пройти **Industry Qualification Review**; движки — **«Cocos / Laya / Unity»**, фреймворк — **«Native Runtime»** (то есть не обычный браузерный HTML5/three.js).
- Рынки: США, Япония, Индонезия, Турция, Саудовская Аравия, Таиланд, Бразилия, Малайзия, Филиппины, Вьетнам ([developers.tiktok.com/docs/en/mini-games-overview](https://developers.tiktok.com/docs/en/mini-games-overview)); монетизация IAA/IAP там же.
- **Вердикт**: **скорее нет** — three.js под их native runtime не подходит без порта на Cocos/Unity; нужен бизнес-аккаунт и квалификация. Усилие L при сомнительном фите.

### 2.4 Snapchat — нет

- Snap Games закрыты (вложения прекращены по SEC-филингу Snap от 26.08.2022; функция удалена в 2023) — по прессе ([Screen Rant](https://screenrant.com/snapchat-games-disappeared/) и др.); действующей dev-программы игр нет.

### 2.5 LINE MINI Apps — скорее нет

- Официально: **«LINE MINI App is only offered in Japan, Taiwan, and Thailand»** ([help.line.me](https://help.line.me/line/smartphone/sp?contentId=200000423&lang=en)). Это веб-приложения на HTML5 с ревью для «verified» статуса ([developers.line.biz](https://developers.line.biz/en/docs/line-mini-app/discover/introduction/)).
- **Вердикт**: **скорее нет** — регионы не пересекаются с EN/RU аудиторией wheee; локализации под JP/TH нет.

### 2.6 Viber — нет

- Актуальной программы игр не нашёл ни на первоисточниках, ни в новостях после запуска Viber Games 2014–2015 ([TechCrunch](https://techcrunch.com/2015/02/25/viber-games-worldwide/)); признаков живой платформы в 2026 нет. **Пропустить.**

### 2.7 WeChat / WhatsApp — нет

- WeChat Mini Games: обязательны китайская бизнес-лицензия и ICP-филинг, бэкенд должен хоститься в Китае или через локального партнёра (обзорные материалы агентств, напр. [appinchina.co](https://appinchina.co/blog/the-complete-guide-to-wechat-mini-games/); первоисточники Tencent за логином). Для соло-разработчика без китайского юрлица — **нереализуемо**.
- У WhatsApp игровой платформы нет.

---

## 3. Магазины приложений (обёртки с малыми усилиями)

### 3.1 RuStore — рекомендую (RU)

- **Публикация бесплатна**: «Публикация приложений в RuStore бесплатна» ([rustore.ru/help/developers/publishing-and-verifying-apps](https://www.rustore.ru/help/developers/publishing-and-verifying-apps)). Физлица допущены к публикации после верификации (анонс VK, вторично: [ria.ru](https://ria.ru/20220916/rustore-1817374651.html)).
- **Монетизация**: официальный блог RuStore ([rustore.ru/developer/blog/self-employed](https://www.rustore.ru/developer/blog/self-employed)) — с **01.02.2026 платёжные инструменты RuStore недоступны физлицам и самозанятым** (Pay SDK, платные приложения, подписки); остаются **реклама и внешние решения — «RuStore не берёт комиссию за альтернативные платёжные решения»**; для полного IAP нужен ИП (можно на НПД 4–6%).
- Формат — APK (обёртка WebView/TWA поверх ru.wheee.io); правил против веб-обёрток, аналогичных Google Play, в требованиях RuStore не встретил (раздел требований подробно не фетчился — проверить при подаче).
- **Вердикт**: **рекомендую** — дешёвый способ присутствия в RU-сторе, где конкуренция ниже; усилие **S/M** (собрать APK-обёртку).

### 3.2 Google Play (TWA/Bubblewrap) — возможно

- Официальная политика: единый Developer Program Policy ([support.google.com/googleplay/android-developer/answer/16933379](https://support.google.com/googleplay/android-developer/answer/16933379) — открыл; конкретные правила про webview вынесены в раздел «Spam, Functionality and User Experience», отдельную страницу не фетчил). Суть по практике и обзорам: «wrapper-only» приложения отклоняются за Minimum Functionality/Spam; TWA-PWA допустимы при добавленной ценности (push, оффлайн, нативная интеграция) ([Google Play Academy — курс о Spam/Min Functionality](https://playacademy.exceedlms.com/student/path/65190-comply-with-google-play-s-spam-and-minimum-functionality-policies)).
- Продажа игровой валюты в обёртке потребует Google Play Billing.
- **Вердикт**: **возможно** — реализуемо (TWA + push-уведомления о матчах как «добавленная ценность»), но риск реджекта реален; $25 разовая регистрация. Усилие **M**.

### 3.3 Samsung Instant Plays — скорее нет

- Instant Plays 2.0 — это **облачный стриминг APK**, не HTML5: «bring users … right into your game instantly via streaming», загрузка APK в Galaxy Store Seller Portal, «Contact your Samsung representative» ([developer.samsung.com/instant-plays/overview.html](https://developer.samsung.com/instant-plays/overview.html)).
- **Вердикт**: **скорее нет** — потребуется APK + канал через менеджера Samsung; выгода неочевидна.

### 3.4 Huawei Quick Apps / Quick Game — скорее нет (первоисточник не догружен)

- Официальные страницы ([developer.huawei.com/consumer/en/quickGame/](https://developer.huawei.com/consumer/en/quickGame/), гайд по конверсии H5→Quick App) **таймаутились — верифицировать детально не удалось**. По официальным ссылкам из поиска: регистрация+верификация разработчика, упаковка в RPK, ревью, выбор стран ([developer.huawei.com, гайд по релизу](https://developer.huawei.com/consumer/en/doc/development/quickApp-Guides/quickapp-app-release-0000001129563721)).
- **Вердикт**: **скорее нет** — RPK-формат, отдельная экосистема, аудитория квик-аппов за пределами Китая невелика; усилие M–L.

### 3.5 Xiaomi GetApps / quick games — скорее нет

- GetApps работает в 59 регионах, публикация через global.developer.mi.com с ревью 1–2 дня; игры триггерят доп. проверку ([global.developer.mi.com](https://global.developer.mi.com/document?doc=quickStart.aboutGetApps) — по данным поиска, страницу отдельно не фетчил). Quick games как отдельная международная программа не подтверждена.
- **Вердикт**: **скорее нет** — тот же APK-wrapper, что и в Google Play/RuStore, но с меньшей отдачей; делать только после RuStore/GP.

### 3.6 Apple App Store — скорее нет (честно: высокий барьер)

- Guidelines ([developer.apple.com/app-store/review/guidelines/](https://developer.apple.com/app-store/review/guidelines/)): 4.2 Minimum Functionality — «Your app should include features, content, and UI that elevate it beyond a repackaged website»; 4.7 разрешает HTML5/JS мини-игры **внутри** приложения, но простая обёртка сайта будет отклонена.
- Плюс $99/год и ревью. Реалистичный путь — нативная оболочка (Capacitor) с нативными фичами (push, Game Center), это уже полноценный мобильный релиз.
- **Вердикт**: **скорее нет** сейчас; вернуться, если появится ресурс на настоящий мобильный порт.

---

## 4. Desktop и прочее

### 4.1 Steam (Electron-обёртка) — скорее нет (сейчас)

- Steam Direct: **$100 за продукт**, невозвратный, но рекупается после $1,000 gross; проверки личности/банка; 30 дней ожидания после оплаты + 2 недели «coming soon» ([partner.steamgames.com/steamdirect](https://partner.steamgames.com/steamdirect)). Запрещены «advertising-based business models» — т.е. рекламная монетизация wheee в Steam не работает, только F2P+IAP.
- Честно: у F2P веб-PvP без вишлист-кампании дискавери на Steam почти нулевое; ценность — соцпруф и страница для прессы, не аудитория.
- **Вердикт**: **скорее нет** — до появления IAP-модели и маркетингового плана под Steam. Усилие **L**.

### 4.2 Epic Games Store — скорее нет

- Официальные страницы публикации ([store.epicgames.com/en-US/publish](https://store.epicgames.com/en-US/publish) — 403, dev-доки — пусто/JS) **верифицировать не удалось**. По анонсу самопаблишинга (вторично: [Game Developer](https://www.gamedeveloper.com/business/epic-games-store-now-lets-developers-publish-their-own-games)): $100/игра (рекупается), 88/12, для мультиплеера — требование PC cross-play между сторами.
- **Вердикт**: **скорее нет** — те же проблемы, что со Steam, при ещё меньшем органическом дискавери.

### 4.3 Netflix Games — нет

- Открытой программы подачи для инди нет (поиск не находит первоисточника с submission-процессом; Netflix работает через собственные студии и закрытые контракты). **Пропустить.**

---

## 5. Агрегаторы помимо GamePush

### 5.1 Условия GamePush (важно для любых параллельных ходов)

- Официальные доки дистрибуции ([docs.gamepush.com/docs/distribution/](https://docs.gamepush.com/docs/distribution/)): revshare 80/20 по старым договорам; с 01.03.2026 — 70% для ИП/самозанятых/ООО и **60% для физлиц**; порог выплат $100; **пунктов об эксклюзивности в документации нет** — прямых запретов публиковаться самостоятельно или через второго агрегатора не обнаружено. Хостинг, аналитика и «запросы к бэкенду игры» включены в комиссию.
- **Практическое правило**: не отдавать один и тот же портал двум посредникам. Перед вторым агрегатором зафиксировать матрицу «кто куда поставляет».

### 5.2 Playgama — возможно (второй агрегатор с непересекающейся сеткой)

- [playgama.com/developers](https://playgama.com/developers): «Publish once with Playgama Bridge and reach **450M+ players** across YouTube Playables, MSN, and 100+ partner platforms»; единый SDK (Bridge, есть JS); revshare **70% (<$1k/мес) / 80% ($1–3k) / 90% (>$3k)**; фидбек за 24 часа; эксклюзивность не упоминается.
- Сетка: MSN Games, Facebook, Huawei, Xiaomi, Discord, Y8, Lagged, Playhop, TikTok и др. — **пересекается** с GamePush по YouTube Playables (и потенциально Playhop/Yandex): при подключении **исключить у Playgama платформы, куда уже поставляет GamePush**.
- **Вердикт**: **возможно/рекомендую** как способ дотянуться до MSN Games и «длинного хвоста» без ручной работы. Усилие **M** (ещё один SDK-мост; wheee уже умеет GamePush — Bridge ставится параллельно билд-флейвором).

### 5.3 GameMonetize — возможно (низкий приоритет)

- [gamemonetize.com](https://gamemonetize.com/): брокер, 37k+ игр, 50+ сайтов-партнёров, revshare от рекламы (~$1.5–3 eCPM за 1000 просмотров рекламы), выплаты NET 30, эксклюзивности нет.
- **Вердикт**: **возможно** — быстрый «ковровый» дистриб по мелким сайтам; низкий eCPM, зато усилие **S**. Риск пересечения с GameDistribution-сеткой — проверить список их партнёров перед подачей.

### 5.4 Famobi — скорее нет

- [famobi.com](https://famobi.com/): full-service агентство, лицензирование под бренды (Xiaomi Game Center, YouTube Playables, Bing, gamesnacks и т.п.); открытой подачи нет — только по контакту (sales@famobi.com); условия не публикуются.
- **Вердикт**: **скорее нет** — B2B-лицензирование казуалок, реалтайм-PvP им нетипичен; письмо стоит копейки, но ожидания низкие.

### 5.5 MarketJS — нет

- [marketjs.com](https://www.marketjs.com/): продают готовые игры бизнесам (лицензии $999–$15,999), это не канал дистрибуции для сторонних разработчиков. **Пропустить.**

### 5.6 CoolGames — скорее нет

- [coolgames.com](https://www.coolgames.com/): издатель/разработчик собственных и брендированных игр (Hasbro, Zynga; куплены Keesing Media Group в 2023); открытого приёма игр на сайте нет.
- **Вердикт**: **скорее нет**.

---

## 6. RU-специфика (сводно)

- **VK Play** — самостоятельный канал (не путать с VK Games/mini-apps, которые уже покрыты): каталог принимает **браузерные и PC-игры**, физлица допущены, **комиссия 5% / разработчику 95%**, новинкам дают 350 000 показов промо (пресс-релиз VK: [vk.company/ru/press/releases/11239/](https://vk.company/ru/press/releases/11239/)). Вердикт: **возможно/рекомендую** — RU-аудитория PC-геймеров, усилие S/M. Детальные технические требования к браузерным играм — в кабинете ([documentation.vkplay.ru](https://documentation.vkplay.ru/hotbox/devdocs/pdfcopy/ru/1010.pdf) — PDF-соглашение, детально не разбирал).
- **RuStore** — см. §3.1 (рекомендую).
- **Playhop/Яндекс международный** — см. §1.12: не новый канал, но проверить включённость международной дистрибуции в кабинете Яндекса.
- Fastex/Absolutist и т.п. — действующих открытых программ на первоисточниках не нашёл; пропущено.

---

## Сводная таблица

| Канал | Усилие | Вердикт | Ключевой факт (первоисточник) |
|---|---|---|---|
| Discord Activities | M | **Рекомендую** | WSS поддержан через прокси + URL Mappings ([docs.discord.com](https://docs.discord.com/developers/activities/development-guides/networking)) |
| Poki (напрямую) | M | **Рекомендую*** | Мультиплеер с внешним сервером разрешён; 90M+ игроков; осторожно с web-эксклюзивом ([sdk.poki.com/deals](https://sdk.poki.com/deals)) |
| Lagged | S | **Рекомендую** | 50% AdSense, 20M игроков, открытая подача ([lagged.dev](https://lagged.dev/)) |
| RuStore (APK-обёртка) | S/M | **Рекомендую (RU)** | Бесплатно, физлица; IAP физлицам отключён с 01.02.2026, реклама — да ([rustore.ru blog](https://www.rustore.ru/developer/blog/self-employed)) |
| VK Play (каталог) | S/M | **Возможно/рекомендую (RU)** | Браузерные игры, физлица, 95/5 ([vk.company](https://vk.company/ru/press/releases/11239/)) |
| itch.io | S | **Рекомендую (комьюнити)** | Внешние API по HTTPS разрешены; денег нет ([itch.io/docs](https://itch.io/docs/creators/html5)) |
| CrazyGames → прямой аккаунт | M | Возможно | Без эксклюзива; бэкенд свой — норма; минус комиссия GamePush ([docs.crazygames.com/faq](https://docs.crazygames.com/faq/)) |
| Playgama (2-й агрегатор) | M | Возможно | 450M+ через MSN и 100+ платформ, revshare 70–90%; исключить пересечения с GamePush ([playgama.com/developers](https://playgama.com/developers)) |
| GameMonetize | S | Возможно | 50+ сайтов, низкий eCPM ([gamemonetize.com](https://gamemonetize.com/)) |
| Y8 | S | Возможно | Открытая подача, revshare после одобрения Studio ([forum.y8.com](https://forum.y8.com/t/how-to-upload-html5-games/26969)) |
| Miniplay | M | Возможно | Свой бэкенд предполагается архитектурой ([ssl.miniplay.com](https://ssl.miniplay.com/dev/docs/overview)) |
| Newgrounds | S | Возможно | Первоисточник 403 — проверить вручную |
| Facebook Instant Games | L | Возможно | Активна, Zero Permissions + бизнес-верификация ([developers.facebook.com](https://developers.facebook.com/docs/features-reference/instant-games-zero-permission-access)) |
| Google Play (TWA) | M | Возможно | Wrapper-only реджектят; нужна добавленная ценность ([Play Academy](https://playacademy.exceedlms.com/student/path/65190-comply-with-google-play-s-spam-and-minimum-functionality-policies)) |
| Steam (Electron) | L | Скорее нет | $100, рекламная модель запрещена, дискавери у F2P-порта слабое ([steamdirect](https://partner.steamgames.com/steamdirect)) |
| Epic Games Store | L | Скорее нет | Первоисточник не верифицирован (403); $100, кроссплей-требование (вторично) |
| Apple App Store | L | Скорее нет | 4.2: «beyond a repackaged website» ([guidelines](https://developer.apple.com/app-store/review/guidelines/)) |
| CoolMathGames | M | Скорее нет | «Remove any external links», жанровый мисфит ([developers.coolmathgames.com](https://developers.coolmathgames.com/)) |
| Armor Games | S | Скорее нет | Закрытое спонсорство по e-mail; страницы 403/404 |
| TikTok Mini Games | L | Скорее нет | Бизнес-верификация; Cocos/Laya/Unity native runtime, не браузерный HTML5 ([ads.tiktok.com help](https://ads.tiktok.com/help/article/how-to-develop-tiktok-mini-games)) |
| Samsung Instant Plays | M | Скорее нет | Это облачный стриминг APK через менеджера ([developer.samsung.com](https://developer.samsung.com/instant-plays/overview.html)) |
| Huawei / Xiaomi quick apps | M–L | Скорее нет | RPK/отдельная экосистема; первоисточники Huawei таймаутились |
| LINE MINI Apps | L | Скорее нет | Только Япония/Тайвань/Таиланд ([help.line.me](https://help.line.me/line/smartphone/sp?contentId=200000423&lang=en)) |
| Kizi/Agame, Playhop | — | Нет (overlap) | Azerion/GameDistribution и Яндекс соответственно — уже покрыты |
| Kongregate, Snapchat, Viber, WeChat, Netflix, MarketJS, CoolGames, Famobi | — | Нет | Закрыты / нет открытой программы / нужен китайский энтити |

\* Poki — при условии неэксклюзивной сделки или готовности пересмотреть текущую сетку дистрибуции.

### Предлагаемый порядок действий

1. **itch.io** — залить за вечер (S), собрать фидбек.
2. **Lagged** — подать (S), простой SDK.
3. **Discord Activity** — спланировать спринт (M): URL Mapping на api.wheee.io, `patchUrlMappings`, авторизация через SDK.
4. **Poki** — отправить заявку и в переписке сразу проговорить неэксклюзив/мультиплеер (M).
5. **RuStore + VK Play** — RU-пакет одной итерацией (S/M).
6. Затем решить по **Playgama** (закрыть MSN и хвост) и **миграции CrazyGames на прямой аккаунт**.
