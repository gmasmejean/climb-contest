import { reactive } from 'vue'

export interface ToastMessage {
  id: string
  text: string
  variant: 'info' | 'success' | 'error'
}

const toasts = reactive<ToastMessage[]>([])

/**
 * Nombre maximal de notifications empilées à l'écran. Sans plafond, une
 * saisie juge rapprochée (Lot 6 : plus d'attente réseau entre deux
 * confirmations) peut faire grandir la pile jusqu'à recouvrir les boutons
 * d'action critiques sur un écran de 360 px (CLAUDE.md § accessibilité).
 */
const MAX_VISIBLE_TOASTS = 3

function dismiss(id: string): void {
  const index = toasts.findIndex((toast) => toast.id === id)
  if (index !== -1) {
    toasts.splice(index, 1)
  }
}

function show(text: string, variant: ToastMessage['variant'] = 'info', durationMs = 5000): void {
  const id = crypto.randomUUID()
  toasts.push({ id, text, variant })
  while (toasts.length > MAX_VISIBLE_TOASTS) {
    toasts.shift()
  }
  setTimeout(() => dismiss(id), durationMs)
}

export function useToast(): {
  toasts: ToastMessage[]
  show: typeof show
  dismiss: typeof dismiss
} {
  return { toasts, show, dismiss }
}
