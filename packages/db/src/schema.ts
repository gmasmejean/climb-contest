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
  doublePrecision,
  index,
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

// ADR-088 : une adresse est un libellé, avec ou sans position. Partagée par
// l'organisation et le lieu des compétitions (ADR-089).
const addressColumns = () => ({
  addressLabel: text('address_label'),
  postcode: text('postcode'),
  city: text('city'),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  banId: text('ban_id'),
})

interface AddressTable {
  addressLabel: AnyPgColumn
  postcode: AnyPgColumn
  city: AnyPgColumn
  latitude: AnyPgColumn
  longitude: AnyPgColumn
  banId: AnyPgColumn
}

const addressChecks = (tableName: string, table: AddressTable) => [
  check(
    `${tableName}_position_check`,
    // Un CHECK passe quand il vaut NULL : les IS NOT NULL explicites empêchent
    // une latitude sans longitude de passer par un `BETWEEN` qui vaudrait NULL.
    sql`(${table.latitude} IS NULL AND ${table.longitude} IS NULL) OR (${table.latitude} IS NOT NULL AND ${table.longitude} IS NOT NULL AND ${table.latitude} BETWEEN -90 AND 90 AND ${table.longitude} BETWEEN -180 AND 180)`,
  ),
  check(
    `${tableName}_address_check`,
    sql`${table.addressLabel} IS NOT NULL OR (${table.postcode} IS NULL AND ${table.city} IS NULL AND ${table.latitude} IS NULL AND ${table.banId} IS NULL)`,
  ),
]

// ADR-086 : la structure organisatrice (club, salle ou autre). Anciennement
// `club` ; le club d'affiliation d'un compétiteur reste `competitor.club_name`.
// ADR-088 : la fiche publique (type, description, contact, site, adresse).
// L'adresse est un libellé, avec ou sans position : sans proposition BAN
// choisie, seul le libellé est renseigné (pas de carte).
export const organization = pgTable(
  'organization',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    type: text('type').notNull().default('club'),
    description: text('description'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    websiteUrl: text('website_url'),
    ...addressColumns(),
    ...timestamps,
  },
  (table) => [
    check('organization_type_check', sql`${table.type} IN ('club', 'gym', 'other')`),
    ...addressChecks('organization', table),
  ],
)

export const user = pgTable(
  'user',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
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
    // ADR-087 : non nul = compte désactivé par un owner (connexion et refresh
    // refusés). Réversible : la réactivation remet null.
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
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
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
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
    // ADR-027 : conserve le PIN/token en clair pour réaffichage organisateur.
    // Vrai par défaut (ergonomie prioritaire pour les petits clubs). Passer à
    // faux efface rétroactivement le clair déjà stocké pour cette compétition
    // (routes/competitions.ts) ; passer à vrai ne s'applique qu'aux actions
    // futures (création, régénération de PIN).
    judgeCredentialsStored: boolean('judge_credentials_stored').notNull().default(true),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    // Lot 9 (ADR-051) : date de la purge des données personnelles. Nulle tant
    // que la compétition n'a pas été purgée ; la ligne reste, sans donnée
    // personnelle, comme trace de la purge.
    purgedAt: timestamp('purged_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // ADR-089 : adresse du lieu, copiée depuis l'organisation à la création
    // (par le formulaire) ou saisie ; `venue` reste le nom du lieu.
    ...addressColumns(),
    ...timestamps,
  },
  (table) => [
    check('competition_format_check', sql`${table.format} IN ('contest', 'phases')`),
    check(
      'competition_status_check',
      sql`${table.status} IN ('draft', 'open', 'running', 'closed', 'archived')`,
    ),
    ...addressChecks('competition', table),
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
  (table) => [check('asset_kind_check', sql`${table.kind} IN ('video', 'route_photo')`)],
)

/**
 * Lot 9 (ADR-052, ADR-058) — un téléversement de vidéo en cours, reprenable :
 * l'organisateur l'envoie par morceaux, et `received_bytes` dit où reprendre
 * après une coupure. Une ligne devient un `asset` à la fin de l'envoi ; les
 * envois abandonnés sont purgés après `expires_at`.
 */
export const assetUpload = pgTable(
  'asset_upload',
  {
    id: id(),
    competitionId: uuid('competition_id')
      .notNull()
      .references(() => competition.id),
    routeId: uuid('route_id')
      .notNull()
      .references(() => route.id),
    storageKey: text('storage_key').notNull(),
    // Type DÉCLARÉ par le client : jamais une preuve, seule la signature réelle
    // du fichier est vérifiée à la fin.
    declaredMimeType: text('declared_mime_type').notNull(),
    declaredSizeBytes: integer('declared_size_bytes').notNull(),
    receivedBytes: integer('received_bytes').notNull().default(0),
    status: text('status').notNull().default('uploading'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    check(
      'asset_upload_status_check',
      sql`${table.status} IN ('uploading', 'completed', 'aborted')`,
    ),
    check(
      'asset_upload_size_check',
      sql`${table.declaredSizeBytes} > 0 AND ${table.receivedBytes} >= 0`,
    ),
    index('asset_upload_route_id_idx').on(table.routeId),
    index('asset_upload_status_expires_idx').on(table.status, table.expiresAt),
  ],
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
    // Lot 15 (ADR-066) : photo annotée. `photo_holds` est une liste
    // `{ number, x, y }` (x, y normalisés dans [0, 1]) validée par Zod aux
    // frontières ; la colonne reste un jsonb non typé, comme `scoring_config`.
    photoAssetId: uuid('photo_asset_id').references(() => asset.id),
    photoHolds: jsonb('photo_holds'),
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
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check('round_type_check', sql`${table.type} IN ('qualification', 'semifinal', 'final')`),
    check('round_style_check', sql`${table.style} IN ('flash', 'onsight')`),
    uniqueIndex('round_competition_display_order_key').on(table.competitionId, table.displayOrder),
  ],
)

/**
 * ADR-065 : le statut d'un tour se porte par catégorie (des catégories
 * finissent le matin, d'autres l'après-midi). Une ligne absente vaut `draft` :
 * on n'écrit qu'à la première transition, donc rien à synchroniser avec
 * `round_route`. Toute lecture du statut passe par `LEFT JOIN … COALESCE`
 * (voir `apps/api/src/lib/round-category.ts`), jamais par cette table seule.
 */
export const roundCategory = pgTable(
  'round_category',
  {
    roundId: uuid('round_id')
      .notNull()
      .references(() => round.id),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => category.id),
    status: text('status').notNull().default('draft'),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.roundId, table.categoryId] }),
    check(
      'round_category_status_check',
      sql`${table.status} IN ('draft', 'open', 'closed', 'published')`,
    ),
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

/**
 * ADR-054 : la liste des qualifiés d'un tour, figée au moment où ce tour
 * passe à `open`. `round_id` est le tour QUI REÇOIT les qualifiés, pas celui
 * dont ils viennent (`source_round_id`). Une catégorie sans ligne ici pour un
 * tour donné n'est pas restreinte : premier tour de la catégorie, ou tour
 * ouvert avant le Lot 9 (calculé à la volée, comme avant).
 */
export const roundQualifier = pgTable(
  'round_qualifier',
  {
    roundId: uuid('round_id')
      .notNull()
      .references(() => round.id),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => category.id),
    competitorId: uuid('competitor_id')
      .notNull()
      .references(() => competitor.id),
    sourceRoundId: uuid('source_round_id')
      .notNull()
      .references(() => round.id),
    // Rang obtenu au tour source. Plusieurs qualifiés peuvent le partager
    // (égalité à la limite : tous les ex aequo passent).
    sourceRank: integer('source_rank').notNull(),
    frozenAt: timestamp('frozen_at', { withTimezone: true }).notNull().defaultNow(),
    frozenByUserId: uuid('frozen_by_user_id').references(() => user.id),
  },
  (table) => [
    primaryKey({ columns: [table.roundId, table.competitorId] }),
    check('round_qualifier_source_rank_check', sql`${table.sourceRank} >= 1`),
    index('round_qualifier_round_category_idx').on(table.roundId, table.categoryId),
  ],
)

export const judge = pgTable('judge', {
  id: id(),
  competitionId: uuid('competition_id')
    .notNull()
    .references(() => competition.id),
  displayName: text('display_name').notNull(),
  // Optionnel — sert à l'envoi (et au renvoi) du lien d'accès par e-mail.
  // Jamais utilisée pour l'authentification.
  email: text('email'),
  accessTokenHash: text('access_token_hash').notNull(),
  accessTokenPrefix: text('access_token_prefix').notNull(),
  // Nullable depuis le Lot 4 (DECISIONS.md ADR-026) : le PIN est une option
  // de la compétition, désactivée par défaut. `pinHash === null` signifie
  // que ce juge est accessible par le lien seul.
  pinHash: text('pin_hash'),
  // ADR-027 : copie en clair, uniquement si `competition.judge_credentials_stored`
  // était vrai au moment de l'action (création, ou régénération pour pinPlain).
  // Sert exclusivement à réafficher l'accès à l'organisateur — jamais utilisée
  // pour l'authentification, qui reste sur les colonnes *_hash ci-dessus.
  accessTokenPlain: text('access_token_plain'),
  pinPlain: text('pin_plain'),
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
    // DECISIONS.md ADR-031 : en base, cette FK est `DEFERRABLE INITIALLY
    // DEFERRED` (migration `0004_ascent_superseded_by_deferrable`, écrite à
    // la main — l'API `references()` de Drizzle Kit ne sait pas exprimer
    // `DEFERRABLE`). Nécessaire pour chaîner une correction : l'ancienne
    // ligne doit être retirée de `ascent_active_key` (index partiel, jamais
    // différable) avant que la nouvelle n'y entre, donc avant que la
    // nouvelle ligne n'existe.
    supersededBy: uuid('superseded_by').references((): AnyPgColumn => ascent.id),
    // ADR-002 : marque une saisie contradictoire, sort temporairement de
    // l'unicité (round_id, route_id, competitor_id).
    conflictGroup: uuid('conflict_group'),
    // ADR-078 : saisie refusée par l'organisateur (quarantaine d'un accès
    // révoqué). La ligne GARDE son `conflict_group` — elle reste ainsi hors de
    // tous les filtres « actif » et de `ascent_active_key` — et sort seulement
    // des lectures de conflits non résolus.
    voidedAt: timestamp('voided_at', { withTimezone: true }),
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

/**
 * Lot 8 — journal d'activité de la compétition (ROADMAP.md), pour tout ce
 * qui n'est pas un passage (déjà couvert par `ascent_event`) : changements
 * de statut d'un tour ou d'un compétiteur. `GET .../activity-log` fusionne
 * ces lignes avec `ascent_event` (jointe à `ascent` pour filtrer par
 * compétition) au moment de la lecture — voir DECISIONS.md.
 */
export const activityLog = pgTable(
  'activity_log',
  {
    id: id(),
    competitionId: uuid('competition_id')
      .notNull()
      .references(() => competition.id),
    eventType: text('event_type').notNull(),
    actorType: text('actor_type').notNull(),
    // Référence polymorphe (user.id, ou null pour 'system') : pas de FK,
    // même choix que ascent_event.actorId.
    actorId: uuid('actor_id'),
    // round.id ou competitor.id selon eventType — pas de FK (polymorphe).
    entityId: uuid('entity_id').notNull(),
    payload: jsonb('payload').notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'activity_log_event_type_check',
      sql`${table.eventType} IN ('round_status_changed', 'competitor_status_changed')`,
    ),
    check('activity_log_actor_type_check', sql`${table.actorType} IN ('organizer', 'system')`),
    index('activity_log_competition_id_idx').on(table.competitionId),
  ],
)

/**
 * Lot 24 (ADR-087) — trace des actions d'un owner sur les membres de son
 * organisation. `target_user_id` sans clé étrangère : une invitation annulée
 * supprime la ligne `user`, la trace doit lui survivre (e-mail et nom recopiés).
 */
export const organizationMemberLog = pgTable(
  'organization_member_log',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => user.id),
    targetUserId: uuid('target_user_id').notNull(),
    targetEmail: text('target_email').notNull(),
    targetDisplayName: text('target_display_name').notNull(),
    action: text('action').notNull(),
    // Changement de rôle : { from, to }. Vide pour les autres actions.
    details: jsonb('details').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'organization_member_log_action_check',
      sql`${table.action} IN ('invited', 'invitation_resent', 'invitation_cancelled', 'role_changed', 'deactivated', 'reactivated')`,
    ),
    index('organization_member_log_organization_id_idx').on(table.organizationId, table.createdAt),
  ],
)

/**
 * Lot 11 — trace des mises à la corbeille, restaurations et suppressions
 * définitives d'une compétition (CLAUDE.md, règle n°3 : « toute saisie
 * destructive laisse une trace »). `competition_id` n'est volontairement PAS
 * une clé étrangère : la ligne doit survivre à la suppression définitive de la
 * compétition. Aucune donnée personnelle de compétiteur ou de juge — le nom de
 * la compétition suffit à reconnaître ce qui a été supprimé. Voir ADR-063.
 */
export const competitionDeletionLog = pgTable(
  'competition_deletion_log',
  {
    id: id(),
    competitionId: uuid('competition_id').notNull(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    competitionName: text('competition_name').notNull(),
    action: text('action').notNull(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'competition_deletion_log_action_check',
      sql`${table.action} IN ('trashed', 'restored', 'deleted')`,
    ),
    index('competition_deletion_log_organization_id_idx').on(table.organizationId, table.createdAt),
  ],
)
