import {
  BACKUP_SCHEMA_VERSION,
  competitionBackupSchema,
  type CompetitionBackup,
} from '@climbcontest/contracts'
import { describe, expect, it } from 'vitest'

import { checkBackupIntegrity, remapIdsDeep, summarizeBackup } from './backup-import'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const NOW = '2026-09-19T10:00:00.000Z'

function validBackup(): CompetitionBackup {
  return competitionBackupSchema.parse({
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: NOW,
    competition: {
      name: 'Coupe',
      venue: 'Salle',
      startsOn: '2026-09-19',
      endsOn: '2026-09-19',
      discipline: 'difficulty',
      format: 'phases',
      scoringEngineId: 'ffme-difficulty-2026',
      scoringConfig: { routesCounted: 1 },
      status: 'running',
      timingEnabled: false,
      judgePinRequired: false,
      judgeCredentialsStored: true,
    },
    categories: [
      {
        id: uuid(1),
        label: 'U16',
        sex: 'X',
        birthYearMin: null,
        birthYearMax: null,
        displayOrder: 0,
        deletedAt: null,
      },
    ],
    competitors: [
      {
        id: uuid(2),
        categoryId: uuid(1),
        bib: 1,
        firstName: 'Léa',
        lastName: 'Martin',
        birthYear: null,
        clubName: null,
        licenseNumber: null,
        status: 'registered',
        deletedAt: null,
      },
      {
        id: uuid(3),
        categoryId: uuid(1),
        bib: 2,
        firstName: 'Zoé',
        lastName: 'Petit',
        birthYear: null,
        clubName: null,
        licenseNumber: null,
        status: 'registered',
        deletedAt: null,
      },
    ],
    routes: [
      {
        id: uuid(4),
        number: 1,
        name: null,
        holdCount: 40,
        sector: null,
        color: null,
        videoUrl: null,
        notes: null,
        deletedAt: null,
      },
    ],
    routeCategories: [{ routeId: uuid(4), categoryId: uuid(1) }],
    rounds: [
      {
        id: uuid(5),
        type: 'qualification',
        style: 'onsight',
        displayOrder: 0,
        qualifyingCount: 1,
        status: 'closed',
        deletedAt: null,
      },
    ],
    roundRoutes: [{ roundId: uuid(5), routeId: uuid(4), categoryId: uuid(1) }],
    roundQualifiers: [],
    judges: [{ id: uuid(6), displayName: 'Juge', routeIds: [uuid(4)], deletedAt: null }],
    ascents: [
      {
        id: uuid(7),
        roundId: uuid(5),
        routeId: uuid(4),
        competitorId: uuid(2),
        holdNumber: 30,
        holdCount: 40,
        modifier: 'none',
        isTop: false,
        status: 'valid',
        climbTimeMs: null,
        recordedBy: { kind: 'judge', judgeId: uuid(6) },
        recordedAt: NOW,
        syncedAt: NOW,
        deviceId: 'd',
        supersededBy: null,
        conflictGroup: null,
      },
    ],
    ascentEvents: [],
    activityLog: [],
  })
}

describe('checkBackupIntegrity', () => {
  it('accepte une sauvegarde cohérente', () => {
    expect(checkBackupIntegrity(validBackup())).toEqual([])
  })

  it('refuse deux compétiteurs au même dossard', () => {
    const backup = validBackup()
    backup.competitors[1]!.bib = 1
    expect(checkBackupIntegrity(backup)).toContain('Deux compétiteurs portent le même dossard : 1.')
  })

  it('accepte plusieurs compétiteurs sans dossard', () => {
    const backup = validBackup()
    backup.competitors[0]!.bib = null
    backup.competitors[1]!.bib = null
    expect(checkBackupIntegrity(backup)).toEqual([])
  })

  it('refuse deux voies au même numéro, deux catégories au même libellé, deux tours au même ordre', () => {
    const backup = validBackup()
    backup.routes.push({ ...backup.routes[0]!, id: uuid(40) })
    backup.categories.push({ ...backup.categories[0]!, id: uuid(10) })
    backup.rounds.push({ ...backup.rounds[0]!, id: uuid(50) })
    const errors = checkBackupIntegrity(backup)
    expect(errors).toContain('Deux voies portent le même numéro : 1.')
    expect(errors).toContain('Deux catégories portent le même libellé : « U16 ».')
    expect(errors).toContain('Deux tours portent le même ordre d’affichage : 0.')
  })

  it('refuse un compétiteur dont la catégorie est absente', () => {
    const backup = validBackup()
    backup.competitors[0]!.categoryId = uuid(99)
    expect(checkBackupIntegrity(backup).join(' ')).toContain('référence une catégorie absente')
  })

  it('refuse un passage qui référence un compétiteur, une voie ou un tour absent', () => {
    const backup = validBackup()
    backup.ascents[0]!.competitorId = uuid(99)
    expect(checkBackupIntegrity(backup).join(' ')).toContain('absent du fichier')
  })

  it('refuse un passage saisi par un juge absent', () => {
    const backup = validBackup()
    backup.ascents[0]!.recordedBy = { kind: 'judge', judgeId: uuid(99) }
    expect(checkBackupIntegrity(backup).join(' ')).toContain('juge absent')
  })

  it('accepte un passage saisi par un organisateur', () => {
    const backup = validBackup()
    backup.ascents[0]!.recordedBy = { kind: 'organizer' }
    expect(checkBackupIntegrity(backup)).toEqual([])
  })

  it.each([
    ['valid sans prise ni TOP', { status: 'valid' as const, holdNumber: null, isTop: false }],
    [
      'prise au-delà du nombre de prises de la voie',
      { status: 'valid' as const, holdNumber: 41, isTop: false },
    ],
    ['prise 0', { status: 'valid' as const, holdNumber: 0, isTop: false }],
    ['DNS avec une prise', { status: 'dns' as const, holdNumber: 5, isTop: false }],
    ['DNF marqué TOP', { status: 'dnf' as const, holdNumber: null, isTop: true }],
  ])('refuse un contenu de passage incohérent : %s', (_label, patch) => {
    const backup = validBackup()
    Object.assign(backup.ascents[0]!, patch)
    expect(checkBackupIntegrity(backup).join(' ')).toContain('contenu incohérent')
  })

  it('accepte un TOP, une prise bornée, et un DNS sans prise', () => {
    const backup = validBackup()
    Object.assign(backup.ascents[0]!, { holdNumber: null, isTop: true })
    expect(checkBackupIntegrity(backup)).toEqual([])
    Object.assign(backup.ascents[0]!, { holdNumber: 40, isTop: false })
    expect(checkBackupIntegrity(backup)).toEqual([])
    Object.assign(backup.ascents[0]!, { status: 'dns', holdNumber: null, isTop: false })
    expect(checkBackupIntegrity(backup)).toEqual([])
  })

  it('refuse un passage remplacé par un passage absent, ou par lui-même', () => {
    const backup = validBackup()
    backup.ascents[0]!.supersededBy = uuid(99)
    expect(checkBackupIntegrity(backup).join(' ')).toContain('remplacé par un passage absent')
    backup.ascents[0]!.supersededBy = backup.ascents[0]!.id
    expect(checkBackupIntegrity(backup).join(' ')).toContain('se remplace lui-même')
  })

  it('refuse deux passages ACTIFS pour le même compétiteur, tour et voie — mais pas un remplacé ou en conflit', () => {
    const backup = validBackup()
    const second = { ...backup.ascents[0]!, id: uuid(8) }
    backup.ascents.push(second)
    expect(checkBackupIntegrity(backup).join(' ')).toContain('Deux passages actifs')

    backup.ascents[0]!.supersededBy = second.id
    expect(checkBackupIntegrity(backup)).toEqual([])

    backup.ascents[0]!.supersededBy = null
    backup.ascents[0]!.conflictGroup = uuid(9)
    backup.ascents[1]!.conflictGroup = uuid(9)
    expect(checkBackupIntegrity(backup)).toEqual([])
  })

  it('refuse un juge assigné à une voie absente, et une liste de qualifiés qui référence un absent', () => {
    const backup = validBackup()
    backup.judges[0]!.routeIds = [uuid(99)]
    backup.roundQualifiers = [
      {
        roundId: uuid(5),
        categoryId: uuid(1),
        competitorId: uuid(99),
        sourceRoundId: uuid(5),
        sourceRank: 1,
        frozenAt: NOW,
      },
    ]
    const errors = checkBackupIntegrity(backup).join(' ')
    expect(errors).toContain('assigné à une voie absente')
    expect(errors).toContain('liste de qualifiés')
  })

  it('plafonne le nombre d’erreurs renvoyées', () => {
    const backup = validBackup()
    backup.ascents = Array.from({ length: 200 }, (_, i) => ({
      ...backup.ascents[0]!,
      id: uuid(1000 + i),
      competitorId: uuid(99),
    }))
    expect(checkBackupIntegrity(backup).length).toBeLessThanOrEqual(50)
  })
})

describe('competitionBackupSchema', () => {
  it('refuse un champ inconnu (jamais ignoré en silence)', () => {
    const backup = { ...validBackup(), surprise: true }
    expect(competitionBackupSchema.safeParse(backup).success).toBe(false)
  })

  it('refuse un champ secret glissé dans un juge', () => {
    const backup = validBackup()
    const tampered = { ...backup, judges: [{ ...backup.judges[0]!, accessTokenHash: 'abc' }] }
    expect(competitionBackupSchema.safeParse(tampered).success).toBe(false)
  })

  it('refuse un autre numéro de version', () => {
    expect(competitionBackupSchema.safeParse({ ...validBackup(), schemaVersion: 2 }).success).toBe(
      false,
    )
  })
})

describe('remapIdsDeep', () => {
  const mapping = new Map([
    [uuid(1), uuid(101)],
    [uuid(2), uuid(102)],
  ])

  it('remplace un identifiant connu, où qu’il soit dans la valeur', () => {
    const value = {
      a: uuid(1),
      list: [uuid(2), { deep: uuid(1) }],
      other: 'texte',
      n: 3,
      nul: null,
    }
    expect(remapIdsDeep(value, mapping)).toEqual({
      a: uuid(101),
      list: [uuid(102), { deep: uuid(101) }],
      other: 'texte',
      n: 3,
      nul: null,
    })
  })

  it('laisse intact un identifiant inconnu', () => {
    expect(remapIdsDeep({ a: uuid(9) }, mapping)).toEqual({ a: uuid(9) })
  })
})

describe('summarizeBackup', () => {
  it('compte ce qui sera créé et dit ce qui ne sera pas restauré tel quel', () => {
    const preview = summarizeBackup(validBackup())
    expect(preview.counts).toEqual({
      categories: 1,
      competitors: 2,
      routes: 1,
      rounds: 1,
      judges: 1,
      ascents: 1,
    })
    expect(preview.notices.join(' ')).toContain('révoqués')
    expect(preview.notices.join(' ')).toContain('vidéos téléversées')
  })
})
