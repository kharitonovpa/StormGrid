<script setup lang="ts">
import { ref, inject, onMounted, onUnmounted, watch } from 'vue'
import type { CharacterType, ReplaySummary } from '@wheee/shared'
import { GAME_TITLE } from '@wheee/shared'
import type { AudioSystem } from '../lib/audio'
import { fetchReplayList } from '../lib/replayPlayer'
import { useAuth } from '../composables/useAuth'
import CharacterPreview from './CharacterPreview.vue'
import LeaderboardPanel from './LeaderboardPanel.vue'

const TAGLINES = [
  'One gust. One grid. No mercy.',
  'The wind doesn\'t care who built the hill.',
  'Shape. Stand. Survive.',
  'Hold your ground — if you can.',
]

const props = defineProps<{
  phase: string
  /** When true, crop choice is fixed (searching / Play Again already queued). */
  characterLocked: boolean
  /** Crop used for this matchmaking session when `characterLocked`. */
  committedCharacter: CharacterType
  onlineCount: number
  inQueue: number
  queueCountdown: number
}>()

const emit = defineEmits<{
  play: [character: CharacterType]
  watch: []
  architect: []
  watchReplay: [roomId: string]
  cancelSearch: []
}>()

const audio = inject<AudioSystem>('audio')
const { user, login, logout, fetchMe } = useAuth()
const showAuthMenu = ref(false)

const characters: { id: CharacterType; name: string; color: string; glow: string }[] = [
  { id: 'wheat', name: 'Wheat', color: '#e8c547', glow: 'rgba(232, 197, 71, 0.35)' },
  { id: 'rice', name: 'Rice', color: '#7bc47f', glow: 'rgba(123, 196, 127, 0.35)' },
  { id: 'corn', name: 'Corn', color: '#e8874a', glow: 'rgba(232, 135, 74, 0.35)' },
]

const selected = ref<CharacterType>('wheat')
const replays = ref<ReplaySummary[]>([])

function selectChar(id: CharacterType) {
  if (props.characterLocked) return
  selected.value = id
  audio?.play('ui-click')
}

function isCharActive(id: CharacterType) {
  return props.characterLocked ? props.committedCharacter === id : selected.value === id
}

watch(
  () => props.characterLocked,
  (locked) => {
    if (!locked) selected.value = props.committedCharacter
  },
)

function handleLogin(provider: 'google' | 'github') {
  audio?.play('ui-click')
  login(provider)
  showAuthMenu.value = false
}

function handleLogout() {
  audio?.play('ui-click')
  logout()
  showAuthMenu.value = false
}

const charLabel: Record<string, string> = { wheat: 'Wheat', rice: 'Rice', corn: 'Corn' }
const tagline = TAGLINES[Math.floor(Math.random() * TAGLINES.length)]

function onClickOutside(e: MouseEvent) {
  if (!showAuthMenu.value) return
  const target = e.target as HTMLElement
  if (target.closest('.signin-wrap') || target.closest('.user-chip')) return
  showAuthMenu.value = false
}

onMounted(async () => {
  selected.value = props.committedCharacter
  document.addEventListener('click', onClickOutside, true)
  fetchMe()
  replays.value = (await fetchReplayList()).slice(0, 5)
})

onUnmounted(() => {
  document.removeEventListener('click', onClickOutside, true)
})
</script>

<template>
  <div class="lobby">
    <!-- Title -->
    <div class="lobby-title-area">
      <h1 class="lobby-title">{{ GAME_TITLE }}</h1>
      <p class="lobby-tagline">{{ tagline }}</p>
    </div>

    <!-- Bottom glass panel -->
    <div class="lobby-panel">
      <div class="panel-fade" />
      <div class="panel-content">
        <!-- Crop selector -->
        <div class="panel-section crops-section">
          <div class="char-select" :class="{ 'char-select-locked': characterLocked }">
            <button
              v-for="ch in characters"
              :key="ch.id"
              type="button"
              class="char-btn"
              :class="{ active: isCharActive(ch.id), locked: characterLocked }"
              :style="{ '--accent': ch.color, '--glow': ch.glow }"
              :disabled="characterLocked"
              :aria-disabled="characterLocked"
              :aria-pressed="isCharActive(ch.id)"
              @click="selectChar(ch.id)"
            >
              <div class="char-preview-wrap">
                <CharacterPreview :character="ch.id" :active="isCharActive(ch.id)" />
              </div>
              <span class="char-name">{{ ch.name }}</span>
            </button>
          </div>
        </div>

        <!-- Divider -->
        <div class="panel-divider" />

        <!-- Actions -->
        <div class="panel-section actions-section">
          <template v-if="phase === 'queue' || phase === 'watch_queue' || phase === 'architect_queue'">
            <div class="queue-status">
              <div class="queue-spinner" />
              <span v-if="phase === 'queue'">
                Searching for opponent<span class="dots" />
                <span v-if="queueCountdown > 0" class="queue-countdown">
                  Match starts in {{ queueCountdown }}s or sooner
                </span>
              </span>
              <span v-else-if="phase === 'watch_queue'">Finding a match<span class="dots" /></span>
              <span v-else>Finding a match<span class="dots" /></span>
            </div>
            <button class="btn-cancel" @click="emit('cancelSearch')">Cancel</button>
          </template>
          <template v-else>
            <div class="actions-primary">
              <button
                class="btn-play"
                :class="{ 'btn-play-hot': props.inQueue > 0 }"
                :aria-label="props.inQueue > 0 ? 'Play — instant match available' : 'Play'"
                @click="emit('play', selected)"
              >
                <span class="btn-play-text">Play</span>
                <svg class="btn-play-arrow" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
                <Transition name="queue-pip">
                  <span v-if="props.inQueue > 0" class="queue-pip" aria-hidden="true" />
                </Transition>
              </button>
              <!-- Auth: logged-in user chip -->
              <div v-if="user" class="user-chip" @click="showAuthMenu = !showAuthMenu">
                <img v-if="user.avatar" :src="user.avatar" class="user-avatar" alt="" />
                <span class="user-name">{{ user.name }}</span>
                <div v-if="showAuthMenu" class="auth-dropdown" @click.stop>
                  <button class="auth-dropdown-item" @click="handleLogout">Sign Out</button>
                </div>
              </div>
              <!-- Auth: sign-in button -->
              <div v-else class="signin-wrap">
                <button class="btn-signin" @click="showAuthMenu = !showAuthMenu">
                  Sign In
                </button>
                <div v-if="showAuthMenu" class="auth-dropdown" @click.stop>
                  <button class="auth-dropdown-item" @click="handleLogin('google')">
                    <svg viewBox="0 0 24 24" width="16" height="16"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                    Google
                  </button>
                  <button class="auth-dropdown-item" @click="handleLogin('github')">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
                    GitHub
                  </button>
                </div>
              </div>
            </div>
            <div class="actions-secondary">
              <button class="btn-role" @click="emit('watch')">
                <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor"><path d="M10 3C5 3 1.7 7.1 1 10c.7 2.9 4 7 9 7s8.3-4.1 9-7c-.7-2.9-4-7-9-7zm0 11.5a4.5 4.5 0 110-9 4.5 4.5 0 010 9zm0-7a2.5 2.5 0 100 5 2.5 2.5 0 000-5z"/></svg>
                Watch
              </button>
              <button class="btn-role btn-architect" @click="emit('architect')">
                <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor"><path d="M17.4 2.6a2 2 0 00-2.8 0L3 14.2V17h2.8L17.4 5.4a2 2 0 000-2.8zM5.1 15.5H4.5V15l9.3-9.3.6.6-9.3 9.2z"/></svg>
                Architect
              </button>
            </div>
          </template>
        </div>

        <!-- Online counter -->
        <div class="panel-divider" v-if="onlineCount > 0" />
        <div class="online-badge" v-if="onlineCount > 0">
          <div class="online-dot" />
          <span>{{ onlineCount }} online</span>
        </div>

        <!-- Leaderboard -->
        <div class="panel-divider" />
        <LeaderboardPanel />
      </div>
    </div>

    <!-- Recent Matches — top-right corner -->
    <div v-if="replays.length > 0" class="recent-corner">
      <span class="recent-label">Recent</span>
      <button
        v-for="r in replays"
        :key="r.id"
        class="replay-item"
        @click="audio?.play('ui-click'); emit('watchReplay', r.id)"
      >
        <span class="ri-chars">{{ charLabel[r.charA] || r.charA }} vs {{ charLabel[r.charB] || r.charB }}</span>
        <span class="ri-result">{{ r.winner === 'draw' ? 'Draw' : `${r.winner} won` }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.lobby {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  pointer-events: none;
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
}

/* ── Title ── */

.lobby-title-area {
  padding: 40px 48px;
  animation: titleIn 1s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.lobby-title {
  font-family: 'Comfortaa', 'Quicksand', sans-serif;
  font-size: 52px;
  font-weight: 700;
  letter-spacing: 6px;
  color: rgba(255, 255, 255, 0.95);
  text-shadow:
    0 0 50px rgba(200, 220, 255, 0.3),
    0 0 100px rgba(200, 220, 255, 0.1);
  margin: 0;
  line-height: 1;
}

.lobby-tagline {
  font-family: 'Comfortaa', 'Quicksand', sans-serif;
  margin-top: 14px;
  font-size: 13px;
  font-weight: 400;
  letter-spacing: 2px;
  color: rgba(200, 210, 225, 0.5);
  text-transform: uppercase;
}

/* ── Bottom panel ── */

.lobby-panel {
  position: relative;
  pointer-events: auto;
  animation: panelIn 0.8s 0.2s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.panel-fade {
  position: absolute;
  top: -60px;
  left: 0;
  right: 0;
  height: 60px;
  background: linear-gradient(to bottom, transparent, rgba(10, 14, 20, 0.5));
  pointer-events: none;
}

.panel-content {
  display: flex;
  align-items: center;
  gap: 32px;
  padding: 28px 48px 36px;
  background: rgba(12, 16, 24, 0.55);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel-divider {
  width: 1px;
  align-self: stretch;
  background: rgba(255, 255, 255, 0.06);
  margin: 4px 8px;
}

/* ── Character select ── */

.char-select {
  display: flex;
  gap: 10px;
}

.char-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 10px 10px;
  border-radius: 16px;
  border: 1.5px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(200, 210, 225, 0.5);
  cursor: pointer;
  transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  font-family: inherit;
  font-size: 11px;
  letter-spacing: 0.5px;
}

.char-btn:hover {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(220, 225, 235, 0.75);
  transform: translateY(-2px);
}

.char-btn.active {
  border-color: var(--accent);
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  box-shadow: 0 0 28px var(--glow), inset 0 0 20px rgba(255, 255, 255, 0.02);
  transform: translateY(-4px);
}

.char-preview-wrap {
  width: 120px;
  height: 120px;
  position: relative;
  overflow: hidden;
  border-radius: 12px;
}

.char-btn.active .char-preview-wrap {
  filter: drop-shadow(0 0 8px var(--glow));
}

.char-select-locked .char-btn {
  cursor: default;
}

.char-btn.locked {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none;
}

.char-btn.locked:hover {
  transform: none;
  border-color: rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(200, 210, 225, 0.5);
}

.char-btn.locked.active {
  opacity: 1;
  border-color: var(--accent);
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  box-shadow: 0 0 20px var(--glow), inset 0 0 20px rgba(255, 255, 255, 0.02);
}

.char-btn.locked.active:hover {
  border-color: var(--accent);
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
}

.char-name {
  font-weight: 600;
}

/* ── Actions ── */

.actions-section {
  flex: 1;
  min-width: 240px;
}

.actions-primary {
  display: flex;
  gap: 12px;
  align-items: center;
}

.btn-play {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 28px;
  border-radius: 10px;
  border: none;
  background: linear-gradient(135deg, #e94560, #c73750);
  color: white;
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.8px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 4px 20px rgba(233, 69, 96, 0.25);
}

.btn-play:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 28px rgba(233, 69, 96, 0.4);
  background: linear-gradient(135deg, #ed5a73, #d14460);
}

.btn-play-hot:hover {
  box-shadow: 0 4px 28px rgba(233, 69, 96, 0.5), 0 0 0 6px rgba(233, 69, 96, 0.08);
}

.btn-play:active {
  transform: translateY(0);
}

.btn-play-hot {
  animation: play-pulse 2.5s ease-in-out infinite;
}

.queue-pip {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #4ade80;
  box-shadow: 0 0 8px rgba(74, 222, 128, 0.6);
  border: 2px solid rgba(12, 16, 24, 0.8);
  animation: pip-breathe 2s ease-in-out infinite;
}

.queue-pip-enter-active {
  transition: opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
.queue-pip-leave-active {
  transition: opacity 0.3s;
}
.queue-pip-enter-from,
.queue-pip-leave-to {
  opacity: 0;
}

@keyframes pip-breathe {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes play-pulse {
  0%, 100% {
    box-shadow: 0 4px 20px rgba(233, 69, 96, 0.25);
  }
  50% {
    box-shadow: 0 4px 28px rgba(233, 69, 96, 0.5), 0 0 0 6px rgba(233, 69, 96, 0.08);
  }
}

@media (prefers-reduced-motion: reduce) {
  .btn-play-hot { animation: none; }
  .queue-pip { animation: none; }
}

.btn-play-arrow {
  transition: transform 0.2s;
}

.btn-play:hover .btn-play-arrow {
  transform: translateX(3px);
}

.signin-wrap {
  position: relative;
}

.btn-signin {
  padding: 12px 24px;
  border-radius: 10px;
  border: 1.5px solid rgba(255, 255, 255, 0.1);
  background: transparent;
  color: rgba(200, 210, 225, 0.6);
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.5px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-signin:hover {
  border-color: rgba(255, 255, 255, 0.2);
  color: rgba(220, 225, 235, 0.9);
}

.user-chip {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px 6px 6px;
  border-radius: 10px;
  border: 1.5px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition: all 0.2s;
}

.user-chip:hover {
  border-color: rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.07);
}

.user-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
}

.user-name {
  font-size: 13px;
  font-weight: 600;
  color: rgba(220, 225, 235, 0.85);
  letter-spacing: 0.3px;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.auth-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 160px;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(18, 22, 32, 0.95);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  z-index: 200;
}

.auth-dropdown-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 14px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(200, 210, 225, 0.75);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.auth-dropdown-item:hover {
  background: rgba(139, 180, 255, 0.1);
  color: #fff;
}

.actions-secondary {
  display: flex;
  gap: 16px;
  margin-top: 12px;
}

.btn-role {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: none;
  background: none;
  color: rgba(140, 180, 220, 0.6);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.5px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-role:hover {
  color: rgba(160, 200, 240, 0.9);
}

.btn-architect {
  color: rgba(180, 150, 230, 0.6);
}

.btn-architect:hover {
  color: rgba(200, 175, 245, 0.9);
}

/* ── Online badge ── */

.online-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  color: rgba(200, 210, 225, 0.45);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

.online-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4ade80;
  box-shadow: 0 0 8px rgba(74, 222, 128, 0.5);
  animation: pulse-dot 2s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* ── Recent Matches (top-right corner) ── */

.recent-corner {
  position: fixed;
  top: 40px;
  right: 48px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 170px;
  max-width: 220px;
  pointer-events: auto;
  animation: recentIn 0.8s 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.recent-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: rgba(200, 210, 225, 0.35);
  margin-bottom: 4px;
}

.replay-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 5px 10px;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  color: rgba(200, 210, 225, 0.55);
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}

.replay-item:hover {
  background: rgba(139, 180, 255, 0.08);
  color: rgba(200, 210, 225, 0.85);
}

.ri-chars {
  font-weight: 600;
}

.ri-result {
  font-size: 10px;
  color: rgba(139, 180, 255, 0.6);
}

/* ── Queue ── */

.queue-status {
  display: flex;
  align-items: center;
  gap: 12px;
  color: rgba(200, 210, 225, 0.55);
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.3px;
}

.queue-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(233, 69, 96, 0.2);
  border-top-color: #e94560;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.queue-countdown {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(233, 69, 96, 0.8);
  letter-spacing: 0.5px;
  font-variant-numeric: tabular-nums;
}

.btn-cancel {
  margin-top: 10px;
  padding: 6px 20px;
  border-radius: 8px;
  border: 1.5px solid rgba(255, 255, 255, 0.1);
  background: transparent;
  color: rgba(200, 210, 225, 0.5);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.5px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-cancel:hover {
  border-color: rgba(255, 255, 255, 0.2);
  color: rgba(220, 225, 235, 0.85);
  background: rgba(255, 255, 255, 0.04);
}

.dots {
  display: inline-block;
  width: 1.5em;
  text-align: left;
  overflow: hidden;
}

.dots::after {
  content: '...';
  display: inline-block;
  animation: dots-clip 1.5s steps(4, end) infinite;
}

/* ── Animations ── */

@keyframes titleIn {
  0% { opacity: 0; transform: translateY(-20px); }
  100% { opacity: 1; transform: translateY(0); }
}

@keyframes panelIn {
  0% { opacity: 0; transform: translateY(40px); }
  100% { opacity: 1; transform: translateY(0); }
}

@keyframes recentIn {
  0% { opacity: 0; transform: translateX(20px); }
  100% { opacity: 1; transform: translateX(0); }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes dots-clip {
  0% { width: 0; }
  25% { width: 0.5em; }
  50% { width: 1em; }
  75% { width: 1.5em; }
}

/* ── Mobile ── */

@media (max-width: 640px) {
  .lobby-title-area { padding: 24px 24px; }
  .lobby-title { font-size: 36px; letter-spacing: 4px; }
  .lobby-tagline { font-size: 11px; }

  .panel-content {
    flex-direction: column;
    padding: 20px 24px 28px;
    gap: 20px;
    align-items: center;
  }

  .panel-divider { display: none; }

  .char-select { gap: 8px; justify-content: center; }
  .char-btn { font-size: 10px; padding: 6px 8px 8px; }
  .char-preview-wrap { width: 80px; height: 80px; }

  .actions-section { min-width: auto; align-items: center; }
  .actions-primary { justify-content: center; }
  .actions-secondary { justify-content: center; }

  .btn-role {
    padding: 8px 12px;
    min-height: 44px;
    align-items: center;
  }

  .online-badge { justify-content: center; }

  .recent-corner { display: none; }
}
</style>
