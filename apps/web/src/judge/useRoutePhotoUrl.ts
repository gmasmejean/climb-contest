import { computed, onUnmounted, ref, watch, type Ref } from 'vue'

import { judgeDb } from './local-db'
import { useLiveQuery } from './use-live-query'

/**
 * L'adresse locale (`blob:`) de la photo d'une voie, lue dans IndexedDB — aucun
 * accès réseau (ADR-066). `null` tant que la photo annoncée par l'amorçage n'est
 * pas sur l'appareil, ou quand l'image stockée n'est plus celle qu'on attend
 * (photo remplacée) : mieux vaut pas de photo qu'une photo qui ne correspond plus
 * aux numéros de prises affichés.
 *
 * `enabled` : n'alloue l'adresse que quand le panneau est ouvert.
 */
export function useRoutePhotoUrl(
  routeId: string,
  expectedAssetId: Ref<string | null>,
  enabled: Ref<boolean>,
): Ref<string | null> {
  const row = useLiveQuery(() => judgeDb.routePhotos.get(routeId), undefined)
  const url = ref<string | null>(null)

  const source = computed(() => {
    if (!enabled.value || !row.value) return null
    return row.value.assetId === expectedAssetId.value ? row.value : null
  })

  function release(): void {
    if (url.value !== null) URL.revokeObjectURL(url.value)
    url.value = null
  }

  watch(
    source,
    (next) => {
      release()
      if (next) url.value = URL.createObjectURL(new Blob([next.bytes], { type: next.mimeType }))
    },
    { immediate: true },
  )
  onUnmounted(release)
  return url
}
