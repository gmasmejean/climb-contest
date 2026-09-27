import type { Address } from '@climbcontest/contracts'
import { z } from 'zod'

/**
 * Géocodage par la Base Adresse Nationale, servie par la Géoplateforme de l'IGN
 * (ADR-088 : `api-adresse.data.gouv.fr` y redirige). Appelé directement depuis le
 * navigateur de l'organisateur — aucun appel sortant côté serveur (ADR-086
 * point 10). La CSP n'autorise que ce domaine (`connect-src`).
 */
export const BAN_SEARCH_URL = 'https://data.geopf.fr/geocodage/search'
export const BAN_RESULT_LIMIT = 5
/** Délai après la dernière frappe avant d'interroger le service (ADR-086 point 10). */
export const BAN_SEARCH_DELAY_MS = 300

/** Le service refuse (400) une requête de moins de 3 ou de plus de 200 caractères,
 * ou qui ne commence pas par une lettre ou un chiffre. */
const MIN_QUERY_LENGTH = 3
const MAX_QUERY_LENGTH = 200

export function normalizeBanQuery(text: string): string | null {
  const query = text
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim()
    .slice(0, MAX_QUERY_LENGTH)
  return query.length >= MIN_QUERY_LENGTH ? query : null
}

export function banSearchUrl(query: string): string {
  const params = new URLSearchParams({
    q: query,
    limit: String(BAN_RESULT_LIMIT),
    autocomplete: '1',
  })
  return `${BAN_SEARCH_URL}?${params.toString()}`
}

// Donnée externe : validée comme toute entrée à une frontière. On ne garde que
// ce qu'on utilise, le reste du GeoJSON est ignoré.
const banFeatureSchema = z.object({
  geometry: z.object({
    coordinates: z.tuple([z.number(), z.number()]),
  }),
  properties: z.object({
    label: z.string().min(1),
    id: z.string().min(1),
    postcode: z.string().optional(),
    city: z.string().optional(),
  }),
})

const banResponseSchema = z.object({ features: z.array(z.unknown()) })

export class AddressServiceError extends Error {
  constructor(readonly status: number | null) {
    super(status === null ? 'Service d’adresses injoignable' : `Service d’adresses : ${status}`)
    this.name = 'AddressServiceError'
  }
}

/** Un résultat BAN devient une adresse complète ; un résultat mal formé est écarté. */
export function toAddress(feature: unknown): Address | null {
  const parsed = banFeatureSchema.safeParse(feature)
  if (!parsed.success) return null
  const { geometry, properties } = parsed.data
  const [longitude, latitude] = geometry.coordinates
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  return {
    label: properties.label,
    postcode:
      properties.postcode && /^\d{5}$/.test(properties.postcode) ? properties.postcode : null,
    city: properties.city ?? null,
    latitude,
    longitude,
    banId: properties.id,
  }
}

export async function searchAddresses(
  query: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Address[]> {
  let response: Response
  try {
    response = await fetchImpl(banSearchUrl(query), { signal, credentials: 'omit' })
  } catch (error) {
    if (signal.aborted) throw error
    throw new AddressServiceError(null)
  }
  if (!response.ok) throw new AddressServiceError(response.status)
  const body = banResponseSchema.safeParse(await response.json().catch(() => null))
  if (!body.success) throw new AddressServiceError(response.status)
  return body.data.features.map(toAddress).filter((address): address is Address => address !== null)
}
