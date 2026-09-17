const STORAGE_KEY = 'climbcontest.judge.deviceId'

/**
 * `ascent.deviceId` est `NOT NULL` (SPEC.md § 5 : « quel appareil a saisi »)
 * — un identifiant stable par navigateur, indépendant du compte juge (un
 * même appareil peut servir à plusieurs juges dans la journée).
 */
export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY)
    if (existing) return existing
    const id = crypto.randomUUID()
    localStorage.setItem(STORAGE_KEY, id)
    return id
  } catch {
    // Navigation privée ou quota plein : un id non persisté suffit pour la
    // durée de la session en cours.
    return crypto.randomUUID()
  }
}
