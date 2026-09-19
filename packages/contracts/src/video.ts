import { z } from 'zod'

/** Types de vidéo acceptés (ADR-052) : ce que la plupart des téléphones produisent. */
export const VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const
export const videoMimeTypeSchema = z.enum(VIDEO_MIME_TYPES)
export type VideoMimeType = z.infer<typeof videoMimeTypeSchema>

/** Taille d'un morceau envoyé par le client (8 Mio) — annoncée par le serveur. */
export const VIDEO_CHUNK_SIZE = 8 * 1024 * 1024

/** `POST .../routes/:rid/video/uploads` — le type déclaré n'est jamais une preuve (ADR-058). */
export const createVideoUploadInputSchema = z.object({
  sizeBytes: z.number().int().positive(),
  mimeType: videoMimeTypeSchema,
})
export type CreateVideoUploadInput = z.infer<typeof createVideoUploadInputSchema>

export const videoUploadSchema = z.object({
  uploadId: z.uuid(),
  status: z.enum(['uploading', 'completed', 'aborted']),
  declaredSizeBytes: z.number().int(),
  receivedBytes: z.number().int(),
  chunkSize: z.number().int(),
  maxBytes: z.number().int(),
})
export type VideoUpload = z.infer<typeof videoUploadSchema>

export const videoAssetSchema = z.object({
  assetId: z.uuid(),
  mimeType: videoMimeTypeSchema,
  sizeBytes: z.number().int(),
})
export type VideoAsset = z.infer<typeof videoAssetSchema>
