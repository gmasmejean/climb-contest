import { describe, expect, it } from 'vitest'

import {
  DELETE_VERBS,
  RESTORE_VERBS,
  TRASH_VERBS,
  describeBulk,
  runBulk,
  type BulkOutcome,
} from './bulk-action'

type Named = { name: string }
const coupe: Named = { name: 'Coupe d’été' }
const open: Named = { name: 'Open de Lyon' }
const trophee: Named = { name: 'Trophée' }

describe('runBulk', () => {
  it('traite tout dans l’ordre quand tout réussit', async () => {
    const seen: string[] = []
    const outcome = await runBulk(
      [coupe, open],
      (item) => {
        seen.push(item.name)
        return Promise.resolve()
      },
      () => 'jamais',
    )
    expect(seen).toEqual(['Coupe d’été', 'Open de Lyon'])
    expect(outcome).toEqual({ done: [coupe, open], failed: [] })
  })

  it('un échec n’empêche pas les suivants et garde son message', async () => {
    const outcome = await runBulk(
      [coupe, open, trophee],
      (item) => (item === open ? Promise.reject(new Error('en cours')) : Promise.resolve()),
      (error) => (error instanceof Error ? error.message : '?'),
    )
    expect(outcome.done).toEqual([coupe, trophee])
    expect(outcome.failed).toEqual([{ item: open, message: 'en cours' }])
  })

  it('ne fait rien pour une sélection vide', async () => {
    expect(
      await runBulk(
        [],
        async () => {},
        () => '',
      ),
    ).toEqual({ done: [], failed: [] })
  })
})

describe('describeBulk', () => {
  const ok = (done: Named[]): BulkOutcome<Named> => ({ done, failed: [] })

  it('nomme la compétition quand il n’y en a qu’une', () => {
    expect(describeBulk(ok([coupe]), TRASH_VERBS)).toBe(
      '« Coupe d’été » a été mise à la corbeille.',
    )
  })

  it('compte quand il y en a plusieurs, au pluriel accordé', () => {
    expect(describeBulk(ok([coupe, open, trophee]), TRASH_VERBS)).toBe(
      '3 compétitions ont été mises à la corbeille.',
    )
    expect(describeBulk(ok([coupe, open]), RESTORE_VERBS)).toBe(
      '2 compétitions ont été restaurées.',
    )
    expect(describeBulk(ok([coupe]), DELETE_VERBS)).toBe(
      '« Coupe d’été » a été supprimée définitivement.',
    )
  })

  it('dit ce qui a été fait ET ce qui ne l’a pas été, avec la raison', () => {
    const text = describeBulk(
      { done: [coupe, trophee], failed: [{ item: open, message: 'Clôturez-la d’abord.' }] },
      TRASH_VERBS,
    )
    expect(text).toBe(
      '2 compétitions ont été mises à la corbeille. Une compétition est restée telle quelle. « Open de Lyon » : Clôturez-la d’abord.',
    )
  })

  it('quand tout échoue, dit clairement que rien n’a bougé', () => {
    const text = describeBulk(
      { done: [], failed: [{ item: open, message: 'Impossible de joindre le serveur.' }] },
      TRASH_VERBS,
    )
    expect(text).toBe('Rien n’a été modifié. « Open de Lyon » : Impossible de joindre le serveur.')
  })

  it('accorde « restées telles quelles » au pluriel', () => {
    const text = describeBulk(
      {
        done: [coupe],
        failed: [
          { item: open, message: 'a' },
          { item: trophee, message: 'b' },
        ],
      },
      TRASH_VERBS,
    )
    expect(text).toContain('2 compétitions sont restées telles quelles.')
  })
})
