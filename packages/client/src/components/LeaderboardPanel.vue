<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { PlayerLeaderboardEntry, WatcherLeaderboardEntry, Paginated } from '@wheee/shared'
import { API_BASE } from '../lib/config'
import { t } from '../lib/i18n'
import { usePlatform } from '../lib/platform'

const platform = usePlatform()

const PAGE_SIZE = 10

type Tab = 'players' | 'watchers'
const activeTab = ref<Tab>('players')
const players = ref<PlayerLeaderboardEntry[]>([])
const playersTotal = ref(0)
const watchers = ref<WatcherLeaderboardEntry[]>([])
const watchersTotal = ref(0)
const loaded = ref(false)
const loadingMore = ref(false)

function isValidAvatar(url: string | null): url is string {
  if (!url) return false
  try { return new URL(url).protocol === 'https:' } catch { return false }
}

function isPaginated<T>(v: unknown, check: (e: unknown) => boolean): v is Paginated<T> {
  return typeof v === 'object' && v !== null && 'items' in v && 'total' in v
    && Array.isArray((v as Paginated<T>).items) && (v as Paginated<T>).items.every(check)
}

const isPlayerEntry = (e: unknown) => typeof e === 'object' && e !== null && 'wins' in e && 'userId' in e
const isWatcherEntry = (e: unknown) => typeof e === 'object' && e !== null && 'watcherScore' in e && 'userId' in e

async function fetchLeaderboard(retries = 2) {
  let failed = false
  try {
    const [pRaw, wRaw] = await Promise.all([
      fetch(`${API_BASE}/api/leaderboard/players?limit=${PAGE_SIZE}`).then(r => r.ok ? r.json() : null),
      fetch(`${API_BASE}/api/leaderboard/watchers?limit=${PAGE_SIZE}`).then(r => r.ok ? r.json() : null),
    ])
    if (isPaginated<PlayerLeaderboardEntry>(pRaw, isPlayerEntry)) {
      players.value = pRaw.items
      playersTotal.value = pRaw.total
    }
    if (isPaginated<WatcherLeaderboardEntry>(wRaw, isWatcherEntry)) {
      watchers.value = wRaw.items
      watchersTotal.value = wRaw.total
    }
    failed = pRaw === null && wRaw === null
  } catch {
    failed = true
  }
  if (failed && retries > 0) {
    setTimeout(() => fetchLeaderboard(retries - 1), 1500)
    return
  }
  loaded.value = true
}

async function loadMore(tab: Tab) {
  loadingMore.value = true
  try {
    const offset = tab === 'players' ? players.value.length : watchers.value.length
    const url = `${API_BASE}/api/leaderboard/${tab}?limit=${PAGE_SIZE}&offset=${offset}`
    const raw = await fetch(url).then(r => r.ok ? r.json() : null)
    if (tab === 'players' && isPaginated<PlayerLeaderboardEntry>(raw, isPlayerEntry)) {
      players.value = [...players.value, ...raw.items]
      playersTotal.value = raw.total
    } else if (tab === 'watchers' && isPaginated<WatcherLeaderboardEntry>(raw, isWatcherEntry)) {
      watchers.value = [...watchers.value, ...raw.items]
      watchersTotal.value = raw.total
    }
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[leaderboard] load more failed:', e)
  }
  loadingMore.value = false
}

const RANK_CLASS = ['lb-gold', 'lb-silver', 'lb-bronze'] as const

onMounted(fetchLeaderboard)
</script>

<template>
  <div class="lb" v-if="loaded">
    <div class="lb-tabs">
      <button
        class="lb-tab"
        :class="{ active: activeTab === 'players' }"
        @click="activeTab = 'players'"
      >{{ t('leaderboard.players') }}</button>
      <button
        class="lb-tab"
        :class="{ active: activeTab === 'watchers' }"
        @click="activeTab = 'watchers'"
      >{{ t('leaderboard.watchers') }}</button>
    </div>

    <div class="lb-list" v-if="activeTab === 'players'">
      <div v-for="(p, i) in players" :key="p.userId" class="lb-row">
        <span class="lb-rank" :class="RANK_CLASS[i]">{{ i + 1 }}</span>
        <img v-if="isValidAvatar(p.avatar)" :src="p.avatar" class="lb-avatar" alt="" referrerpolicy="no-referrer" />
        <span v-else class="lb-avatar lb-avatar-placeholder" />
        <span class="lb-name">{{ p.name }}</span>
        <span class="lb-stat lb-wins">{{ p.wins }}W</span>
        <span class="lb-stat lb-losses">{{ p.losses }}L</span>
      </div>
      <button
        v-if="players.length < playersTotal"
        class="lb-more"
        :disabled="loadingMore"
        @click="loadMore('players')"
      >{{ loadingMore ? '···' : t('leaderboard.more', playersTotal - players.length) }}</button>
      <div v-if="players.length === 0" class="lb-empty">{{ t('leaderboard.noPlayers') }}</div>
    </div>

    <div class="lb-list" v-if="activeTab === 'watchers'">
      <div v-for="(w, i) in watchers" :key="w.userId" class="lb-row">
        <span class="lb-rank" :class="RANK_CLASS[i]">{{ i + 1 }}</span>
        <img v-if="isValidAvatar(w.avatar)" :src="w.avatar" class="lb-avatar" alt="" referrerpolicy="no-referrer" />
        <span v-else class="lb-avatar lb-avatar-placeholder" />
        <span class="lb-name">{{ w.name }}</span>
        <span class="lb-stat lb-score">{{ w.watcherScore }}pts</span>
      </div>
      <button
        v-if="watchers.length < watchersTotal"
        class="lb-more"
        :disabled="loadingMore"
        @click="loadMore('watchers')"
      >{{ loadingMore ? '···' : t('leaderboard.more', watchersTotal - watchers.length) }}</button>
      <div v-if="watchers.length === 0" class="lb-empty">{{ t('leaderboard.noWatchers') }}</div>
    </div>

    <a
      v-if="platform.type !== 'yandex'"
      href="https://t.me/wheeeio"
      target="_blank"
      rel="noopener"
      class="lb-community"
    >
      <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
        <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/>
      </svg>
      <span>{{ t('leaderboard.chat') }}</span>
    </a>
  </div>
</template>

<style scoped>
.lb {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 180px;
  max-width: 220px;
}

.lb-tabs {
  display: flex;
  gap: 2px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  padding: 2px;
}

.lb-tab {
  flex: 1;
  padding: 5px 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(200, 210, 225, 0.4);
  font-family: inherit;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.15s;
}

.lb-tab:hover {
  color: rgba(200, 210, 225, 0.65);
}

.lb-tab.active {
  background: rgba(139, 180, 255, 0.1);
  color: rgba(200, 210, 225, 0.85);
}

.lb-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 148px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.08) transparent;
}

.lb-list::-webkit-scrollbar {
  width: 3px;
}

.lb-list::-webkit-scrollbar-track {
  background: transparent;
}

.lb-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}

.lb-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 6px;
  transition: background 0.1s;
}

.lb-row:hover {
  background: rgba(139, 180, 255, 0.06);
}

.lb-rank {
  width: 16px;
  font-size: 10px;
  font-weight: 700;
  color: rgba(200, 210, 225, 0.3);
  text-align: right;
  flex-shrink: 0;
}

.lb-gold { color: #ffd700; }
.lb-silver { color: #c0c0c0; }
.lb-bronze { color: #cd7f32; }

.lb-avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  flex-shrink: 0;
}

.lb-avatar-placeholder {
  display: block;
  background: rgba(255, 255, 255, 0.08);
}

.lb-name {
  flex: 1;
  font-size: 11px;
  font-weight: 600;
  color: rgba(200, 210, 225, 0.7);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lb-stat {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.3px;
  flex-shrink: 0;
}

.lb-wins {
  color: rgba(74, 222, 128, 0.7);
}

.lb-losses {
  color: rgba(248, 113, 113, 0.6);
}

.lb-score {
  color: rgba(139, 180, 255, 0.7);
}

.lb-more {
  border: none;
  background: none;
  color: rgba(139, 180, 255, 0.5);
  font-family: inherit;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.3px;
  padding: 4px 8px;
  cursor: pointer;
  transition: color 0.15s;
  text-align: center;
}

.lb-more:hover {
  color: rgba(139, 180, 255, 0.8);
}

.lb-more:disabled {
  cursor: default;
  opacity: 0.5;
}

.lb-empty {
  font-size: 10px;
  color: rgba(200, 210, 225, 0.3);
  text-align: center;
  padding: 8px;
}

.lb-community {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 6px;
  padding: 6px 0;
  border-radius: 6px;
  border: none;
  background: rgba(255, 255, 255, 0.03);
  color: rgba(200, 210, 225, 0.35);
  font-family: inherit;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.15s;
}

.lb-community:hover {
  background: rgba(139, 180, 255, 0.08);
  color: rgba(200, 210, 225, 0.7);
}
</style>
