import { z } from 'zod'

/**
 * Adresse d'un lieu (ADR-088) : un libellé, avec ou sans position. Choisir une
 * proposition de la Base Adresse Nationale remplit tout ; une saisie libre (ou
 * un service qui ne répond pas) ne donne que le libellé, sans carte. Sert à
 * l'organisation, et servira au lieu des compétitions (Lot 26).
 */
export const addressSchema = z
  .strictObject({
    label: z
      .string()
      .trim()
      .min(1, 'Indiquez l’adresse.')
      .max(300, 'L’adresse ne peut pas dépasser 300 caractères.'),
    postcode: z
      .string()
      .regex(/^\d{5}$/)
      .nullable(),
    city: z.string().trim().min(1).max(120).nullable(),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    /** Identifiant `id` du résultat BAN (clé d'interopérabilité). */
    banId: z.string().trim().min(1).max(100).nullable(),
  })
  .refine((address) => (address.latitude === null) === (address.longitude === null), {
    message: 'Une position a toujours une latitude et une longitude.',
    path: ['latitude'],
  })
export type Address = z.infer<typeof addressSchema>

/** Ce que le public voit d'une adresse : pas l'identifiant BAN, inutile hors saisie. */
export const publicAddressSchema = z.strictObject({
  label: z.string(),
  postcode: z.string().nullable(),
  city: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
})
export type PublicAddress = z.infer<typeof publicAddressSchema>
