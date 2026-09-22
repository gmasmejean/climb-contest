/**
 * État du formulaire de correction / saisie de secours, partagé par la liste
 * par voie et la matrice compétiteurs × voies (Lot 20). Hors du composant,
 * comme les types de `DataList` : un `<script setup>` ne peut rien exporter.
 */
export interface AscentEditTarget {
  mode: 'create' | 'correct'
  /** Ce qu'on est en train de noter, en toutes lettres, pour l'en-tête. */
  subject: string
  roundId: string
  routeId: string
  competitorId: string
  ascentId: string | null
  holdNumber: number | null
  modifier: 'none' | 'plus'
  isTop: boolean
  status: 'valid' | 'dns' | 'dnf' | 'dsq'
  reason: string
  /** Borne du pavé de prise, quand le nombre de prises de la voie est connu. */
  holdCount: number | null
}
