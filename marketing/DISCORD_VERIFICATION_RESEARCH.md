# Discord: верификация приложения и попадание в App Directory для Activity (wheee)

Дата исследования: **2026-08-24**.
Контекст: wheee — HTML5 1v1 PvP-игра, работает как Discord Activity; app id сейчас на личном аккаунте. Цель: команда → верификация личности + приложения → снятие лимита «сервер < 25 участников» → опт-ин в Discovery (App Directory / App Launcher). Монетизация **не** нужна.

**Методология и оговорка об источниках.** Канонические доки (`docs.discord.com`) прочитаны напрямую и через официальный репозиторий `discord/discord-api-docs` (ветка `main`, актуальный источник сайта). Статьи `support-dev.discord.com` **блокируются Cloudflare при прямом фетче (HTTP 403)** — их содержимое взято из снапшотов Wayback Machine (для каждой указана дата снапшота и дата обновления статьи). Всё, что не удалось подтвердить первоисточником, помечено «⚠️ не подтверждено первоисточником».

---

## TL;DR — порядок действий и сроки

1. **Включить 2FA** на Discord-аккаунте владельца (обязательное условие для команд). Проверить, что e-mail подтверждён.
2. **Создать команду**: Developer Portal → [Teams](https://discord.com/developers/teams) → «New Team». Команда **обязательна для верификации приложения** («Teams are required for app verification»).
3. **Перенести приложение в команду**: приложение → General Information → внизу кнопка **«Transfer App to Team»**. Перенос **необратим**. В доках нет ни слова о смене client id/secret — по всем признакам App ID сохраняется (⚠️ явного подтверждения «ничего не ломается» в доках нет, см. §1).
4. **Подготовить артефакты**: Privacy Policy и ToS публично доступны (у нас: wheee.io/privacy, wheee.io/terms) и **привязаны в портале** (General Information → Terms of Service URL / Privacy Policy URL); описание, иконка, теги.
5. **App Verification**: приложение → вкладка **«App Verification»** (URL-шаблон `applications/<id>/verification-onboarding`) → выполнить чеклист → владелец команды проходит **проверку личности через Stripe** (гос. документ; RU-паспорта в списке поддерживаемых Stripe стран, см. §2) → кнопка **«Verify App»**. Срок ревью Discord нигде официально не публикует; по вторичным источникам — «несколько дней, иногда дольше» (⚠️ не подтверждено первоисточником).
6. После верификации: лимит «<25 участников» снят, Activity играбельна везде; в портале появляется вкладка **Discovery**.
7. **Discovery**: Discovery → Discovery Settings (описание, support-сервер, медиа, языки, ссылки) + теги в General Information + Install URL в OAuth2 → Discovery Status → **«Enable Discovery»**. Появление в каталоге — **до 24 часов** (доки) / **до 30 часов** (Help Center).
8. Переверификация личности через Stripe — **раз в 3 года**, окно 60 дней; иначе статус верификации слетает.

---

## 1. Teams: создание, перенос приложения, роли, 2FA

Источник: [docs.discord.com/developers/topics/teams](https://docs.discord.com/developers/topics/teams) (прочитан полностью) и Help Center «Creating and Managing a Developer Team» ([support-dev, id 34905563063703](https://support-dev.discord.com/hc/en-us/articles/34905563063703-Creating-and-Managing-a-Developer-Team); статья обновлена 30.09.2025, снапшот Wayback 20.07.2026 — прямой фетч блокирует Cloudflare).

- **2FA обязательна**: «To create or be a member on a team, you must enable 2FA for your Discord account» — т.е. и для создателя, **и для каждого участника** команды.
- **Создание**: Developer Portal → [Teams page](https://discord.com/developers/teams) → «New Team» → заполнить Team Information, пригласить участников (по username; приглашение приходит на e-mail, его нужно принять). Лимит: 75 приложений на команду, до 100 участников.
- **Команда обязательна для верификации**: «Teams are required for app verification» (Help Center, 30.09.2025).
- **Перенос существующего приложения**: страница приложения → **General Information** → внизу **«Transfer App to Team»**. Предупреждение из доков: «Once an app has been transferred to a team, it *cannot* be transferred back» — перенос необратим.
- **Что с credentials**: ни доки, ни Help Center **не упоминают** смену Application ID, client secret, токена бота или OAuth-маппингов при переносе. App ID — snowflake приложения и в URL портала остаётся тем же. ⚠️ Явной фразы «client id/secret сохраняются» в первоисточниках нет; практический риск минимален, но после переноса стоит проверить, что прописанный в проде `DISCORD_CLIENT_ID`/secret работают (secret можно не трогать — кнопки «Reset» не нажимать).
- **Роли** (каждая наследует права нижестоящих):
  - **Owner** — один на команду; единственный, кто может совершать «destructive, irreversible actions» (удаление приложений/команды). Именно owner проходит проверку личности.
  - **Admin** — всё как owner, кроме разрушительных действий.
  - **Developer** — видит client secret/public key, может настраивать endpoints, сбрасывать токен бота; не управляет командой.
  - **Read-only** — просмотр информации и экспорт payout-записей.
- Все участники команды имеют доступ к приложениям команды — «use caution when adding new team members». Для чистых плейтестеров лучше **App Testers** (до 50, вкладка App Testers), а не членство в команде.

## 2. Проверка личности (identity verification)

Источники: «How Do I Get My App Verified?» ([support-dev, id 23926564536471](https://support-dev.discord.com/hc/en-us/articles/23926564536471-How-Do-I-Get-My-App-Verified), обновл. 30.08.2024, снапшот 11.06.2026), «Stripe Identity Verification FAQ» ([id 6226051178775](https://support-dev.discord.com/hc/en-us/articles/6226051178775-Stripe-Identity-Verification-FAQ), обновл. 09.05.2024, снапшот 16.10.2025), «ID Verification Update FAQ» ([id 23370452552599](https://support-dev.discord.com/hc/en-us/articles/23370452552599-ID-Verification-Update-FAQ), обновл. 09.05.2024, снапшот 13.01.2025) — все через Wayback (Cloudflare 403 при прямом фетче); [docs.stripe.com/identity/verification-checks?type=document](https://docs.stripe.com/identity/verification-checks?type=document) (прочитан напрямую).

- **Кто проходит**: «the owner of the development team which owns the app will need to verify their identity through Stripe, our identity verification provider». Только **владелец команды**; при переверификации «all current team members will be notified, but the owner is the one who needs to re-verify their ID».
- **Провайдер — Stripe Identity**: документ-чек (фото гос. документа, Stripe сверяет подлинность; возможна связка с селфи — Discord-специфичный состав шагов в статьях не расписан). Данные хранятся у Stripe/для Discord; доступ — узкий круг security/legal; удаление — через год после удаления связанного приложения.
- **Возраст**: подающий на верификацию должен быть **16+** (Bot Verification FAQ for Parents…, ⚠️ по сниппету поиска, статья не перечитана целиком).
- **Переверификация**: «users will be asked to reverify their ID once every three years» (ретеншн Stripe — 3 года); окно — **60 дней**, иначе «your apps will lose their verification status and you will have to apply for verification again». Можно использовать **другой документ**, чем в первый раз.
- **Срок прохождения**: сама проверка Stripe обычно автоматическая (минуты); Discord пишет лишь «if you still see this after a few minutes, try again with better lighting or a clearer photo». Официального SLA нет.
- **Про Россию / RU-паспорта**: в Discord-источниках **никаких** ограничений по стране гражданства владельца не сформулировано. В общем доке Stripe Identity список стран, чьи документы поддерживаются document-чеком, **включает RU** (наряду с BY, UA, KZ, UZ и др.). Важная оговорка Stripe: «Stripe doesn't support extraction of document fields written in Arabic, Chinese, Cyrillic, Greek, Hebrew, Korean, Tamil, or Thai script» — т.е. кириллические поля не извлекаются; у загранпаспорта РФ есть машиночитаемая зона (MRZ) латиницей, что обычно и используется (⚠️ вывод о MRZ — инференс, не цитата). Рекомендация: проходить по **загранпаспорту**, а не внутреннему паспорту РФ. Это доки Stripe «в общем», а не Discord-специфичный список — теоретически у Discord конфигурация может отличаться (⚠️ не проверяемо снаружи).
- Санкционные ограничения Stripe касаются **бизнес-аккаунтов/выплат** (нам не нужны — монетизацию не включаем); к identity-чеку документов это в доках не привязано.

## 3. Верификация приложения (App Verification)

Источники: «How Do I Get My App Verified?» (см. выше), [docs.discord.com/developers/discovery/enabling-discovery](https://docs.discord.com/developers/discovery/enabling-discovery) (прочитан полностью).

- **Где**: Developer Portal → выбрать приложение → вкладка **«App Verification»** в левом меню (в доках ссылка вида `https://discord.com/developers/applications/select/verification-onboarding`, т.е. страница `applications/<app id>/verification-onboarding`).
- **Формат**: это **чеклист**, а не длинная анкета: «In this tab you will find a checklist of requirements for verification. Once you meet all of these requirements, you will be able to click the "Verify App" button, and that is that!» Самое заметное требование — identity verification владельца команды (см. §2).
- **Точный состав чеклиста** снаружи (без верифицируемого приложения в портале) не опубликован. По совокупности источников в него входят: владение приложением командой, identity verification владельца, заполненные name/description/icon, привязанные **Terms of Service URL и Privacy Policy URL** (поля на General Information), 2FA. ⚠️ Пункт «verified email» отдельно в статьях не назван (он и так обязателен для создания приложений). Анкеты «зачем каждый scope» для Activity-приложения без privileged intents источники не описывают — развёрнутые обоснования интентов относятся к бот-верификации; наши скоупы `identify` и `applications.commands` непривилегированные. ⚠️ не подтверждено, что форма вообще спросит про скоупы.
- **Privacy Policy** должна «clearly and accurately describe to users of your app the user data you collect and how you use and share such data with us and third parties»; **ToS** — «an agreement between you and users governing the use of your app». Проверьте, что wheee.io/privacy покрывает данные из `identify` (id, username, avatar).
- **Срок ревью**: официально не публикуется. Вторичный источник (discord-media.com): «обычно несколько дней, может дольше при загруженности» — ⚠️ не подтверждено первоисточником.
- **Типовые причины отказа** (⚠️ вторичные источники, не официальный список): нет ясной цели/ценности приложения; неполная или неточная информация в заявке; запрошены лишние permissions/скоупы; недоступные или пустые ToS/Privacy Policy; контент, нарушающий Developer Policy.
- Побочный эффект: «Once your application is verified, you will not be able to turn off the public bot setting». Для экспериментов Discord советует держать **отдельное unverified-приложение**: «The best practice for development, testing, and adding new features is to use an unverified Activity. Meanwhile, maintain a separate verified "live" Activity for your stable build».

## 4. Что верификация даёт именно Activity

Источники: «What are Verified and Unverified Activities?» ([support-dev, id 26576097154199](https://support-dev.discord.com/hc/en-us/articles/26576097154199-What-are-Verified-and-Unverified-Activities), обновл. 30.04.2025, снапшот 16.10.2025), «How Can Users Discover and Play My Activity?» ([id 21204493235991](https://support-dev.discord.com/hc/en-us/articles/21204493235991-How-Can-Users-Discover-and-Play-My-Activity), обновл. 30.04.2025, снапшот 04.10.2025) — через Wayback; [docs.discord.com/developers/platform/activities](https://docs.discord.com/developers/platform/activities).

Точные формулировки:

- Unverified: «By design, unverified Activities have limited visibility and can only be launched in servers with fewer than 25 members»; «Only visible to you, your development team, and app testers»; «It is only playable by the team's developers and app testers who are explicitly invited to test it».
- Verified: «Visible to everyone on Discord (**There is no longer a server member limit.**)», «Playable in any server, regardless of size», «Allowed to enable discovery through Discord Discovery Surfaces», «Eligible for monetization…» (нам не нужно).
- Про запуск вообще (platform-док): «They can be launched in channels, DMs, or from the App Launcher with no external window or separate download required». Отдельной формулировки «DM-поведение для не-установивших до/после верификации» в источниках нет — доступность для «everyone on Discord» покрывается цитатой выше. ⚠️ Специальных «минимальных порогов использования» (минимум серверов и т.п.) для верификации Activity ни один источник не называет; правило «Verification is required for your app to scale past 100 servers» сформулировано для приложений/ботов в целом.
- **Share-ссылки** (`https://discord.com/activities/<Activity ID>?...`, `shareLink`, custom links) описаны в [Growth and Referrals](https://docs.discord.com/developers/activities/development-guides/growth-and-referrals): клик по embed «Play» открывает Activity и прокидывает `custom_id`/`referrer_id`; кастомные ссылки создаются в портале (Activities → Custom Links, картинка **43:24**, title+description обязательны), ephemeral quick-links живут 30 дней. Ограничений «только для верифицированных» в этом доке нет, но фактическая запускаемость для посторонних следует из правил §4 выше: до верификации ссылку смогут открыть только тестеры/команда и только в серверах <25 человек.
- Третья discovery-поверхность помимо Directory/Launcher — **Activity Status**: «friends and members in their servers will be able to see when they are playing your Activity or if they have played it recently» (если у игрока включён Activity Privacy).

## 5. App Directory / Discovery: чеклист, поля, ассеты, локали

Источники: [enabling-discovery](https://docs.discord.com/developers/discovery/enabling-discovery), [discovery/overview](https://docs.discord.com/developers/discovery/overview), [discovery/best-practices](https://docs.discord.com/developers/discovery/best-practices), [activities/development-guides/assets-and-metadata](https://docs.discord.com/developers/activities/development-guides/assets-and-metadata) (все прочитаны); «App Directory: App profile pages» ([support-dev, id 6378525413143](https://support-dev.discord.com/hc/en-us/articles/6378525413143-App-Directory-App-profile-pages), обновл. 09.10.2025, снапшот 12.03.2026) и «App Content Requirements Policy» ([id 9489299950487](https://support-dev.discord.com/hc/en-us/articles/9489299950487-App-Directory-App-Content-Requirements-Policy), обновл. 09.10.2025, снапшот 06.07.2026) — через Wayback.

- **Предусловие**: «we require your team owner to complete identity and application verification». Вкладка Discovery видна **только верифицированным** приложениям.
- **Чеклист Discovery Status** (обязательные пункты):
  1. App Verification — приложение верифицировано.
  2. **Support Server\*** (в Discovery Settings) — ссылка на ваш Discord-сервер, и он должен быть **Community server** («Your support server must be designated as a community server»).
  3. **Application Description\*** (в Discovery Settings) — «Explain with as much detail as possible, what your application does…»; рекомендация: главное — в первых строках.
  4. **Tags** — минимум 1, до 5, задаются в **General Information**; best practices: «up to five words» как поисковые теги.
  5. **Install URL** — в разделе **OAuth2 URL Generator** («setting up the OAuth2 flow will generate a Default URL»).
  6. **Privacy Policy** и **Terms of Service** — привязаны и публично доступны.
- **Необязательные поля** Discovery Settings: **Media Carousel** (до **5 ассетов**: изображения и/или видео; видео — **только YouTube**, public или unlisted; карусель крутится сама, лучший ассет — первым), **External Links** (до **5**, имя+URL freeform; популярные соцсети получают иконку автоматически), **Supported Languages** (выбрать ВСЕ поддерживаемые языки; для каждого выбранного языка появляется дропдаун в Application Description — туда кладут **локализованный текст описания**).
  - Точные пиксельные размеры для картинок карусели в статье **не заданы** (⚠️ спеки не опубликованы; ориентироваться на превью).
- **Русский язык**: официальный список локалей Discord ([Reference → Locales](https://docs.discord.com/developers/reference#locales)) включает `ru` — Russian. Отдельного «списка языков App Directory» источники не публикуют; поле Supported Languages + локализованные описания — механизм локализации страницы. Сам Developer Portal — «Currently, the Developer Portal is only available in English». ⚠️ Что дропдаун Supported Languages содержит именно русский — снаружи не проверяемо, но, учитывая `ru` в API-локалях и русскую локализацию клиента, крайне вероятно.
- **Ассеты Activity Shelf** (App Launcher; отдельно от карусели Directory!) — Activities → **Art Assets** ([assets-and-metadata](https://docs.discord.com/developers/activities/development-guides/assets-and-metadata)), точные спеки:
  - **Embedded Background**: 16:9, ширина ≥ 1024 px; арт по краям, центр свободен под UI.
  - **Cover Art**: показывается и в 16:9, и в 13:11; ширина ≥ 1024 px; советуют вписать название игры в изображение.
  - **Video Preview** (при наведении на cover): **640×360, mp4, ≤10 секунд**, размер — доки говорят ≤1 MB, но ⚠️ **портал на практике требует ≤0.5 MB** («Файл слишком большой. Максимальный размер файла — 0.5 МБ», проверено на живой форме 2026-08-27). Ориентироваться на 0.5 MB.
  - Метаданные Shelf берутся из General Information: name, icon, description, **Max Participants** (для wheee поставить 2 — покажет «Up to 2 participants»; пусто = «Unlimited»).
- **Контентные требования** (за нарушение не пустят/выкинут из Directory): соответствие ToS/Community Guidelines/Developer ToS/Developer Policy; публичные Privacy Policy и ToS; **никакого age-restricted контента** (секс-контент, «Violent content», оружие/алкоголь/наркотики, «Gambling-adjacent or addictive behavior»); name/description/commands без нарушения чужой IP. Важно: «Enable Discovery» ≠ гарантия листинга — «We also reserve the right to remove apps from the App Directory at any time».
- **Пропагация**: доки — «it may take up to 24 hours for your app to appear in the App Directory and App Launcher»; Help Center-статья про Activity — «it can take up to 30 hours». Проверка: искать себя в [App Directory](https://discord.com/application-directory) (страница приложения — `discord.com/application-directory/<application_id>`; превью страницы видите только вы/команда ещё до опт-ина).
- Частые провалы ревью каталога: недоступные ToS/Privacy URL, не-community support-сервер, теги/описание с нарушением IP или намёком на age-restricted (⚠️ агрегировано из требований, официального «топа причин» нет).

## 6. Entry Point command / вид в App Launcher

Источник: [docs.discord.com/developers/interactions/application-commands#entry-point-commands](https://docs.discord.com/developers/interactions/application-commands#entry-point-commands) (прочитан полностью).

- «An Entry Point command serves as the primary way for users to open an app's Activity from the App Launcher». Команда видна, только если у приложения включены Activities.
- **Дефолт**: «When you enable Activities, an Entry Point command (named "Launch") is automatically created for your app with `DISCORD_LAUNCH_ACTIVITY` (2) set as the Entry Point handler» — Discord сам запускает Activity и постит follow-up сообщение в канал.
- Эталонный вид команды (пример из доков):
  ```json
  { "name": "launch", "description": "Launch Racing with Friends", "type": 4, "handler": 2 }
  ```
  Для wheee: получить свою команду через `GET /applications/<id>/commands` (искать «Launch») и `PATCH`-нуть description на что-то продающее, например «Запусти wheee — 1v1 PvP прямо в Discord» (+ `description_localizations` с `ru`). Тип 4 = `PRIMARY_ENTRY_POINT`; handler 2 оставить (Discord сам открывает Activity) — наш `applications.commands` scope это покрывает.
- Ничего больше для «правильного вида» в App Launcher не требуется: карточку в Launcher формируют Art Assets + name/description/Max Participants из §5.

---

## Чеклист владельца (пошагово, с местами в портале)

1. ☐ Аккаунт: включить **2FA** (User Settings → My Account), убедиться, что e-mail подтверждён.
2. ☐ [discord.com/developers/teams](https://discord.com/developers/teams) → **New Team** → имя/иконка (это будущее публичное «лицо» разработчика).
3. ☐ Приложение wheee → **General Information** → вниз → **Transfer App to Team** → выбрать команду. (Необратимо! App ID остаётся в URL — сверить.)
4. ☐ Проверить прод после переноса: Activity запускается, OAuth работает, client id/secret в env не менялись.
5. ☐ **General Information**: name, icon, description (≤400 зн.), **Tags (≥1, ≤5)**, **Terms of Service URL** = `https://wheee.io/terms`, **Privacy Policy URL** = `https://wheee.io/privacy`, **Max Participants = 2**.
6. ☐ **OAuth2** → URL Generator → настроить **Install URL** (Default URL достаточно).
7. ☐ Приложение → **App Verification** (`…/verification-onboarding`) → пройти чеклист → владелец команды проходит **Stripe Identity** (загранпаспорт; уведомление видно и на странице команды) → **Verify App** → ждать ревью (⚠️ ориентир «дни», официального SLA нет).
8. ☐ После аппрува: убедиться, что лимит снят (запуск в сервере ≥25 человек посторонним пользователем).
9. ☐ Activities → **Art Assets**: загрузить Embedded Background, Cover Art, Video Preview (спеки в §5).
10. ☐ **Discovery → Discovery Settings**: Support Server (сделать сервер **Community**: Server Settings → Enable Community), Application Description (+ Supported Languages: en, ru + локализованные описания), Media Carousel (до 5), External Links (wheee.io, соцсети) → Save → **Preview App Directory**.
11. ☐ **Discovery → Discovery Status**: все пункты зелёные → **Enable Discovery**.
12. ☐ Через 24–30 ч искать wheee в [App Directory](https://discord.com/application-directory) и App Launcher.
13. ☐ Обновить description Entry Point-команды «Launch» (+ ru-локализация) через API.
14. ☐ Календарь: напоминание о **переверификации Stripe раз в 3 года** (окно 60 дней; письмо + system DM + баннер в портале).

## Что подготовить заранее (арты и тексты со спеками)

| Артефакт | Спека (из первоисточников) | Куда |
|---|---|---|
| Иконка приложения | квадрат (точный размер в доках не задан; де-факто 512×512+) | General Information |
| App Description | до 400 символов; Summary до 200 (best practices) | General Information |
| Теги | 1–5 шт., короткие поисковые слова (напр. `pvp`, `1v1`, `game`, `multiplayer`, `arcade`) | General Information |
| **Embedded Background** | 16:9, ширина ≥1024 px, центр свободен от арта | Activities → Art Assets |
| **Cover Art** | читается в 16:9 **и** 13:11, ширина ≥1024 px, с названием игры | Activities → Art Assets |
| **Video Preview** | 640×360, mp4, ≤10 c, ≤1 MB | Activities → Art Assets |
| Media Carousel | до 5 ассетов; видео — только YouTube-ссылка (public/unlisted); точных px-спек нет | Discovery Settings |
| Custom Link образ | 43:24 + title + description | Activities → Custom Links |
| Полное описание для Directory | markdown поддерживается (expanded description); EN + RU версии | Discovery Settings |
| Support-сервер | Discord-сервер с включённым **Community** | Discovery Settings |
| ToS / Privacy | публичные wheee.io/terms и wheee.io/privacy; privacy описывает данные `identify` (id/username/avatar) и их использование | General Information |
| Документ владельца | загранпаспорт (RU в списке Stripe; кириллические поля Stripe не извлекает) | Stripe Identity flow |
| Entry Point description | короткий продающий текст + `description_localizations.ru` | API PATCH команды «Launch» |

## Источники

Прочитаны напрямую (docs.discord.com / зеркально из `discord/discord-api-docs@main`):
- https://docs.discord.com/developers/topics/teams
- https://docs.discord.com/developers/discovery/enabling-discovery
- https://docs.discord.com/developers/discovery/overview
- https://docs.discord.com/developers/discovery/best-practices
- https://docs.discord.com/developers/platform/discovery • https://docs.discord.com/developers/platform/activities
- https://docs.discord.com/developers/activities/overview • …/how-activities-work
- https://docs.discord.com/developers/activities/development-guides/assets-and-metadata
- https://docs.discord.com/developers/activities/development-guides/growth-and-referrals
- https://docs.discord.com/developers/interactions/application-commands#entry-point-commands
- https://docs.discord.com/developers/reference#locales
- https://docs.stripe.com/identity/verification-checks?type=document (Stripe, список стран включая RU)

support-dev.discord.com — **прямой фетч блокирован Cloudflare (403)**, содержимое взято из Wayback-снапшотов оригинальных страниц:
- How Do I Get My App Verified? (обновл. 30.08.2024; снапшот 11.06.2026) — /hc/en-us/articles/23926564536471
- Stripe Identity Verification FAQ (09.05.2024; снапшот 16.10.2025) — /hc/en-us/articles/6226051178775
- ID Verification Update FAQ (09.05.2024; снапшот 13.01.2025) — /hc/en-us/articles/23370452552599
- Creating and Managing a Developer Team (30.09.2025; снапшот 20.07.2026) — /hc/en-us/articles/34905563063703
- What are Verified and Unverified Activities? (30.04.2025; снапшот 16.10.2025) — /hc/en-us/articles/26576097154199
- How Can Users Discover and Play My Activity? (30.04.2025; снапшот 04.10.2025) — /hc/en-us/articles/21204493235991
- App Directory: App Content Requirements Policy (09.10.2025; снапшот 06.07.2026) — /hc/en-us/articles/9489299950487
- App Directory: App profile pages (09.10.2025; снапшот 12.03.2026) — /hc/en-us/articles/6378525413143

Вторичные (⚠️ не первоисточники): discord-media.com (гайд по верификации — сроки/причины отказов), поисковые сниппеты Bot Verification FAQ (возраст 16+).
