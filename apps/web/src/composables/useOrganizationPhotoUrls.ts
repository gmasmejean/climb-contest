import { onScopeDispose, reactive, watch, type Ref } from 'vue'

import { organizationPhotosApi } from '../api/organization'

/**
 * Les adresses locales (`blob:`) des photos de l'organisation, pour ses membres
 * (ADR-090 point 8) : l'image se lit avec le jeton en en-tête, qu'un
 * `<img src>` ne sait pas envoyer. Chaque photo est chargée une fois ; celles
 * qui quittent la liste sont libérées. Une image qui ne se charge pas reste à
 * `null` : la vignette affiche son texte plutôt que de bloquer l'écran.
 */
export function useOrganizationPhotoUrls(
  photoIds: Ref<readonly string[]>,
  fetchImage: (id: string) => Promise<Blob> = organizationPhotosApi.fetchImage,
): { src: (photoId: string) => string | null } {
  const urls = reactive(new Map<string, string>())
  const loading = new Set<string>()
  let disposed = false

  function release(id: string): void {
    const url = urls.get(id)
    if (url !== undefined) URL.revokeObjectURL(url)
    urls.delete(id)
  }

  async function load(id: string): Promise<void> {
    loading.add(id)
    try {
      const blob = await fetchImage(id)
      // Retirée ou écran quitté pendant le chargement : on ne garde rien.
      if (disposed || !photoIds.value.includes(id)) return
      urls.set(id, URL.createObjectURL(blob))
    } catch {
      // Laissée à `null` ; un rechargement de la page réessaiera.
    } finally {
      loading.delete(id)
    }
  }

  watch(
    photoIds,
    (ids) => {
      for (const id of [...urls.keys()]) if (!ids.includes(id)) release(id)
      for (const id of ids) if (!urls.has(id) && !loading.has(id)) void load(id)
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    disposed = true
    for (const id of [...urls.keys()]) release(id)
  })

  return { src: (photoId) => urls.get(photoId) ?? null }
}
