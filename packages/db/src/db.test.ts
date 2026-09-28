import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { sql } from 'drizzle-orm'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDatabase, type DatabaseHandle } from './client'
import { applyPendingMigrations, revertLastMigrations } from './migrate-shared'
import {
  ascent,
  asset,
  category,
  competition,
  competitor,
  organization,
  organizationPhoto,
  round,
  route,
  user,
} from './schema'

let container: StartedPostgreSqlContainer
let handle: DatabaseHandle

async function withRawClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: container.getConnectionUri() })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16.15-alpine').start()
  await withRawClient((client) => applyPendingMigrations(client))
  handle = createDatabase(container.getConnectionUri())
}, 180_000)

afterAll(async () => {
  await handle.close()
  await container.stop()
})

async function insertOrganizationAndUser() {
  const [demoOrganization] = await handle.db
    .insert(organization)
    .values({ name: 'Club Test', slug: `club-test-${crypto.randomUUID()}` })
    .returning()
  if (!demoOrganization) throw new Error('organization insert failed')
  const [demoUser] = await handle.db
    .insert(user)
    .values({
      organizationId: demoOrganization.id,
      email: `${crypto.randomUUID()}@test.local`,
      displayName: 'Test',
      role: 'owner',
    })
    .returning()
  if (!demoUser) throw new Error('user insert failed')
  return { demoOrganization, demoUser }
}

describe('migrations', () => {
  it('créent toutes les tables du schéma', async () => {
    const result = await handle.db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' and table_name != '_migrations_applied'`,
    )
    const tableNames = result.rows.map((row) => (row as { table_name: string }).table_name)
    expect(tableNames.sort()).toEqual(
      [
        'activity_log',
        'ascent',
        'ascent_event',
        'asset',
        'asset_upload',
        'category',
        'competition',
        'competition_deletion_log',
        'competitor',
        'judge',
        'judge_route',
        'organization',
        'organization_member_log',
        'organization_photo',
        'round',
        'round_category',
        'round_qualifier',
        'round_route',
        'route',
        'route_category',
        'session',
        'user',
      ].sort(),
    )
  })

  it('sont réversibles (down puis up ne changent rien au jeu de tables)', async () => {
    await withRawClient(async (client) => {
      // steps volontairement plus grand que le nombre de migrations
      // appliquées : revertLastMigrations s'arrête dès qu'il n'y en a plus
      // (LIMIT), donc ce test reste correct sans être mis à jour à chaque
      // nouvelle migration ajoutée.
      const reverted = await revertLastMigrations(client, 50)
      expect(reverted.length).toBeGreaterThan(0)

      const afterDown = await client.query(
        "select table_name from information_schema.tables where table_schema = 'public' and table_name != '_migrations_applied'",
      )
      expect(afterDown.rows).toHaveLength(0)

      const applied = await applyPendingMigrations(client)
      expect(applied.length).toBeGreaterThan(0)

      const afterUp = await client.query(
        "select table_name from information_schema.tables where table_schema = 'public' and table_name != '_migrations_applied'",
      )
      expect(afterUp.rows.length).toBe(22)
    })
  })
})

// Doit tourner avant les tests suivants : ils insèrent des compétiteurs avec
// `bib = null`, ce que le `down` de cette migration (SET NOT NULL) refuserait.
//
// Revert un cran à la fois plutôt qu'un nombre de crans fixe : la migration
// 0001 n'est plus forcément la dernière (voir migration 0002 plus haut), donc
// on s'arrête dès que son effet (bib redevient NOT NULL) est observé, quel
// que soit le nombre de migrations ajoutées par-dessus depuis — même
// philosophie que le test « sont réversibles » ci-dessus.
describe('migration 0001_competitor_bib_nullable (ADR-022)', () => {
  it('est réversible : le down réapplique NOT NULL, le up la retire', async () => {
    await withRawClient(async (client) => {
      const columnNullable = async () => {
        const result = await client.query<{ is_nullable: string }>(
          "select is_nullable from information_schema.columns where table_name = 'competitor' and column_name = 'bib'",
        )
        return result.rows[0]?.is_nullable === 'YES'
      }

      expect(await columnNullable()).toBe(true)

      const reverted: string[] = []
      while (await columnNullable()) {
        const [name] = await revertLastMigrations(client, 1)
        if (!name)
          throw new Error('Plus de migration à annuler avant 0001_competitor_bib_nullable.')
        reverted.push(name)
      }
      expect(reverted.at(-1)).toBe('0001_competitor_bib_nullable.sql')
      expect(await columnNullable()).toBe(false)

      const applied = await applyPendingMigrations(client)
      expect(applied).toEqual([...reverted].reverse())
      expect(await columnNullable()).toBe(true)
    })
  })
})

// Doit tourner avant les tests suivants : le down de cette migration remet
// `judge.pin_hash` en NOT NULL, ce qui casserait toute insertion de juge sans
// PIN — même stratégie de revert « un cran à la fois » que le bloc 0001
// ci-dessus.
describe('migration 0002_judge_pin_optional (DECISIONS.md ADR-026)', () => {
  it('est réversible : le down remet pin_hash et judge_pin_required, le up les retire', async () => {
    await withRawClient(async (client) => {
      const pinHashNullable = async () => {
        const result = await client.query<{ is_nullable: string }>(
          "select is_nullable from information_schema.columns where table_name = 'judge' and column_name = 'pin_hash'",
        )
        return result.rows[0]?.is_nullable === 'YES'
      }
      const judgePinRequiredExists = async () => {
        const result = await client.query(
          "select column_name from information_schema.columns where table_name = 'competition' and column_name = 'judge_pin_required'",
        )
        return result.rows.length > 0
      }

      expect(await pinHashNullable()).toBe(true)
      expect(await judgePinRequiredExists()).toBe(true)

      const reverted: string[] = []
      while (await pinHashNullable()) {
        const [name] = await revertLastMigrations(client, 1)
        if (!name) throw new Error('Plus de migration à annuler avant 0002_judge_pin_optional.')
        reverted.push(name)
      }
      expect(reverted.at(-1)).toBe('0002_judge_pin_optional.sql')
      expect(await pinHashNullable()).toBe(false)
      expect(await judgePinRequiredExists()).toBe(false)

      const applied = await applyPendingMigrations(client)
      expect(applied).toEqual([...reverted].reverse())
      expect(await pinHashNullable()).toBe(true)
      expect(await judgePinRequiredExists()).toBe(true)
    })
  })
})

describe('migration 0003_judge_credentials_plaintext (DECISIONS.md ADR-027)', () => {
  it('est réversible : le down retire les colonnes en clair, le up les recrée', async () => {
    await withRawClient(async (client) => {
      const columnExists = async (table: string, column: string) => {
        const result = await client.query(
          'select column_name from information_schema.columns where table_name = $1 and column_name = $2',
          [table, column],
        )
        return result.rows.length > 0
      }
      const allColumnsExist = async () =>
        (await columnExists('judge', 'access_token_plain')) &&
        (await columnExists('judge', 'pin_plain')) &&
        (await columnExists('competition', 'judge_credentials_stored'))

      expect(await allColumnsExist()).toBe(true)

      const reverted: string[] = []
      while (await allColumnsExist()) {
        const [name] = await revertLastMigrations(client, 1)
        if (!name)
          throw new Error('Plus de migration à annuler avant 0003_judge_credentials_plaintext.')
        reverted.push(name)
      }
      expect(reverted.at(-1)).toBe('0003_judge_credentials_plaintext.sql')
      expect(await columnExists('judge', 'access_token_plain')).toBe(false)
      expect(await columnExists('judge', 'pin_plain')).toBe(false)
      expect(await columnExists('competition', 'judge_credentials_stored')).toBe(false)

      const applied = await applyPendingMigrations(client)
      expect(applied).toEqual([...reverted].reverse())
      expect(await allColumnsExist()).toBe(true)
    })
  })
})

describe('migration 0008_lot9_competition_purged_at (ADR-051)', () => {
  it('est réversible : le down retire competition.purged_at, le up la rétablit, nulle par défaut', async () => {
    await withRawClient(async (client) => {
      const hasColumn = async () => {
        const result = await client.query(
          "select 1 from information_schema.columns where table_name = 'competition' and column_name = 'purged_at'",
        )
        return result.rows.length === 1
      }
      expect(await hasColumn()).toBe(true)

      // Un cran à la fois : on s'arrête dès que la colonne a disparu, quel que
      // soit le nombre de migrations ajoutées par-dessus depuis.
      let guard = 0
      while (await hasColumn()) {
        expect((await revertLastMigrations(client, 1)).length).toBe(1)
        guard += 1
        expect(guard).toBeLessThan(20)
      }
      expect(await hasColumn()).toBe(false)

      await applyPendingMigrations(client)
      expect(await hasColumn()).toBe(true)
      const nullable = await client.query(
        "select is_nullable, column_default from information_schema.columns where table_name = 'competition' and column_name = 'purged_at'",
      )
      expect(nullable.rows[0]).toMatchObject({ is_nullable: 'YES', column_default: null })
    })
  })
})

describe('migration 0009_lot11_competition_deletion_log (ADR-063)', () => {
  async function hasTable(client: pg.Client): Promise<boolean> {
    const result = await client.query(
      "select 1 from information_schema.tables where table_name = 'competition_deletion_log'",
    )
    return result.rows.length === 1
  }

  it('garde une trace même quand la compétition n’existe plus (pas de clé étrangère)', async () => {
    const { demoOrganization, demoUser } = await insertOrganizationAndUser()
    await handle.db.execute(sql`
      insert into competition_deletion_log (id, competition_id, organization_id, competition_name, action, actor_user_id)
      values (gen_random_uuid(), gen_random_uuid(), ${demoOrganization.id}, 'Coupe supprimée', 'deleted', ${demoUser.id})
    `)
    const rows = await handle.db.execute(
      sql`select action from competition_deletion_log where organization_id = ${demoOrganization.id}`,
    )
    expect(rows.rows).toEqual([{ action: 'deleted' }])
  })

  it('refuse une action inconnue', async () => {
    const { demoOrganization, demoUser } = await insertOrganizationAndUser()
    await expect(
      handle.db.execute(sql`
        insert into competition_deletion_log (id, competition_id, organization_id, competition_name, action, actor_user_id)
        values (gen_random_uuid(), gen_random_uuid(), ${demoOrganization.id}, 'Coupe', 'exploded', ${demoUser.id})
      `),
    ).rejects.toThrow()
  })

  it('est réversible : le down supprime la table, le up la recrée vide', async () => {
    await withRawClient(async (client) => {
      expect(await hasTable(client)).toBe(true)

      // Un cran à la fois, comme pour la migration 0008.
      let guard = 0
      while (await hasTable(client)) {
        expect((await revertLastMigrations(client, 1)).length).toBe(1)
        guard += 1
        expect(guard).toBeLessThan(20)
      }
      expect(await hasTable(client)).toBe(false)

      await applyPendingMigrations(client)
      expect(await hasTable(client)).toBe(true)
      const count = await client.query('select count(*)::int as n from competition_deletion_log')
      expect(count.rows[0]).toEqual({ n: 0 })
    })
  })
})

describe('migration 0010_lot12_round_category (ADR-065)', () => {
  // Compétition et catégories écrites par Drizzle, donc AVANT d'annuler les
  // migrations : une fois 0014 annulée, la table s'appelle de nouveau `club` et
  // le schéma Drizzle (`organization`) ne sait plus y écrire.
  async function seedCompetitionAndCategories() {
    const { demoOrganization, demoUser } = await insertOrganizationAndUser()
    const [comp] = await handle.db
      .insert(competition)
      .values({
        organizationId: demoOrganization.id,
        name: 'Migration 0010',
        venue: 'Salle',
        startsOn: '2026-01-01',
        endsOn: '2026-01-01',
        format: 'phases',
        scoringEngineId: 'ffme-difficulty-2026',
        publicSlug: crypto.randomUUID(),
        createdBy: demoUser.id,
      })
      .returning()
    if (!comp) throw new Error('competition insert failed')
    const [u16, u18] = await handle.db
      .insert(category)
      .values([
        { competitionId: comp.id, label: 'U16', sex: 'M', displayOrder: 0 },
        { competitionId: comp.id, label: 'U18', sex: 'M', displayOrder: 1 },
      ])
      .returning()
    if (!u16 || !u18) throw new Error('category insert failed')
    return { comp, u16, u18 }
  }

  // Deux catégories, trois tours : `open` (U16 + U18), `closed` (U16 seulement),
  // `draft` (U18). Écrit avec `round.status`, donc AVANT la migration 0010.
  async function seedOldSchemaRounds(
    client: pg.Client,
    { comp, u16, u18 }: Awaited<ReturnType<typeof seedCompetitionAndCategories>>,
  ) {
    // SQL brut : à ce stade 0011 est annulée, or le schéma Drizzle sait déjà
    // écrire `photo_asset_id` / `photo_holds`, colonnes qui n'existent pas encore.
    const routeInsert = await client.query<{ id: string }>(
      'insert into route (id, competition_id, number, hold_count) values ($1, $2, 1, 30) returning id',
      [crypto.randomUUID(), comp.id],
    )
    const routeRow = routeInsert.rows[0]
    if (!routeRow) throw new Error('fixture insert failed')

    async function insertRound(order: number, type: string, status: string, categoryIds: string[]) {
      const roundId = crypto.randomUUID()
      await client.query(
        `insert into round (id, competition_id, type, style, display_order, status)
         values ($1, $2, $3, 'onsight', $4, $5)`,
        [roundId, comp.id, type, order, status],
      )
      for (const categoryId of categoryIds) {
        await client.query(
          'insert into round_route (round_id, route_id, category_id) values ($1, $2, $3)',
          [roundId, routeRow?.id, categoryId],
        )
      }
      return roundId
    }
    const openId = await insertRound(0, 'qualification', 'open', [u16.id, u18.id])
    const closedId = await insertRound(1, 'semifinal', 'closed', [u16.id])
    const draftId = await insertRound(2, 'final', 'draft', [u18.id])
    return { openId, closedId, draftId, u16, u18 }
  }

  it('le up réplique l’ancien statut sur chaque catégorie du tour, le down garde `open` en priorité', async () => {
    const fixture = await seedCompetitionAndCategories()
    await withRawClient(async (client) => {
      // 0011 (Lot 15), 0012 (Lot 21), 0013 (juge, ADR-081), 0014
      // (organisation, ADR-086), 0015 (membres, ADR-087), 0016 (fiche,
      // ADR-088), 0017 (lieu, ADR-089) et 0018 (photos, ADR-090) ont été
      // posées par-dessus 0010 : neuf crans. À réviser si une migration est
      // ajoutée après 0018.
      expect(await revertLastMigrations(client, 9)).toEqual([
        '0018_lot27_organization_photos.sql',
        '0017_lot26_competition_address.sql',
        '0016_lot25_organization_profile.sql',
        '0015_lot24_members.sql',
        '0014_lot23_rename_club_to_organization.sql',
        '0013_judge_email.sql',
        '0012_lot21_ascent_voided_at.sql',
        '0011_lot15_route_photo.sql',
        '0010_lot12_round_category.sql',
      ])
      const { openId, closedId, draftId, u16, u18 } = await seedOldSchemaRounds(client, fixture)

      await applyPendingMigrations(client)
      const { rows: migrated } = await client.query<{
        round_id: string
        category_id: string
        status: string
      }>('select round_id, category_id, status from round_category where round_id = any($1)', [
        [openId, closedId, draftId],
      ])
      // Un tour en brouillon n'écrit rien : ligne absente = brouillon.
      expect(migrated).toHaveLength(3)
      expect(migrated).toEqual(
        expect.arrayContaining([
          { round_id: openId, category_id: u16.id, status: 'open' },
          { round_id: openId, category_id: u18.id, status: 'open' },
          { round_id: closedId, category_id: u16.id, status: 'closed' },
        ]),
      )
      const statusColumn = await client.query(
        "select 1 from information_schema.columns where table_name = 'round' and column_name = 'status'",
      )
      expect(statusColumn.rows).toHaveLength(0)

      // Le tour ouvert diverge : U16 fermée, U18 ouverte → le down doit garder `open`.
      await client.query(
        "update round_category set status = 'closed' where round_id = $1 and category_id = $2",
        [openId, u16.id],
      )
      await revertLastMigrations(client, 9)
      const back = await client.query<{ id: string; status: string }>(
        'select id, status from round where id = any($1)',
        [[openId, closedId, draftId]],
      )
      expect(new Map(back.rows.map((row) => [row.id, row.status]))).toEqual(
        new Map([
          [openId, 'open'],
          [closedId, 'closed'],
          [draftId, 'draft'],
        ]),
      )

      // On laisse la base au dernier état pour les tests suivants.
      await applyPendingMigrations(client)
    })
  })

  it('refuse un statut inconnu sur round_category', async () => {
    const { demoOrganization, demoUser } = await insertOrganizationAndUser()
    const [comp] = await handle.db
      .insert(competition)
      .values({
        organizationId: demoOrganization.id,
        name: 'Statut inconnu',
        venue: 'Salle',
        startsOn: '2026-01-01',
        endsOn: '2026-01-01',
        format: 'phases',
        scoringEngineId: 'ffme-difficulty-2026',
        publicSlug: crypto.randomUUID(),
        createdBy: demoUser.id,
      })
      .returning()
    if (!comp) throw new Error('competition insert failed')
    const [cat] = await handle.db
      .insert(category)
      .values({ competitionId: comp.id, label: 'U16', sex: 'M', displayOrder: 0 })
      .returning()
    const [roundRow] = await handle.db
      .insert(round)
      .values({ competitionId: comp.id, type: 'qualification', style: 'onsight', displayOrder: 0 })
      .returning()
    if (!cat || !roundRow) throw new Error('fixture insert failed')

    await expect(
      handle.db.execute(sql`
        insert into round_category (round_id, category_id, status)
        values (${roundRow.id}, ${cat.id}, 'exploded')
      `),
    ).rejects.toThrow()
  })
})

describe('migration 0011_lot15_route_photo (ADR-066)', () => {
  async function seedRouteWithPhoto() {
    const { demoOrganization, demoUser } = await insertOrganizationAndUser()
    const [comp] = await handle.db
      .insert(competition)
      .values({
        organizationId: demoOrganization.id,
        name: 'Migration 0011',
        venue: 'Salle',
        startsOn: '2026-01-01',
        endsOn: '2026-01-01',
        format: 'contest',
        scoringEngineId: 'ffme-difficulty-2026',
        publicSlug: crypto.randomUUID(),
        createdBy: demoUser.id,
      })
      .returning()
    if (!comp) throw new Error('competition insert failed')
    const [photo] = await handle.db
      .insert(asset)
      .values({
        competitionId: comp.id,
        kind: 'route_photo',
        storageKey: `competitions/${comp.id}/photos/test`,
        mimeType: 'image/jpeg',
        sizeBytes: 1234,
        uploadedBy: demoUser.id,
      })
      .returning()
    if (!photo) throw new Error('asset insert failed')
    const [routeRow] = await handle.db
      .insert(route)
      .values({
        competitionId: comp.id,
        number: 1,
        holdCount: 3,
        photoAssetId: photo.id,
        photoHolds: [{ number: 1, x: 0.5, y: 0.9 }],
      })
      .returning()
    if (!routeRow) throw new Error('route insert failed')
    return { comp, demoUser, photo, routeRow }
  }

  it('accepte une photo et son annotation, refuse un type d\'asset inconnu', async () => {
    const { comp, demoUser, routeRow } = await seedRouteWithPhoto()
    expect(routeRow.photoHolds).toEqual([{ number: 1, x: 0.5, y: 0.9 }])

    await expect(
      handle.db.insert(asset).values({
        competitionId: comp.id,
        kind: 'audio',
        storageKey: 'competitions/x/audio/1',
        mimeType: 'audio/mpeg',
        sizeBytes: 1,
        uploadedBy: demoUser.id,
      }),
    ).rejects.toThrow()
  })

  it('est réversible : le down retire les colonnes et les assets route_photo, le up les rétablit', async () => {
    await seedRouteWithPhoto()
    await withRawClient(async (client) => {
      const hasColumn = async (name: string) => {
        const result = await client.query(
          "select 1 from information_schema.columns where table_name = 'route' and column_name = $1",
          [name],
        )
        return result.rows.length === 1
      }
      const photoAssetCount = async () => {
        const result = await client.query<{ count: string }>(
          "select count(*) from asset where kind = 'route_photo'",
        )
        return Number(result.rows[0]?.count)
      }
      expect(await hasColumn('photo_asset_id')).toBe(true)
      expect(await hasColumn('photo_holds')).toBe(true)
      expect(await photoAssetCount()).toBeGreaterThan(0)

      let guard = 0
      while (await hasColumn('photo_asset_id')) {
        expect((await revertLastMigrations(client, 1)).length).toBe(1)
        guard += 1
        expect(guard).toBeLessThan(20)
      }
      expect(await hasColumn('photo_holds')).toBe(false)
      // Perte assumée du down : les assets route_photo sont supprimés.
      expect(await photoAssetCount()).toBe(0)
      // Le CHECK d'avant refuse de nouveau le type route_photo.
      await expect(
        client.query(
          `insert into asset (competition_id, kind, storage_key, mime_type, size_bytes, uploaded_by)
           select id, 'route_photo', 'k', 'image/jpeg', 1, created_by from competition limit 1`,
        ),
      ).rejects.toThrow()

      await applyPendingMigrations(client)
      expect(await hasColumn('photo_asset_id')).toBe(true)
      expect(await hasColumn('photo_holds')).toBe(true)
    })
  })
})

describe('migration 0012_lot21_ascent_voided_at (ADR-078)', () => {
  it('est réversible : le down retire ascent.voided_at, le up la rétablit, nulle par défaut', async () => {
    await withRawClient(async (client) => {
      const hasColumn = async () => {
        const result = await client.query(
          "select 1 from information_schema.columns where table_name = 'ascent' and column_name = 'voided_at'",
        )
        return result.rows.length === 1
      }
      expect(await hasColumn()).toBe(true)

      let guard = 0
      while (await hasColumn()) {
        expect((await revertLastMigrations(client, 1)).length).toBe(1)
        guard += 1
        expect(guard).toBeLessThan(20)
      }

      await applyPendingMigrations(client)
      expect(await hasColumn()).toBe(true)
      const nullable = await client.query(
        "select is_nullable, column_default from information_schema.columns where table_name = 'ascent' and column_name = 'voided_at'",
      )
      expect(nullable.rows[0]).toMatchObject({ is_nullable: 'YES', column_default: null })
    })
  })
})

describe('migration 0013_judge_email (ADR-081)', () => {
  it('est réversible : le down retire judge.email, le up la rétablit, nulle', async () => {
    await withRawClient(async (client) => {
      const hasColumn = async () => {
        const result = await client.query(
          "select 1 from information_schema.columns where table_name = 'judge' and column_name = 'email'",
        )
        return result.rows.length === 1
      }
      expect(await hasColumn()).toBe(true)

      let guard = 0
      while (await hasColumn()) {
        expect((await revertLastMigrations(client, 1)).length).toBe(1)
        guard += 1
        expect(guard).toBeLessThan(20)
      }

      await applyPendingMigrations(client)
      expect(await hasColumn()).toBe(true)
      const nullable = await client.query(
        "select is_nullable from information_schema.columns where table_name = 'judge' and column_name = 'email'",
      )
      expect(nullable.rows[0]).toMatchObject({ is_nullable: 'YES' })
    })
  })
})

describe('migration 0014_lot23_rename_club_to_organization (ADR-086)', () => {
  it('est réversible sans perte : le down rend `club` et `club_id`, le up les renomme de nouveau', async () => {
    const { demoOrganization, demoUser } = await insertOrganizationAndUser()
    await withRawClient(async (client) => {
      const tableExists = async (name: string) =>
        (
          await client.query(
            "select 1 from information_schema.tables where table_schema = 'public' and table_name = $1",
            [name],
          )
        ).rows.length === 1
      const columnsNamed = async (name: string) =>
        (
          await client.query<{ table_name: string }>(
            "select table_name from information_schema.columns where table_schema = 'public' and column_name = $1 order by table_name",
            [name],
          )
        ).rows.map((row) => row.table_name)
      const owningTables = ['competition', 'competition_deletion_log', 'user']

      expect(await tableExists('organization')).toBe(true)
      expect(await columnsNamed('organization_id')).toEqual(
        expect.arrayContaining(owningTables),
      )

      // Un cran à la fois : 0014 n'est plus forcément la dernière migration.
      const reverted: string[] = []
      while (await tableExists('organization')) {
        reverted.push(...(await revertLastMigrations(client, 1)))
        expect(reverted.length).toBeLessThan(20)
      }
      expect(reverted.at(-1)).toBe('0014_lot23_rename_club_to_organization.sql')
      expect(await tableExists('club')).toBe(true)
      expect(await columnsNamed('club_id')).toEqual(owningTables)
      expect(await columnsNamed('organization_id')).toEqual([])
      const kept = await client.query('select u.id from "user" u join club c on c.id = u.club_id where u.id = $1', [
        demoUser.id,
      ])
      expect(kept.rows).toHaveLength(1)

      await applyPendingMigrations(client)
      expect(await tableExists('club')).toBe(false)
      expect(await columnsNamed('organization_id')).toEqual(
        expect.arrayContaining(owningTables),
      )
      const constraints = await client.query<{ conname: string }>(
        "select conname from pg_constraint where conname like '%club%' union all select indexname from pg_indexes where schemaname = 'public' and indexname like '%club%'",
      )
      expect(constraints.rows).toEqual([])
    })

    const [back] = await handle.db
      .select()
      .from(organization)
      .where(sql`${organization.id} = ${demoOrganization.id}`)
    expect(back?.slug).toBe(demoOrganization.slug)
  })
})

describe('migration 0015_lot24_members (ADR-087)', () => {
  it('refuse une action inconnue au journal des membres', async () => {
    const { demoOrganization, demoUser } = await insertOrganizationAndUser()
    await expect(
      handle.db.execute(sql`
        insert into organization_member_log (id, organization_id, actor_user_id, target_user_id, target_email, target_display_name, action)
        values (gen_random_uuid(), ${demoOrganization.id}, ${demoUser.id}, gen_random_uuid(), 'x@test.local', 'X', 'promoted')
      `),
    ).rejects.toThrow()
  })

  it('est réversible : le down retire le journal et user.deactivated_at, le up les rétablit', async () => {
    await withRawClient(async (client) => {
      const hasDeactivatedAt = async () =>
        (
          await client.query(
            "select 1 from information_schema.columns where table_name = 'user' and column_name = 'deactivated_at'",
          )
        ).rows.length === 1
      const hasLog = async () =>
        (
          await client.query(
            "select 1 from information_schema.tables where table_name = 'organization_member_log'",
          )
        ).rows.length === 1

      expect(await hasDeactivatedAt()).toBe(true)
      expect(await hasLog()).toBe(true)

      let guard = 0
      while (await hasLog()) {
        expect((await revertLastMigrations(client, 1)).length).toBe(1)
        guard += 1
        expect(guard).toBeLessThan(20)
      }
      expect(await hasDeactivatedAt()).toBe(false)

      await applyPendingMigrations(client)
      expect(await hasDeactivatedAt()).toBe(true)
      expect(await hasLog()).toBe(true)
    })
  })
})

describe('migration 0016_lot25_organization_profile (ADR-088)', () => {
  it('fait des organisations existantes des clubs et refuse un type inconnu', async () => {
    const { demoOrganization } = await insertOrganizationAndUser()
    expect(demoOrganization.type).toBe('club')
    await expect(
      handle.db.execute(
        sql`update organization set type = 'association' where id = ${demoOrganization.id}`,
      ),
    ).rejects.toThrow()
  })

  it('refuse une latitude sans longitude, hors bornes, ou une adresse sans libellé', async () => {
    const { demoOrganization } = await insertOrganizationAndUser()
    const attempt = (fields: Partial<typeof organization.$inferInsert>) =>
      handle.db
        .update(organization)
        .set(fields)
        .where(sql`${organization.id} = ${demoOrganization.id}`)
    await expect(attempt({ addressLabel: 'Amiens', latitude: 49.9 })).rejects.toThrow()
    await expect(
      attempt({ addressLabel: 'Amiens', latitude: 91, longitude: 2.3 }),
    ).rejects.toThrow()
    await expect(attempt({ postcode: '80000' })).rejects.toThrow()
    await expect(
      attempt({
        addressLabel: '8 Boulevard du Port 80000 Amiens',
        postcode: '80000',
        city: 'Amiens',
        latitude: 49.897442,
        longitude: 2.290084,
        banId: '80021_6590_00008',
      }),
    ).resolves.toBeDefined()
    // Saisie manuelle : le libellé seul, sans position (ADR-088 point 2).
    await expect(
      attempt({
        addressLabel: 'Gymnase Jules-Verne, Amiens',
        postcode: null,
        city: null,
        latitude: null,
        longitude: null,
        banId: null,
      }),
    ).resolves.toBeDefined()
  })

  it('est réversible : le down retire les colonnes de la fiche, le up les rétablit', async () => {
    const { demoOrganization } = await insertOrganizationAndUser()
    await withRawClient(async (client) => {
      const hasType = async () =>
        (
          await client.query(
            "select 1 from information_schema.columns where table_name = 'organization' and column_name = 'type'",
          )
        ).rows.length === 1

      expect(await hasType()).toBe(true)
      let guard = 0
      while (await hasType()) {
        expect((await revertLastMigrations(client, 1)).length).toBe(1)
        guard += 1
        expect(guard).toBeLessThan(20)
      }
      const { rows: profileColumns } = await client.query(
        "select column_name from information_schema.columns where table_name = 'organization' and column_name in ('description', 'address_label', 'latitude', 'ban_id')",
      )
      expect(profileColumns).toEqual([])
      const kept = await client.query('select slug from organization where id = $1', [
        demoOrganization.id,
      ])
      expect(kept.rows).toEqual([{ slug: demoOrganization.slug }])

      await applyPendingMigrations(client)
      expect(await hasType()).toBe(true)
    })
    const [back] = await handle.db
      .select()
      .from(organization)
      .where(sql`${organization.id} = ${demoOrganization.id}`)
    expect(back?.type).toBe('club')
  })
})

describe('migration 0017_lot26_competition_address (ADR-089)', () => {
  async function insertCompetition() {
    const { demoOrganization, demoUser } = await insertOrganizationAndUser()
    const [row] = await handle.db
      .insert(competition)
      .values({
        organizationId: demoOrganization.id,
        name: 'Comp',
        venue: 'Salle',
        startsOn: '2026-01-01',
        endsOn: '2026-01-01',
        format: 'contest',
        scoringEngineId: 'ffme-difficulty-2026',
        publicSlug: crypto.randomUUID(),
        createdBy: demoUser.id,
      })
      .returning()
    if (!row) throw new Error('competition insert failed')
    return row
  }

  it('une compétition n’a pas d’adresse par défaut ; les mêmes règles que l’organisation', async () => {
    const created = await insertCompetition()
    expect(created.addressLabel).toBeNull()
    const attempt = (fields: Partial<typeof competition.$inferInsert>) =>
      handle.db
        .update(competition)
        .set(fields)
        .where(sql`${competition.id} = ${created.id}`)
    await expect(attempt({ addressLabel: 'Amiens', longitude: 2.29 })).rejects.toThrow()
    await expect(attempt({ city: 'Amiens' })).rejects.toThrow()
    await expect(
      attempt({ addressLabel: '8 Boulevard du Port 80000 Amiens', latitude: 49.9, longitude: 2.29 }),
    ).resolves.toBeDefined()
  })

  it('est réversible : le down retire les colonnes d’adresse, le up les rétablit', async () => {
    const created = await insertCompetition()
    await withRawClient(async (client) => {
      const hasAddress = async () =>
        (
          await client.query(
            "select 1 from information_schema.columns where table_name = 'competition' and column_name = 'address_label'",
          )
        ).rows.length === 1

      expect(await hasAddress()).toBe(true)
      let guard = 0
      while (await hasAddress()) {
        expect((await revertLastMigrations(client, 1)).length).toBe(1)
        guard += 1
        expect(guard).toBeLessThan(20)
      }
      const kept = await client.query('select venue from competition where id = $1', [created.id])
      expect(kept.rows).toEqual([{ venue: 'Salle' }])

      await applyPendingMigrations(client)
      expect(await hasAddress()).toBe(true)
    })
  })
})

describe('migration 0018_lot27_organization_photos (ADR-090)', () => {
  const photoValues = (organizationId: string, uploadedBy: string) => ({
    organizationId,
    storageKey: `organizations/${organizationId}/photos/${crypto.randomUUID()}`,
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    position: 0,
    uploadedBy,
  })

  it('n’accepte que du JPEG, une taille et une position positives', async () => {
    const { demoOrganization, demoUser } = await insertOrganizationAndUser()
    const base = photoValues(demoOrganization.id, demoUser.id)
    const [created] = await handle.db.insert(organizationPhoto).values(base).returning()
    expect(created?.altText).toBeNull()
    expect(created?.deletedAt).toBeNull()
    await expect(
      handle.db.insert(organizationPhoto).values({ ...base, mimeType: 'image/png' }),
    ).rejects.toThrow()
    await expect(
      handle.db.insert(organizationPhoto).values({ ...base, sizeBytes: 0 }),
    ).rejects.toThrow()
    await expect(
      handle.db.insert(organizationPhoto).values({ ...base, position: -1 }),
    ).rejects.toThrow()
  })

  it('est réversible : le down retire la table, le up la rétablit', async () => {
    const { demoOrganization, demoUser } = await insertOrganizationAndUser()
    await handle.db.insert(organizationPhoto).values(photoValues(demoOrganization.id, demoUser.id))
    await withRawClient(async (client) => {
      const hasTable = async () =>
        (
          await client.query(
            "select 1 from information_schema.tables where table_name = 'organization_photo'",
          )
        ).rows.length === 1

      expect(await hasTable()).toBe(true)
      expect(await revertLastMigrations(client, 1)).toEqual(['0018_lot27_organization_photos.sql'])
      expect(await hasTable()).toBe(false)
      const kept = await client.query('select name from organization where id = $1', [
        demoOrganization.id,
      ])
      expect(kept.rows).toHaveLength(1)

      await applyPendingMigrations(client)
      expect(await hasTable()).toBe(true)
    })
  })
})

describe('contraintes et colonne calculée ascent', () => {
  async function setupAscentFixture() {
    const { demoOrganization, demoUser } = await insertOrganizationAndUser()
    const [demoCompetition] = await handle.db
      .insert(competition)
      .values({
        organizationId: demoOrganization.id,
        name: 'Comp',
        venue: 'Salle',
        startsOn: '2026-01-01',
        endsOn: '2026-01-01',
        format: 'contest',
        scoringEngineId: 'ffme-difficulty-2026',
        publicSlug: crypto.randomUUID(),
        createdBy: demoUser.id,
      })
      .returning()
    if (!demoCompetition) throw new Error('competition insert failed')
    const [demoCategory] = await handle.db
      .insert(category)
      .values({ competitionId: demoCompetition.id, label: 'U16 Homme', sex: 'M', displayOrder: 0 })
      .returning()
    if (!demoCategory) throw new Error('category insert failed')
    const [demoRound] = await handle.db
      .insert(round)
      .values({
        competitionId: demoCompetition.id,
        type: 'qualification',
        style: 'onsight',
        displayOrder: 0,
      })
      .returning()
    if (!demoRound) throw new Error('round insert failed')
    const [demoRoute] = await handle.db
      .insert(route)
      .values({ competitionId: demoCompetition.id, number: 1, holdCount: 40 })
      .returning()
    if (!demoRoute) throw new Error('route insert failed')
    const [demoCompetitor] = await handle.db
      .insert(competitor)
      .values({
        competitionId: demoCompetition.id,
        categoryId: demoCategory.id,
        bib: 1,
        firstName: 'A',
        lastName: 'B',
      })
      .returning()
    if (!demoCompetitor) throw new Error('competitor insert failed')

    return { demoUser, demoRound, demoRoute, demoCompetitor }
  }

  it('rejette un passage valide sans hauteur atteinte ni top', async () => {
    const { demoUser, demoRound, demoRoute, demoCompetitor } = await setupAscentFixture()

    await expect(
      handle.db.insert(ascent).values({
        id: crypto.randomUUID(),
        competitionId: demoRoute.competitionId,
        roundId: demoRound.id,
        routeId: demoRoute.id,
        competitorId: demoCompetitor.id,
        holdCount: demoRoute.holdCount,
        status: 'valid',
        isTop: false,
        recordedByUserId: demoUser.id,
        recordedAt: new Date(),
        deviceId: 'test',
      }),
    ).rejects.toThrow()
  })

  it('calcule score_value = hold_count + 1 pour un TOP', async () => {
    const { demoUser, demoRound, demoRoute, demoCompetitor } = await setupAscentFixture()

    const [inserted] = await handle.db
      .insert(ascent)
      .values({
        id: crypto.randomUUID(),
        competitionId: demoRoute.competitionId,
        roundId: demoRound.id,
        routeId: demoRoute.id,
        competitorId: demoCompetitor.id,
        holdCount: demoRoute.holdCount,
        status: 'valid',
        isTop: true,
        recordedByUserId: demoUser.id,
        recordedAt: new Date(),
        deviceId: 'test',
      })
      .returning()

    expect(inserted?.scoreValue).toBe(`${demoRoute.holdCount + 1}.0`)
  })

  it('calcule score_value = hold_number + 0.5 pour un modificateur +', async () => {
    const { demoUser, demoRound, demoRoute, demoCompetitor } = await setupAscentFixture()

    const [inserted] = await handle.db
      .insert(ascent)
      .values({
        id: crypto.randomUUID(),
        competitionId: demoRoute.competitionId,
        roundId: demoRound.id,
        routeId: demoRoute.id,
        competitorId: demoCompetitor.id,
        holdCount: demoRoute.holdCount,
        holdNumber: 25,
        modifier: 'plus',
        status: 'valid',
        isTop: false,
        recordedByUserId: demoUser.id,
        recordedAt: new Date(),
        deviceId: 'test',
      })
      .returning()

    expect(inserted?.scoreValue).toBe('25.5')
  })
})

describe('unicité compétiteur', () => {
  it('refuse deux compétiteurs avec le même dossard dans la même compétition', async () => {
    const { demoOrganization, demoUser } = await insertOrganizationAndUser()
    const [demoCompetition] = await handle.db
      .insert(competition)
      .values({
        organizationId: demoOrganization.id,
        name: 'Comp bib',
        venue: 'Salle',
        startsOn: '2026-01-01',
        endsOn: '2026-01-01',
        format: 'contest',
        scoringEngineId: 'ffme-difficulty-2026',
        publicSlug: crypto.randomUUID(),
        createdBy: demoUser.id,
      })
      .returning()
    if (!demoCompetition) throw new Error('competition insert failed')
    const [demoCategory] = await handle.db
      .insert(category)
      .values({ competitionId: demoCompetition.id, label: 'U16 Homme', sex: 'M', displayOrder: 0 })
      .returning()
    if (!demoCategory) throw new Error('category insert failed')

    await handle.db.insert(competitor).values({
      competitionId: demoCompetition.id,
      categoryId: demoCategory.id,
      bib: 1,
      firstName: 'A',
      lastName: 'B',
    })

    await expect(
      handle.db.insert(competitor).values({
        competitionId: demoCompetition.id,
        categoryId: demoCategory.id,
        bib: 1,
        firstName: 'C',
        lastName: 'D',
      }),
    ).rejects.toThrow()
  })

  it('autorise plusieurs compétiteurs sans dossard (bib null) dans la même compétition (ADR-022)', async () => {
    const { demoOrganization, demoUser } = await insertOrganizationAndUser()
    const [demoCompetition] = await handle.db
      .insert(competition)
      .values({
        organizationId: demoOrganization.id,
        name: 'Comp bib null',
        venue: 'Salle',
        startsOn: '2026-01-01',
        endsOn: '2026-01-01',
        format: 'contest',
        scoringEngineId: 'ffme-difficulty-2026',
        publicSlug: crypto.randomUUID(),
        createdBy: demoUser.id,
      })
      .returning()
    if (!demoCompetition) throw new Error('competition insert failed')
    const [demoCategory] = await handle.db
      .insert(category)
      .values({ competitionId: demoCompetition.id, label: 'U16 Homme', sex: 'M', displayOrder: 0 })
      .returning()
    if (!demoCategory) throw new Error('category insert failed')

    await handle.db.insert(competitor).values([
      {
        competitionId: demoCompetition.id,
        categoryId: demoCategory.id,
        firstName: 'A',
        lastName: 'B',
      },
      {
        competitionId: demoCompetition.id,
        categoryId: demoCategory.id,
        firstName: 'C',
        lastName: 'D',
      },
    ])

    const rows = await handle.db.query.competitor.findMany({
      where: (row, { eq }) => eq(row.competitionId, demoCompetition.id),
    })
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.bib === null)).toBe(true)
  })
})
