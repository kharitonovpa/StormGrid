<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { PlayerLeaderboardEntry, WatcherLeaderboardEntry } from '@wheee/shared'
import { API_BASE } from '../lib/config'

type Tab = 'players' | 'watchers'
const activeTab = ref<Tab>('players')
const players = ref<PlayerLeaderboardEntry[]>([])
const watchers = ref<WatcherLeaderboardEntry[]>([])
const loaded = ref(false)

function isValidAvatar(url: string | null): url is string {
  if (!url) return false
  try { return new URL(url).protocol === 'https:' } catch { return false }
}

function isPlayerArray(v: unknown): v is PlayerLeaderboardEntry[] {
  return Array.isArray(v) && v.every(e => typeof e === 'object' && e !== null && 'wins' in e && 'userId' in e)
}

function isWatcherArray(v: unknown): v is WatcherLeaderboardEntry[] {
  return Array.isArray(v) && v.every(e => typeof e === 'object' && e !== null && 'watcherScore' in e && 'userId' in e)
}

async function fetchLeaderboard() {
  try {
    const [pRaw, wRaw] = await Promise.all([
      fetch(`${API_BASE}/api/leaderboard/players`).then(r => r.ok ? r.json() : []),
      fetch(`${API_BASE}/api/leaderboard/watchers`).then(r => r.ok ? r.json() : []),
    ])
    players.value = isPlayerArray(pRaw) ? pRaw : []
    watchers.value = isWatcherArray(wRaw) ? wRaw : []
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[leaderboard] fetch failed:', e)
  }
  loaded.value = true
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
      >Players</button>
      <button
        class="lb-tab"
        :class="{ active: activeTab === 'watchers' }"
        @click="activeTab = 'watchers'"
      >Watchers</button>
    </div>

    <div class="lb-list" v-if="activeTab === 'players'">
      <div v-for="(p, i) in players.slice(0, 10)" :key="p.userId" class="lb-row">
        <span class="lb-rank" :class="RANK_CLASS[i]">{{ i + 1 }}</span>
        <img v-if="isValidAvatar(p.avatar)" :src="p.avatar" class="lb-avatar" alt="" referrerpolicy="no-referrer" />
        <span v-else class="lb-avatar lb-avatar-placeholder" />
        <span class="lb-name">{{ p.name }}</span>
        <span class="lb-stat lb-wins">{{ p.wins }}W</span>
        <span class="lb-stat lb-losses">{{ p.losses }}L</span>
      </div>
      <div v-if="players.length === 0" class="lb-empty">No ranked players yet</div>
    </div>

    <div class="lb-list" v-if="activeTab === 'watchers'">
      <div v-for="(w, i) in watchers.slice(0, 10)" :key="w.userId" class="lb-row">
        <span class="lb-rank" :class="RANK_CLASS[i]">{{ i + 1 }}</span>
        <img v-if="isValidAvatar(w.avatar)" :src="w.avatar" class="lb-avatar" alt="" referrerpolicy="no-referrer" />
        <span v-else class="lb-avatar lb-avatar-placeholder" />
        <span class="lb-name">{{ w.name }}</span>
        <span class="lb-stat lb-score">{{ w.watcherScore }}pts</span>
      </div>
      <div v-if="watchers.length === 0" class="lb-empty">No watcher scores yet</div>
    </div>
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

.lb-empty {
  font-size: 10px;
  color: rgba(200, 210, 225, 0.3);
  text-align: center;
  padding: 8px;
}
</style>
