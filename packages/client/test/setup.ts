// Bun's test runner has no DOM. `config.ts` reads `location` at import time
// to compute API_BASE, and characterSuggestion.ts (Task 4) is the first test
// to pull that module in transitively. Stub a minimal same-origin `location`
// so browser-only modules can load under `bun test`.
if (typeof globalThis.location === 'undefined') {
  ;(globalThis as { location?: URL }).location = new URL('http://localhost:5173/')
}
