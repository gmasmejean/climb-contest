import type { OrganizationProfile } from '@climbcontest/contracts'
import { describe, expect, it } from 'vitest'

import {
  competitionAddress,
  initialPlaceChoice,
  organizationPlace,
  samePlace,
} from './competition-place'

const address = {
  label: '8 Boulevard du Port 80000 Amiens',
  postcode: '80000',
  city: 'Amiens',
  latitude: 49.897442,
  longitude: 2.290084,
  banId: '80021_6590_00008',
}
const manual = {
  label: 'Gymnase Jules-Verne, Amiens',
  postcode: null,
  city: null,
  latitude: null,
  longitude: null,
  banId: null,
}
const profile: OrganizationProfile = {
  id: '0189dcd5-5311-7d40-8db0-9496a2eef37b',
  name: 'Roc’n Bloc',
  type: 'gym',
  description: null,
  contactEmail: null,
  contactPhone: null,
  websiteUrl: null,
  address,
}

describe('competitionAddress', () => {
  it('regroupe les colonnes à plat ; pas de libellé, pas d’adresse', () => {
    expect(
      competitionAddress({
        addressLabel: address.label,
        postcode: '80000',
        city: 'Amiens',
        latitude: 49.897442,
        longitude: 2.290084,
        banId: '80021_6590_00008',
      }),
    ).toEqual(address)
    expect(
      competitionAddress({
        addressLabel: null,
        postcode: null,
        city: null,
        latitude: null,
        longitude: null,
        banId: null,
      }),
    ).toBeNull()
  })
})

describe('organizationPlace', () => {
  it('propose le nom et l’adresse de la fiche', () => {
    expect(organizationPlace(profile)).toEqual({ venue: 'Roc’n Bloc', address })
  })

  it('rien sans adresse, ni sans fiche chargée', () => {
    expect(organizationPlace({ ...profile, address: null })).toBeNull()
    expect(organizationPlace(undefined)).toBeNull()
  })
})

describe('samePlace', () => {
  it('compare les positions quand les deux en ont une', () => {
    expect(samePlace(address, { ...address, label: 'Autre libellé' })).toBe(true)
    expect(samePlace(address, { ...address, latitude: 48.85 })).toBe(false)
  })

  it('compare les libellés d’adresses saisies à la main', () => {
    expect(samePlace(manual, { ...manual, label: ' gymnase jules-verne, amiens ' })).toBe(true)
    expect(samePlace(manual, address)).toBe(false)
    expect(samePlace(null, address)).toBe(false)
  })
})

describe('initialPlaceChoice', () => {
  it('à la création : le lieu de l’organisation si la fiche a une adresse', () => {
    expect(initialPlaceChoice(profile)).toBe('organization')
    expect(initialPlaceChoice({ ...profile, address: null })).toBe('other')
    expect(initialPlaceChoice(undefined)).toBe('other')
  })

  it('sur une compétition existante : seulement si le nom et l’adresse sont ceux de la fiche', () => {
    expect(initialPlaceChoice(profile, { venue: 'Roc’n Bloc', address })).toBe('organization')
    expect(initialPlaceChoice(profile, { venue: 'Gymnase municipal', address })).toBe('other')
    expect(initialPlaceChoice(profile, { venue: 'Roc’n Bloc', address: null })).toBe('other')
    expect(initialPlaceChoice(profile, { venue: 'Roc’n Bloc', address: manual })).toBe('other')
  })
})
