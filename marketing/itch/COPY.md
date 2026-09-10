# wheee — страница на itch.io

Ответы на поля формы itch.io (Create new project). Дата: 2026-09-10.

## Файлы

| Что | Где |
|---|---|
| Архив игры | `wheee-itch.zip` в корне репозитория, собирается `bash deploy/deploy-itch.sh` |
| Обложка 630×500 | `marketing/itch/cover-630x500.png` |
| Скриншоты 1920×1080 | `packages/client/public/press/01-lobby.jpg` … `04-victory.jpg`, грузить в этом порядке |

## Основные поля

| Поле | Значение |
|---|---|
| Title | `wheee` |
| Project URL | `kharitonovpa.itch.io/wheee` |
| Short description or tagline | `1v1 storm duel on a two-sided floating island` |
| Classification | Games |
| Kind of project | **HTML** — You have a ZIP or HTML file that will be played in the browser |
| Release status | **In development** |
| Pricing | No payments |
| Genre | Strategy |
| Tags | `Multiplayer`, `PvP`, `Online`, `Versus`, `Tactical`, `Casual`, `Cute`, `3D`, `Weather`, `Short` |
| AI generation disclosure | **Yes**, см. ниже |
| App store links | пусто |
| Custom noun | пусто |
| Community | Comments |
| Visibility | Draft, после проверки встраивания переключить на Public |

**Release status.** «In development» честно описывает игру, которую правят каждую неделю, и открыто просит фидбек. Это и есть цель страницы.

**Pricing.** Донаты на itch работают только как экран перед скачиванием. У браузерной игры скачивания нет, поэтому «$0 or donate» ничего не даст.

**AI disclosure.** Большая часть кода написана вместе с Claude, это видно по истории коммитов. Правила itch требуют раскрывать такое даже после ручной правки. Отметить «Yes», а в уточняющих галочках выбрать то, что правда: код и тексты точно, графику и звук по фактическому происхождению ассетов.

## Uploads

1. Upload files → `wheee-itch.zip`.
2. У загруженного файла поставить галочку **This file will be played in the browser**.

## Embed options (появляются после выбора Kind of project = HTML)

| Поле | Значение |
|---|---|
| Embed in page | Manually set size |
| Viewport dimensions | 960 × 540 |
| Mobile friendly | включить, Orientation: Default |
| Automatically start on page load | выключить, пусть будет кнопка Run game |
| Fullscreen button | включить |
| Enable scrollbars | выключить |
| SharedArrayBuffer support | выключить |

## Description

Вставлять через кнопку `<>` (HTML source) в редакторе описания.

```html
<p><strong>wheee</strong> is a 1v1 storm-tactics duel. You and your rival stand on opposite faces of the same floating island. Every hill you raise on your side is a pit on theirs.</p>

<p>Read the wind forecast, build shelter, dig traps. When the storm hits, whoever prepared worse gets blown off the map or drowned in a flooded hollow. A match takes 1–3 minutes.</p>

<ul>
  <li><strong>Simultaneous moves</strong>: no waiting for turns, both players act at once</li>
  <li><strong>The two-sided map</strong>: your terrain is your opponent's, turned upside down</li>
  <li><strong>Wind pushes, rain floods, lightning strikes the highest crown</strong>: survive all three</li>
  <li><strong>Three crops to play</strong>: Wheat, Rice or Corn</li>
  <li><strong>Win streaks</strong> grow a badge, and one loss takes it away</li>
  <li><strong>Points and a leaderboard</strong> for every match you finish</li>
</ul>

<h2>Play with a friend</h2>
<p>Press <em>Invite a friend</em> and send the link. The match starts as soon as they open it. If nobody is in the queue, a bot steps in so you are never left waiting.</p>

<h2>Early and changing</h2>
<p>wheee is in active development. Tell me in the comments what made you stop playing or what would bring you back. I read every one.</p>

<p>Also on <a href="https://wheee.io">wheee.io</a>, in <a href="https://t.me/wheee_game_bot/play">Telegram</a> and as a <a href="https://discord.com/oauth2/authorize?client_id=1541107251346153492">Discord Activity</a>. Same servers, same leaderboard.</p>

<p>No ads, no paywalls.</p>

<hr>

<p><em>По-русски:</em> штормовая дуэль 1 на 1 на двусторонней карте. Каждый холм на твоей стороне становится ямой на стороне соперника. Матч идёт 1–3 минуты, игра переведена на русский.</p>
```

## Что itch-сборка делает иначе, чем wheee.io

- **Вход в аккаунт скрыт.** Сессия живёт в cookie api.wheee.io, а внутри фрейма itch это сторонний cookie, который браузеры отбрасывают. Гости играют во всё, кроме просмотра чужих матчей.
- **Приглашения ведут на wheee.io.** Адрес фрейма itch бесполезен как ссылка, а `?join=` со страницы itch во фрейм не доходит. Сервер тот же, друг попадает в тот же матч.
- **Аналитика помечает трафик хостом `itch`** при платформе `web`, так что его видно отдельно от wheee.io.
- **Лидерборд и подсказка персонажа** работают, только когда на сервере задеплоен CORS для `*.itch.zone`.
