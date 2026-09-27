import { describe, expect, it } from 'vitest'

import { addressSchema } from './address'
import { updateOrganizationInputSchema } from './organization'

const banAddress = {
  label: '8 Boulevard du Port 80000 Amiens',
  postcode: '80000',
  city: 'Amiens',
  latitude: 49.897442,
  longitude: 2.290084,
  banId: '80021_6590_00008',
}

function firstMessage(input: unknown): string | undefined {
  const result = updateOrganizationInputSchema.safeParse(input)
  return result.success ? undefined : result.error.issues[0]?.message
}

describe('addressSchema (ADR-088)', () => {
  it('accepte une adresse choisie dans la BAN', () => {
    expect(addressSchema.safeParse(banAddress).success).toBe(true)
  })

  it('accepte une saisie libre : le libellé seul, sans position', () => {
    const manual = {
      label: 'Gymnase Jules-Verne, Amiens',
      postcode: null,
      city: null,
      latitude: null,
      longitude: null,
      banId: null,
    }
    expect(addressSchema.safeParse(manual).success).toBe(true)
  })

  it('refuse une latitude sans longitude, un libellé vide ou un code postal mal formé', () => {
    expect(addressSchema.safeParse({ ...banAddress, longitude: null }).success).toBe(false)
    expect(addressSchema.safeParse({ ...banAddress, label: '   ' }).success).toBe(false)
    expect(addressSchema.safeParse({ ...banAddress, postcode: '8000' }).success).toBe(false)
    expect(addressSchema.safeParse({ ...banAddress, latitude: 91 }).success).toBe(false)
  })

  it('refuse un champ inconnu', () => {
    expect(addressSchema.safeParse({ ...banAddress, citycode: '80021' }).success).toBe(false)
  })
})

describe('updateOrganizationInputSchema (ADR-088)', () => {
  it('accepte une fiche complète', () => {
    const result = updateOrganizationInputSchema.safeParse({
      name: 'Club Roc',
      type: 'gym',
      description: 'Salle de bloc et de difficulté.',
      contactEmail: 'contact@club-roc.test',
      contactPhone: '+33 3 22 00 00 00',
      websiteUrl: 'https://club-roc.test',
      address: banAddress,
    })
    expect(result.success).toBe(true)
  })

  it('accepte une modification partielle, et null pour vider un champ', () => {
    expect(updateOrganizationInputSchema.safeParse({ description: null }).success).toBe(true)
    expect(updateOrganizationInputSchema.safeParse({}).success).toBe(true)
  })

  it('refuse un site en http, avec un message qui dit quoi faire', () => {
    expect(firstMessage({ websiteUrl: 'http://club-roc.test' })).toBe(
      'Adresse du site invalide : elle doit commencer par https://.',
    )
    expect(firstMessage({ websiteUrl: 'javascript:alert(1)' })).toBeDefined()
  })

  it('refuse un téléphone avec des lettres ou trop peu de chiffres', () => {
    expect(firstMessage({ contactPhone: '03 22 AB CD EF' })).toMatch(/Numéro de téléphone invalide/)
    expect(firstMessage({ contactPhone: '+33 (0)' })).toMatch(/Numéro de téléphone invalide/)
    expect(firstMessage({ contactPhone: '(+32) 2.123.45.67' })).toBeUndefined()
  })

  it('refuse une description de plus de 2 000 caractères, ou vide', () => {
    expect(firstMessage({ description: 'a'.repeat(2001) })).toBe(
      'La description ne peut pas dépasser 2 000 caractères.',
    )
    expect(firstMessage({ description: '   ' })).toBeDefined()
    expect(firstMessage({ description: 'a'.repeat(2000) })).toBeUndefined()
  })

  it('refuse un nom vide et un type inconnu', () => {
    expect(firstMessage({ name: '  ' })).toBe('Indiquez le nom de l’organisation.')
    expect(firstMessage({ type: 'association' })).toBeDefined()
  })

  it('refuse un champ inconnu (le slug ne se modifie pas)', () => {
    expect(updateOrganizationInputSchema.safeParse({ slug: 'autre' }).success).toBe(false)
  })
})
