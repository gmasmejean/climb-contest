import { VueQueryPlugin } from '@tanstack/vue-query'
import { createApp } from 'vue'

import App from './App.vue'
import { startSyncRuntime } from './judge/sync-runtime'
import { setUpPwaUpdateGate } from './pwa-update'
import router from './router'
import './style.css'

const app = createApp(App)
app.use(router)
app.use(VueQueryPlugin)
app.mount('#app')

startSyncRuntime()
setUpPwaUpdateGate()
