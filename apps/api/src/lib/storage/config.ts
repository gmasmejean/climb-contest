import { z } from 'zod'

/**
 * Configuration du stockage de fichiers (Lot 9, ADR-058). Lue séparément de
 * `env.ts` : la vidéo est une fonctionnalité optionnelle branchée par
 * `index.ts`, pas un prérequis de chaque route de l'API.
 */
const storageConfigSchema = z.object({
  STORAGE_DRIVER: z.enum(['local-disk', 's3']).default('local-disk'),
  STORAGE_LOCAL_DIR: z.string().min(1).default('./data/uploads'),
  // Plafond d'une vidéo, en octets (200 Mio par défaut, 2 Gio au plus : la
  // colonne `asset.size_bytes` est un entier 32 bits).
  VIDEO_MAX_BYTES: z.coerce.number().int().positive().max(2_000_000_000).default(209_715_200),
})

export type StorageConfig = z.infer<typeof storageConfigSchema>

export function loadStorageConfig(source: NodeJS.ProcessEnv = process.env): StorageConfig {
  const result = storageConfigSchema.safeParse(source)
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')
    throw new Error(`Configuration du stockage invalide : ${details}`)
  }
  return result.data
}
