import { ref, computed } from 'vue'

const currentLang = ref('en')

const messages: Record<string, Record<string, string>> = {
  en: {
    'tagline.1': 'One gust. One grid. No mercy.',
    'tagline.2': 'The wind doesn\'t care who built the hill.',
    'tagline.3': 'Shape. Stand. Survive.',
    'tagline.4': 'Hold your ground — if you can.',

    'char.wheat': 'Wheat',
    'char.rice': 'Rice',
    'char.corn': 'Corn',

    'lobby.play': 'Play',
    'lobby.play.instant': 'Play — instant match available',
    'lobby.watch': 'Watch',
    'lobby.architect': 'Architect',
    'lobby.signIn': 'Sign In',
    'lobby.signOut': 'Sign Out',
    'lobby.cancel': 'Cancel',
    'lobby.online': '{0} online',
    'lobby.searching': 'Searching for opponent',
    'lobby.countdown': 'Match starts in {0}s or sooner',
    'lobby.finding': 'Finding a match',
    'lobby.recent': 'Recent',
    'lobby.vs': 'vs',
    'lobby.draw': 'Draw',
    'lobby.won': '{0} won',

    'hud.round': 'Round {0}',
    'hud.waiting': 'Waiting for opponent...',
    'hud.forecast': 'Forecast',
    'hud.forecastSub': 'Your turn is coming...',
    'hud.roundPill': 'R{0}',
    'hud.chooseMoveFlash': 'Choose your move!',
    'hud.cataclysm': 'Cataclysm',
    'hud.flipView': 'Peek at opponent\'s side',

    'gameover.stalemate': 'Stalemate',
    'gameover.playerWins': 'Player {0} Wins',
    'gameover.victory': 'Victory!',
    'gameover.defeated': 'Defeated',
    'gameover.bothFell': 'Both fell to the elements',
    'gameover.concluded': 'The match has concluded',
    'gameover.stormBends': 'The storm bends to your will',
    'gameover.tryAgain': 'Every storm passes — try again?',
    'gameover.bothBlown': 'Both blown away by the storm',
    'gameover.bothDrowned': 'Both drowned in flooded basins',
    'gameover.blownOff': '{0} blown off the {1} edge',
    'gameover.drowned': '{0} drowned in a flooded basin',
    'gameover.disconnected': '{0} disconnected',
    'gameover.opponentBlown': 'Opponent blown off the {0} edge',
    'gameover.opponentDrowned': 'Opponent drowned in a flooded basin',
    'gameover.opponentDisconnected': 'Opponent disconnected',
    'gameover.youBlown': 'Wind blew you off the {0} edge',
    'gameover.youDrowned': 'You drowned in a flooded basin',
    'gameover.playAgain': 'Play Again',
    'gameover.rewardedPlay': 'Watch Ad & Play',
    'gameover.replay': 'Replay',
    'gameover.backToLobby': 'Back to lobby',

    'dir.N': 'north',
    'dir.S': 'south',
    'dir.E': 'east',
    'dir.W': 'west',

    'watcher.pts': 'pts',
    'watcher.wins': 'wins',
    'watcher.or': 'or',
    'watcher.vane': 'Vane',
    'watcher.baro': 'Baro',

    'architect.wind': 'Wind',
    'architect.storm': 'Storm',
    'architect.rain': 'Rain',
    'architect.confirm': 'Confirm Weather',
    'architect.locked': 'Weather locked',
    'architect.time': 'Time',
    'architect.intel': 'Intel',
    'architect.clear': 'Clear',
    'architect.placeHint': 'click a cell to place',
    'architect.s': 's',

    'leaderboard.players': 'Players',
    'leaderboard.watchers': 'Watchers',
    'leaderboard.noPlayers': 'No ranked players yet',
    'leaderboard.noWatchers': 'No watcher scores yet',
    'leaderboard.more': '{0} more',
    'leaderboard.chat': 'Chat',

    'volume.mute': 'Mute',
    'volume.unmute': 'Unmute',
    'volume.music': 'Music',
    'volume.sfx': 'SFX',

    'tutorial.badge': 'Tutorial',
    'tutorial.forecast': 'A storm hits after **5 moves**. The **compass** (top right) shows where the wind will blow from. Take your time — moves here are untimed.',
    'tutorial.raise': '**Tap a cell** next to you and pick **Raise** — a wall on the wind side will shield you.',
    'tutorial.move': 'Now try moving: **tap your character**, pick **Move**, then tap a neighboring cell.',
    'tutorial.submitted': 'Nice. The move resolves once both sides have acted.',
    'tutorial.actToContinue': 'When you\'re ready, **make any move** to continue.',
    'tutorial.flip': 'Your opponent builds on the **other side** of the map. Tap the **flip button** (bottom right) to peek.',
    'tutorial.shelter': '**Wind** pushes you until a taller wall stops it. Stand behind a wall — or dig the opponent\'s defenses down.',
    'tutorial.lastTick': 'Last move before the storm. Check the **compass** and hold your ground!',
    'tutorial.weather': '**Cataclysm!** Whoever failed to prepare gets swept away.',
    'tutorial.round2': 'You\'re on your own now — **beat the bot!** Watch out: **rain** floods pits.',

    'replay.prev': 'Previous frame',
    'replay.pause': 'Pause',
    'replay.play': 'Play',
    'replay.next': 'Next frame',
    'replay.exit': 'Exit replay',

    'app.contextLost': 'Display error — tap to reload',
    'app.reconnecting': 'Reconnecting...',
    'app.opponentDc': 'Opponent disconnected — waiting for reconnect...',
    'app.you': 'You',
    'app.opponent': 'Opponent',
    'app.winnerPredicted': 'Winner predicted',

    'action.move': 'Move',
    'action.raise': 'Raise',
    'action.lower': 'Lower',
  },

  ru: {
    'tagline.1': 'Один порыв. Одна сетка. Без пощады.',
    'tagline.2': 'Ветру всё равно, кто построил холм.',
    'tagline.3': 'Формируй. Стой. Выживай.',
    'tagline.4': 'Удержи позицию — если сможешь.',

    'char.wheat': 'Пшеница',
    'char.rice': 'Рис',
    'char.corn': 'Кукуруза',

    'lobby.play': 'Играть',
    'lobby.play.instant': 'Играть — соперник найден',
    'lobby.watch': 'Смотреть',
    'lobby.architect': 'Архитектор',
    'lobby.signIn': 'Войти',
    'lobby.signOut': 'Выйти',
    'lobby.cancel': 'Отмена',
    'lobby.online': '{0} онлайн',
    'lobby.searching': 'Поиск соперника',
    'lobby.countdown': 'Матч через {0}с или раньше',
    'lobby.finding': 'Ищем матч',
    'lobby.recent': 'Недавние',
    'lobby.vs': 'vs',
    'lobby.draw': 'Ничья',
    'lobby.won': '{0} победил',

    'hud.round': 'Раунд {0}',
    'hud.waiting': 'Ожидание соперника...',
    'hud.forecast': 'Прогноз',
    'hud.forecastSub': 'Скоро ваш ход...',
    'hud.roundPill': 'R{0}',
    'hud.chooseMoveFlash': 'Выбери действие!',
    'hud.cataclysm': 'Катаклизм',
    'hud.flipView': 'Посмотреть сторону соперника',

    'gameover.stalemate': 'Ничья',
    'gameover.playerWins': 'Игрок {0} победил',
    'gameover.victory': 'Победа!',
    'gameover.defeated': 'Поражение',
    'gameover.bothFell': 'Оба пали от стихии',
    'gameover.concluded': 'Матч завершён',
    'gameover.stormBends': 'Буря подчиняется тебе',
    'gameover.tryAgain': 'Каждая буря проходит — попробуешь ещё?',
    'gameover.bothBlown': 'Оба сдуты бурей',
    'gameover.bothDrowned': 'Оба утонули в затопленных впадинах',
    'gameover.blownOff': '{0} сдут с {1} края',
    'gameover.drowned': '{0} утонул в затопленной впадине',
    'gameover.disconnected': '{0} отключился',
    'gameover.opponentBlown': 'Соперник сдут с {0} края',
    'gameover.opponentDrowned': 'Соперник утонул в затопленной впадине',
    'gameover.opponentDisconnected': 'Соперник отключился',
    'gameover.youBlown': 'Ветер сдул тебя с {0} края',
    'gameover.youDrowned': 'Ты утонул в затопленной впадине',
    'gameover.playAgain': 'Ещё раз',
    'gameover.rewardedPlay': 'Реклама и играть',
    'gameover.replay': 'Повтор',
    'gameover.backToLobby': 'В лобби',

    'dir.N': 'северного',
    'dir.S': 'южного',
    'dir.E': 'восточного',
    'dir.W': 'западного',

    'watcher.pts': 'очк',
    'watcher.wins': 'побед',
    'watcher.or': 'или',
    'watcher.vane': 'Флюгер',
    'watcher.baro': 'Баро',

    'architect.wind': 'Ветер',
    'architect.storm': 'Шторм',
    'architect.rain': 'Дождь',
    'architect.confirm': 'Подтвердить погоду',
    'architect.locked': 'Погода зафиксирована',
    'architect.time': 'Время',
    'architect.intel': 'Разведка',
    'architect.clear': 'Ясно',
    'architect.placeHint': 'нажми на клетку',
    'architect.s': 'с',

    'leaderboard.players': 'Игроки',
    'leaderboard.watchers': 'Зрители',
    'leaderboard.noPlayers': 'Пока нет игроков',
    'leaderboard.noWatchers': 'Пока нет зрителей',
    'leaderboard.more': 'ещё {0}',
    'leaderboard.chat': 'Чат',

    'volume.mute': 'Звук',
    'volume.unmute': 'Звук',
    'volume.music': 'Музыка',
    'volume.sfx': 'Эффекты',

    'tutorial.badge': 'Обучение',
    'tutorial.forecast': 'Буря ударит после **5 ходов**. **Компас** (справа сверху) показывает, откуда подует ветер. Не спеши — здесь ходы без таймера.',
    'tutorial.raise': '**Нажми на клетку** рядом с собой и выбери **Поднять** — стена со стороны ветра защитит тебя.',
    'tutorial.move': 'Теперь попробуй сходить: **нажми на своего персонажа**, выбери **Ход** и нажми на соседнюю клетку.',
    'tutorial.submitted': 'Отлично. Ход применится, когда сходят обе стороны.',
    'tutorial.actToContinue': 'Когда осмотришься — **сделай любой ход**, чтобы продолжить.',
    'tutorial.flip': 'Соперник строит на **другой стороне** карты. Нажми **кнопку переворота** (внизу справа), чтобы подглядеть.',
    'tutorial.shelter': '**Ветер** толкает, пока не упрёшься в стену выше. Спрячься за стеной — или срой защиту соперника.',
    'tutorial.lastTick': 'Последний ход перед бурей. Проверь **компас** и держись!',
    'tutorial.weather': '**Катаклизм!** Кто не подготовился — того сдует.',
    'tutorial.round2': 'Дальше сам — **победи бота!** И осторожно: **дождь** затапливает ямы.',

    'replay.prev': 'Предыдущий кадр',
    'replay.pause': 'Пауза',
    'replay.play': 'Воспроизвести',
    'replay.next': 'Следующий кадр',
    'replay.exit': 'Выйти из повтора',

    'app.contextLost': 'Ошибка отображения — нажми для перезагрузки',
    'app.reconnecting': 'Переподключение...',
    'app.opponentDc': 'Соперник отключился — ожидание...',
    'app.you': 'Ты',
    'app.opponent': 'Соперник',
    'app.winnerPredicted': 'Победитель угадан',

    'action.move': 'Ход',
    'action.raise': 'Поднять',
    'action.lower': 'Опустить',
  },
}

export function setLanguage(lang: string) {
  currentLang.value = messages[lang] ? lang : 'en'
}

export function getLanguage(): string {
  return currentLang.value
}

export function t(key: string, ...args: (string | number)[]): string {
  const msg = messages[currentLang.value]?.[key] ?? messages.en[key] ?? key
  if (args.length === 0) return msg
  return msg.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)]))
}

export const lang = computed(() => currentLang.value)

export const TAGLINES = computed(() => [
  t('tagline.1'),
  t('tagline.2'),
  t('tagline.3'),
  t('tagline.4'),
])
