import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import JudgeQrCode from './JudgeQrCode.vue'

const mounted: VueWrapper[] = []

async function mountQr(url: string, judgeName = 'Léa Martin') {
  const wrapper = mount(JudgeQrCode, { props: { url, judgeName } })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
})

describe('JudgeQrCode', () => {
  it('dessine un QR nommé, lisible par un lecteur d’écran', async () => {
    const wrapper = await mountQr('https://exemple.test/j/abc123')

    const qr = wrapper.get('[data-testid="judge-qr-code"]')
    expect(qr.attributes('role')).toBe('img')
    expect(qr.attributes('aria-label')).toBe("QR code d'accès de Léa Martin")
    expect(qr.html()).toContain('<svg')
  })

  it('redessine quand le lien change, et ignore une réponse en retard', async () => {
    const wrapper = await mountQr('https://exemple.test/j/abc123')
    const first = wrapper.get('[data-testid="judge-qr-code"]').html()

    await wrapper.setProps({ url: 'https://exemple.test/j/zzz999' })
    await flushPromises()

    expect(wrapper.get('[data-testid="judge-qr-code"]').html()).not.toBe(first)
  })

  it('le dit plutôt que d’afficher un carré vide quand le dessin échoue', async () => {
    const qrcode = await import('qrcode')
    vi.spyOn(qrcode.default, 'toString').mockRejectedValue(new Error('trop long'))

    const wrapper = await mountQr('https://exemple.test/j/abc123')

    expect(wrapper.find('[data-testid="judge-qr-code"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Le QR code n’a pas pu être dessiné')
  })
})
