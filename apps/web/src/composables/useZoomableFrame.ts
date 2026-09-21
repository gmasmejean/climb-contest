import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { nextTick } from 'vue'

/** Les trois niveaux de zoom, partagés par le recadrage et l'annotation. */
export const ZOOMS = [1, 2, 3] as const
export type ZoomLevel = (typeof ZOOMS)[number]

/**
 * Le rembourrage réservé autour de la photo pour que ses coins restent
 * atteignables au bord de l'écran.
 */
const PADDING = 48

export interface ZoomableFrame {
  zoom: Ref<ZoomLevel>
  /** Largeur à donner au cadre qui porte la photo. */
  frameWidth: Ref<string>
  /** Change le niveau en gardant au centre de l'écran ce qui y était. */
  setZoom: (level: ZoomLevel) => Promise<void>
  /** À brancher sur le `@load` de l'image : il fixe le rapport de forme. */
  onImageLoad: (event: Event) => void
}

/**
 * Cadre zoomable pour une photo de voie (ADR-077). À ×1 la photo tient ENTIÈRE
 * dans l'espace disponible — sinon, sur un téléphone, on annote une photo dont
 * on ne voit pas le bas. Extrait du dialogue de recadrage, qui l'avait écrit le
 * premier ; l'annotateur s'en sert désormais aussi.
 */
export function useZoomableFrame(scroller: Ref<HTMLElement | null>): ZoomableFrame {
  const zoom = ref<ZoomLevel>(1)
  const aspect = ref(0)
  const room = ref<{ width: number; height: number } | null>(null)
  let observer: ResizeObserver | null = null

  function measure(): void {
    const el = scroller.value
    if (el) room.value = { width: el.clientWidth - PADDING, height: el.clientHeight - PADDING }
  }

  watch(scroller, (el) => {
    observer?.disconnect()
    observer = null
    if (!el) return
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure)
      observer.observe(el)
    }
  })
  onBeforeUnmount(() => observer?.disconnect())

  function onImageLoad(event: Event): void {
    const image = event.target as HTMLImageElement
    aspect.value = image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 0
  }

  // Repli sur la largeur du conteneur tant que les tailles ne sont pas connues.
  const frameWidth = computed(() => {
    const size = room.value
    if (aspect.value <= 0 || !size || size.width <= 0 || size.height <= 0) {
      return `${zoom.value * 100}%`
    }
    const base = Math.min(size.width, size.height * aspect.value)
    return `${Math.max(1, base) * zoom.value}px`
  })

  async function setZoom(level: ZoomLevel): Promise<void> {
    const el = scroller.value
    const centerX =
      el && el.scrollWidth > 0 ? (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth : 0.5
    const centerY =
      el && el.scrollHeight > 0 ? (el.scrollTop + el.clientHeight / 2) / el.scrollHeight : 0.5
    zoom.value = level
    await nextTick()
    if (!el) return
    el.scrollLeft = centerX * el.scrollWidth - el.clientWidth / 2
    el.scrollTop = centerY * el.scrollHeight - el.clientHeight / 2
  }

  return { zoom, frameWidth, setZoom, onImageLoad }
}
