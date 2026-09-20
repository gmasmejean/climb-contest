import { registerSW } from 'virtual:pwa-register'

/**
 * Active une nouvelle version de l'appli dès que le navigateur l'a installée
 * (ADR-061, qui remplace le gel d'ADR-035).
 *
 * Recharger ne perd rien : la file de saisies est dans IndexedDB avant tout
 * réseau et le serveur est idempotent, et la saisie en cours à l'écran est
 * gardée par un brouillon (`judge/ascent-draft.ts`). `registerType: 'prompt'`
 * reste : c'est lui qui laisse ce module piloter l'appel.
 */
export function setUpPwaUpdate(): void {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => {
      void updateSW(true)
    },
  })
}
