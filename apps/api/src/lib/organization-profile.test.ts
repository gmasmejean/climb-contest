import { organization } from '@climbcontest/db'
import { describe, expect, it } from 'vitest'

import {
  organizationUpdateColumns,
  toOrganizationProfile,
  toPublicOrganization,
} from './organization-profile'

type OrganizationRow = typeof organization.$inferSelect

const row: OrganizationRow = {
  id: '0189dcd5-5311-7d40-8db0-9496a2eef37b',
  name: 'Club Roc',
  slug: 'club-roc',
  type: 'club',
  description: null,
  contactEmail: 'contact@club-roc.test',
  contactPhone: null,
  websiteUrl: null,
  addressLabel: '8 Boulevard du Port 80000 Amiens',
  postcode: '80000',
  city: 'Amiens',
  latitude: 49.897442,
  longitude: 2.290084,
  banId: '80021_6590_00008',
  createdAt: new Date('2026-09-27T10:00:00Z'),
  updatedAt: new Date('2026-09-27T10:00:00Z'),
}

describe('toOrganizationProfile', () => {
  it('regroupe les colonnes d’adresse en un bloc', () => {
    expect(toOrganizationProfile(row).address).toEqual({
      label: '8 Boulevard du Port 80000 Amiens',
      postcode: '80000',
      city: 'Amiens',
      latitude: 49.897442,
      longitude: 2.290084,
      banId: '80021_6590_00008',
    })
  })

  it('sans libellé, pas d’adresse', () => {
    const withoutAddress: OrganizationRow = {
      ...row,
      addressLabel: null,
      postcode: null,
      city: null,
      latitude: null,
      longitude: null,
      banId: null,
    }
    expect(toOrganizationProfile(withoutAddress).address).toBeNull()
  })

  it('refuse un type que la contrainte en base aurait dû empêcher', () => {
    expect(() => toOrganizationProfile({ ...row, type: 'association' })).toThrow()
  })
})

describe('toPublicOrganization', () => {
  it('ne donne ni l’identifiant de l’organisation, ni son slug, ni l’identifiant BAN', () => {
    const publicCard = toPublicOrganization(row)
    expect(publicCard).not.toHaveProperty('id')
    expect(publicCard).not.toHaveProperty('slug')
    expect(publicCard.address).not.toHaveProperty('banId')
    expect(publicCard.address?.label).toBe('8 Boulevard du Port 80000 Amiens')
  })
})

describe('organizationUpdateColumns', () => {
  it('ne touche pas aux champs absents', () => {
    expect(organizationUpdateColumns({ description: 'Salle de bloc.' })).toEqual({
      description: 'Salle de bloc.',
    })
  })

  it('vider l’adresse remet toutes ses colonnes à null', () => {
    expect(organizationUpdateColumns({ address: null })).toEqual({
      addressLabel: null,
      postcode: null,
      city: null,
      latitude: null,
      longitude: null,
      banId: null,
    })
  })

  it('une adresse saisie à la main n’a pas de position', () => {
    const columns = organizationUpdateColumns({
      address: {
        label: 'Gymnase Jules-Verne, Amiens',
        postcode: null,
        city: null,
        latitude: null,
        longitude: null,
        banId: null,
      },
    })
    expect(columns).toMatchObject({ addressLabel: 'Gymnase Jules-Verne, Amiens', latitude: null })
  })
})
