import { createRouter, createWebHistory } from 'vue-router'

import { bootstrapSession } from './api/client'
import { currentUser } from './api/session'
import { judgeAccessRevoked } from './judge/access-state'
import { judgeScreens } from './judge/screens'
import { isCompetitionTabId } from './lib/competition-tabs'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/register',
      name: 'register',
      component: () => import('./pages/Register.vue'),
      meta: { guestOnly: true },
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('./pages/Login.vue'),
      meta: { guestOnly: true },
    },
    {
      // Lot 24 (ADR-087) : ni `guestOnly` ni `requiresAuth` — accepter une
      // invitation remplace la session éventuellement ouverte sur l'appareil.
      path: '/accept-invite',
      name: 'accept-invite',
      component: () => import('./pages/AcceptInvite.vue'),
    },
    {
      path: '/organization',
      name: 'organization-profile',
      component: () => import('./pages/organization/OrganizationProfile.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/organization/members',
      name: 'organization-members',
      component: () => import('./pages/organization/OrganizationMembers.vue'),
      meta: { requiresAuth: true },
    },
    {
      // Page d'accueil publique (ADR-070) : pas d'authentification requise,
      // mais PAS de `skipOrganizerSession` non plus — la session organisateur
      // est restaurée au F5 pour afficher l'état connecté dans l'en-tête. Si
      // l'API est injoignable, la garde ci-dessous avale l'erreur et la page
      // s'affiche en anonyme.
      path: '/',
      name: 'home',
      component: () => import('./pages/Home.vue'),
    },
    {
      path: '/competitions',
      name: 'competition-list',
      component: () => import('./pages/competitions/CompetitionList.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/competitions/new',
      name: 'competition-create',
      component: () => import('./pages/competitions/CompetitionCreate.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/competitions/trash',
      name: 'competition-trash',
      component: () => import('./pages/competitions/CompetitionTrash.vue'),
      meta: { requiresAuth: true },
    },
    {
      // L'onglet vit dans l'URL (ADR-072) : rechargement, lien profond et
      // « précédent » du navigateur. Un segment inconnu est retiré ici ; le cas
      // qui dépend de la compétition (`rounds` hors phases) l'est par la page.
      path: '/competitions/:id/:tab?',
      name: 'competition-detail',
      component: () => import('./pages/competitions/CompetitionDetail.vue'),
      meta: { requiresAuth: true },
      beforeEnter: (to) =>
        to.params.tab === '' || to.params.tab === undefined || isCompetitionTabId(to.params.tab)
          ? true
          : { name: 'competition-detail', params: { id: to.params.id }, replace: true },
    },
    {
      // Pas de compte, pas de session organisateur (SPEC.md § 3.2) : ni
      // `requiresAuth` ni `guestOnly`, ce garde ne les concerne pas. Pas de
      // bandeau de synchronisation ici — aucune file avant authentification.
      path: '/j/:token',
      name: 'judge-access',
      component: () => import('./pages/judge/JudgeAccess.vue'),
      meta: { skipOrganizerSession: true },
    },
    {
      // Page publique (ROADMAP.md Lot 7) : ni auth ni brouillon, comme `/j`.
      path: '/c/:slug',
      name: 'public-competition',
      component: () => import('./pages/public/PublicCompetition.vue'),
      meta: { skipOrganizerSession: true },
    },
    {
      path: '/c/:slug/salle',
      name: 'public-room-screen',
      component: () => import('./pages/public/PublicRoomScreen.vue'),
      meta: { skipOrganizerSession: true },
    },
    {
      // Lot 21 (ADR-078) : hors de `JudgeLayout` — l'écran dit lui-même où en
      // est la file, et doit s'afficher même une fois le jeton retiré.
      path: '/j/revoked',
      name: 'judge-revoked',
      component: judgeScreens.revoked,
      meta: { skipOrganizerSession: true },
    },
    {
      // `JudgeLayout` monte le bandeau de synchronisation UNE SEULE FOIS
      // (Lot 6, ROADMAP.md point 6) pour les trois écrans juge authentifiés.
      path: '/j',
      component: judgeScreens.layout,
      meta: { skipOrganizerSession: true, judgeEntryScreen: true },
      children: [
        {
          path: 'home',
          name: 'judge-home',
          component: judgeScreens.home,
        },
        {
          path: 'routes/:routeId',
          name: 'judge-route',
          component: judgeScreens.route,
        },
        {
          path: 'routes/:routeId/competitors/:competitorId',
          name: 'judge-ascent-entry',
          component: judgeScreens.ascentEntry,
        },
      ],
    },
    {
      // Toute autre adresse : une page qui le dit, au lieu d'une page blanche.
      // Pas de session organisateur à restaurer : elle s'affiche sans réseau.
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('./pages/NotFound.vue'),
      meta: { skipOrganizerSession: true },
    },
  ],
})

let bootstrapped = false

router.beforeEach(async (to) => {
  // Les écrans juge n'ont pas de session organisateur (SPEC.md § 3.2) — et
  // surtout, AUCUN écran juge ne doit dépendre d'une requête réseau pour
  // s'afficher (CLAUDE.md), y compris ce premier appel : au premier
  // chargement hors ligne (onglet fermé/rouvert en mode avion, Lot 6), un
  // `fetch` qui échoue par manque de réseau (pas juste un 401) rejetterait
  // sinon la navigation ENTIÈRE avant même d'atteindre la garde ci-dessous.
  // La page publique (`/c`, Lot 7) n'a pas non plus de session organisateur
  // — même logique, étendue par extension d'ADR-038.
  //
  // Le drapeau est porté par la route (`meta.skipOrganizerSession`), jamais
  // déduit d'un préfixe de chemin : un `startsWith('/c')` attrapait aussi
  // `/competitions/...`, si bien qu'un F5 sur une route organisateur ne
  // restaurait pas la session (TODO.md § Lot 8, corrigé au Lot 9).
  if (!bootstrapped && !to.meta.skipOrganizerSession) {
    bootstrapped = true
    try {
      await bootstrapSession()
    } catch {
      // Hors ligne ou serveur injoignable au démarrage : dégradation propre
      // (SPEC.md § 6.1) — on continue sans session restaurée, jamais un
      // écran blanc.
    }
  }

  // ADR-078 : un accès révoqué ne revoit plus aucun écran de saisie. Lecture
  // locale (localStorage) — aucune requête, comme l'exige tout écran juge.
  if (to.meta.judgeEntryScreen && judgeAccessRevoked.value) {
    return { name: 'judge-revoked', replace: true }
  }

  if (to.meta.requiresAuth && !currentUser.value) {
    return { name: 'login' }
  }
  if (to.meta.guestOnly && currentUser.value) {
    return { name: 'competition-list' }
  }
  return true
})

export default router
