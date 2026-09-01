import { createApp } from 'vue'
import './style.css'
import { initPlatform } from './lib/platform'
import { initAnalytics } from './lib/analytics'
import { setLanguage } from './lib/i18n'
import { fetchCharacterSuggestion } from './lib/characterSuggestion'
import App from './App.vue'

// useGameState() reads getSuggestedCharacter() synchronously during App's
// setup(), so the suggestion fetch must resolve before mount — same
// constraint initPlatform() already satisfies for storage.ts. It runs
// alongside initPlatform() rather than after it, and never rejects (see
// characterSuggestion.ts), so it can't be the reason this chain's .catch
// fires.
Promise.all([initPlatform(), fetchCharacterSuggestion()])
  .then(([platform]) => {
    setLanguage(platform.getLanguage())
    initAnalytics(platform)
    createApp(App).mount('#app')
  })
  .catch((err) => {
    console.error('[init] Platform initialization failed:', err)
    document.getElementById('app')!.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#fff;font-family:sans-serif;text-align:center;padding:24px">' +
      '<div><p style="font-size:18px;margin-bottom:12px">Failed to load</p>' +
      '<button onclick="location.reload()" style="padding:10px 24px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff;font-size:14px;cursor:pointer">Reload</button></div></div>'
  })
