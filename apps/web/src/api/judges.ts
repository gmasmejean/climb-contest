import type {
  CreateJudgeInput,
  JudgeCreated,
  JudgePinRegenerated,
  JudgeSummary,
} from '@climbcontest/contracts'
import { ref } from 'vue'

import { accessToken } from './session'
import { apiFetch, ApiError } from './client'

export type JudgeWithRoutes = JudgeSummary & { routeIds: string[] }

const json = (body: unknown) => JSON.stringify(body)

/**
 * Jetons révélés en clair, gardés en mémoire pour la durée de l'onglet
 * navigateur (jamais persisté, voir DECISIONS.md ADR-026). Volontairement au
 * niveau du module plutôt que dans l'état local de `JudgesTab.vue` : ce
 * composant est démonté/remonté à chaque changement d'onglet dans
 * `CompetitionDetail.vue` (`v-else-if`), ce qui viderait un état local avant
 * même que l'organisateur ait pu télécharger la planche.
 */
export const revealedJudgeTokens = ref<{ competitionId: string; judgeId: string; accessToken: string }[]>(
  [],
)

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
   * ne connaît un jeton d'accès juge en clair qu'à sa création (SPEC.md § 5),
   * donc seuls les juges de `judges` (fournis avec le jeton tout juste
   * révélé, tenu en mémoire par `JudgesTab.vue`) apparaissent en encart
   * individuel ; les autres ne figurent que via la page QR publique.
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
