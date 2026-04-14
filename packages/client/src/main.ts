import { createApp } from 'vue'
import './style.css'

await (window.__tgReady ?? Promise.resolve())

const { default: App } = await import('./App.vue')
createApp(App).mount('#app')
