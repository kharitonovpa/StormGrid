import { createApp } from 'vue'
import './style.css'
import { initPlatform } from './lib/platform'
import { initAnalytics } from './lib/analytics'
import { setLanguage, t } from './lib/i18n'
import { fetchCharacterSuggestion } from './lib/characterSuggestion'
import App from './App.vue'

/**
 * Fills `#app` with a translated "failed to load" card and wires its Reload
 * button. Shared by both boot-failure paths below so the scaffold and its
 * `textContent`/`addEventListener` wiring exist once, not twice.
 */
function showBootFailure(hintKey: string) {
  const root = document.getElementById('app')!
  root.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#fff;font-family:sans-serif;text-align:center;padding:24px">' +
    '<div>' +
    '<p style="font-size:18px;margin:0 0 8px"></p>' +
    '<p style="font-size:13px;opacity:.6;margin:0 0 18px"></p>' +
    '<button style="padding:10px 24px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff;font-size:14px;cursor:pointer"></button>' +
    '</div></div>'

  // Text goes in through textContent, not the markup string: translated copy
  // must never be parsed as HTML. The reload handler is attached rather than
  // written as an inline onclick, which a strict CSP is entitled to refuse.
  const [title, hint] = root.querySelectorAll('p')
  title!.textContent = t('boot.failed')
  hint!.textContent = t(hintKey)
  const button = root.querySelector('button')!
  button.textContent = t('boot.reload')
  button.addEventListener('click', () => location.reload())
}

// The rejection handler is `.then`'s second argument, not a chained `.catch`,
// so it only ever sees a rejected initPlatform(). A throw from Vue's own
// setup()/render()/lifecycle handling inside mount() never reaches here at
// all — Vue wraps those itself and (without throwUnhandledErrorInProduction,
// which this app never sets) only logs them — so this path is purely "the
// platform adapter never came up".
//
// The fulfilled callback carries its own try/catch instead, because
// setLanguage(platform.getLanguage()) and initAnalytics(platform) both run as
// plain top-level statements before mount() starts, outside any Vue error
// boundary. initAnalytics in particular calls crypto.randomUUID(), which
// throws outright on a plain-HTTP embed or an older in-app WebView — exactly
// where this game's portal, Telegram and Discord embeds run. Without this
// try/catch, that throw would leave #app blank with no message and no Reload.
//
// Do not "simplify" either of these away: collapsing back to
// `.then(...).catch(...)` reintroduces a mislabeled "check your internet"
// message for what is often a graphics or crypto-API failure, and dropping
// the inner try/catch brings back the silent blank page it replaced.
// useGameState() reads getSuggestedCharacter() synchronously during App's
// setup(), so the suggestion fetch must resolve before mount — the same
// constraint initPlatform() already satisfies for storage.ts. It runs
// alongside initPlatform() rather than after it, and never rejects (see
// characterSuggestion.ts), so a rejection below is still always the
// platform adapter's.
Promise.all([initPlatform(), fetchCharacterSuggestion()]).then(
  ([platform]) => {
    let languageResolved = false
    try {
      setLanguage(platform.getLanguage())
      languageResolved = true
      initAnalytics(platform)
      createApp(App).mount('#app')
    } catch (err) {
      console.error('[init] Mount failed:', err)
      // platform.getLanguage() itself may be what threw, so the language can
      // still be unset here — fall back to the browser's, same guard as the
      // rejection path below. Skipped once setLanguage has already
      // succeeded, so a later throw (initAnalytics, mount) can't override a
      // correctly-resolved language with a possibly different
      // navigator.language.
      if (!languageResolved) {
        setLanguage(
          typeof navigator !== 'undefined' && navigator.language
            ? navigator.language.slice(0, 2)
            : 'en'
        )
      }
      showBootFailure('boot.failedGeneric')
    }
  },
  (err) => {
    console.error('[init] Platform initialization failed:', err)
    // The adapter never came up, so its language is unknowable — fall back to
    // the browser's. i18n has no platform dependency, so it still works here.
    // Guard this line: it runs before anything is rendered, so a throw here costs
    // the player the entire error message. Use the same guard as web.ts's getLanguage.
    setLanguage(
      typeof navigator !== 'undefined' && navigator.language
        ? navigator.language.slice(0, 2)
        : 'en'
    )
    showBootFailure('boot.failedHint')
  },
)
