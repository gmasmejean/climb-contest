/**
 * D'où vient le lien d'accès affichable d'un juge. Deux sources, et une seule
 * règle, écrite ici parce qu'elle décide de l'affichage d'un secret :
 *
 * - le serveur le renvoie en clair quand la compétition conserve les accès
 *   (`judgeCredentialsStored`, ADR-027) ;
 * - sinon il n'existe qu'une fois, à la création, et c'est le navigateur qui le
 *   tient en mémoire pour la durée de l'onglet (ADR-026).
 *
 * Un juge révoqué n'a plus d'accès affichable, même si son jeton est encore en
 * mémoire : son lien ne mène plus nulle part.
 */

export interface RevealedToken {
  competitionId: string
  judgeId: string
  accessToken: string
}

export interface JudgeAccessSource {
  id: string
  revokedAt: Date | string | null
  /** Présent seulement si le serveur conserve le clair (ADR-027). */
  accessUrl?: string | undefined
}

/**
 * Le lien `/j/<jeton>` à montrer, ou `null` s'il n'y en a plus.
 *
 * @param origin l'origine de l'application (`window.location.origin`), qui sert
 *   à reconstruire le lien d'un jeton gardé en mémoire — le serveur, lui,
 *   renvoie déjà une URL complète.
 */
export function judgeAccessUrl(
  judge: JudgeAccessSource,
  tokens: readonly RevealedToken[],
  competitionId: string,
  origin: string,
): string | null {
  if (judge.revokedAt) return null
  if (judge.accessUrl) return judge.accessUrl
  const revealed = tokens.find(
    (token) => token.competitionId === competitionId && token.judgeId === judge.id,
  )
  return revealed ? `${origin}/j/${revealed.accessToken}` : null
}
