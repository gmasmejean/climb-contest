import type { Ascent, CorrectLastAscentInput, CreateAscentInput } from '@climbcontest/contracts'

import { judgeAscentsApi } from '../api/judge-ascents'

/**
 * Point de passage unique de toute mutation de saisie juge (ROADMAP.md
 * Lot 5 : « mutations passant par une seule fonction »). Triviale
 * aujourd'hui à dessein — la valeur est le point d'appel unique, pas la
 * logique : le Lot 6 changera l'intérieur (file IndexedDB, retries) sans
 * toucher les appelants (`JudgeAscentEntry.vue`, `useAscentRowState.ts`).
 */
export function recordAscent(input: CreateAscentInput): Promise<Ascent> {
  return judgeAscentsApi.create(input)
}

export function correctLastAscent(input: CorrectLastAscentInput): Promise<Ascent> {
  return judgeAscentsApi.correctLast(input)
}
