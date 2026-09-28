import {
  organizationPhotoListSchema,
  organizationPhotoSchema,
  type ChangeMemberRoleInput,
  type InviteInput,
  type Member,
  type OrganizationPhoto,
  type OrganizationProfile,
  type UpdateOrganizationInput,
  type UpdateOrganizationPhotoInput,
} from '@climbcontest/contracts'

import { apiFetch, apiRawFetch, errorFromResponse } from './client'

const json = (body: unknown) => JSON.stringify(body)
const member = (id: string) => `/organization/members/${id}`
const photo = (id: string) => `/organization/photos/${id}`

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

/**
 * Photos de la fiche (Lot 27, ADR-090). Le JPEG est déjà ré-encodé par
 * `lib/photo-resize.ts` ; le serveur le revérifie sur ses octets.
 */
export const organizationPhotosApi = {
  list: async (): Promise<OrganizationPhoto[]> =>
    organizationPhotoListSchema.parse(await apiFetch<unknown>('/organization/photos')),
  upload: async (jpeg: Blob): Promise<OrganizationPhoto> => {
    const response = await apiRawFetch('/organization/photos', {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: jpeg,
    })
    if (!response.ok) throw await errorFromResponse(response)
    return organizationPhotoSchema.parse(await response.json())
  },
  update: (id: string, input: UpdateOrganizationPhotoInput) =>
    apiFetch<OrganizationPhoto>(photo(id), { method: 'PATCH', body: json(input) }),
  reorder: async (photoIds: string[]): Promise<OrganizationPhoto[]> =>
    organizationPhotoListSchema.parse(
      await apiFetch<unknown>('/organization/photos/order', {
        method: 'PUT',
        body: json({ photoIds }),
      }),
    ),
  remove: (id: string) => apiFetch<void>(photo(id), { method: 'DELETE' }),
  restore: (id: string) => apiFetch<OrganizationPhoto>(`${photo(id)}/restore`, { method: 'POST' }),
  /** L'image, pour les membres : le jeton passe en en-tête, un `<img src>` ne le pourrait pas. */
  fetchImage: async (id: string): Promise<Blob> => {
    const response = await apiRawFetch(photo(id))
    if (!response.ok) throw await errorFromResponse(response)
    return response.blob()
  },
}
