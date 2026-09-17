import { onMounted, onUnmounted } from 'vue'

/**
 * SPEC.md § 6.5 : l'écran ne doit pas se verrouiller pendant la saisie.
 * Repli silencieux total si l'API est indisponible (iOS Safari, entre
 * autres) — jamais d'erreur visible, la voie fonctionne quand même, elle
 * peut juste se reverrouiller pendant une pause (ROADMAP.md Lot 5).
 */
export function useWakeLock(): void {
  let sentinel: WakeLockSentinel | null = null

  async function acquire(): Promise<void> {
    if (!('wakeLock' in navigator)) return
    try {
      sentinel = await navigator.wakeLock.request('screen')
    } catch {
      // Repli silencieux (permission refusée, contexte non sécurisé…).
    }
  }

  function release(): void {
    void sentinel?.release()
    sentinel = null
  }

  function onVisibilityChange(): void {
    // Le verrou est automatiquement relâché par le navigateur dès que
    // l'onglet passe en arrière-plan — sans ce ré-essai, l'écran se
    // reverrouillerait dès le retour au premier plan.
    if (document.visibilityState === 'visible') void acquire()
  }

  onMounted(() => {
    void acquire()
    document.addEventListener('visibilitychange', onVisibilityChange)
  })

  onUnmounted(() => {
    release()
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })
}
