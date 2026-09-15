import { reactive } from 'vue'

export interface ToastMessage {
  id: string
  text: string
  variant: 'info' | 'success' | 'error'
}

const toasts = reactive<ToastMessage[]>([])

function dismiss(id: string): void {
  const index = toasts.findIndex((toast) => toast.id === id)
  if (index !== -1) {
    toasts.splice(index, 1)
  }
}

function show(text: string, variant: ToastMessage['variant'] = 'info', durationMs = 5000): void {
  const id = crypto.randomUUID()
  toasts.push({ id, text, variant })
  setTimeout(() => dismiss(id), durationMs)
}

export function useToast(): {
  toasts: ToastMessage[]
  show: typeof show
  dismiss: typeof dismiss
} {
  return { toasts, show, dismiss }
}
