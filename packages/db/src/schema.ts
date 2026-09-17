/**
 * Schéma Drizzle — SPEC.md § 5, avec l'extension `user` d'ADR-017
 * (inscription ouverte + vérification e-mail + invitations).
 *
 * Convention : `text` + contrainte CHECK plutôt que des ENUM Postgres natifs
 * pour toutes les colonnes à choix fermé — un ENUM Postgres ne peut pas
 * perdre de valeur sans recréer le type, ce qui complique les migrations
 * `down` exigées par CLAUDE.md. Voir ADR-018 (DECISIONS.md).
 */
import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { uuidv7 } from 'uuidv7'

const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7())

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}

export const club = pgTable('club', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  ...timestamps,
})

export const user = pgTable(
  'user',
  {
    id: id(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => club.id),
    email: text('email').notNull().unique(),
    // ADR-017 : null tant qu'une invitation n'a pas été acceptée.
    passwordHash: text('password_hash'),
    displayName: text('display_name').notNull(),
    role: text('role').notNull(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    // ADR-017 : null = compte inutilisable en connexion (ni vérifié, ni
    // invitation acceptée).
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    invitedByUserId: uuid('invited_by_user_id').references((): AnyPgColumn => user.id),
    pendingTokenHash: text('pending_token_hash'),
    pendingTokenPurpose: text('pending_token_purpose'),
    pendingTokenExpiresAt: timestamp('pending_token_expires_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check('user_role_check', sql`${table.role} IN ('owner', 'organizer')`),
    check(
      'user_pending_token_purpose_check',
      sql`${table.pendingTokenPurpose} IS NULL OR ${table.pendingTokenPurpose} IN ('email_verification', 'invitation')`,
    ),
  ],
)

export const session = pgTable('session', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id),
  refreshTokenHash: text('refresh_token_hash').notNull(),
  userAgent: text('user_agent'),
  ip: text('ip'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  ...timestamps,
})

export const competition = pgTable(
  'competition',
  {
    id: id(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => club.id),
    name: text('name').notNull(),
    venue: text('venue').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    discipline: text('discipline').notNull().default('difficulty'),
    format: text('format').notNull(),
    scoringEngineId: text('scoring_engine_id').notNull(),
    scoringConfig: jsonb('scoring_config').notNull().default({}),
    status: text('status').notNull().default('draft'),
    publicSlug: text('public_slug').notNull().unique(),
    timingEnabled: boolean('timing_enabled').notNull().default(false),
    // Valeur par défaut appliquée à la création d'un juge (voir DECISIONS.md
    // ADR-026) — changer ce réglage n'a aucun effet rétroactif sur les juges
    // déjà créés.
    judgePinRequired: boolean('judge_pin_required').notNull().default(false),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check('competition_format_check', sql`${table.format} IN ('contest', 'phases')`),
    check(
      'competition_status_check',
      sql`${table.status} IN ('draft', 'open', 'running', 'closed', 'archived')`,
    ),
  ],
)

export const asset = pgTable(
  'asset',
  {
    id: id(),
    competitionId: uuid('competition_id')
      .notNull()
      .references(() => competition.id),
    kind: text('kind').notNull().default('video'),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    durationMs: integer('duration_ms'),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => user.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [check('asset_kind_check', sql`${table.kind} IN ('video')`)],
)

export const category = pgTable(
  'category',
  {
    id: id(),
    competitionId: uuid('competition_id')
      .notNull()
      .references(() => competition.id),
    label: text('label').notNull(),
    sex: text('sex').notNull(),
    birthYearMin: integer('birth_year_min'),
    birthYearMax: integer('birth_year_max'),
    displayOrder: integer('display_order').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check('category_sex_check', sql`${table.sex} IN ('M', 'F', 'X')`),
    uniqueIndex('category_competition_label_key').on(table.competitionId, table.label),
  ],
)

export const competitor = pgTable(
  'competitor',
  {
    id: id(),
    competitionId: uuid('competition_id')
      .notNull()
      .references(() => competition.id),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => category.id),
    bib: integer('bib'), // ADR-022 : nullable, attribué manuellement ou en masse (Lot 3)
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    birthYear: integer('birth_year'),
    clubName: text('club_name'),
    licenseNumber: text('license_number'),
    status: text('status').notNull().default('registered'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check(
      'competitor_status_check',
      sql`${table.status} IN ('registered', 'present', 'withdrawn', 'disqualified')`,
    ),
    uniqueIndex('competitor_competition_bib_key').on(table.competitionId, table.bib),
  ],
)

export const route = pgTable(
  'route',
  {
    id: id(),
    competitionId: uuid('competition_id')
      .notNull()
      .references(() => competition.id),
    number: integer('number').notNull(),
    name: text('name'),
    holdCount: integer('hold_count').notNull(),
    sector: text('sector'),
    color: text('color'),
    videoUrl: text('video_url'),
    videoAssetId: uuid('video_asset_id').references(() => asset.id),
    notes: text('notes'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check('route_hold_count_check', sql`${table.holdCount} > 0`),
    uniqueIndex('route_competition_number_key').on(table.competitionId, table.number),
  ],
)

export const routeCategory = pgTable(
  'route_category',
  {
    routeId: uuid('route_id')
      .notNull()
      .references(() => route.id),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => category.id),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.routeId, table.categoryId] })],
)

export const round = pgTable(
  'round',
  {
    id: id(),
    competitionId: uuid('competition_id')
      .notNull()
      .references(() => competition.id),
    type: text('type').notNull(),
    style: text('style').notNull(),
    displayOrder: integer('display_order').notNull(),
    qualifyingCount: integer('qualifying_count'),
    status: text('status').notNull().default('draft'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check('round_type_check', sql`${table.type} IN ('qualification', 'semifinal', 'final')`),
    check('round_style_check', sql`${table.style} IN ('flash', 'onsight')`),
    check('round_status_check', sql`${table.status} IN ('draft', 'open', 'closed', 'published')`),
    uniqueIndex('round_competition_display_order_key').on(table.competitionId, table.displayOrder),
  ],
)

export const roundRoute = pgTable(
  'round_route',
  {
    roundId: uuid('round_id')
      .notNull()
      .references(() => round.id),
    routeId: uuid('route_id')
      .notNull()
      .references(() => route.id),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => category.id),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.roundId, table.routeId, table.categoryId] })],
)

export const judge = pgTable('judge', {
  id: id(),
  competitionId: uuid('competition_id')
    .notNull()
    .references(() => competition.id),
  displayName: text('display_name').notNull(),
  accessTokenHash: text('access_token_hash').notNull(),
  accessTokenPrefix: text('access_token_prefix').notNull(),
  // Nullable depuis le Lot 4 (DECISIONS.md ADR-026) : le PIN est une option
  // de la compétition, désactivée par défaut. `pinHash === null` signifie
  // que ce juge est accessible par le lien seul.
  pinHash: text('pin_hash'),
  pinAttempts: integer('pin_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  ...timestamps,
})

export const judgeRoute = pgTable(
  'judge_route',
  {
    judgeId: uuid('judge_id')
      .notNull()
      .references(() => judge.id),
    routeId: uuid('route_id')
      .notNull()
      .references(() => route.id),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.judgeId, table.routeId] })],
)

export const ascent = pgTable(
  'ascent',
  {
    // ADR (SPEC.md § 5) : généré côté CLIENT pour l'idempotence hors ligne —
    // pas de $defaultFn ici, contrairement aux autres tables.
    id: uuid('id').primaryKey(),
    competitionId: uuid('competition_id')
      .notNull()
      .references(() => competition.id),
    roundId: uuid('round_id')
      .notNull()
      .references(() => round.id),
    routeId: uuid('route_id')
      .notNull()
      .references(() => route.id),
    competitorId: uuid('competitor_id')
      .notNull()
      .references(() => competitor.id),
    holdNumber: integer('hold_number'),
    // ADR-003 : copie de route.hold_count au moment de la saisie.
    holdCount: integer('hold_count').notNull(),
    modifier: text('modifier').notNull().default('none'),
    isTop: boolean('is_top').notNull().default(false),
    status: text('status').notNull().default('valid'),
    scoreValue: numeric('score_value', { precision: 6, scale: 1 })
      .notNull()
      .generatedAlwaysAs(
        () => sql`
          CASE
            WHEN status IN ('dns', 'dnf', 'dsq') THEN 0
            WHEN is_top THEN hold_count + 1
            WHEN modifier = 'plus' THEN hold_number + 0.5
            ELSE hold_number
          END
        `,
      ),
    climbTimeMs: integer('climb_time_ms'),
    recordedByJudgeId: uuid('recorded_by_judge_id').references(() => judge.id),
    recordedByUserId: uuid('recorded_by_user_id').references(() => user.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    deviceId: text('device_id').notNull(),
    // ADR (SPEC.md § 5) : correction par chaînage, jamais d'écrasement.
    supersededBy: uuid('superseded_by').references((): AnyPgColumn => ascent.id),
    // ADR-002 : marque une saisie contradictoire, sort temporairement de
    // l'unicité (round_id, route_id, competitor_id).
    conflictGroup: uuid('conflict_group'),
    ...timestamps,
  },
  (table) => [
    check('ascent_modifier_check', sql`${table.modifier} IN ('none', 'plus')`),
    check('ascent_status_check', sql`${table.status} IN ('valid', 'dns', 'dnf', 'dsq')`),
    check('ascent_hold_count_check', sql`${table.holdCount} > 0`),
    check(
      'ascent_recorded_by_check',
      sql`(${table.recordedByJudgeId} IS NULL) <> (${table.recordedByUserId} IS NULL)`,
    ),
    check(
      'ascent_status_shape_check',
      sql`
        (${table.status} IN ('dns', 'dnf', 'dsq') AND ${table.holdNumber} IS NULL AND ${table.isTop} = false)
        OR (${table.status} = 'valid' AND ${table.isTop} = true)
        OR (
          ${table.status} = 'valid' AND ${table.isTop} = false
          AND ${table.holdNumber} IS NOT NULL
          AND ${table.holdNumber} >= 1 AND ${table.holdNumber} <= ${table.holdCount}
        )
      `,
    ),
    // ADR-002 : une ligne en conflit ou remplacée sort de la contrainte
    // d'unicité — elle y revient une fois le conflit tranché.
    uniqueIndex('ascent_active_key')
      .on(table.roundId, table.routeId, table.competitorId)
      .where(sql`${table.supersededBy} IS NULL AND ${table.conflictGroup} IS NULL`),
  ],
)

export const ascentEvent = pgTable('ascent_event', {
  id: id(),
  ascentId: uuid('ascent_id')
    .notNull()
    .references(() => ascent.id),
  eventType: text('event_type').notNull(),
  actorType: text('actor_type').notNull(),
  // Référence polymorphe (judge.id ou user.id selon actor_type) : pas de FK.
  actorId: uuid('actor_id'),
  payload: jsonb('payload').notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
