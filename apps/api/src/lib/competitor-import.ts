import type { ImportReport, ImportRow } from '@climbcontest/contracts'
import { category, competitor, type Database } from '@climbcontest/db'
import { and, eq, isNull } from 'drizzle-orm'

import { parseCompetitorCsv } from './csv-parse'

export interface ImportableCompetitor {
  categoryId: string
  bib: number | null
  firstName: string
  lastName: string
  birthYear: number | null
  clubName: string | null
  licenseNumber: string | null
}

export interface ImportBuildResult {
  report: ImportReport
  insertable: ImportableCompetitor[]
}

const BIRTH_YEAR_MIN = 1900
const BIRTH_YEAR_MAX = 2200

function normalizeName(firstName: string, lastName: string): string {
  return `${firstName.trim().toLowerCase()}|${lastName.trim().toLowerCase()}`
}

/**
 * Ré-analyse et re-valide systématiquement, en preview comme en commit —
 * on ne fait jamais confiance à un aperçu déjà validé côté client
 * (DECISIONS.md).
 */
export async function buildImportReport(
  db: Database,
  competitionId: string,
  csv: string,
): Promise<ImportBuildResult> {
  const parsedRows = parseCompetitorCsv(csv)

  const categories = await db.query.category.findMany({
    where: and(eq(category.competitionId, competitionId), isNull(category.deletedAt)),
  })
  const categoryByLabel = new Map(categories.map((row) => [row.label.trim().toLowerCase(), row]))

  const existingCompetitors = await db.query.competitor.findMany({
    where: and(eq(competitor.competitionId, competitionId), isNull(competitor.deletedAt)),
  })
  const existingBibs = new Set(
    existingCompetitors.flatMap((row) => (row.bib === null ? [] : [row.bib])),
  )
  const existingNames = new Set(
    existingCompetitors.map((row) => normalizeName(row.firstName, row.lastName)),
  )

  const rows: ImportRow[] = []
  const insertable: ImportableCompetitor[] = []
  const seenBibsInFile = new Map<number, number>() // bib -> première ligne rencontrée
  const seenNamesInFile = new Map<string, number>() // nom normalisé -> première ligne

  for (const parsed of parsedRows) {
    const errors: string[] = []

    let bib: number | null = null
    if (parsed.dossard !== '') {
      const value = Number(parsed.dossard)
      if (!Number.isInteger(value) || value <= 0) {
        errors.push(`Dossard « ${parsed.dossard} » invalide — doit être un entier positif.`)
      } else {
        bib = value
      }
    }

    if (parsed.prenom === '') errors.push('Prénom manquant.')
    if (parsed.nom === '') errors.push('Nom manquant.')

    let matchedCategory = null
    if (parsed.categorie === '') {
      errors.push('Catégorie manquante.')
    } else {
      matchedCategory = categoryByLabel.get(parsed.categorie.trim().toLowerCase()) ?? null
      if (!matchedCategory) {
        errors.push(`Catégorie « ${parsed.categorie} » introuvable pour cette compétition.`)
      }
    }

    let birthYear: number | null = null
    if (parsed.annee_naissance !== '') {
      const value = Number(parsed.annee_naissance)
      if (!Number.isInteger(value) || value < BIRTH_YEAR_MIN || value > BIRTH_YEAR_MAX) {
        errors.push(`Année de naissance « ${parsed.annee_naissance} » invalide.`)
      } else {
        birthYear = value
      }
    }

    if (bib !== null) {
      if (existingBibs.has(bib)) {
        errors.push(`Dossard ${bib} déjà attribué dans cette compétition.`)
      }
      const firstLine = seenBibsInFile.get(bib)
      if (firstLine !== undefined) {
        errors.push(`Dossard ${bib} déjà utilisé à la ligne ${firstLine} de ce fichier.`)
        const firstRow = rows.find((row) => row.line === firstLine)
        firstRow?.errors.push(`Dossard ${bib} réutilisé à la ligne ${parsed.line} de ce fichier.`)
      } else {
        seenBibsInFile.set(bib, parsed.line)
      }
    }

    if (parsed.prenom !== '' && parsed.nom !== '') {
      const nameKey = normalizeName(parsed.prenom, parsed.nom)
      if (existingNames.has(nameKey)) {
        errors.push(`${parsed.prenom} ${parsed.nom} est déjà inscrit·e dans cette compétition.`)
      }
      const firstLine = seenNamesInFile.get(nameKey)
      if (firstLine !== undefined) {
        errors.push(
          `${parsed.prenom} ${parsed.nom} apparaît aussi à la ligne ${firstLine} de ce fichier.`,
        )
        const firstRow = rows.find((row) => row.line === firstLine)
        firstRow?.errors.push(
          `${parsed.prenom} ${parsed.nom} réapparaît à la ligne ${parsed.line}.`,
        )
      } else {
        seenNamesInFile.set(nameKey, parsed.line)
      }
    }

    rows.push({
      line: parsed.line,
      bib,
      firstName: parsed.prenom,
      lastName: parsed.nom,
      categoryLabel: parsed.categorie,
      birthYear,
      clubName: parsed.club || null,
      licenseNumber: parsed.licence || null,
      errors,
    })

    if (errors.length === 0 && matchedCategory) {
      insertable.push({
        categoryId: matchedCategory.id,
        bib,
        firstName: parsed.prenom,
        lastName: parsed.nom,
        birthYear,
        clubName: parsed.club || null,
        licenseNumber: parsed.licence || null,
      })
    }
  }

  const validRows = rows.filter((row) => row.errors.length === 0).length

  // `insertable` contient les lignes individuellement valides même si
  // d'autres lignes du fichier ne le sont pas — c'est à l'appelant (la
  // route, tout-ou-rien par décision produit, DECISIONS.md) de décider si
  // l'ensemble est assez propre pour être écrit, pas à cette fonction.
  return {
    report: { committed: false, totalRows: rows.length, validRows, rows },
    insertable,
  }
}
