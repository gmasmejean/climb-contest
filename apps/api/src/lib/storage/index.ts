import type { StorageConfig } from './config'
import { LocalDiskStorage } from './local-disk'
import type { StorageAdapter } from './storage'

export * from './storage'
export { LocalDiskStorage } from './local-disk'

export { loadStorageConfig, type StorageConfig } from './config'

/**
 * Fabrique de l'adaptateur configuré. `s3` n'est volontairement PAS
 * implémenté (ADR-058) : il échoue ici, explicitement, plutôt que de faire
 * semblant — `CLAUDE.md` : « si une partie n'est pas implémentée, elle jette
 * une erreur explicite ».
 */
export function createStorageAdapter(config: StorageConfig): StorageAdapter {
  if (config.STORAGE_DRIVER === 's3') {
    throw new Error(
      'STORAGE_DRIVER=s3 n’est pas implémenté dans cette version (DECISIONS.md ADR-058). Utilisez STORAGE_DRIVER=local-disk.',
    )
  }
  return new LocalDiskStorage(config.STORAGE_LOCAL_DIR)
}
