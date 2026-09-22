import { ref } from 'vue'

/**
 * L'accès du juge de cet appareil a été révoqué (Lot 21, ADR-078). Persistant :
 * un rechargement ne doit pas rendre les écrans de saisie à un juge révoqué.
 *
 * Levé par les deux seuls points de contact réseau du juge — le lot de saisies
 * (`sync-transport.ts`) et l'actualisation des voies (`refresh-routes.ts`) —,
 * baissé seulement par une nouvelle connexion réussie (`JudgeAccess.vue`).
 */
const STORAGE_KEY = 'climbcontest.judge.revoked'

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export const judgeAccessRevoked = ref(readStored())

export function markJudgeAccessRevoked(): void {
  judgeAccessRevoked.value = true
  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    // Stockage indisponible : l'état vaut pour cet onglet, et sera relevé au
    // prochain contact avec le serveur.
  }
}

export function clearJudgeAccessRevoked(): void {
  judgeAccessRevoked.value = false
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Rien à faire de plus.
  }
}
