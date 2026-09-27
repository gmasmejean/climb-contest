import { describe, expect, it, vi } from 'vitest'

import {
  AddressServiceError,
  banSearchUrl,
  normalizeBanQuery,
  searchAddresses,
  toAddress,
} from './ban'

// Extrait réel d'une réponse de data.geopf.fr/geocodage/search (2026-09-27).
const feature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [2.290084, 49.897442] },
  properties: {
    label: '8 Boulevard du Port 80000 Amiens',
    score: 0.59,
    housenumber: '8',
    id: '80021_6590_00008',
    banId: 'f2633629-5541-4233-aa54-3c2eb58aa8b9',
    name: '8 Boulevard du Port',
    postcode: '80000',
    citycode: '80021',
    city: 'Amiens',
    context: '80, Somme, Hauts-de-France',
    type: 'housenumber',
  },
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('normalizeBanQuery', () => {
  it('attend 3 caractères, sans compter les espaces', () => {
    expect(normalizeBanQuery('  8 ')).toBeNull()
    expect(normalizeBanQuery('8 b')).toBe('8 b')
  })

  it('retire ce qui précède la première lettre ou le premier chiffre (le service refuserait)', () => {
    expect(normalizeBanQuery('« Gymnase')).toBe('Gymnase')
    expect(normalizeBanQuery('--- ')).toBeNull()
  })

  it('coupe à 200 caractères', () => {
    expect(normalizeBanQuery('a'.repeat(250))).toHaveLength(200)
  })
})

describe('banSearchUrl', () => {
  it('demande 5 propositions en mode autocomplétion', () => {
    const url = new URL(banSearchUrl('8 bd du port'))
    expect(url.origin + url.pathname).toBe('https://data.geopf.fr/geocodage/search')
    expect(url.searchParams.get('q')).toBe('8 bd du port')
    expect(url.searchParams.get('limit')).toBe('5')
    expect(url.searchParams.get('autocomplete')).toBe('1')
  })
})

describe('toAddress', () => {
  it('garde le libellé, le code postal, la ville, la position (lat, lon) et l’identifiant', () => {
    expect(toAddress(feature)).toEqual({
      label: '8 Boulevard du Port 80000 Amiens',
      postcode: '80000',
      city: 'Amiens',
      latitude: 49.897442,
      longitude: 2.290084,
      banId: '80021_6590_00008',
    })
  })

  it('écarte un résultat mal formé plutôt que d’enregistrer une position fausse', () => {
    expect(toAddress({ ...feature, geometry: { coordinates: ['2.29', 49.8] } })).toBeNull()
    expect(toAddress({ geometry: feature.geometry, properties: { label: 'X' } })).toBeNull()
    expect(toAddress({ ...feature, geometry: { coordinates: [200, 49.8] } })).toBeNull()
  })
})

describe('searchAddresses', () => {
  it('renvoie les adresses proposées', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ type: 'FeatureCollection', features: [feature, { broken: true }] }),
      )
    const results = await searchAddresses('8 bd du port', new AbortController().signal, fetchImpl)
    expect(results.map((address) => address.label)).toEqual(['8 Boulevard du Port 80000 Amiens'])
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit' })
  })

  it('signale un service qui refuse (429) ou ne répond pas', async () => {
    const signal = new AbortController().signal
    await expect(
      searchAddresses(
        'amiens',
        signal,
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 429)),
      ),
    ).rejects.toEqual(new AddressServiceError(429))
    await expect(
      searchAddresses(
        'amiens',
        signal,
        vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fail')),
      ),
    ).rejects.toBeInstanceOf(AddressServiceError)
  })

  it('laisse passer l’annulation d’une requête dépassée, sans la faire passer pour une panne', async () => {
    const controller = new AbortController()
    controller.abort()
    const abortError = new DOMException('aborted', 'AbortError')
    await expect(
      searchAddresses(
        'amiens',
        controller.signal,
        vi.fn<typeof fetch>().mockRejectedValue(abortError),
      ),
    ).rejects.toBe(abortError)
  })
})
