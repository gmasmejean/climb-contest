import type { BackupPreview, CompetitionBackup } from '@climbcontest/contracts'
import {
  activityLog,
  ascent,
  ascentEvent,
  category,
  competition,
  competitor,
  hashToken,
  judge,
  judgeRoute,
  randomToken,
  round,
  roundCategory,
  roundQualifier,
  roundRoute,
  route,
  routeCategory,
  type Database,
} from '@climbcontest/db'
import { uuidv7 } from 'uuidv7'

const PUBLIC_SLUG_LENGTH = 22
const INSERT_CHUNK_SIZE = 500

/**
 * Contrôle ce que le schéma Zod ne peut pas exprimer : références entre lignes
 * et règles que la base imposerait (et refuserait avec une erreur technique).
 * Chaque message dit QUOI corriger, en français. Pure : testée sans base.
 */
export function checkBackupIntegrity(backup: CompetitionBackup): string[] {
  const errors: string[] = []
  const add = (message: string) => {
    if (errors.length < 50) errors.push(message)
  }

  const duplicates = <T>(items: readonly T[], key: (item: T) => string | number | null) => {
    const seen = new Set<string | number>()
    const dupes = new Set<string | number>()
    for (const item of items) {
      const value = key(item)
      if (value === null) continue
      if (seen.has(value)) dupes.add(value)
      seen.add(value)
    }
    return [...dupes]
  }

  const ids = (items: readonly { id: string }[]) => new Set(items.map((item) => item.id))
  const categoryIds = ids(backup.categories)
  const competitorIds = ids(backup.competitors)
  const routeIds = ids(backup.routes)
  const roundIds = ids(backup.rounds)
  const judgeIds = ids(backup.judges)
  const ascentIds = ids(backup.ascents)

  for (const [name, list] of [
    ['catégorie', backup.categories],
    ['compétiteur', backup.competitors],
    ['voie', backup.routes],
    ['tour', backup.rounds],
    ['juge', backup.judges],
    ['passage', backup.ascents],
  ] as const) {
    if (duplicates<{ id: string }>(list, (item) => item.id).length > 0) {
      add(`Deux ${name}s portent le même identifiant : le fichier est corrompu.`)
    }
  }

  for (const label of duplicates(backup.categories, (c) => c.label)) {
    add(`Deux catégories portent le même libellé : « ${String(label)} ».`)
  }
  for (const bib of duplicates(backup.competitors, (c) => c.bib)) {
    add(`Deux compétiteurs portent le même dossard : ${String(bib)}.`)
  }
  for (const number of duplicates(backup.routes, (r) => r.number)) {
    add(`Deux voies portent le même numéro : ${String(number)}.`)
  }
  for (const order of duplicates(backup.rounds, (r) => r.displayOrder)) {
    add(`Deux tours portent le même ordre d’affichage : ${String(order)}.`)
  }

  for (const c of backup.competitors) {
    if (!categoryIds.has(c.categoryId)) {
      add(
        `Le compétiteur « ${c.firstName} ${c.lastName} » référence une catégorie absente du fichier.`,
      )
    }
  }
  for (const link of backup.routeCategories) {
    if (!routeIds.has(link.routeId) || !categoryIds.has(link.categoryId)) {
      add(
        'Une affectation voie ↔ catégorie référence une voie ou une catégorie absente du fichier.',
      )
    }
  }
  for (const link of backup.roundRoutes) {
    if (
      !roundIds.has(link.roundId) ||
      !routeIds.has(link.routeId) ||
      !categoryIds.has(link.categoryId)
    ) {
      add(
        'Une affectation de voie à un tour référence un tour, une voie ou une catégorie absente du fichier.',
      )
    }
  }
  for (const link of backup.roundCategories) {
    if (!roundIds.has(link.roundId) || !categoryIds.has(link.categoryId)) {
      add('Un état de tour référence un tour ou une catégorie absente du fichier.')
    }
  }
  for (const pair of duplicates(backup.roundCategories, (r) => `${r.roundId}:${r.categoryId}`)) {
    add(
      `Un tour porte deux états pour la même catégorie (${String(pair)}) : le fichier est corrompu.`,
    )
  }
  for (const q of backup.roundQualifiers) {
    if (
      !roundIds.has(q.roundId) ||
      !roundIds.has(q.sourceRoundId) ||
      !categoryIds.has(q.categoryId) ||
      !competitorIds.has(q.competitorId)
    ) {
      add(
        'Une liste de qualifiés référence un tour, une catégorie ou un compétiteur absent du fichier.',
      )
    }
  }
  for (const j of backup.judges) {
    for (const routeId of j.routeIds) {
      if (!routeIds.has(routeId))
        add(`Le juge « ${j.displayName} » est assigné à une voie absente du fichier.`)
    }
  }

  for (const a of backup.ascents) {
    if (
      !roundIds.has(a.roundId) ||
      !routeIds.has(a.routeId) ||
      !competitorIds.has(a.competitorId)
    ) {
      add(`Le passage ${a.id} référence un tour, une voie ou un compétiteur absent du fichier.`)
    }
    if (a.recordedBy.kind === 'judge' && !judgeIds.has(a.recordedBy.judgeId)) {
      add(`Le passage ${a.id} a été saisi par un juge absent du fichier.`)
    }
    if (a.supersededBy !== null && !ascentIds.has(a.supersededBy)) {
      add(`Le passage ${a.id} est remplacé par un passage absent du fichier.`)
    }
    if (a.supersededBy === a.id) add(`Le passage ${a.id} se remplace lui-même.`)

    // Les mêmes règles que `ascent_status_shape_check` : mieux vaut un message
    // français ici qu'une erreur SQL au milieu de l'écriture.
    const shapeOk =
      a.status === 'valid'
        ? a.isTop || (a.holdNumber !== null && a.holdNumber >= 1 && a.holdNumber <= a.holdCount)
        : a.holdNumber === null && !a.isTop
    if (!shapeOk) add(`Le passage ${a.id} a un contenu incohérent (statut, prise ou TOP).`)
  }
  for (const e of backup.ascentEvents) {
    if (!ascentIds.has(e.ascentId))
      add(`Un événement référence le passage ${e.ascentId}, absent du fichier.`)
    if (e.actorJudgeId !== null && !judgeIds.has(e.actorJudgeId)) {
      add('Un événement de passage référence un juge absent du fichier.')
    }
  }

  // Un seul passage actif par (tour, voie, compétiteur) — l'index unique de la base.
  const active = new Set<string>()
  for (const a of backup.ascents) {
    if (a.supersededBy !== null || a.conflictGroup !== null) continue
    const key = `${a.roundId}|${a.routeId}|${a.competitorId}`
    if (active.has(key))
      add(`Deux passages actifs existent pour le même compétiteur, tour et voie (${a.id}).`)
    active.add(key)
  }

  return errors
}

export function summarizeBackup(backup: CompetitionBackup): BackupPreview {
  return {
    competitionName: backup.competition.name,
    format: backup.competition.format,
    exportedAt: backup.exportedAt,
    counts: {
      categories: backup.categories.length,
      competitors: backup.competitors.length,
      routes: backup.routes.length,
      rounds: backup.rounds.length,
      judges: backup.judges.length,
      ascents: backup.ascents.length,
    },
    notices: [
      'Une nouvelle compétition est créée : l’originale n’est pas modifiée.',
      'Les juges sont restaurés révoqués : créez de nouveaux accès et réimprimez les QR codes.',
      'Les vidéos téléversées ne sont pas dans la sauvegarde ; les liens externes le sont.',
      'Les passages saisis par un organisateur sont attribués à votre compte.',
    ],
  }
}

/** Remplace, dans une valeur JSON quelconque, tout identifiant connu par son nouveau. */
export function remapIdsDeep(value: unknown, mapping: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return mapping.get(value) ?? value
  if (Array.isArray(value)) return value.map((item) => remapIdsDeep(item, mapping))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, remapIdsDeep(inner, mapping)]),
    )
  }
  return value
}

function chunks<T>(items: readonly T[]): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += INSERT_CHUNK_SIZE) {
    result.push(items.slice(index, index + INSERT_CHUNK_SIZE))
  }
  return result
}

const dateOrNull = (iso: string | null) => (iso ? new Date(iso) : null)

/**
 * Écrit la sauvegarde comme une NOUVELLE compétition (ADR-056), en une seule
 * transaction : tout ou rien. Tous les identifiants sont regénérés — y compris
 * ceux des passages, globalement uniques : réimporter dans la base d'origine
 * entrerait sinon en collision.
 */
export async function importBackup(
  db: Database,
  backup: CompetitionBackup,
  importer: { clubId: string; userId: string },
  now: Date,
): Promise<{ competitionId: string }> {
  const remap = new Map<string, string>()
  const fresh = (oldId: string) => {
    const existing = remap.get(oldId)
    if (existing) return existing
    const created = uuidv7()
    remap.set(oldId, created)
    return created
  }
  for (const list of [
    backup.categories,
    backup.competitors,
    backup.routes,
    backup.rounds,
    backup.judges,
    backup.ascents,
  ]) {
    for (const item of list) fresh(item.id)
  }
  const mapped = (oldId: string) => {
    const value = remap.get(oldId)
    if (!value) throw new Error(`Identifiant non remappé : ${oldId}`)
    return value
  }

  return db.transaction(async (tx) => {
    const competitionId = uuidv7()
    const c = backup.competition
    await tx.insert(competition).values({
      id: competitionId,
      clubId: importer.clubId,
      name: c.name,
      venue: c.venue,
      startsOn: c.startsOn,
      endsOn: c.endsOn,
      discipline: c.discipline,
      format: c.format,
      scoringEngineId: c.scoringEngineId,
      scoringConfig: c.scoringConfig,
      status: c.status,
      publicSlug: randomToken(PUBLIC_SLUG_LENGTH),
      timingEnabled: c.timingEnabled,
      judgePinRequired: c.judgePinRequired,
      judgeCredentialsStored: c.judgeCredentialsStored,
      createdBy: importer.userId,
    })

    for (const rows of chunks(backup.categories)) {
      await tx.insert(category).values(
        rows.map((row) => ({
          id: mapped(row.id),
          competitionId,
          label: row.label,
          sex: row.sex,
          birthYearMin: row.birthYearMin,
          birthYearMax: row.birthYearMax,
          displayOrder: row.displayOrder,
          deletedAt: dateOrNull(row.deletedAt),
        })),
      )
    }
    for (const rows of chunks(backup.competitors)) {
      await tx.insert(competitor).values(
        rows.map((row) => ({
          id: mapped(row.id),
          competitionId,
          categoryId: mapped(row.categoryId),
          bib: row.bib,
          firstName: row.firstName,
          lastName: row.lastName,
          birthYear: row.birthYear,
          clubName: row.clubName,
          licenseNumber: row.licenseNumber,
          status: row.status,
          deletedAt: dateOrNull(row.deletedAt),
        })),
      )
    }
    for (const rows of chunks(backup.routes)) {
      await tx.insert(route).values(
        rows.map((row) => ({
          id: mapped(row.id),
          competitionId,
          number: row.number,
          name: row.name,
          holdCount: row.holdCount,
          sector: row.sector,
          color: row.color,
          videoUrl: row.videoUrl,
          notes: row.notes,
          deletedAt: dateOrNull(row.deletedAt),
        })),
      )
    }
    if (backup.routeCategories.length > 0) {
      await tx.insert(routeCategory).values(
        backup.routeCategories.map((row) => ({
          routeId: mapped(row.routeId),
          categoryId: mapped(row.categoryId),
        })),
      )
    }
    for (const rows of chunks(backup.rounds)) {
      await tx.insert(round).values(
        rows.map((row) => ({
          id: mapped(row.id),
          competitionId,
          type: row.type,
          style: row.style,
          displayOrder: row.displayOrder,
          qualifyingCount: row.qualifyingCount,
          deletedAt: dateOrNull(row.deletedAt),
        })),
      )
    }
    if (backup.roundCategories.length > 0) {
      await tx.insert(roundCategory).values(
        backup.roundCategories.map((row) => ({
          roundId: mapped(row.roundId),
          categoryId: mapped(row.categoryId),
          status: row.status,
        })),
      )
    }
    if (backup.roundRoutes.length > 0) {
      await tx.insert(roundRoute).values(
        backup.roundRoutes.map((row) => ({
          roundId: mapped(row.roundId),
          routeId: mapped(row.routeId),
          categoryId: mapped(row.categoryId),
        })),
      )
    }
    if (backup.roundQualifiers.length > 0) {
      await tx.insert(roundQualifier).values(
        backup.roundQualifiers.map((row) => ({
          roundId: mapped(row.roundId),
          categoryId: mapped(row.categoryId),
          competitorId: mapped(row.competitorId),
          sourceRoundId: mapped(row.sourceRoundId),
          sourceRank: row.sourceRank,
          frozenAt: new Date(row.frozenAt),
          frozenByUserId: importer.userId,
        })),
      )
    }

    // Juges restaurés révoqués, avec un jeton aléatoire jeté aussitôt (ADR-056).
    for (const row of backup.judges) {
      const discardedToken = randomToken(32)
      await tx.insert(judge).values({
        id: mapped(row.id),
        competitionId,
        displayName: row.displayName,
        accessTokenHash: hashToken(discardedToken),
        accessTokenPrefix: discardedToken.slice(0, 8),
        revokedAt: now,
        deletedAt: dateOrNull(row.deletedAt),
      })
    }
    const judgeLinks = backup.judges.flatMap((row) =>
      row.routeIds.map((routeId) => ({ judgeId: mapped(row.id), routeId: mapped(routeId) })),
    )
    if (judgeLinks.length > 0) await tx.insert(judgeRoute).values(judgeLinks)

    // `superseded_by` est une FK `DEFERRABLE INITIALLY DEFERRED` (ADR-031) :
    // l'ordre d'insertion des passages n'a pas d'importance dans la transaction.
    for (const rows of chunks(backup.ascents)) {
      await tx.insert(ascent).values(
        rows.map((row) => ({
          id: mapped(row.id),
          competitionId,
          roundId: mapped(row.roundId),
          routeId: mapped(row.routeId),
          competitorId: mapped(row.competitorId),
          holdNumber: row.holdNumber,
          holdCount: row.holdCount,
          modifier: row.modifier,
          isTop: row.isTop,
          status: row.status,
          climbTimeMs: row.climbTimeMs,
          recordedByJudgeId:
            row.recordedBy.kind === 'judge' ? mapped(row.recordedBy.judgeId) : null,
          recordedByUserId: row.recordedBy.kind === 'organizer' ? importer.userId : null,
          recordedAt: new Date(row.recordedAt),
          syncedAt: new Date(row.syncedAt),
          deviceId: row.deviceId,
          supersededBy: row.supersededBy ? mapped(row.supersededBy) : null,
          conflictGroup: row.conflictGroup ? fresh(row.conflictGroup) : null,
          voidedAt: row.voidedAt ? new Date(row.voidedAt) : null,
        })),
      )
    }
    for (const rows of chunks(backup.ascentEvents)) {
      await tx.insert(ascentEvent).values(
        rows.map((row) => ({
          id: uuidv7(),
          ascentId: mapped(row.ascentId),
          eventType: row.eventType,
          actorType: row.actorType,
          actorId: row.actorJudgeId ? mapped(row.actorJudgeId) : null,
          payload: remapIdsDeep(row.payload, remap),
          reason: row.reason,
          createdAt: new Date(row.createdAt),
        })),
      )
    }
    for (const rows of chunks(backup.activityLog)) {
      await tx.insert(activityLog).values(
        rows.map((row) => ({
          id: uuidv7(),
          competitionId,
          eventType: row.eventType,
          actorType: row.actorType,
          actorId: null,
          entityId: remap.get(row.entityId) ?? row.entityId,
          payload: remapIdsDeep(row.payload, remap),
          reason: row.reason,
          createdAt: new Date(row.createdAt),
        })),
      )
    }

    return { competitionId }
  })
}
