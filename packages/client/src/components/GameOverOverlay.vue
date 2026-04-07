<script setup lang="ts">
defineProps<{
  winner: string | null
  myPlayerId: string | null
}>()

const emit = defineEmits<{
  playAgain: []
}>()
</script>

<template>
  <div class="gameover-overlay">
    <div class="gameover-card">
      <h1 v-if="winner === 'draw'" class="result draw">Draw</h1>
      <h1 v-else-if="!myPlayerId" class="result spectator">Player {{ winner }} wins</h1>
      <h1 v-else-if="winner === myPlayerId" class="result win">Victory!</h1>
      <h1 v-else class="result lose">Defeat</h1>

      <p class="result-sub">
        <template v-if="winner === 'draw'">Both players perished</template>
        <template v-else-if="!myPlayerId">The match has concluded</template>
        <template v-else-if="winner === myPlayerId">Your opponent was destroyed</template>
        <template v-else>You have been destroyed</template>
      </p>

      <button class="play-again-btn" @click="emit('playAgain')">
        Play Again
      </button>
    </div>
  </div>
</template>

<style scoped>
.gameover-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 14, 20, 0.75);
  backdrop-filter: blur(6px);
  animation: fadeIn 0.4s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.gameover-card {
  text-align: center;
  padding: 48px 56px;
  border-radius: 16px;
  background: rgba(22, 26, 36, 0.92);
  border: 1px solid rgba(100, 110, 130, 0.2);
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
}

.result {
  font-family: monospace;
  font-size: 48px;
  margin-bottom: 8px;
  letter-spacing: 2px;
}

.win { color: #50fa7b; }
.lose { color: #e94560; }
.draw { color: #f1fa8c; }
.spectator { color: #bd93f9; }

.result-sub {
  color: rgba(200, 205, 215, 0.5);
  font-family: monospace;
  font-size: 14px;
  margin-bottom: 32px;
}

.play-again-btn {
  padding: 12px 40px;
  border-radius: 8px;
  border: none;
  background: #e94560;
  color: white;
  font-family: monospace;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  letter-spacing: 1px;
}

.play-again-btn:hover {
  background: #d13a52;
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(233, 69, 96, 0.3);
}
</style>
