import type { ChangeMemberRoleInput, InviteInput, Member } from '@climbcontest/contracts'

import { apiFetch } from './client'

const json = (body: unknown) => JSON.stringify(body)
const member = (id: string) => `/organization/members/${id}`

/** Membres de l'organisation (Lot 24, ADR-087). */
export const organizationApi = {
  members: () => apiFetch<Member[]>('/organization/members'),
  invite: (input: InviteInput) =>
    apiFetch<Member>('/auth/invitations', { method: 'POST', body: json(input) }),
  resendInvitation: (id: string) =>
    apiFetch<Member>(`${member(id)}/invitation`, { method: 'POST' }),
  cancelInvitation: (id: string) =>
    apiFetch<void>(`${member(id)}/invitation`, { method: 'DELETE' }),
  changeRole: (id: string, input: ChangeMemberRoleInput) =>
    apiFetch<Member>(member(id), { method: 'PATCH', body: json(input) }),
  deactivate: (id: string) => apiFetch<Member>(`${member(id)}/deactivate`, { method: 'POST' }),
  reactivate: (id: string) => apiFetch<Member>(`${member(id)}/reactivate`, { method: 'POST' }),
}
