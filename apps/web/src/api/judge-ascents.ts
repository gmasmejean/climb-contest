import type {
  Ascent,
  CorrectLastAscentInput,
  CreateAscentInput,
  JudgeLastAscent,
  JudgeRouteDetail,
  JudgeRoutesResponse,
} from '@climbcontest/contracts'

import { judgeFetch } from './judge-client'

export const judgeRoutesApi = {
  list: () => judgeFetch<JudgeRoutesResponse>('/routes'),
  detail: (routeId: string) => judgeFetch<JudgeRouteDetail>(`/routes/${routeId}`),
}

export const judgeAscentsApi = {
  last: () => judgeFetch<JudgeLastAscent>('/ascents/last'),
  create: (input: CreateAscentInput) =>
    judgeFetch<Ascent>('/ascents', { method: 'POST', body: JSON.stringify(input) }),
  correctLast: (input: CorrectLastAscentInput) =>
    judgeFetch<Ascent>('/ascents/last/correct', { method: 'POST', body: JSON.stringify(input) }),
}
