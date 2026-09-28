import { describe, expect, it } from 'vitest'

import { BACKUP_SCHEMA_VERSION, parseCompetitionBackup } from './backup'

const uuid = (n: number) => `0192f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`

const U16 = uuid(1)
const U18 = uuid(2)
const OPEN_ROUND = uuid(10)
const CLOSED_ROUND = uuid(11)
const DRAFT_ROUND = uuid(12)
const ROUTE = uuid(20)

function round(id: string, displayOrder: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: 'qualification',
    style: 'onsight',
    displayOrder,
    qualifyingCount: null,
    deletedAt: null,
    ...extra,
  }
}

/** Ce qu'écrivait l'application avant ADR-065 : le statut est sur le tour. */
function backupV1() {
  return {
    schemaVersion: 1,
    exportedAt: '2026-09-20T10:00:00.000Z',
    competition: {
      name: 'Coupe',
      venue: 'Salle',
      startsOn: '2026-09-20',
      endsOn: '2026-09-20',
      discipline: 'difficulty',
      format: 'phases',
      scoringEngineId: 'ffme-difficulty-2026',
      scoringConfig: {},
      status: 'running',
      timingEnabled: false,
      judgePinRequired: false,
      judgeCredentialsStored: true,
    },
    categories: [U16, U18].map((id, i) => ({
      id,
      label: i === 0 ? 'U16' : 'U18',
      sex: 'M',
      birthYearMin: null,
      birthYearMax: null,
      displayOrder: i,
      deletedAt: null,
    })),
    competitors: [],
    routes: [
      {
        id: ROUTE,
        number: 1,
        name: null,
        holdCount: 30,
        sector: null,
        color: null,
        videoUrl: null,
        notes: null,
        deletedAt: null,
      },
    ],
    routeCategories: [],
    rounds: [
      round(OPEN_ROUND, 0, { status: 'open' }),
      round(CLOSED_ROUND, 1, { status: 'closed' }),
      round(DRAFT_ROUND, 2, { status: 'draft' }),
    ],
    roundRoutes: [
      { roundId: OPEN_ROUND, routeId: ROUTE, categoryId: U16 },
      { roundId: OPEN_ROUND, routeId: ROUTE, categoryId: U18 },
      { roundId: CLOSED_ROUND, routeId: ROUTE, categoryId: U16 },
      { roundId: DRAFT_ROUND, routeId: ROUTE, categoryId: U18 },
    ],
    roundQualifiers: [],
    judges: [],
    ascents: [],
    ascentEvents: [],
    activityLog: [],
  }
}

describe('parseCompetitionBackup', () => {
  it('écrit la version 2', () => {
    expect(BACKUP_SCHEMA_VERSION).toBe(2)
  })

  it('remonte une sauvegarde v1 : le statut du tour est répliqué sur chacune de ses catégories', () => {
    const result = parseCompetitionBackup(backupV1())
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.schemaVersion).toBe(2)
    expect(result.data.roundCategories).toHaveLength(3)
    expect(result.data.roundCategories).toEqual(
      expect.arrayContaining([
        { roundId: OPEN_ROUND, categoryId: U16, status: 'open' },
        { roundId: OPEN_ROUND, categoryId: U18, status: 'open' },
        { roundId: CLOSED_ROUND, categoryId: U16, status: 'closed' },
      ]),
    )
  })

  it('un tour en brouillon n’écrit aucune ligne (ligne absente = brouillon)', () => {
    const result = parseCompetitionBackup(backupV1())
    expect(
      result.success && result.data.roundCategories.some((r) => r.roundId === DRAFT_ROUND),
    ).toBe(false)
  })

  it('les tours remontés n’ont plus de statut propre', () => {
    const result = parseCompetitionBackup(backupV1())
    expect(result.success).toBe(true)
    if (!result.success) return
    for (const r of result.data.rounds) expect('status' in r).toBe(false)
  })

  it('lit une sauvegarde v2 telle quelle', () => {
    const v1 = parseCompetitionBackup(backupV1())
    expect(v1.success).toBe(true)
    if (!v1.success) return
    const again = parseCompetitionBackup(JSON.parse(JSON.stringify(v1.data)))
    expect(again).toEqual({ success: true, data: v1.data })
  })

  it('refuse un statut de tour dans une sauvegarde v2 (champ inconnu, `.strict()`)', () => {
    const v1 = parseCompetitionBackup(backupV1())
    expect(v1.success).toBe(true)
    if (!v1.success) return
    const tampered = JSON.parse(JSON.stringify(v1.data)) as { rounds: Record<string, unknown>[] }
    tampered.rounds[0] = { ...tampered.rounds[0], status: 'open' }
    expect(parseCompetitionBackup(tampered).success).toBe(false)
  })

  it('lit une sauvegarde v2 d’avant l’adresse du lieu (ADR-089), et une avec adresse', () => {
    const v1 = parseCompetitionBackup(backupV1())
    expect(v1.success).toBe(true)
    if (!v1.success) return
    const withoutAddress = JSON.parse(JSON.stringify(v1.data)) as {
      competition: Record<string, unknown>
    }
    delete withoutAddress.competition['address']
    const old = parseCompetitionBackup(withoutAddress)
    expect(old.success).toBe(true)
    if (old.success) expect(old.data.competition.address).toBeUndefined()

    const address = {
      label: '8 Boulevard du Port 80000 Amiens',
      postcode: '80000',
      city: 'Amiens',
      latitude: 49.897442,
      longitude: 2.290084,
      banId: '80021_6590_00008',
    }
    const withAddress = {
      ...withoutAddress,
      competition: { ...withoutAddress.competition, address },
    }
    const parsed = parseCompetitionBackup(withAddress)
    expect(parsed.success && parsed.data.competition.address).toEqual(address)

    const halfPosition = {
      ...withoutAddress,
      competition: { ...withoutAddress.competition, address: { ...address, longitude: null } },
    }
    expect(parseCompetitionBackup(halfPosition).success).toBe(false)
  })

  it('refuse une version inconnue', () => {
    expect(parseCompetitionBackup({ ...backupV1(), schemaVersion: 3 }).success).toBe(false)
  })

  it('refuse ce qui n’est pas une sauvegarde', () => {
    expect(parseCompetitionBackup({ hello: 'world' }).success).toBe(false)
    expect(parseCompetitionBackup(null).success).toBe(false)
  })
})
