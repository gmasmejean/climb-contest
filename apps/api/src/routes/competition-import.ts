import {
  backupPreviewSchema,
  parseCompetitionBackup,
  READABLE_BACKUP_SCHEMA_VERSIONS,
  importBackupInputSchema,
  importBackupResultSchema,
} from '@climbcontest/contracts'
import type { Database } from '@climbcontest/db'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import { checkBackupIntegrity, importBackup, summarizeBackup } from '../lib/exports/backup-import'
import type { AccessTokenSigner } from '../lib/jwt'
import { requireOrganizer } from '../middleware/auth'
import { problem } from '../middleware/problem'

export const MAX_BACKUP_BYTES = 25 * 1024 * 1024

export interface CompetitionImportRouteDeps {
  db: Database
  accessTokenSigner: AccessTokenSigner
  now?: (() => Date) | undefined
}

/**
 * `POST /competitions/import` (ROADMAP.md Lot 9, point 2, DECISIONS.md
 * ADR-056) : réimport d'une sauvegarde JSON comme NOUVELLE compétition.
 * Aperçu puis validation, comme l'import CSV (ADR-024) : le serveur revalide
 * tout dans les deux modes, et n'écrit rien tant que `mode` n'est pas
 * `commit`. Réservé à un organisateur connecté ; la compétition créée
 * appartient à son club.
 */
export function createCompetitionImportRoutes(deps: CompetitionImportRouteDeps): Hono {
  const app = new Hono()
  const { db, accessTokenSigner } = deps
  const now = deps.now ?? (() => new Date())

  app.use('*', requireOrganizer(accessTokenSigner))

  app.post(
    '/',
    bodyLimit({
      maxSize: MAX_BACKUP_BYTES,
      onError: (c) =>
        problem(
          c,
          413,
          'Fichier trop volumineux',
          `Le fichier de sauvegarde dépasse ${MAX_BACKUP_BYTES / 1024 / 1024} Mo.`,
        ),
    }),
    zValidator('json', importBackupInputSchema, (result, c) => {
      if (!result.success)
        return problem(c, 400, 'Requête invalide', result.error.issues[0]?.message)
    }),
    async (c) => {
      const organizer = c.get('organizer')
      const { mode, backup: rawBackup } = c.req.valid('json')

      const parsed = parseCompetitionBackup(rawBackup)
      if (!parsed.success) {
        const version =
          typeof rawBackup === 'object' && rawBackup !== null && 'schemaVersion' in rawBackup
            ? rawBackup.schemaVersion
            : undefined
        if (
          version !== undefined &&
          !(READABLE_BACKUP_SCHEMA_VERSIONS as readonly unknown[]).includes(version)
        ) {
          return problem(
            c,
            400,
            'Sauvegarde non compatible',
            `Ce fichier est au format ${typeof version === 'number' || typeof version === 'string' ? String(version) : 'inconnu'}, cette version de l’application ne lit que les formats ${READABLE_BACKUP_SCHEMA_VERSIONS.join(' et ')}.`,
          )
        }
        const first = parsed.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join('.') || 'fichier'} : ${issue.message}`)
          .join(' ; ')
        return problem(
          c,
          400,
          'Fichier de sauvegarde invalide',
          `Ce fichier n’est pas une sauvegarde ClimbContest valide. ${first}`,
        )
      }

      const integrityErrors = checkBackupIntegrity(parsed.data)
      if (integrityErrors.length > 0) {
        return problem(
          c,
          400,
          'Sauvegarde incohérente',
          `Rien n’a été importé. ${integrityErrors.slice(0, 5).join(' ')}${
            integrityErrors.length > 5
              ? ` (et ${integrityErrors.length - 5} autre(s) problème(s))`
              : ''
          }`,
        )
      }

      if (mode === 'preview') {
        return c.json(backupPreviewSchema.parse(summarizeBackup(parsed.data)))
      }

      const result = await importBackup(
        db,
        parsed.data,
        { clubId: organizer.clubId, userId: organizer.sub },
        now(),
      )
      return c.json(importBackupResultSchema.parse(result), 201)
    },
  )

  return app
}
