import type { Ascent, ConflictSummary, ResolveConflictInput } from '@climbcontest/contracts'

import { apiFetch } from './client'

const json = (body: unknown) => JSON.stringify(body)

export const conflictsApi = {
  list: (competitionId: string) =>
    apiFetch<ConflictSummary[]>(`/competitions/${competitionId}/conflicts`),
  resolve: (competitionId: string, conflictGroup: string, input: ResolveConflictInput) =>
    apiFetch<Ascent>(`/competitions/${competitionId}/conflicts/${conflictGroup}/resolve`, {
      method: 'POST',
      body: json(input),
    }),
}
