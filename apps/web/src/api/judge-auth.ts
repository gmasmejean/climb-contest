import type {
  JudgeAccessInfo,
  JudgeAuthInput,
  JudgeMe,
  JudgeSession,
} from '@climbcontest/contracts'

import { judgeFetch } from './judge-client'

export const judgeAuthApi = {
  access: (token: string) => judgeFetch<JudgeAccessInfo>(`/access/${encodeURIComponent(token)}`),
  auth: (input: JudgeAuthInput) =>
    judgeFetch<JudgeSession>('/auth', { method: 'POST', body: JSON.stringify(input) }),
  me: () => judgeFetch<JudgeMe>('/me'),
}
