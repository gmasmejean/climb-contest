/**
 * Assigns ranks from groups that are already sorted and already grouped by
 * strict equality (sorting and detecting equality remain the caller's
 * responsibility, since only it knows its own tie-break cascade).
 *
 * Rank of group g = 1 + the number of items in all preceding groups; every
 * item in a group gets that same rank. This is the "1, 2, 2, 4" rule from
 * SPEC.md §4.2: ties shift the next rank, never (1, 2, 2, 3).
 *
 * An empty group is skipped (consumes no rank) rather than rejected: this
 * simplifies callers that build their groups by filtering.
 */
export function assignRanksFromGroups<T>(
  orderedTieGroups: readonly (readonly T[])[],
): Array<{ item: T; rank: number }> {
  const result: Array<{ item: T; rank: number }> = []
  let rank = 1

  for (const group of orderedTieGroups) {
    for (const item of group) {
      result.push({ item, rank })
    }
    rank += group.length
  }

  return result
}

/**
 * Sorts `items` by `key` (ascending or descending), then groups consecutive
 * items with a strictly equal key. Used everywhere a tie-break cascade must
 * first order by a numeric criterion before it can tell who is genuinely
 * tied.
 */
export function clusterBySortedKey<T>(
  items: readonly T[],
  key: (item: T) => number,
  order: 'asc' | 'desc' = 'asc',
): T[][] {
  const direction = order === 'asc' ? 1 : -1
  const sorted = [...items].sort((a, b) => direction * (key(a) - key(b)))

  const groups: T[][] = []
  let currentGroup: T[] = []
  let currentKey: number | undefined

  for (const item of sorted) {
    const itemKey = key(item)
    if (currentGroup.length > 0 && itemKey === currentKey) {
      currentGroup.push(item)
    } else {
      currentGroup = [item]
      groups.push(currentGroup)
      currentKey = itemKey
    }
  }

  return groups
}
