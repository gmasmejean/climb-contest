<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { computed } from 'vue'

import { isHttpUrl } from '@climbcontest/contracts'

import { publicApi, publicQueryKeys } from '../../api/public'
import { parseVideoEmbed } from '../../lib/video-embed'

const props = defineProps<{ slug: string; categoryId: string }>()

const { data, isPending, isError } = useQuery({
  queryKey: computed(() => publicQueryKeys.routes(props.slug, props.categoryId)),
  queryFn: () => publicApi.routes(props.slug, props.categoryId),
  refetchOnWindowFocus: false,
})
</script>

<template>
  <section aria-label="Voies">
    <p v-if="isPending" class="text-gray-600">Chargement…</p>
    <p v-else-if="isError" role="alert" class="text-red-700">Impossible de charger les voies.</p>
    <p v-else-if="data?.length === 0" class="text-gray-600">Aucune voie pour cette catégorie.</p>

    <ul v-else-if="data" class="flex flex-col gap-4">
      <li v-for="routeItem in data" :key="routeItem.id" class="rounded-lg border border-gray-200 p-3">
        <div class="flex items-center justify-between gap-2">
          <span class="font-medium text-gray-900">
            Voie {{ routeItem.number }}<template v-if="routeItem.name"> — {{ routeItem.name }}</template>
          </span>
          <span v-if="routeItem.color" class="text-sm text-gray-600">{{ routeItem.color }}</span>
        </div>
        <p class="text-sm text-gray-600">
          {{ routeItem.holdCount }} prises<template v-if="routeItem.sector">
            — {{ routeItem.sector }}</template
          >
        </p>

        <!-- Vidéo téléversée (Lot 9, ADR-058) : lue depuis l'API avec `Range`. -->
        <video
          v-if="routeItem.hasUploadedVideo"
          class="mt-2 aspect-video w-full rounded-lg bg-black"
          controls
          preload="metadata"
          playsinline
          :src="`/api/v1/public/${slug}/routes/${routeItem.id}/video`"
          :aria-label="`Vidéo d'enchaînement de la voie ${routeItem.number}`"
        />
        <template v-else-if="isHttpUrl(routeItem.videoUrl)">
          <div
            v-if="parseVideoEmbed(routeItem.videoUrl)"
            class="mt-2 aspect-video overflow-hidden rounded-lg bg-gray-100"
          >
            <iframe
              :src="parseVideoEmbed(routeItem.videoUrl)!.embedSrc"
              class="h-full w-full"
              title="Vidéo d'enchaînement"
              allow="encrypted-media; picture-in-picture"
              allowfullscreen
              loading="lazy"
            />
          </div>
          <a
            v-else
            :href="routeItem.videoUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="mt-2 inline-flex min-h-12 items-center text-sm font-medium text-blue-700 hover:underline"
          >
            Voir la vidéo d'enchaînement ↗
          </a>
        </template>
      </li>
    </ul>
  </section>
</template>
