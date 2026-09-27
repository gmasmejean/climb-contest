import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { createLocationMap as CreateLocationMap } from '../lib/leaflet-map'
import LocationMap from './LocationMap.vue'

const { createLocationMap, destroy } = vi.hoisted(() => {
  const destroy = vi.fn()
  return { destroy, createLocationMap: vi.fn<typeof CreateLocationMap>(() => ({ destroy })) }
})
vi.mock('../lib/leaflet-map', () => ({ createLocationMap }))

const located = {
  label: '8 Boulevard du Port 80000 Amiens',
  postcode: '80000',
  city: 'Amiens',
  latitude: 49.897442,
  longitude: 2.290084,
}
const manual = {
  label: 'Gymnase Jules-Verne, Amiens',
  postcode: null,
  city: null,
  latitude: null,
  longitude: null,
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value })
}

describe('LocationMap', () => {
  beforeEach(() => {
    setOnline(true)
    createLocationMap.mockClear()
    destroy.mockClear()
  })
  afterEach(() => setOnline(true))

  it('affiche la carte, l’adresse et le lien « Itinéraire » vers la position', async () => {
    const wrapper = mount(LocationMap, { props: { address: located }, attachTo: document.body })
    await flushPromises()
    expect(createLocationMap).toHaveBeenCalledTimes(1)
    expect(createLocationMap.mock.calls[0]?.[1]).toEqual({
      latitude: 49.897442,
      longitude: 2.290084,
    })
    expect(wrapper.find('[data-testid="location-map"]').attributes('aria-label')).toBe(
      'Carte : 8 Boulevard du Port 80000 Amiens',
    )
    const link = wrapper.find('a')
    expect(link.attributes('href')).toContain('destination=49.897442%2C2.290084')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
    wrapper.unmount()
    expect(destroy).toHaveBeenCalled()
  })

  it('sans position : ni carte ni chargement de Leaflet, mais l’adresse et l’itinéraire', async () => {
    const wrapper = mount(LocationMap, { props: { address: manual } })
    await flushPromises()
    expect(createLocationMap).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="location-map"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Gymnase Jules-Verne, Amiens')
    expect(wrapper.find('a').attributes('href')).toContain('destination=Gymnase')
  })

  it('hors ligne : pas de carte, l’adresse reste ; elle revient avec le réseau', async () => {
    setOnline(false)
    const wrapper = mount(LocationMap, { props: { address: located }, attachTo: document.body })
    await flushPromises()
    expect(createLocationMap).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('8 Boulevard du Port 80000 Amiens')

    setOnline(true)
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(createLocationMap).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('les tuiles ne viennent pas : la carte s’efface', async () => {
    const wrapper = mount(LocationMap, { props: { address: located }, attachTo: document.body })
    await flushPromises()
    const onTilesUnavailable = createLocationMap.mock.calls[0]?.[2]
    expect(onTilesUnavailable).toBeTypeOf('function')
    onTilesUnavailable?.()
    await flushPromises()
    expect(wrapper.find('[data-testid="location-map"]').exists()).toBe(false)
    expect(destroy).toHaveBeenCalled()
    expect(wrapper.text()).toContain('Itinéraire')
    wrapper.unmount()
  })

  it('une autre adresse redessine la carte', async () => {
    const wrapper = mount(LocationMap, { props: { address: located }, attachTo: document.body })
    await flushPromises()
    await wrapper.setProps({ address: { ...located, latitude: 48.85, longitude: 2.35 } })
    await flushPromises()
    expect(createLocationMap).toHaveBeenCalledTimes(2)
    expect(destroy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})
