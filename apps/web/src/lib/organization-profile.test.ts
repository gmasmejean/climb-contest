import { describe, expect, it } from 'vitest'

import {
  directionsUrl,
  formFromProfile,
  inputFromForm,
  normalizeWebsite,
  telHref,
} from './organization-profile'

const profile = {
  id: '0189dcd5-5311-7d40-8db0-9496a2eef37b',
  name: 'Club Roc',
  type: 'club' as const,
  description: null,
  contactEmail: null,
  contactPhone: null,
  websiteUrl: null,
  address: null,
}

describe('normalizeWebsite', () => {
  it('ajoute https:// à une adresse écrite sans préfixe', () => {
    expect(normalizeWebsite(' www.club-roc.fr ')).toBe('https://www.club-roc.fr')
  })

  it('laisse un http:// explicite pour que la validation dise quoi faire', () => {
    expect(normalizeWebsite('http://club-roc.fr')).toBe('http://club-roc.fr')
  })

  it('un champ vide vaut null', () => {
    expect(normalizeWebsite('   ')).toBeNull()
  })
})

describe('inputFromForm', () => {
  it('envoie null pour un champ vidé, jamais une chaîne vide', () => {
    const form = { ...formFromProfile(profile), description: '  ', contactPhone: '' }
    expect(inputFromForm(form)).toEqual({
      name: 'Club Roc',
      type: 'club',
      description: null,
      contactEmail: null,
      contactPhone: null,
      websiteUrl: null,
      address: null,
    })
  })

  it('un aller-retour garde la fiche telle quelle', () => {
    const full = {
      ...profile,
      type: 'gym' as const,
      description: 'Salle de bloc.',
      contactEmail: 'contact@club-roc.test',
      contactPhone: '03 22 00 00 00',
      websiteUrl: 'https://club-roc.test',
    }
    expect(inputFromForm(formFromProfile(full))).toEqual({
      name: full.name,
      type: full.type,
      description: full.description,
      contactEmail: full.contactEmail,
      contactPhone: full.contactPhone,
      websiteUrl: full.websiteUrl,
      address: full.address,
    })
  })
})

describe('directionsUrl', () => {
  it('vise les coordonnées quand on les a', () => {
    const url = new URL(
      directionsUrl({
        label: '8 Boulevard du Port 80000 Amiens',
        postcode: '80000',
        city: 'Amiens',
        latitude: 49.897442,
        longitude: 2.290084,
      }),
    )
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/')
    expect(url.searchParams.get('destination')).toBe('49.897442,2.290084')
  })

  it('cherche le libellé d’une adresse saisie à la main', () => {
    const url = new URL(
      directionsUrl({
        label: 'Gymnase Jules-Verne, Amiens',
        postcode: null,
        city: null,
        latitude: null,
        longitude: null,
      }),
    )
    expect(url.searchParams.get('destination')).toBe('Gymnase Jules-Verne, Amiens')
  })
})

describe('telHref', () => {
  it('retire espaces et ponctuation, et le « (0) » qui ne se compose pas', () => {
    expect(telHref('03 22.00-00-00')).toBe('tel:0322000000')
    expect(telHref('+33 (0)3 22 00 00 00')).toBe('tel:+33322000000')
  })
})
