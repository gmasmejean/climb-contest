import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CompetitorImportWizard from './CompetitorImportWizard.vue'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function selectFile(wrapper: ReturnType<typeof mount>, content: string, name: string) {
  const file = new File([content], name, { type: 'text/csv' })
  const input = wrapper.find('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
}

describe('CompetitorImportWizard', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("affiche le rapport d'aperçu et bloque la confirmation s'il reste des erreurs", async () => {
    const report = {
      committed: false,
      totalRows: 1,
      validRows: 0,
      rows: [
        {
          line: 2,
          bib: null,
          firstName: 'Léa',
          lastName: 'Martin',
          categoryLabel: 'Catégorie fantôme',
          birthYear: null,
          clubName: null,
          licenseNumber: null,
          errors: ['Catégorie « Catégorie fantôme » introuvable pour cette compétition.'],
        },
      ],
    }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(report))

    const wrapper = mount(CompetitorImportWizard, { props: { competitionId: 'comp-1' } })
    await selectFile(
      wrapper,
      'prenom,nom,categorie\nLéa,Martin,Catégorie fantôme\n',
      'competiteurs.csv',
    )
    await wrapper.find('button').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('0 / 1 ligne(s) valide(s)'))

    expect(wrapper.text()).toContain('introuvable')
    const commitButton = wrapper
      .findAll('button')
      .find((b) => b.text().includes("Confirmer l'import"))
    expect(commitButton?.attributes('disabled')).toBeDefined()
  })

  it('confirme et affiche le succès quand le fichier est entièrement valide', async () => {
    const previewReport = {
      committed: false,
      totalRows: 1,
      validRows: 1,
      rows: [
        {
          line: 2,
          bib: 1,
          firstName: 'Léa',
          lastName: 'Martin',
          categoryLabel: 'U16 Femme',
          birthYear: null,
          clubName: null,
          licenseNumber: null,
          errors: [],
        },
      ],
    }
    const commitReport = { ...previewReport, committed: true }
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(previewReport))
      .mockResolvedValueOnce(jsonResponse(commitReport, 201))

    const wrapper = mount(CompetitorImportWizard, { props: { competitionId: 'comp-1' } })
    await selectFile(wrapper, 'prenom,nom,categorie\nLéa,Martin,U16 Femme\n', 'competiteurs.csv')
    await wrapper.find('button').trigger('click')
    await vi.waitFor(() =>
      expect(wrapper.findAll('button').some((b) => b.text().includes("Confirmer l'import"))).toBe(
        true,
      ),
    )

    const commitButton = wrapper
      .findAll('button')
      .find((b) => b.text().includes("Confirmer l'import"))
    expect(commitButton?.attributes('disabled')).toBeUndefined()
    await commitButton?.trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('importé(s) avec succès'))

    expect(wrapper.emitted('imported')).toHaveLength(1)
  })
})
