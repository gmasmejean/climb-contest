import { createHash, randomBytes } from 'node:crypto'

import { argon2id, hash, verify } from 'argon2'

const BASE62_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
// 256 n'est pas un multiple de 62 : `byte % 62` sur-représenterait légèrement
// les 8 premiers caractères de l'alphabet (valeurs d'octet 248-255 retombent
// sur 0-7). On rejette ces octets au lieu d'en prendre le modulo — voir
// TODO.md « Depuis le Lot 1 », corrigé avant que les jetons d'accès juge du
// Lot 4 ne s'appuient dessus.
const BASE62_REJECTION_THRESHOLD = 256 - (256 % BASE62_ALPHABET.length)

/** Jeton secret aléatoire (32 octets par défaut), encodé en base62. */
export function randomToken(byteLength = 32): string {
  let result = ''
  while (result.length < byteLength) {
    for (const byte of randomBytes(byteLength - result.length)) {
      if (byte >= BASE62_REJECTION_THRESHOLD) continue
      result += BASE62_ALPHABET[byte % BASE62_ALPHABET.length]
    }
  }
  return result
}

/** PIN juge à 6 chiffres, tirage uniforme par octet (rejection sampling, même principe que `randomToken`). */
export function randomPin(): string {
  const REJECTION_THRESHOLD = 256 - (256 % 10)
  let digits = ''
  while (digits.length < 6) {
    for (const byte of randomBytes(6 - digits.length)) {
      if (byte >= REJECTION_THRESHOLD) continue
      digits += String(byte % 10)
    }
  }
  return digits
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
