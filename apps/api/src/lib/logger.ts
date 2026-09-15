import pino, { type Logger } from 'pino'

import type { Env } from '../env'

export function createLogger(env: Env): Logger {
  return pino(
    env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty' } }
      : { level: 'info' },
  )
}

export type { Logger }
