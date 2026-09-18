import type {
  Ascent,
  CorrectAscentByOrganizerInput,
  CreateAscentByOrganizerInput,
  OrganizerAscentWriteResult,
} from '@climbcontest/contracts'

import { apiFetch } from './client'

const json = (body: unknown) => JSON.stringify(body)

export interface RouteAscentEntry {
  id: string
  bib: number | null
  firstName: string
  lastName: string
  categoryLabel: string
  ascent: {
    id: string
    holdNumber: number | null
    modifier: 'none' | 'plus'
    isTop: boolean
    status: 'valid' | 'dns' | 'dnf' | 'dsq'
    climbTimeMs: number | null
    recordedAt: string
  } | null
}

export const organizerAscentsApi = {
  listForRoute: (competitionId: string, roundId: string, routeId: string) =>
    apiFetch<RouteAscentEntry[]>(
      `/competitions/${competitionId}/ascents?roundId=${roundId}&routeId=${routeId}`,
    ),
  create: (competitionId: string, input: CreateAscentByOrganizerInput) =>
    apiFetch<OrganizerAscentWriteResult>(`/competitions/${competitionId}/ascents`, {
      method: 'POST',
      body: json(input),
    }),
  correct: (competitionId: string, ascentId: string, input: CorrectAscentByOrganizerInput) =>
    apiFetch<Ascent>(`/competitions/${competitionId}/ascents/${ascentId}`, {
      method: 'PATCH',
      body: json(input),
    }),
}
