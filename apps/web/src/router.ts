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
  ],
})

let bootstrapped = false

router.beforeEach(async (to) => {
  if (!bootstrapped) {
    bootstrapped = true
    await bootstrapSession()
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
