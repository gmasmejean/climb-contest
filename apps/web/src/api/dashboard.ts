import type { ActivityLogResponse, DashboardResponse } from '@climbcontest/contracts'

import { apiFetch, ApiError } from './client'
import { accessToken } from './session'

export interface ActivityLogFilters {
  type?: string
  actorType?: string
  from?: string
  to?: string
}

function toQuery(filters: ActivityLogFilters): string {
  const params = new URLSearchParams(
    Object.entries(filters).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  return params.size > 0 ? `?${params.toString()}` : ''
}

export const dashboardApi = {
  get: (competitionId: string) =>
    apiFetch<DashboardResponse>(`/competitions/${competitionId}/dashboard`),
  activityLog: (competitionId: string, filters: ActivityLogFilters = {}) =>
    apiFetch<ActivityLogResponse>(
      `/competitions/${competitionId}/activity-log${toQuery(filters)}`,
    ),
  /** Réponse texte (CSV), pas JSON — même style d'appel brut que `judgesApi.downloadQrSheet`. */
  async downloadActivityLogCsv(competitionId: string, filters: ActivityLogFilters = {}): Promise<Blob> {
    const params = new URLSearchParams(
      Object.entries(filters).filter((entry): entry is [string, string] => entry[1] !== undefined),
    )
    params.set('format', 'csv')
    const response = await fetch(
      `/api/v1/competitions/${competitionId}/activity-log?${params.toString()}`,
      {
        headers: accessToken.value ? { Authorization: `Bearer ${accessToken.value}` } : {},
        credentials: 'include',
      },
    )
    if (!response.ok) {
      throw new ApiError(response.status, 'Impossible de générer le journal d’activité.')
    }
    return response.blob()
  },
}
