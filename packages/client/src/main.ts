import { createApp } from 'vue'
import './style.css'
import { initPlatform } from './lib/platform'
import { initAnalytics } from './lib/analytics'
import { setLanguage, t } from './lib/i18n'
import App from './App.vue'

initPlatform()
  .then((platform) => {
    setLanguage(platform.getLanguage())
    initAnalytics(platform)
    createApp(App).mount('#app')
  })
  .catch((err) => {
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
    hint!.textContent = t('boot.failedHint')
    const button = root.querySelector('button')!
    button.textContent = t('boot.reload')
    button.addEventListener('click', () => location.reload())
  })
