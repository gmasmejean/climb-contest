/** Codes SQLSTATE Postgres utilisés ici. */
const UNIQUE_VIOLATION_CODE = '23505'
const INVALID_TEXT_REPRESENTATION_CODE = '22P02'

function pgErrorCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return undefined
  if ('code' in error && error.code !== undefined) return error.code
  // drizzle-orm enveloppe l'erreur `pg` d'origine (qui porte `.code`, le
  // SQLSTATE) dans une `DrizzleQueryError` — le code réel est sur `.cause`.
  if ('cause' in error) return pgErrorCode(error.cause)
  return undefined
}

export function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === UNIQUE_VIOLATION_CODE
}

/**
 * Un identifiant mal formé dans un paramètre de chemin (ex. `GET
 * /competitions/pas-un-uuid`) atteint directement Postgres, qui le refuse
 * en erreur de bas niveau plutôt qu'un 404/400 propre — les schémas Zod ne
 * couvrent que le corps des requêtes, pas les segments d'URL. Rattrapé une
 * seule fois, globalement, dans `errorHandler` plutôt que voie par voie.
 */
export function isInvalidTextRepresentation(error: unknown): boolean {
  return pgErrorCode(error) === INVALID_TEXT_REPRESENTATION_CODE
}
