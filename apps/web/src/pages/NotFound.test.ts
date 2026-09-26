import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import NotFound from './NotFound.vue'

async function mountAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFound },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(NotFound, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('NotFound', () => {
  it('dit que la page est introuvable et rappelle l’adresse tapée', async () => {
    const wrapper = await mountAt('/connexion')

    expect(wrapper.get('h1').text()).toBe('Page introuvable')
    expect(wrapper.get('code').text()).toBe('/connexion')
  })

  it('propose de repartir de l’accueil', async () => {
    const wrapper = await mountAt('/nimporte/quoi')

    // Le logo de l'en-tête pointe aussi vers `/` : on vise le bouton par son texte.
    const link = wrapper.findAll('a').find((a) => a.text() === 'Retour à l’accueil')
    expect(link?.attributes('href')).toBe('/')
  })
})
