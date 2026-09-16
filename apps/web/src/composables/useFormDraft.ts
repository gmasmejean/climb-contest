import { useToast } from '@climbcontest/ui'
import { onMounted, watch, type UnwrapNestedRefs } from 'vue'

const DEBOUNCE_MS = 500
const STORAGE_PREFIX = 'climbcontest:draft:'

function readDraft(key: string): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
    return raw === null ? null : (JSON.parse(raw) as unknown)
  } catch {
    // Navigation privée, quota dépassé, accès bloqué : pas de brouillon,
    // le formulaire fonctionne quand même.
    return null
  }
}

function writeDraft(key: string, value: unknown): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value))
  } catch {
    // Rien de plus à faire : la persistance du brouillon est un confort,
    // pas une garantie (contrairement à la file de synchronisation juge).
  }
}

function clearDraftStorage(key: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + key)
  } catch {
    // idem
  }
}

/**
 * Brouillon local d'un formulaire long (ROADMAP.md Lot 3 : « absence de
 * perte de données sur un rechargement accidentel »). `key` doit être
 * stable et unique par formulaire (inclure l'id de l'entité éditée s'il y
 * en a un). Restaure au montage, sauvegarde en continu (debounce), et
 * `clearDraft()` doit être appelé après une soumission réussie.
 */
export function useFormDraft<T extends object>(
  key: string,
  form: UnwrapNestedRefs<T>,
): { clearDraft: () => void } {
  const toast = useToast()

  onMounted(() => {
    const draft = readDraft(key)
    if (draft && typeof draft === 'object') {
      Object.assign(form, draft)
      toast.show('Brouillon restauré depuis votre dernière saisie.', 'info')
    }
  })

  let timeout: ReturnType<typeof setTimeout> | undefined
  watch(
    form,
    (value) => {
      clearTimeout(timeout)
      timeout = setTimeout(() => writeDraft(key, value), DEBOUNCE_MS)
    },
    { deep: true },
  )

  function clearDraft(): void {
    clearTimeout(timeout)
    clearDraftStorage(key)
  }

  return { clearDraft }
}
