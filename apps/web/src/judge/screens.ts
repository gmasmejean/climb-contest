/**
 * Chargeurs des écrans juge authentifiés, partagés par le routeur et par la
 * page d'accès. CLAUDE.md, conséquence n° 2 : aucun écran de juge ne dépend
 * d'une requête réseau pour s'afficher — or ces écrans sont des modules
 * chargés à la demande, et le précache du service worker peut ne pas être
 * terminé quand le juge descend au sous-sol juste après s'être connecté.
 * `preloadJudgeScreens` les charge donc TOUS pendant qu'il y a du réseau.
 */
export const judgeScreens = {
  layout: () => import('../pages/judge/JudgeLayout.vue'),
  home: () => import('../pages/judge/JudgeHome.vue'),
  route: () => import('../pages/judge/JudgeRoute.vue'),
  ascentEntry: () => import('../pages/judge/JudgeAscentEntry.vue'),
} as const

export async function preloadJudgeScreens(): Promise<void> {
  await Promise.all(Object.values(judgeScreens).map((load) => load()))
}
