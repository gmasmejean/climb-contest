import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'

import { isInvalidTextRepresentation } from '../lib/pg-errors'

export type ProblemStatus = 400 | 401 | 403 | 404 | 409 | 413 | 416 | 422 | 423 | 429 | 500

/**
 * Membre d'extension RFC 9457 : un code stable, lisible par le client, pour les
 * rares erreurs sur lesquelles il doit AGIR (et non seulement afficher le
 * message). ADR-078 : `judge_revoked` distingue une révocation d'un jeton expiré.
 */
export type ProblemCode = 'judge_revoked'

export class ApiError extends Error {
  constructor(
    public readonly status: ProblemStatus,
    public readonly title: string,
    public readonly detail?: string,
    public readonly code?: ProblemCode,
  ) {
    super(detail ?? title)
  }
}

export function problem(
  c: Context,
  status: ProblemStatus,
  title: string,
  detail?: string,
  code?: ProblemCode,
) {
  c.status(status)
  return c.json({
    type: 'about:blank',
    title,
    status,
    ...(detail ? { detail } : {}),
    ...(code ? { code } : {}),
    instance: c.req.path,
  })
}

export function errorHandler(err: Error, c: Context): Response | Promise<Response> {
  if (err instanceof ApiError) {
    return problem(c, err.status, err.title, err.detail, err.code)
  }
  if (err instanceof HTTPException) {
    return problem(c, err.status as ProblemStatus, err.message || 'Erreur')
  }
  if (isInvalidTextRepresentation(err)) {
    return problem(c, 400, 'Identifiant invalide', "Cet identifiant n'a pas le format attendu.")
  }
  console.error(err)
  return problem(c, 500, 'Erreur interne', "Une erreur inattendue s'est produite.")
}
