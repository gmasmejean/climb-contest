/**
 * Modèle de catégories FFME (ROADMAP.md Lot 3, SPEC.md §1). Tranches d'âge
 * et calcul de la saison sportive d'après le texte réglementaire FFME cité
 * par l'utilisateur le 2026-09-16 (voir DECISIONS.md) :
 *
 *   U12 = 10-11 ans, U14 = 12-13, U16 = 14-15, U18 = 16-17, U20 = 18-19,
 *   Sénior = 20-39, Vétéran = 40 et plus (fusion Vétéran 1/2 du règlement,
 *   SPEC.md ne modélisant qu'une seule catégorie Vétéran).
 *
 *   « Le changement de catégorie pour une saison sportive est déterminé en
 *   prenant en référence l'année de naissance et l'année civile débutant au
 *   cours de la saison sportive » — la saison sportive commence le
 *   1ᵉʳ septembre.
 */

const FFME_AGE_BRACKETS = [
  { label: 'U12', ageMin: 10, ageMax: 11 },
  { label: 'U14', ageMin: 12, ageMax: 13 },
  { label: 'U16', ageMin: 14, ageMax: 15 },
  { label: 'U18', ageMin: 16, ageMax: 17 },
  { label: 'U20', ageMin: 18, ageMax: 19 },
  { label: 'Sénior', ageMin: 20, ageMax: 39 },
  { label: 'Vétéran', ageMin: 40, ageMax: null },
] as const

/**
 * `starts_on` est une colonne `date` Postgres (chaîne "YYYY-MM-DD"), lue
 * telle quelle sans passer par `Date` — CLAUDE.md/ROADMAP.md interdisent
 * toute dépendance au fuseau horaire dans un calcul de règle métier.
 */
export function seasonYear(startsOn: string): number {
  const [yearPart, monthPart] = startsOn.split('-')
  const year = Number(yearPart)
  const month = Number(monthPart)
  return month >= 9 ? year + 1 : year
}

export interface FfmeTemplateCategory {
  label: string
  sex: 'M' | 'F'
  birthYearMin: number | null
  birthYearMax: number | null
  displayOrder: number
}

export function buildFfmeTemplateCategories(startsOn: string): FfmeTemplateCategory[] {
  const n = seasonYear(startsOn)
  const categories: FfmeTemplateCategory[] = []
  let displayOrder = 0
  for (const bracket of FFME_AGE_BRACKETS) {
    for (const sex of ['F', 'M'] as const) {
      categories.push({
        label: `${bracket.label} ${sex === 'M' ? 'Homme' : 'Femme'}`,
        sex,
        birthYearMin: bracket.ageMax === null ? null : n - bracket.ageMax,
        birthYearMax: n - bracket.ageMin,
        displayOrder: displayOrder++,
      })
    }
  }
  return categories
}
