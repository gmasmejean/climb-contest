import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'

import { isInvalidTextRepresentation } from '../lib/pg-errors'

export type ProblemStatus = 400 | 401 | 403 | 404 | 409 | 422 | 423 | 429 | 500

export class ApiError extends Error {
  constructor(
    public readonly status: ProblemStatus,
    public readonly title: string,
    public readonly detail?: string,
  ) {
    super(detail ?? title)
  }
}

export function problem(c: Context, status: ProblemStatus, title: string, detail?: string) {
  c.status(status)
  return c.json({
    type: 'about:blank',
    title,
    status,
    ...(detail ? { detail } : {}),
    instance: c.req.path,
  })
}

export function errorHandler(err: Error, c: Context): Response | Promise<Response> {
  if (err instanceof ApiError) {
    return problem(c, err.status, err.title, err.detail)
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
