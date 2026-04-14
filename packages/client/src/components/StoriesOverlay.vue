<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import type { WindDir } from '@wheee/shared'
import ForecastPanel from './ForecastPanel.vue'
import { t } from '../lib/i18n'

const emit = defineEmits<{ done: []; skip: [] }>()

const SLIDE_DURATION = 4000

const slides = computed(() => [
  { text: t('stories.slide1'), id: 'storm' as const },
  { text: t('stories.slide2'), id: 'actions' as const },
  { text: t('stories.slide3'), id: 'wind' as const },
  { text: t('stories.slide4'), id: 'rain' as const },
  { text: t('stories.slide5'), id: 'forecast' as const },
])

const current = ref(0)
const progress = ref(0)
const leaving = ref(false)

let autoTimer = 0
let progressTimer = 0

function startAutoAdvance() {
  clearTimers()
  progress.value = 0
  const startTime = Date.now()
  progressTimer = window.setInterval(() => {
    progress.value = Math.min(1, (Date.now() - startTime) / SLIDE_DURATION)
  }, 30)
  autoTimer = window.setTimeout(advance, SLIDE_DURATION)
}

function clearTimers() {
  if (autoTimer) { clearTimeout(autoTimer); autoTimer = 0 }
  if (progressTimer) { clearInterval(progressTimer); progressTimer = 0 }
}

function advance() {
  if (current.value < slides.value.length - 1) {
    current.value++
    startAutoAdvance()
  } else {
    finish()
  }
}

let leaveTimer = 0

function finish(skipped = false) {
  if (leaving.value) return
  clearTimers()
  clearInterval(forecastTimer)
  leaving.value = true
  leaveTimer = window.setTimeout(() => {
    if (skipped) emit('skip')
    else emit('done')
  }, 350)
}

const formattedText = computed(() =>
  slides.value[current.value].text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>'),
)

const currentId = computed(() => slides.value[current.value].id)

/* ── Card 1: Isometric grid ── */

const HW = 17, HH = 8.5, SIDE_H = 12, ISO_BX = 120, ISO_BY = 36

function isoCell(gx: number, gz: number) {
  const cx = ISO_BX + (gx - gz) * HW
  const cy = ISO_BY + (gx + gz) * HH
  return {
    top: `${cx},${cy - HH} ${cx + HW},${cy} ${cx},${cy + HH} ${cx - HW},${cy}`,
    right: `${cx + HW},${cy} ${cx},${cy + HH} ${cx},${cy + HH + SIDE_H} ${cx + HW},${cy + SIDE_H}`,
    left: `${cx - HW},${cy} ${cx},${cy + HH} ${cx},${cy + HH + SIDE_H} ${cx - HW},${cy + SIDE_H}`,
    cx, cy,
  }
}

const stormCells = [
  isoCell(0, 0),
  isoCell(1, 0), isoCell(0, 1),
  isoCell(2, 0), isoCell(1, 1), isoCell(0, 2),
  isoCell(2, 1), isoCell(1, 2),
  isoCell(2, 2),
]
const playerCell = isoCell(1, 1)

/* ── Card 2: Actions iso cells ── */

const AHW = 13, AHH = 6.5, ASIDE = 9

function actIso(gx: number, gz: number, bx: number, by: number) {
  const cx = bx + (gx - gz) * AHW
  const cy = by + (gx + gz) * AHH
  return {
    top: `${cx},${cy - AHH} ${cx + AHW},${cy} ${cx},${cy + AHH} ${cx - AHW},${cy}`,
    right: `${cx + AHW},${cy} ${cx},${cy + AHH} ${cx},${cy + AHH + ASIDE} ${cx + AHW},${cy + ASIDE}`,
    left: `${cx - AHW},${cy} ${cx},${cy + AHH} ${cx},${cy + AHH + ASIDE} ${cx - AHW},${cy + ASIDE}`,
    cx, cy,
  }
}

const moveCells = [actIso(0, 0, 44, 24), actIso(0, 1, 44, 24), actIso(1, 0, 44, 24)]
const moveFrom = moveCells[0]
const moveTo = moveCells[2]
const raiseCells = [actIso(0, 0, 130, 26), actIso(1, 0, 130, 26)]
const lowerCells = [actIso(0, 0, 216, 26), actIso(1, 0, 216, 26)]

/* ── Card 5: Forecast cycling ── */

const forecastWind = ref<WindDir[]>(['N'])
const forecastRain = ref(0)
let forecastTimer = 0
let forecastStep = 0
const FC: { w: WindDir[]; r: number }[] = [
  { w: ['N'], r: 0 },
  { w: ['N', 'E'], r: 0.4 },
  { w: ['E'], r: 0.85 },
]

watch(currentId, (id) => {
  clearInterval(forecastTimer)
  if (id === 'forecast') {
    forecastStep = 0
    forecastWind.value = FC[0].w
    forecastRain.value = FC[0].r
    forecastTimer = window.setInterval(() => {
      forecastStep = (forecastStep + 1) % FC.length
      forecastWind.value = FC[forecastStep].w
      forecastRain.value = FC[forecastStep].r
    }, 1400)
  }
})

onMounted(startAutoAdvance)
onUnmounted(() => { clearTimers(); clearInterval(forecastTimer); clearTimeout(leaveTimer) })
</script>

<template>
  <div class="stories-overlay" :class="{ leaving }" @click="advance">
    <!-- Shared SVG defs (document-global IDs) -->
    <svg class="shared-defs" aria-hidden="true">
      <defs>
        <linearGradient id="so-grass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#3a8a28" /><stop offset="100%" stop-color="#2d7018" />
        </linearGradient>
        <linearGradient id="so-earth" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#634d27" /><stop offset="100%" stop-color="#4a3a1a" />
        </linearGradient>
        <linearGradient id="so-earth-r" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#634d27" /><stop offset="100%" stop-color="#4a3a1a" />
        </linearGradient>
        <linearGradient id="so-earth-l" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#564422" /><stop offset="100%" stop-color="#3d2f15" />
        </linearGradient>
      </defs>
      <!-- Character (centered at 0,0; original 64x64 shifted by -32,-32) -->
      <g id="so-char">
        <path d="M0-32C20-32 32-16 32 2C32 20 18 32 0 32C-18 32-32 20-32 2C-32-16-20-32 0-32Z" fill="#F4F1EA"/>
        <circle cx="-12" cy="-10" r="2" fill="#E8E3D8"/>
        <circle cx="12" cy="-8" r="2" fill="#E8E3D8"/>
        <circle cx="-2" cy="14" r="2" fill="#E8E3D8"/>
        <ellipse cx="-8" cy="0" rx="6" ry="7" fill="#2B1B12"/>
        <ellipse cx="8" cy="0" rx="6" ry="7" fill="#2B1B12"/>
        <circle cx="-6" cy="-3" r="2" fill="#FFFFFF"/>
        <circle cx="10" cy="-3" r="2" fill="#FFFFFF"/>
        <ellipse cx="-14" cy="8" rx="4" ry="3" fill="#FFB3A7"/>
        <ellipse cx="14" cy="8" rx="4" ry="3" fill="#FFB3A7"/>
        <path d="M-4 8Q0 14 4 8Q0 16-4 8" fill="#FF8A5C"/>
        <path d="M-4 8Q0 14 4 8" stroke="#7A2E1C" stroke-width="1.5" stroke-linecap="round"/>
      </g>
    </svg>

    <!-- Progress bars -->
    <div class="progress-row">
      <div v-for="(_, i) in slides" :key="i" class="progress-bar">
        <div class="progress-fill" :style="{ transform: `scaleX(${i < current ? 1 : i === current ? progress : 0})` }" />
      </div>
    </div>

    <button class="skip-btn" @click.stop="finish(true)">{{ t('stories.skip') }}</button>

    <Transition name="slide" mode="out-in">
      <div class="slide-content" :key="current">

        <!-- ═══════ Card 1: Storm ═══════ -->
        <div v-if="currentId === 'storm'" class="scene scene-storm">
          <!-- HUD strip mockup (matches real GameHud) -->
          <div class="storm-hud">
            <div class="storm-timer-wrap">
              <svg viewBox="0 0 48 48" class="storm-ring-svg">
                <circle cx="24" cy="24" r="22" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="2.5" />
                <circle cx="24" cy="24" r="22" fill="none" stroke="#e8c547" stroke-width="2.5"
                  stroke-linecap="round" stroke-dasharray="138.23" class="storm-arc" />
              </svg>
              <span class="storm-num">5</span>
            </div>
            <div class="storm-tick-col">
              <div class="storm-dots">
                <div v-for="i in 5" :key="i" class="storm-dot"
                  :style="{ animationDelay: `${(i - 1) * 0.45}s` }" />
              </div>
              <span class="storm-round-lbl">{{ t('stories.round1') }}</span>
            </div>
          </div>

          <!-- Isometric terrain -->
          <svg viewBox="0 0 240 100" class="storm-terrain">
            <g v-for="(c, i) in stormCells" :key="i">
              <polygon :points="c.left" fill="url(#so-earth-l)" />
              <polygon :points="c.right" fill="url(#so-earth-r)" />
              <polygon :points="c.top" fill="url(#so-grass)" stroke="rgba(58,138,40,0.25)" stroke-width="0.5" />
            </g>
            <!-- Player character -->
            <g :transform="`translate(${playerCell.cx}, ${playerCell.cy - 12}) scale(0.22)`">
              <g class="char-bob"><use href="#so-char" /></g>
            </g>
          </svg>

          <!-- Cataclysm banner -->
          <div class="storm-cata">
            <svg viewBox="0 0 32 32" width="16" height="16">
              <polygon points="18,2 10,16 15,16 8,30 24,13 17,13 22,2" fill="currentColor" />
            </svg>
            <span>{{ t('stories.cataclysm') }}</span>
            <svg viewBox="0 0 32 32" width="16" height="16" style="transform: scaleX(-1)">
              <polygon points="18,2 10,16 15,16 8,30 24,13 17,13 22,2" fill="currentColor" />
            </svg>
          </div>
        </div>

        <!-- ═══════ Card 2: Actions ═══════ -->
        <div v-if="currentId === 'actions'" class="scene">
          <svg viewBox="0 0 260 80" class="scene-svg scene-wide">
            <!-- ── Move: L-shaped cluster ── -->
            <g>
              <!-- Back cell (0,0) -->
              <polygon :points="moveCells[0].left" fill="url(#so-earth-l)" />
              <polygon :points="moveCells[0].right" fill="url(#so-earth-r)" />
              <polygon :points="moveCells[0].top" fill="url(#so-grass)" stroke="rgba(58,138,40,0.25)" stroke-width="0.5" />
              <!-- Front-left cell (0,1) -->
              <polygon :points="moveCells[1].left" fill="url(#so-earth-l)" />
              <polygon :points="moveCells[1].right" fill="url(#so-earth-r)" />
              <polygon :points="moveCells[1].top" fill="url(#so-grass)" stroke="rgba(58,138,40,0.25)" stroke-width="0.5" />
              <!-- Move highlight on (0,1) -->
              <polygon :points="moveCells[1].top" fill="rgba(99,102,241,0.25)" class="move-hl" />
              <!-- Front-right cell (1,0) -->
              <polygon :points="moveCells[2].left" fill="url(#so-earth-l)" />
              <polygon :points="moveCells[2].right" fill="url(#so-earth-r)" />
              <polygon :points="moveCells[2].top" fill="url(#so-grass)" stroke="rgba(58,138,40,0.25)" stroke-width="0.5" />
              <!-- Move highlight on (1,0) -->
              <polygon :points="moveCells[2].top" fill="rgba(99,102,241,0.25)" class="move-hl" />
              <!-- Character sliding from (0,0) → (1,0) -->
              <g class="act-move-char"><use href="#so-char" /></g>
              <text :x="moveFrom.cx" y="72" class="act-label" fill="rgba(99,102,241,0.7)">{{ t('stories.move') }}</text>
            </g>

            <!-- ── Raise: 2 iso cells ── -->
            <g>
              <polygon :points="raiseCells[0].left" fill="url(#so-earth-l)" />
              <polygon :points="raiseCells[0].right" fill="url(#so-earth-r)" />
              <polygon :points="raiseCells[0].top" fill="url(#so-grass)" stroke="rgba(58,138,40,0.25)" stroke-width="0.5" />
              <!-- Rising cell (1,0) -->
              <g class="act-raise-cell">
                <polygon :points="raiseCells[1].left" fill="url(#so-earth-l)" />
                <polygon :points="raiseCells[1].right" fill="url(#so-earth-r)" />
                <polygon :points="raiseCells[1].top" fill="url(#so-grass)" stroke="rgba(228,197,71,0.35)" stroke-width="0.5" />
              </g>
              <text :x="raiseCells[0].cx + AHW / 2" y="72" class="act-label" fill="rgba(228,197,71,0.7)">{{ t('stories.raise') }}</text>
            </g>

            <!-- ── Lower: 2 iso cells ── -->
            <g>
              <!-- Base cell (0,0) -->
              <polygon :points="lowerCells[0].left" fill="url(#so-earth-l)" />
              <polygon :points="lowerCells[0].right" fill="url(#so-earth-r)" />
              <polygon :points="lowerCells[0].top" fill="url(#so-grass)" stroke="rgba(58,138,40,0.25)" stroke-width="0.5" />
              <!-- Sinking cell (1,0) -->
              <g class="act-lower-cell">
                <polygon :points="lowerCells[1].left" fill="url(#so-earth-l)" />
                <polygon :points="lowerCells[1].right" fill="url(#so-earth-r)" />
                <polygon :points="lowerCells[1].top" fill="url(#so-grass)" stroke="rgba(200,210,225,0.25)" stroke-width="0.5" />
              </g>
              <text :x="lowerCells[0].cx + AHW / 2" y="72" class="act-label" fill="rgba(200,210,225,0.5)">{{ t('stories.lower') }}</text>
            </g>
          </svg>
        </div>

        <!-- ═══════ Card 3: Wind ═══════ -->
        <div v-if="currentId === 'wind'" class="scene">
          <svg viewBox="0 0 240 130" class="scene-svg scene-wide">
            <!-- Terrain strip -->
            <rect x="10" y="86" width="186" height="28" rx="4" fill="url(#so-earth)" />
            <rect x="10" y="86" width="186" height="7" rx="4" ry="3" fill="url(#so-grass)" />
            <!-- Cliff edge -->
            <rect x="196" y="86" width="3" height="28" rx="1" fill="#3d2f15" />

            <!-- Wind streaks + dust (game-style cyan) -->
            <g class="wind-streaks">
              <g opacity="0.55">
                <path d="M5,48 L75,48" stroke="#7EC8E3" stroke-width="2" stroke-linecap="round" />
                <path d="M68,43 L78,48 L68,53" fill="#7EC8E3" stroke="none" />
              </g>
              <g opacity="0.45">
                <path d="M-5,62 L85,62" stroke="#7EC8E3" stroke-width="2" stroke-linecap="round" />
                <path d="M78,57 L88,62 L78,67" fill="#7EC8E3" stroke="none" />
              </g>
              <g opacity="0.32">
                <path d="M10,76 L65,76" stroke="#7EC8E3" stroke-width="1.5" stroke-linecap="round" />
                <path d="M58,72 L66,76 L58,80" fill="#7EC8E3" stroke="none" />
              </g>
            </g>
            <!-- Dust particles -->
            <g class="wind-dust">
              <circle cx="30" cy="46" r="1" fill="#A0D8EF" opacity="0.5" />
              <circle cx="55" cy="54" r="1.2" fill="#A0D8EF" opacity="0.4" />
              <circle cx="18" cy="60" r="0.8" fill="#A0D8EF" opacity="0.45" />
              <circle cx="68" cy="66" r="1" fill="#A0D8EF" opacity="0.35" />
              <circle cx="40" cy="72" r="1.3" fill="#A0D8EF" opacity="0.4" />
              <circle cx="12" cy="78" r="0.9" fill="#A0D8EF" opacity="0.3" />
              <circle cx="78" cy="50" r="0.7" fill="#A0D8EF" opacity="0.5" />
              <circle cx="48" cy="80" r="1.1" fill="#A0D8EF" opacity="0.25" />
              <circle cx="85" cy="58" r="0.8" fill="#A0D8EF" opacity="0.35" />
              <circle cx="25" cy="68" r="1" fill="#A0D8EF" opacity="0.3" />
              <circle cx="62" cy="44" r="0.9" fill="#A0D8EF" opacity="0.4" />
              <circle cx="90" cy="74" r="1.2" fill="#A0D8EF" opacity="0.2" />
            </g>

            <!-- Act 1: character blown off edge -->
            <g class="wind-char-bad"><use href="#so-char" /></g>

            <!-- Act 2: wall (raised cell) -->
            <g class="wind-wall">
              <rect x="92" y="60" width="30" height="26" rx="3" fill="url(#so-earth)" />
              <rect x="92" y="60" width="30" height="6" rx="3" ry="2" fill="url(#so-grass)" />
            </g>
            <!-- Act 2: character safe -->
            <g class="wind-char-good"><use href="#so-char" /></g>

            <!-- Icons on top -->
            <g class="wind-death-flash" opacity="0">
              <circle cx="218" cy="68" r="13" fill="#1a1520" stroke="#F25B6A" stroke-width="1.5" />
              <path d="M212,62 L224,74 M224,62 L212,74" stroke="#F25B6A" stroke-width="2.5" stroke-linecap="round" />
            </g>
            <g class="wind-safe-flash" opacity="0">
              <circle cx="150" cy="60" r="13" fill="#1a1520" stroke="#44D68C" stroke-width="1.5" />
              <path d="M143,60 L148,65 L158,55" fill="none" stroke="#44D68C" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
            </g>
          </svg>
        </div>

        <!-- ═══════ Card 4: Rain ═══════ -->
        <div v-if="currentId === 'rain'" class="scene">
          <svg viewBox="0 0 240 126" class="scene-svg scene-wide">
            <!-- Full terrain cross-section -->
            <path d="M10,58 L66,58 L66,86 L174,86 L174,58 L230,58 L230,98 L174,98 L174,110 L66,110 L66,98 L10,98 Z"
              fill="url(#so-earth)" />
            <!-- Grass layers -->
            <rect x="10" y="58" width="56" height="6" rx="3" fill="url(#so-grass)" />
            <rect x="66" y="86" width="108" height="5" rx="2" fill="url(#so-grass)" />
            <rect x="174" y="58" width="56" height="6" rx="3" fill="url(#so-grass)" />

            <!-- Rain drops -->
            <g class="rain-drops">
              <line x1="88" y1="8" x2="86" y2="20" stroke="rgba(74,144,224,0.5)" stroke-width="1.5" stroke-linecap="round" />
              <line x1="108" y1="3" x2="106" y2="15" stroke="rgba(74,144,224,0.45)" stroke-width="1.5" stroke-linecap="round" />
              <line x1="128" y1="10" x2="126" y2="22" stroke="rgba(74,144,224,0.5)" stroke-width="1.5" stroke-linecap="round" />
              <line x1="148" y1="5" x2="146" y2="17" stroke="rgba(74,144,224,0.4)" stroke-width="1.5" stroke-linecap="round" />
              <line x1="98" y1="20" x2="96" y2="32" stroke="rgba(74,144,224,0.38)" stroke-width="1.5" stroke-linecap="round" />
              <line x1="138" y1="16" x2="136" y2="28" stroke="rgba(74,144,224,0.35)" stroke-width="1.5" stroke-linecap="round" />
            </g>

            <!-- Water rising in pit (from grass level up to high ground) -->
            <rect x="67" y="58" width="106" height="28" class="rain-water" fill="rgba(74,144,224,0.35)" rx="1" />

            <!-- Character in pit (drowns) -->
            <g class="rain-char-bad"><use href="#so-char" /></g>

            <!-- Character on high ground (safe) -->
            <g class="rain-char-good" transform="translate(38, 46) scale(0.22)">
              <use href="#so-char" />
            </g>

            <!-- Icons on top -->
            <g class="rain-death-flash" opacity="0">
              <circle cx="120" cy="64" r="13" fill="#1a1520" stroke="#F25B6A" stroke-width="1.5" />
              <path d="M114,58 L126,70 M126,58 L114,70" stroke="#F25B6A" stroke-width="2.5" stroke-linecap="round" />
            </g>
            <g class="rain-safe-flash" opacity="0">
              <circle cx="38" cy="38" r="13" fill="#1a1520" stroke="#44D68C" stroke-width="1.5" />
              <path d="M31,38 L36,43 L46,33" fill="none" stroke="#44D68C" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
            </g>
          </svg>
        </div>

        <!-- ═══════ Card 5: Forecast ═══════ -->
        <div v-if="currentId === 'forecast'" class="scene scene-forecast">
          <div class="forecast-wrap">
            <ForecastPanel
              :wind-candidates="forecastWind"
              :rain-probability="forecastRain"
              :vane-broken="false"
              :barometer-broken="false"
            />
          </div>
          <div class="forecast-labels">
            <span>{{ t('stories.windRain') }}</span>
          </div>
        </div>

        <p class="slide-text" v-html="formattedText" />
      </div>
    </Transition>

    <div class="tap-hint">{{ t('stories.tapToContinue') }}</div>
  </div>
</template>

<style scoped>
.stories-overlay {
  position: fixed;
  inset: 0;
  z-index: 250;
  background: rgba(10, 14, 20, 0.88);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  animation: stories-in 0.4s ease both;
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
}
.stories-overlay.leaving { animation: stories-out 0.35s ease both; }
@keyframes stories-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes stories-out { from { opacity: 1 } to { opacity: 0 } }

.shared-defs { position: absolute; width: 0; height: 0; overflow: hidden; pointer-events: none; }

/* ── Progress ── */

.progress-row { position: absolute; top: 16px; left: 16px; right: 16px; display: flex; gap: 6px; }
.progress-bar { flex: 1; height: 3px; border-radius: 2px; background: rgba(255,255,255,0.12); overflow: hidden; }
.progress-fill { height: 100%; background: rgba(228,197,71,0.8); transform-origin: left; transition: transform 30ms linear; border-radius: 2px; }

/* ── Skip ── */

.skip-btn {
  position: absolute; top: 32px; right: 20px;
  padding: 10px 24px; border: 1px solid rgba(255,255,255,0.15); border-radius: 24px;
  background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.5);
  font-family: inherit; font-size: 15px; font-weight: 600; letter-spacing: 0.5px;
  cursor: pointer; pointer-events: auto; transition: all 0.2s ease;
}
.skip-btn:hover { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.7); }

/* ── Slide content ── */

.slide-content { display: flex; flex-direction: column; align-items: center; gap: 24px; padding: 0 24px; width: 100%; max-width: 480px; box-sizing: border-box; }

.scene { display: flex; justify-content: center; width: 100%; }
.scene-svg { width: 100%; max-width: 360px; height: auto; }
.scene-wide { max-width: 380px; }

.slide-text {
  font-size: 18px; font-weight: 500; color: rgba(255,255,255,0.9);
  text-align: center; line-height: 1.6; letter-spacing: 0.3px; margin: 0;
}
.slide-text :deep(strong) { color: #e8c547; font-weight: 700; }

.tap-hint {
  position: absolute; bottom: 40px; font-size: 12px;
  color: rgba(255,255,255,0.2); letter-spacing: 0.5px;
  animation: tap-pulse 2s ease-in-out infinite;
}
@keyframes tap-pulse { 0%,100% { opacity: 0.2 } 50% { opacity: 0.45 } }

/* ── Slide transitions ── */

.slide-enter-active { transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1); }
.slide-leave-active { transition: all 0.2s ease; }
.slide-enter-from { opacity: 0; transform: translateX(30px); }
.slide-leave-to { opacity: 0; transform: translateX(-30px); }

/* ── Labels ── */

.act-label {
  font-size: 10px; text-anchor: middle;
  font-family: 'JetBrains Mono', monospace; font-weight: 600; letter-spacing: 0.5px;
}

/* ── Shared: character bob ── */

.char-bob {
  animation: char-bob 2s ease-in-out infinite;
}
@keyframes char-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2px); }
}

/* ═══════════════════════════════════════════
   Card 1: Storm — HUD + isometric terrain
   ═══════════════════════════════════════════ */

.scene-storm {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.storm-hud {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 18px 8px 10px;
  border-radius: 14px;
  background: rgba(12, 16, 24, 0.5);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
}

.storm-timer-wrap {
  position: relative;
  width: 42px;
  height: 42px;
  flex-shrink: 0;
}

.storm-ring-svg { width: 42px; height: 42px; }

.storm-arc {
  transform: rotate(-90deg);
  transform-origin: 24px 24px;
  animation: storm-drain 2.8s linear both;
}
@keyframes storm-drain {
  from { stroke-dashoffset: 0; }
  to { stroke-dashoffset: 138.23; }
}

.storm-num {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.85);
}

.storm-tick-col { display: flex; flex-direction: column; gap: 5px; }

.storm-dots { display: flex; gap: 5px; }

.storm-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  border: 1.5px solid rgba(255, 255, 255, 0.12);
  box-sizing: border-box;
  animation: storm-dot-on 0.35s ease both;
}
@keyframes storm-dot-on {
  from {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.12);
    box-shadow: none;
  }
  to {
    background: rgba(228, 197, 71, 0.6);
    border-color: rgba(228, 197, 71, 0.8);
    box-shadow: 0 0 6px rgba(228, 197, 71, 0.3);
  }
}

.storm-round-lbl {
  font-size: 10px;
  font-weight: 600;
  color: rgba(200, 210, 225, 0.35);
  letter-spacing: 0.5px;
}

.storm-terrain { width: 100%; max-width: 340px; height: auto; }

.storm-cata {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 22px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(233, 69, 96, 0.2), rgba(200, 60, 80, 0.08));
  border: 1px solid rgba(233, 69, 96, 0.2);
  color: rgba(233, 69, 96, 0.8);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 2px;
  text-transform: uppercase;
  opacity: 0;
  animation: cata-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) 3s both;
}
@keyframes cata-in {
  from { opacity: 0; transform: scale(0.8); }
  to { opacity: 1; transform: scale(1); }
}

/* ═══════════════════════════════════════════
   Card 2: Actions — move / raise / lower
   ═══════════════════════════════════════════ */

.move-hl {
  animation: hl-pulse 3s ease-in-out infinite;
}
@keyframes hl-pulse {
  0%, 8% { opacity: 0; }
  15%, 35% { opacity: 1; }
  50%, 100% { opacity: 0; }
}

.act-move-char {
  animation: act-slide 3s ease-in-out infinite;
}
@keyframes act-slide {
  0%, 10% { transform: translate(44px, 14px) scale(0.2); }
  40%, 60% { transform: translate(57px, 21px) scale(0.2); }
  90%, 100% { transform: translate(44px, 14px) scale(0.2); }
}

.act-raise-cell {
  animation: act-rise 3s ease-in-out infinite;
}
@keyframes act-rise {
  0%, 10% { transform: translateY(0); }
  40%, 60% { transform: translateY(-12px); }
  90%, 100% { transform: translateY(0); }
}

.act-lower-cell {
  animation: act-sink 3s ease-in-out infinite;
}
@keyframes act-sink {
  0%, 10% { transform: translateY(0); }
  40%, 60% { transform: translateY(10px); }
  90%, 100% { transform: translateY(0); }
}

/* ═══════════════════════════════════════════
   Card 3: Wind — blown off / wall saves
   ═══════════════════════════════════════════ */

.wind-streaks {
  animation: wind-push 4s ease-in-out infinite;
}
@keyframes wind-push {
  0%, 100% { transform: translateX(0); opacity: 0.7; }
  25% { transform: translateX(80px); opacity: 1; }
  50% { transform: translateX(0); opacity: 0.7; }
  75% { transform: translateX(20px); opacity: 0.8; }
}

.wind-dust {
  animation: dust-drift 3s linear infinite;
}
@keyframes dust-drift {
  0% { transform: translateX(0); opacity: 0.7; }
  100% { transform: translateX(100px); opacity: 0; }
}

.wind-char-bad {
  animation: wind-blown 4s ease-in-out infinite;
}
@keyframes wind-blown {
  0%, 5% { transform: translate(130px, 74px) scale(0.22); opacity: 1; }
  20% { transform: translate(215px, 74px) scale(0.22); opacity: 1; }
  25% { transform: translate(230px, 74px) scale(0.22); opacity: 0; }
  50%, 100% { transform: translate(130px, 74px) scale(0.22); opacity: 0; }
}

.wind-death-flash {
  animation: w-death-fl 4s ease-in-out infinite;
}
@keyframes w-death-fl {
  0%, 22% { opacity: 0; }
  25% { opacity: 0.5; }
  35% { opacity: 0; }
  100% { opacity: 0; }
}

.wind-wall {
  animation: wall-in 4s ease-in-out infinite;
}
@keyframes wall-in {
  0%, 45% { opacity: 0; transform: translateY(10px); }
  55% { opacity: 1; transform: translateY(0); }
  90% { opacity: 1; }
  100% { opacity: 0; }
}

.wind-char-good {
  animation: w-char-safe 4s ease-in-out infinite;
}
@keyframes w-char-safe {
  0%, 50% { opacity: 0; transform: translate(145px, 74px) scale(0.22); }
  55% { opacity: 1; transform: translate(145px, 74px) scale(0.22); }
  75% { opacity: 1; transform: translate(145px, 74px) scale(0.22); }
  80% { transform: translate(151px, 74px) scale(0.22); opacity: 1; }
  85%, 90% { transform: translate(145px, 74px) scale(0.22); opacity: 1; }
  100% { opacity: 0; transform: translate(145px, 74px) scale(0.22); }
}

.wind-safe-flash {
  animation: w-safe-fl 4s ease-in-out infinite;
}
@keyframes w-safe-fl {
  0%, 83% { opacity: 0; }
  87% { opacity: 0.4; }
  95%, 100% { opacity: 0; }
}

/* ═══════════════════════════════════════════
   Card 4: Rain — flood pit / safe on high
   ═══════════════════════════════════════════ */

.rain-drops {
  animation: r-drops 4s linear infinite;
}
@keyframes r-drops {
  0% { transform: translateY(0); opacity: 0.6; }
  50% { transform: translateY(38px); opacity: 0.3; }
  51% { transform: translateY(0); opacity: 0; }
  60% { opacity: 0.6; }
  100% { transform: translateY(38px); opacity: 0.3; }
}

.rain-water {
  transform-origin: 120px 86px;
  animation: r-water 4s ease-in-out infinite;
}
@keyframes r-water {
  0%, 15% { transform: scaleY(0); }
  45%, 60% { transform: scaleY(1); }
  85%, 100% { transform: scaleY(0); }
}

.rain-char-bad {
  animation: r-drown 4s ease-in-out infinite;
}
@keyframes r-drown {
  0%, 10% { opacity: 1; transform: translate(120px, 74px) scale(0.22); }
  35% { opacity: 1; transform: translate(120px, 74px) scale(0.22); }
  45% { opacity: 0; transform: translate(120px, 80px) scale(0.22); }
  90%, 100% { opacity: 0; transform: translate(120px, 74px) scale(0.22); }
}

.rain-death-flash {
  animation: r-death-fl 4s ease-in-out infinite;
}
@keyframes r-death-fl {
  0%, 43% { opacity: 0; }
  47% { opacity: 0.4; }
  55%, 100% { opacity: 0; }
}

.rain-char-good {
  animation: r-safe 4s ease-in-out infinite;
}
@keyframes r-safe {
  0%, 50% { opacity: 0; }
  55%, 88% { opacity: 0.9; }
  100% { opacity: 0; }
}

.rain-safe-flash {
  animation: r-safe-fl 4s ease-in-out infinite;
}
@keyframes r-safe-fl {
  0%, 78% { opacity: 0; }
  82% { opacity: 0.4; }
  90%, 100% { opacity: 0; }
}

/* ═══════════════════════════════════════════
   Card 5: Forecast — real ForecastPanel
   ═══════════════════════════════════════════ */

.scene-forecast {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.forecast-wrap {
  position: relative;
  display: flex;
  justify-content: center;
}

.forecast-wrap :deep(.forecast-panel) {
  position: static;
  top: auto;
  right: auto;
  z-index: auto;
  pointer-events: none;
  animation: none;
}

.forecast-labels {
  text-align: center;
}
.forecast-labels span {
  font-size: 11px;
  font-weight: 600;
  color: rgba(200, 210, 225, 0.35);
  letter-spacing: 0.8px;
  text-transform: uppercase;
}

/* ── Mobile ── */

@media (max-width: 640px) {
  .progress-row { top: 12px; left: 12px; right: 12px; gap: 4px; }
  .progress-bar { height: 2.5px; }
  .skip-btn { top: 26px; right: 14px; font-size: 14px; padding: 8px 20px; }
  .slide-content { gap: 18px; padding: 0 16px; }
  .storm-terrain { width: 100%; max-width: 300px; }
  .storm-hud { gap: 10px; padding: 7px 14px 7px 8px; }
  .storm-timer-wrap, .storm-ring-svg { width: 36px; height: 36px; }
  .storm-num { font-size: 12px; }
  .storm-dot { width: 6px; height: 6px; }
  .storm-cata { font-size: 11px; padding: 6px 16px; letter-spacing: 1.5px; }
  .slide-text { font-size: 16px; }
  .tap-hint { bottom: 28px; font-size: 11px; }
  .forecast-wrap :deep(.compass-svg) { width: 120px; height: 120px; }
}
</style>
