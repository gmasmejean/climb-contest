import type {
  ChangeMemberRoleInput,
  InviteInput,
  Member,
  OrganizationProfile,
  UpdateOrganizationInput,
} from '@climbcontest/contracts'

import { apiFetch } from './client'

const json = (body: unknown) => JSON.stringify(body)
const member = (id: string) => `/organization/members/${id}`

/** Fiche (Lot 25, ADR-088) et membres (Lot 24, ADR-087) de l'organisation. */
export const organizationApi = {
  profile: () => apiFetch<OrganizationProfile>('/organization'),
  updateProfile: (input: UpdateOrganizationInput) =>
    apiFetch<OrganizationProfile>('/organization', { method: 'PATCH', body: json(input) }),
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
