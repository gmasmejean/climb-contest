import { describe, expect, it } from 'vitest'

import {
  publicCategoryQuerySchema,
  publicCompetitionMetaSchema,
  publicRankingEntrySchema,
  publicRankingResponseSchema,
  publicRouteSchema,
  publicStreamEventSchema,
} from './public'

const uuid = '0189dcd5-5311-7d40-8db0-9496a2eef37b'
const otherUuid = '0189dcd5-5311-7d40-8db0-9496a2eef37c'

describe('publicCategoryQuerySchema', () => {
  it('refuse un identifiant de catégorie mal formé', () => {
    expect(publicCategoryQuerySchema.safeParse({ category: 'pas-un-uuid' }).success).toBe(false)
  })
})

describe('publicCompetitionMetaSchema', () => {
  const valid = {
    competition: {
      id: uuid,
      slug: 'abc123',
      name: 'Coupe du club',
      venue: 'Salle Roc',
      address: null,
      startsOn: '2026-05-01',
      endsOn: '2026-05-01',
      format: 'contest',
      status: 'running',
    },
    organization: {
      name: 'Club Roc',
      type: 'club',
      description: null,
      contactEmail: 'contact@club-roc.test',
      contactPhone: null,
      websiteUrl: null,
      address: {
        label: '8 Boulevard du Port 80000 Amiens',
        postcode: '80000',
        city: 'Amiens',
        latitude: 49.897442,
        longitude: 2.290084,
      },
      photos: [{ id: uuid, altText: 'Le mur principal' }],
    },
    categories: [{ id: uuid, label: 'U16 Femme', displayOrder: 0 }],
    rounds: [],
  }

  it('accepte des métadonnées complètes', () => {
    expect(publicCompetitionMetaSchema.safeParse(valid).success).toBe(true)
  })

  it("refuse un format de compétition inconnu (garantit qu'on ne dérive pas silencieusement)", () => {
    const result = publicCompetitionMetaSchema.safeParse({
      ...valid,
      competition: { ...valid.competition, format: 'ligue' },
    })
    expect(result.success).toBe(false)
  })

  it('refuse un champ de trop dans l’encart organisation (pas d’identifiant BAN, pas de slug)', () => {
    const withBanId = {
      ...valid,
      organization: {
        ...valid.organization,
        address: { ...valid.organization.address, banId: '80021_6590_00008' },
      },
    }
    expect(publicCompetitionMetaSchema.safeParse(withBanId).success).toBe(false)
    const withSlug = { ...valid, organization: { ...valid.organization, slug: 'club-roc' } }
    expect(publicCompetitionMetaSchema.safeParse(withSlug).success).toBe(false)
    const withStorageKey = {
      ...valid,
      organization: {
        ...valid.organization,
        photos: [{ id: uuid, altText: null, storageKey: 'organizations/x/photos/y' }],
      },
    }
    expect(publicCompetitionMetaSchema.safeParse(withStorageKey).success).toBe(false)
  })
})

describe('publicRouteSchema — aucune donnée organisateur', () => {
  it('accepte une voie publique sans notes ni videoAssetId', () => {
    const result = publicRouteSchema.safeParse({
      id: uuid,
      number: 3,
      name: 'Le toit',
      holdCount: 40,
      sector: 'Mur nord',
      color: 'rouge',
      videoUrl: 'https://youtu.be/abc123',
      hasUploadedVideo: false,
    })
    expect(result.success).toBe(true)
  })

  it('annonce une vidéo téléversée par un simple booléen, jamais l’identifiant interne de l’asset (Lot 9)', () => {
    const route = {
      id: uuid,
      number: 3,
      name: null,
      holdCount: 40,
      sector: null,
      color: null,
      videoUrl: null,
      hasUploadedVideo: true,
    }
    expect(publicRouteSchema.safeParse(route).success).toBe(true)
    expect(publicRouteSchema.safeParse({ ...route, videoAssetId: otherUuid }).success).toBe(false)
    expect(publicRouteSchema.safeParse({ ...route, hasUploadedVideo: undefined }).success).toBe(
      false,
    )
  })

  it('rejette les champs inconnus (aucune fuite de champ organisateur)', () => {
    const result = publicRouteSchema.safeParse({
      id: uuid,
      number: 3,
      name: null,
      holdCount: 40,
      sector: null,
      color: null,
      videoUrl: null,
      hasUploadedVideo: false,
      notes: 'commentaire interne organisateur',
    })
    expect(result.success).toBe(false)
  })
})

describe('publicRankingEntrySchema — aucune PII au-delà de SPEC.md §6.4', () => {
  const validEntry = {
    rank: 1,
    bib: 47,
    firstName: 'Léa',
    lastName: 'Martin',
    club: 'Club Demo',
    reachedRoundId: uuid,
    rounds: [
      {
        roundId: uuid,
        roundType: 'qualification',
        combinedRank: 1,
        routes: [
          {
            routeId: otherUuid,
            routeNumber: 1,
            routeName: null,
            holdNumber: 25,
            modifier: 'plus',
            isTop: false,
            status: 'valid',
            routeRank: 1,
          },
        ],
      },
    ],
  }

  it('accepte une entrée de classement complète', () => {
    expect(publicRankingEntrySchema.safeParse(validEntry).success).toBe(true)
  })

  it("rejette un champ hors liste — jamais d'année de naissance ou de licence", () => {
    const result = publicRankingEntrySchema.safeParse({
      ...validEntry,
      birthYear: 2010,
      licenseNumber: '123456',
    })
    expect(result.success).toBe(false)
  })
})

describe('publicRankingResponseSchema', () => {
  it('accepte une réponse « pas encore démarré »', () => {
    const result = publicRankingResponseSchema.safeParse({
      categoryId: uuid,
      started: false,
      provisional: false,
      generatedAt: new Date().toISOString(),
      entries: [],
    })
    expect(result.success).toBe(true)
  })
})

describe('publicStreamEventSchema', () => {
  it('accepte les trois types d’événement (SPEC.md §7, corrigé — ROADMAP.md Lot 7)', () => {
    expect(
      publicStreamEventSchema.safeParse({
        type: 'ranking_updated',
        competitionId: uuid,
        categoryId: otherUuid,
      }).success,
    ).toBe(true)
    expect(
      publicStreamEventSchema.safeParse({
        type: 'round_status_changed',
        competitionId: uuid,
        roundId: otherUuid,
        categoryIds: [uuid],
      }).success,
    ).toBe(true)
    // ADR-065 : sans les catégories touchées, le client ne saurait pas quoi rafraîchir.
    expect(
      publicStreamEventSchema.safeParse({
        type: 'round_status_changed',
        competitionId: uuid,
        roundId: otherUuid,
      }).success,
    ).toBe(false)
    expect(
      publicStreamEventSchema.safeParse({
        type: 'route_updated',
        competitionId: uuid,
        routeId: otherUuid,
      }).success,
    ).toBe(true)
  })

  it('rejette un type d’événement inconnu', () => {
    const result = publicStreamEventSchema.safeParse({
      type: 'competitor_updated',
      competitionId: uuid,
    })
    expect(result.success).toBe(false)
  })
})
