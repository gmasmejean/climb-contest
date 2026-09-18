import { registerSW } from 'virtual:pwa-register'

import { syncEngine } from './judge/sync-runtime'

/**
 * Gel de l'ACTIVATION d'une nouvelle version tant qu'une saisie juge est en
 * attente (ROADMAP.md Lot 6, point 2). Le navigateur installe toujours un
 * nouveau service worker en arrière-plan dès qu'il le détecte — ça, rien ne
 * l'empêche, et ce n'est pas dangereux tant qu'il ne prend pas la main. Ce
 * qui est gelé ici, c'est le seul moment qui pourrait interrompre une
 * saisie : `skipWaiting` + rechargement de page.
 */
export function setUpPwaUpdateGate(): void {
  let needsRefresh = false

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => {
      needsRefresh = true
      tryActivate()
    },
  })

  function tryActivate(): void {
    if (!needsRefresh) return
    const queueEmpty = syncEngine
      .snapshot()
      .every((item) => item.state !== 'pending' && item.state !== 'sending')
    if (!queueEmpty) return
    needsRefresh = false
    void updateSW(true)
  }

  syncEngine.subscribe(tryActivate)
}
