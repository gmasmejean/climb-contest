import Papa from 'papaparse'

/**
 * Colonnes attendues du CSV compétiteurs (DECISIONS.md) : dossard
 * (optionnel), prenom, nom, categorie, annee_naissance (optionnel), club
 * (optionnel), licence (optionnel). En-têtes normalisés (minuscules, sans
 * accents, espaces → underscore) pour accepter « Catégorie », « Année de
 * naissance », etc.
 */
export interface ParsedCsvRow {
  line: number
  dossard: string
  prenom: string
  nom: string
  categorie: string
  annee_naissance: string
  club: string
  licence: string
}

function normalizeHeader(header: string): string {
  return header.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, '_')
}

/**
 * Pure : ne touche pas à la base. La ligne 1 est l'en-tête ; `line` compte
 * les lignes du fichier telles qu'un organisateur les verrait dans un
 * tableur (l'en-tête est la ligne 1, la première donnée la ligne 2).
 */
export function parseCompetitorCsv(csv: string): ParsedCsvRow[] {
  const result = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeHeader,
  })

  return result.data.map((row, index) => ({
    line: index + 2,
    dossard: (row['dossard'] ?? '').trim(),
    prenom: (row['prenom'] ?? '').trim(),
    nom: (row['nom'] ?? '').trim(),
    categorie: (row['categorie'] ?? '').trim(),
    annee_naissance: (row['annee_naissance'] ?? '').trim(),
    club: (row['club'] ?? '').trim(),
    licence: (row['licence'] ?? '').trim(),
  }))
}
