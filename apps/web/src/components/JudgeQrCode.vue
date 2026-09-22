<script setup lang="ts">
import QRCode from 'qrcode'
import { ref, watchEffect } from 'vue'

/**
 * QR code d'accès d'un juge, dessiné dans le navigateur (ADR-076). Le serveur
 * ne saurait pas le faire : quand la compétition ne conserve pas les accès en
 * clair (ADR-027), le jeton n'existe qu'ici, en mémoire, depuis la création du
 * juge. Le dessiner ici évite aussi de faire passer un secret dans une URL
 * d'image, où il finirait dans les journaux d'accès.
 */
const props = defineProps<{
  /** Le lien `/j/<jeton>` à encoder. */
  url: string
  /** Pour le nom accessible de l'image. */
  judgeName: string
}>()

const svg = ref('')
const failed = ref(false)
// Le dessin est asynchrone : un jeton garde la dernière demande, sinon un
// changement de juge pourrait afficher le QR du précédent.
let token = 0

watchEffect(() => {
  const current = (token += 1)
  const url = props.url
  svg.value = ''
  failed.value = false
  void QRCode.toString(url, { type: 'svg', margin: 1 })
    .then((drawn) => {
      if (current === token) svg.value = drawn
    })
    .catch(() => {
      // Jamais un carré vide : on le dit, le lien reste copiable à côté.
      if (current === token) failed.value = true
    })
})
</script>

<template>
  <p v-if="failed" class="text-sm text-amber-800">
    Le QR code n’a pas pu être dessiné. Utilisez le lien ci-dessus, ou la planche imprimable.
  </p>
  <!-- Le SVG vient de `qrcode`, à partir d'une URL que nous construisons :
       aucune saisie utilisateur n'y entre. -->
  <!-- eslint-disable vue/no-v-html -->
  <div
    v-else-if="svg"
    role="img"
    :aria-label="`QR code d'accès de ${props.judgeName}`"
    data-testid="judge-qr-code"
    class="w-48 max-w-full bg-white [&>svg]:h-auto [&>svg]:w-full"
    v-html="svg"
  />
  <!-- eslint-enable vue/no-v-html -->
</template>
