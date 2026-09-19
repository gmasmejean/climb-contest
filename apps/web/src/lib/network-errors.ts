import { ApiError } from '../api/client'

/**
 * Message unique pour « le serveur ne répond pas » (Lot 9, mode dégradé,
 * CLAUDE.md § 5 : une erreur dit en langage humain ce qu'il faut faire).
 * `fetch` REJETTE (TypeError) quand le réseau est coupé ou le serveur
 * injoignable — ce n'est pas une `ApiError`, le serveur n'a rien répondu.
 */
export const UNREACHABLE_MESSAGE =
  'Impossible de joindre le serveur. Vérifiez votre connexion internet, puis réessayez. Rien de ce que vous avez déjà enregistré n’est perdu.'

export function isServerUnreachable(error: unknown): boolean {
  return !(error instanceof ApiError)
}

/** Ce que le serveur a dit s'il a répondu, sinon le message « injoignable ». */
export function describeError(error: unknown, fallback = UNREACHABLE_MESSAGE): string {
  if (error instanceof ApiError) return error.detail ?? error.title
  return fallback
}
