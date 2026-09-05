<script setup lang="ts">
import { STAR_PATH, STAR_VIEWBOX } from '../lib/star'
</script>

<template>
  <!--
    Inline so it inherits `color` and scales with the surrounding font-size;
    pair it with the global `.points` class for spacing and the shared gold.
  -->
  <svg
    class="points-star"
    :viewBox="`0 0 ${STAR_VIEWBOX} ${STAR_VIEWBOX}`"
    aria-hidden="true"
    focusable="false"
  >
    <path :d="STAR_PATH" />
  </svg>
</template>

<style scoped>
.points-star {
  width: 1em;
  height: 1em;
  flex-shrink: 0;
  fill: currentColor;
  /* A hair of rounded stroke softens the tips at 10–12px without a second shape. */
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linejoin: round;
  overflow: visible;
}
</style>
