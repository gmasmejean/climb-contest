import { describe, expect, it } from 'vitest'

import { parseCompetitorCsv } from './csv-parse'

describe('parseCompetitorCsv', () => {
  it('parse les colonnes attendues et numérote les lignes comme un tableur', () => {
    const csv =
      'dossard,prenom,nom,categorie,annee_naissance,club,licence\n1,Léa,Martin,U16 Femme,2010,,\n'
    const rows = parseCompetitorCsv(csv)
    expect(rows).toEqual([
      {
        line: 2,
        dossard: '1',
        prenom: 'Léa',
        nom: 'Martin',
        categorie: 'U16 Femme',
        annee_naissance: '2010',
        club: '',
        licence: '',
      },
    ])
  })

  it('normalise les en-têtes (accents, casse, espaces)', () => {
    const csv =
      'Dossard,Prénom,Nom,Catégorie,Année de naissance,Club,Licence\n,Léa,Martin,U16 Femme,,,\n'
    const rows = parseCompetitorCsv(csv)
    expect(rows[0]?.categorie).toBe('U16 Femme')
    expect(rows[0]?.dossard).toBe('')
  })

  it('ignore les lignes vides', () => {
    const csv = 'prenom,nom,categorie\nA,B,U16 Femme\n\n'
    expect(parseCompetitorCsv(csv)).toHaveLength(1)
  })
})
