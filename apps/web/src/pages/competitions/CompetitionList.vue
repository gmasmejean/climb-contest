<script setup lang="ts">
import { Badge, Button } from '@climbcontest/ui'
import { useQuery } from '@tanstack/vue-query'
import { RouterLink } from 'vue-router'

import { competitionsApi } from '../../api/competitions'

const { data, isPending, isError } = useQuery({
  queryKey: ['competitions'],
  queryFn: competitionsApi.list,
})

const statusLabels: Record<string, string> = {
  draft: 'Brouillon',
  open: 'Ouverte',
  running: 'En cours',
  closed: 'Clôturée',
  archived: 'Archivée',
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-lg flex-col gap-6 px-4 py-8">
    <header class="flex items-center justify-between gap-4">
      <h1 class="text-2xl font-bold text-gray-900">Mes compétitions</h1>
      <RouterLink :to="{ name: 'competition-create' }">
        <Button>Nouvelle compétition</Button>
      </RouterLink>
    </header>

    <p v-if="isPending" class="text-gray-600">Chargement…</p>
    <p v-else-if="isError" role="alert" class="text-red-700">
      Impossible de charger vos compétitions.
    </p>
    <p v-else-if="data?.length === 0" class="text-gray-600">
      Aucune compétition pour l'instant — créez la première.
    </p>

    <ul v-else class="flex flex-col gap-3">
      <li v-for="competition in data" :key="competition.id">
        <RouterLink
          :to="{ name: 'competition-detail', params: { id: competition.id } }"
          class="flex min-h-12 items-center justify-between gap-4 rounded-lg border border-gray-200 px-4 py-3 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          <div class="flex flex-col">
            <span class="font-medium text-gray-900">{{ competition.name }}</span>
            <span class="text-sm text-gray-600"
              >{{ competition.venue }} — {{ competition.startsOn }}</span
            >
          </div>
          <Badge :tone="competition.status === 'draft' ? 'neutral' : 'success'">
            {{ statusLabels[competition.status] ?? competition.status }}
          </Badge>
        </RouterLink>
      </li>
    </ul>
  </main>
</template>
