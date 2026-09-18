export type VideoEmbedProvider = 'youtube' | 'vimeo'

export interface VideoEmbed {
  provider: VideoEmbedProvider
  embedSrc: string
}

/**
 * Allowlist stricte de domaines (correspondance EXACTE, jamais `.includes`
 * ni un motif — un hôte comme `youtube.com.evil.example` ne doit jamais
 * passer). Vidéo d'enchaînement, ROADMAP.md Lot 7 : « lecteur intégré pour
 * YouTube/Vimeo ». Tout le reste (lien mal formé, domaine inconnu, schéma
 * `javascript:`/`data:`) renvoie `null` — l'appelant affiche alors un
 * simple lien externe, jamais une iframe.
 */
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'])
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com'])
const ID_PATTERN = /^[\w-]{6,64}$/

/**
 * Ne construit JAMAIS un `embedSrc` à partir de texte non validé : l'id
 * extrait est revalidé par `ID_PATTERN` puis concaténé à une base fixe et
 * connue (`youtube-nocookie.com`/`player.vimeo.com`) — jamais l'URL fournie
 * elle-même, même partiellement.
 */
export function parseVideoEmbed(url: string): VideoEmbed | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null

  const host = parsed.hostname.toLowerCase()
  if (YOUTUBE_HOSTS.has(host)) {
    const videoId = extractYoutubeId(parsed)
    return videoId ? { provider: 'youtube', embedSrc: `https://www.youtube-nocookie.com/embed/${videoId}` } : null
  }
  if (VIMEO_HOSTS.has(host)) {
    const videoId = extractVimeoId(parsed)
    return videoId ? { provider: 'vimeo', embedSrc: `https://player.vimeo.com/video/${videoId}` } : null
  }
  return null
}

function extractYoutubeId(url: URL): string | null {
  if (url.hostname.toLowerCase() === 'youtu.be') {
    const id = url.pathname.slice(1)
    return ID_PATTERN.test(id) ? id : null
  }
  if (url.pathname === '/watch') {
    const id = url.searchParams.get('v')
    return id && ID_PATTERN.test(id) ? id : null
  }
  const shortsMatch = /^\/shorts\/([\w-]{6,64})$/.exec(url.pathname)
  if (shortsMatch?.[1]) return shortsMatch[1]
  const embedMatch = /^\/embed\/([\w-]{6,64})$/.exec(url.pathname)
  if (embedMatch?.[1]) return embedMatch[1]
  return null
}

function extractVimeoId(url: URL): string | null {
  const match = /^\/(?:video\/)?(\d+)/.exec(url.pathname)
  return match?.[1] ?? null
}
