import { z } from 'zod'

/**
 * RGPD (ROADMAP.md Lot 9, DECISIONS.md ADR-051) : les compétiteurs sont
 * majoritairement mineurs. Export et purge sont MANUELS, réservés au
 * propriétaire de l'organisation ; l'application se contente de rappeler quand une
 * compétition a dépassé la durée de conservation proposée.
 */

/** Durées de conservation proposées (SPEC.md §6.4) : archivage à 2 ans, purge à 5 ans. */
export const ARCHIVE_AFTER_YEARS = 2
export const PURGE_AFTER_YEARS = 5

export type RetentionStatus = 'ok' | 'archive_due' | 'purge_due'

/**
 * Où en est une compétition au regard de la durée de conservation, à partir de
 * sa date de FIN (`YYYY-MM-DD`). Pure, sans fuseau : on compare des dates de
 * calendrier, jamais des instants — `Date.now()` n'est pas appelé ici.
 */
export function retentionStatus(endsOn: string, today: string): RetentionStatus {
  const [endYear, endMonth, endDay] = endsOn.split('-').map(Number)
  const [year, month, day] = today.split('-').map(Number)
  if (
    endYear === undefined ||
    endMonth === undefined ||
    endDay === undefined ||
    year === undefined ||
    month === undefined ||
    day === undefined
  ) {
    return 'ok'
  }
  // Nombre d'années ENTIÈRES écoulées depuis la fin de la compétition.
  let elapsed = year - endYear
  if (month < endMonth || (month === endMonth && day < endDay)) elapsed -= 1
  if (elapsed >= PURGE_AFTER_YEARS) return 'purge_due'
  if (elapsed >= ARCHIVE_AFTER_YEARS) return 'archive_due'
  return 'ok'
}

/** `DELETE .../personal-data` : retaper le nom EXACT de la compétition (action irréversible). */
export const purgePersonalDataInputSchema = z.object({ confirmName: z.string() })
export type PurgePersonalDataInput = z.infer<typeof purgePersonalDataInputSchema>

export const purgePersonalDataResultSchema = z.object({
  purgedAt: z.iso.datetime(),
  anonymizedCompetitors: z.number().int(),
  revokedJudges: z.number().int(),
  deletedVideos: z.number().int(),
})
export type PurgePersonalDataResult = z.infer<typeof purgePersonalDataResultSchema>
