import type { Address } from '@climbcontest/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { BAN_SEARCH_DELAY_MS } from '../lib/ban'
import AddressAutocomplete from './AddressAutocomplete.vue'

const feature = (label: string, id: string, lon: number, lat: number) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: { label, id, postcode: '80000', city: 'Amiens' },
})

const banResponse = {
  type: 'FeatureCollection',
  features: [
    feature('8 Boulevard du Port 80000 Amiens', '80021_6590_00008', 2.290084, 49.897442),
    feature('8 Port d’Amont 80000 Amiens', '80021_0430_00008', 2.306578, 49.895257),
  ],
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('AddressAutocomplete', () => {
  let fetchMock: Mock<typeof fetch>

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(json(banResponse)))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function mountField(modelValue: Address | null = null) {
    return mount(AddressAutocomplete, {
      props: {
        modelValue,
        label: 'Adresse',
        'onUpdate:modelValue': (value: Address | null) => {
          void wrapper.setProps({ modelValue: value })
        },
      },
      attachTo: document.body,
    })
  }
  let wrapper: ReturnType<typeof mountField>

  async function type(text: string) {
    await wrapper.find('input').setValue(text)
    await vi.advanceTimersByTimeAsync(BAN_SEARCH_DELAY_MS)
    await flushPromises()
  }

  it('attend 300 ms après la dernière frappe, et une seule requête part', async () => {
    wrapper = mountField()
    const input = wrapper.find('input')
    await input.setValue('8 bd')
    await vi.advanceTimersByTimeAsync(100)
    await input.setValue('8 bd du port')
    await vi.advanceTimersByTimeAsync(BAN_SEARCH_DELAY_MS - 1)
    expect(fetchMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toContain('q=8+bd+du+port')
    wrapper.unmount()
  })

  it('ne cherche pas en dessous de 3 caractères', async () => {
    wrapper = mountField()
    await type('8 ')
    expect(fetchMock).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('propose les adresses dans une liste, et un clic en choisit une, localisée', async () => {
    wrapper = mountField()
    await type('8 bd du port')
    const input = wrapper.find('input')
    expect(input.attributes('aria-expanded')).toBe('true')
    const options = wrapper.findAll('[role="option"]')
    expect(options.map((option) => option.text())).toEqual([
      '8 Boulevard du Port 80000 Amiens',
      '8 Port d’Amont 80000 Amiens',
    ])
    expect(wrapper.text()).toContain('2 adresses proposées.')

    await options[0]?.trigger('mousedown')
    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted?.at(-1)).toEqual([
      {
        label: '8 Boulevard du Port 80000 Amiens',
        postcode: '80000',
        city: 'Amiens',
        latitude: 49.897442,
        longitude: 2.290084,
        banId: '80021_6590_00008',
      },
    ])
    expect((input.element as HTMLInputElement).value).toBe('8 Boulevard du Port 80000 Amiens')
    expect(input.attributes('aria-expanded')).toBe('false')
    expect(wrapper.text()).toContain('Adresse localisée')
    wrapper.unmount()
  })

  it('se pilote au clavier : flèches, Entrée, Échap', async () => {
    wrapper = mountField()
    await type('8 bd du port')
    const input = wrapper.find('input')
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'ArrowDown' })
    const second = wrapper.findAll('[role="option"]')[1]
    expect(input.attributes('aria-activedescendant')).toBe(second?.attributes('id'))
    expect(second?.attributes('aria-selected')).toBe('true')
    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(input.attributes('aria-activedescendant')).toBe(
      wrapper.findAll('[role="option"]')[0]?.attributes('id'),
    )
    await input.trigger('keydown', { key: 'ArrowUp' })
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toMatchObject({
      banId: '80021_0430_00008',
    })

    await type('8 bd du port')
    await input.trigger('keydown', { key: 'Escape' })
    expect(input.attributes('aria-expanded')).toBe('false')
    wrapper.unmount()
  })

  it('garde la saisie libre, sans position, quand on ne choisit rien', async () => {
    wrapper = mountField()
    await type('Gymnase Jules-Verne, Amiens')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
      {
        label: 'Gymnase Jules-Verne, Amiens',
        postcode: null,
        city: null,
        latitude: null,
        longitude: null,
        banId: null,
      },
    ])
    expect(wrapper.text()).toContain('Adresse non localisée')
    wrapper.unmount()
  })

  it('le service ne répond pas : un message dit que l’adresse sera gardée telle quelle', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json({}, 503)))
    wrapper = mountField()
    await type('8 bd du port')
    expect(wrapper.find('[role="option"]').exists()).toBe(false)
    expect(wrapper.text()).toContain(
      'Le service d’adresses ne répond pas. Votre adresse sera enregistrée telle que vous l’avez écrite, sans carte.',
    )
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toMatchObject({
      label: '8 bd du port',
      latitude: null,
    })
    wrapper.unmount()
  })

  it('vider le champ efface l’adresse', async () => {
    wrapper = mountField({
      label: '8 Boulevard du Port 80000 Amiens',
      postcode: '80000',
      city: 'Amiens',
      latitude: 49.897442,
      longitude: 2.290084,
      banId: '80021_6590_00008',
    })
    await type('')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([null])
    wrapper.unmount()
  })

  it('suit une adresse chargée après le montage', async () => {
    wrapper = mountField()
    await wrapper.setProps({
      modelValue: {
        label: 'Gymnase Jules-Verne, Amiens',
        postcode: null,
        city: null,
        latitude: null,
        longitude: null,
        banId: null,
      },
    })
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe(
      'Gymnase Jules-Verne, Amiens',
    )
    expect(fetchMock).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
