import type { RouteHold } from '@climbcontest/contracts'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import HoldAnnotator from './HoldAnnotator.vue'

const mounted: VueWrapper[] = []

function mountIt(props: {
  holdCount: number | null
  holds?: RouteHold[]
  imageUrl?: string | null
}) {
  const wrapper = mount(HoldAnnotator, {
    attachTo: document.body,
    props: {
      imageUrl: 'blob:photo',
      routeNumber: null,
      holds: [],
      'onUpdate:modelValue': (value: RouteHold[]) => wrapper.setProps({ modelValue: value }),
      ...props,
      modelValue: props.holds ?? [],
    },
  })
  mounted.push(wrapper)
  const frame = wrapper.get('[data-testid="photo-frame"]')
  vi.spyOn(frame.element, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 200,
    bottom: 400,
    width: 200,
    height: 400,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  return wrapper
}

const tap = (wrapper: VueWrapper, x: number, y: number) =>
  wrapper.get('[data-testid="photo-frame"]').trigger('click', { clientX: x, clientY: y })
const counter = (wrapper: VueWrapper) => wrapper.get('[data-testid="hold-counter"]').text()

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

describe('HoldAnnotator — sans plafond (création de voie)', () => {
  it('compte les prises placées, sans « sur N »', async () => {
    const wrapper = mountIt({ holdCount: null })
    expect(counter(wrapper)).toBe('0 prise placée')

    await tap(wrapper, 100, 300)
    expect(counter(wrapper)).toBe('1 prise placée')
    await tap(wrapper, 100, 100)
    expect(counter(wrapper)).toBe('2 prises placées')
  })

  it('ne refuse jamais une prise de plus', async () => {
    const wrapper = mountIt({ holdCount: null })

    for (let i = 0; i < 30; i += 1) await tap(wrapper, 100, 10 + i * 12)

    expect(counter(wrapper)).toBe('30 prises placées')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('numérote de bas en haut à la demande', async () => {
    const wrapper = mountIt({ holdCount: null })
    await tap(wrapper, 100, 100) // posée en haut, numéro 1
    await tap(wrapper, 100, 350) // posée en bas, numéro 2

    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Renuméroter de bas en haut')
      ?.trigger('click')

    const bottom = wrapper.get('[data-testid="hold-marker"][data-number="1"]')
    expect(bottom.attributes('style')).toContain('top: 87.5%')
  })
})

describe('HoldAnnotator — avec plafond (voie enregistrée)', () => {
  it('refuse la prise au-delà du nombre de prises de la voie, avec la marche à suivre', async () => {
    const wrapper = mountIt({ holdCount: 1 })
    await tap(wrapper, 100, 300)

    await tap(wrapper, 100, 100)

    expect(wrapper.get('[role="alert"]').text()).toContain(
      'Les 1 prises de la voie sont déjà placées',
    )
    expect(counter(wrapper)).toBe('1 prise placée sur 1')
  })

  it('dit combien il en manque', () => {
    const wrapper = mountIt({ holdCount: 5, holds: [{ number: 1, x: 0.5, y: 0.5 }] })

    expect(counter(wrapper)).toBe('1 prise placée sur 5 — il en manque 4.')
  })
})

describe('HoldAnnotator — image', () => {
  it('sans image, dit qu’elle charge et ne pose rien', async () => {
    const wrapper = mountIt({ holdCount: null, imageUrl: null })

    await tap(wrapper, 100, 100)

    expect(wrapper.text()).toContain('Chargement de la photo')
    expect(counter(wrapper)).toBe('0 prise placée')
  })

  it('décrit l’image avec le numéro de la voie quand il est connu', async () => {
    const wrapper = mountIt({ holdCount: null })
    expect(wrapper.get('img').attributes('alt')).toBe('Photo de la voie')

    await wrapper.setProps({ routeNumber: 4 })

    expect(wrapper.get('img').attributes('alt')).toBe('Photo de la voie 4')
  })
})
