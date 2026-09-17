import { ref } from 'vue'

/**
 * Session juge — distincte de `session.ts` (organisateur) : pas de compte,
 * pas de refresh token, un seul JWT de longue durée (SPEC.md § 3.2). Stocké
 * dans `localStorage` pour survivre à la fermeture de l'onglet — « stocké de
 * manière persistante sur l'appareil ».
 */
const STORAGE_KEY = 'climbcontest.judge.token'

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export const judgeToken = ref<string | null>(readStoredToken())

export function setJudgeSession(token: string): void {
  judgeToken.value = token
  try {
    localStorage.setItem(STORAGE_KEY, token)
  } catch {
    // Stockage indisponible (navigation privée, quota) — la session reste
    // valable pour cet onglet, simplement pas persistée au rechargement.
  }
}

export function clearJudgeSession(): void {
  judgeToken.value = null
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Rien à faire de plus.
  }
}
