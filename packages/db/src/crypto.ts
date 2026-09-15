import { createHash, randomBytes } from 'node:crypto'

import { argon2id, hash, verify } from 'argon2'

const BASE62_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** Jeton secret aléatoire (32 octets par défaut), encodé en base62. */
export function randomToken(byteLength = 32): string {
  let result = ''
  for (const byte of randomBytes(byteLength)) {
    result += BASE62_ALPHABET[byte % BASE62_ALPHABET.length]
  }
  return result
}

/**
 * argon2id — réservé aux secrets à faible entropie choisis par un humain
 * (mot de passe, PIN juge). Coûteux par conception, pour résister au brute
 * force.
 */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, { type: argon2id })
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password)
  } catch {
    return false
  }
}

/**
 * SHA-256 — pour les jetons opaques déjà à haute entropie (vérification
 * d'e-mail, invitation, refresh token, jeton d'accès juge) : un hachage
 * rapide suffit puisque le secret n'est jamais deviné par force brute,
 * seulement volé en base — et un hachage déterministe permet une recherche
 * directe `WHERE token_hash = …`, ce qu'argon2id (salé aléatoirement) ne
 * permet pas.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
