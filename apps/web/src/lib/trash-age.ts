/**
 * Depuis combien de temps une compétition est à la corbeille (Lot 11). Ce n'est
 * qu'une information : rien ne se supprime tout seul (ADR-063). Compte des
 * jours de calendrier LOCAUX, pas des multiples de 24 h — « hier soir » est
 * « depuis 1 jour » même à 8 h du matin.
 */
function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** `string | Date` : le schéma partagé type la date en `Date`, mais le JSON la livre en texte. */
export function daysInTrash(deletedAt: string | Date, now: Date): number {
  const days = Math.round(
    (startOfLocalDay(now) - startOfLocalDay(new Date(deletedAt))) / 86_400_000,
  )
  return Math.max(0, days)
}

export function describeTrashAge(deletedAt: string | Date, now: Date): string {
  const days = daysInTrash(deletedAt, now)
  if (days === 0) return 'Mise à la corbeille aujourd’hui'
  if (days === 1) return 'À la corbeille depuis 1 jour'
  return `À la corbeille depuis ${days} jours`
}
