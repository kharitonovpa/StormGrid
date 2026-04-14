import { createApp } from 'vue'
import './style.css'
import { initPlatform } from './lib/platform'
import { setLanguage } from './lib/i18n'
import App from './App.vue'

initPlatform()
  .then((platform) => {
    setLanguage(platform.getLanguage())
    createApp(App).mount('#app')
  })
  .catch((err) => {
    console.error('[init] Platform initialization failed:', err)
    document.getElementById('app')!.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#fff;font-family:sans-serif;text-align:center;padding:24px">' +
      '<div><p style="font-size:18px;margin-bottom:12px">Failed to load</p>' +
      '<button onclick="location.reload()" style="padding:10px 24px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff;font-size:14px;cursor:pointer">Reload</button></div></div>'
  })
