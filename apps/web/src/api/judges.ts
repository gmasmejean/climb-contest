import type {
  CreateJudgeInput,
  JudgeCreated,
  JudgePinRegenerated,
  JudgeSummary,
} from '@climbcontest/contracts'
import { ref } from 'vue'

import { accessToken } from './session'
import { apiFetch, ApiError } from './client'

// `accessUrl`/`pin` ne sont présents que si `competition.judgeCredentialsStored`
// était actif au moment de l'action qui les a produits (DECISIONS.md ADR-027).
export type JudgeWithRoutes = JudgeSummary & {
  routeIds: string[]
  accessUrl?: string
  pin?: string
}

const json = (body: unknown) => JSON.stringify(body)

/**
 * Jetons révélés en clair, gardés en mémoire pour la durée de l'onglet
 * navigateur (jamais persisté, voir DECISIONS.md ADR-026). Volontairement au
 * niveau du module plutôt que dans l'état local de `JudgesTab.vue` : ce
 * composant est démonté/remonté à chaque changement d'onglet dans
 * `CompetitionDetail.vue` (`v-else-if`), ce qui viderait un état local avant
 * même que l'organisateur ait pu télécharger la planche.
 */
export const revealedJudgeTokens = ref<
  { competitionId: string; judgeId: string; accessToken: string }[]
>([])

export const judgesApi = {
  list: (competitionId: string) =>
    apiFetch<JudgeWithRoutes[]>(`/competitions/${competitionId}/judges`),
  create: (competitionId: string, input: CreateJudgeInput) =>
    apiFetch<JudgeCreated>(`/competitions/${competitionId}/judges`, {
      method: 'POST',
      body: json(input),
    }),
  revoke: (competitionId: string, judgeId: string) =>
    apiFetch<JudgeWithRoutes>(`/competitions/${competitionId}/judges/${judgeId}/revoke`, {
      method: 'POST',
    }),
  regeneratePin: (competitionId: string, judgeId: string) =>
    apiFetch<JudgePinRegenerated>(
      `/competitions/${competitionId}/judges/${judgeId}/regenerate-pin`,
      { method: 'POST' },
    ),
  /**
   * Réponse binaire (PDF), pas JSON — n'utilise pas `apiFetch`. Le serveur
   * inclut automatiquement tout juge dont le jeton est stocké en clair
   * (DECISIONS.md ADR-027) ; `judges` ne sert qu'à fournir, en plus, le
   * jeton des juges encore tenus en mémoire par `JudgesTab.vue` pour cette
   * session mais pas stockés côté serveur (ADR-026). Un juge ni stocké ni
   * fourni ici ne figure que via la page QR publique de la planche.
   */
  async downloadQrSheet(
    competitionId: string,
    judges: { judgeId: string; accessToken: string }[],
  ): Promise<Blob> {
    const response = await fetch(`/api/v1/competitions/${competitionId}/qrcodes.pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken.value ? { Authorization: `Bearer ${accessToken.value}` } : {}),
      },
      credentials: 'include',
      body: json({ judges }),
    })
    if (!response.ok) {
      throw new ApiError(response.status, 'Impossible de générer la planche de QR codes.')
    }
    return response.blob()
  },
}
