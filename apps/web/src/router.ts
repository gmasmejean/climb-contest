import { createRouter, createWebHistory } from 'vue-router'

import { bootstrapSession } from './api/client'
import { currentUser } from './api/session'

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
      path: '/',
      name: 'home',
      component: () => import('./pages/Home.vue'),
      meta: { requiresAuth: true },
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
      path: '/competitions/:id',
      name: 'competition-detail',
      component: () => import('./pages/competitions/CompetitionDetail.vue'),
      meta: { requiresAuth: true },
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
      // `JudgeLayout` monte le bandeau de synchronisation UNE SEULE FOIS
      // (Lot 6, ROADMAP.md point 6) pour les trois écrans juge authentifiés.
      path: '/j',
      component: () => import('./pages/judge/JudgeLayout.vue'),
      meta: { skipOrganizerSession: true },
      children: [
        {
          path: 'home',
          name: 'judge-home',
          component: () => import('./pages/judge/JudgeHome.vue'),
        },
        {
          path: 'routes/:routeId',
          name: 'judge-route',
          component: () => import('./pages/judge/JudgeRoute.vue'),
        },
        {
          path: 'routes/:routeId/competitors/:competitorId',
          name: 'judge-ascent-entry',
          component: () => import('./pages/judge/JudgeAscentEntry.vue'),
        },
      ],
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

  if (to.meta.requiresAuth && !currentUser.value) {
    return { name: 'login' }
  }
  if (to.meta.guestOnly && currentUser.value) {
    return { name: 'home' }
  }
  return true
})

export default router
