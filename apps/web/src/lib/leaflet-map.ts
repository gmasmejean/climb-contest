import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './leaflet-map.css'

/**
 * Carte Leaflet sur tuiles Plan IGN v2 (ADR-088). Ce module n'est importé qu'à
 * la demande par `LocationMap.vue` : Leaflet n'entre ni dans le bundle
 * principal ni dans le précache du service worker (`vite.config.ts`).
 * Les tuiles sont servies par la Géoplateforme, sans clé ni limite d'usage,
 * sous Licence Ouverte Etalab : la source est citée dans l'attribution.
 */
export const IGN_PLAN_TILES_URL =
  'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
  '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM' +
  '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png'

const IGN_ATTRIBUTION =
  '<a href="https://cartes.gouv.fr/" target="_blank" rel="noopener noreferrer">© IGN – Plan IGN</a>'

const INITIAL_ZOOM = 16
const MAX_ZOOM = 19

export interface LocationMapHandle {
  destroy: () => void
}

export function createLocationMap(
  container: HTMLElement,
  position: { latitude: number; longitude: number },
  onTilesUnavailable: () => void,
): LocationMapHandle {
  const center = L.latLng(position.latitude, position.longitude)
  // Au doigt, un glissement fait défiler la page et non la carte : sur un
  // téléphone, une carte qui capture le défilement piège la page.
  const map = L.map(container, {
    center,
    zoom: INITIAL_ZOOM,
    scrollWheelZoom: false,
    dragging: !L.Browser.mobile,
    zoomControl: false,
  })
  // Boutons de zoom en français, agrandis à 48 px (`leaflet-map.css`).
  L.control.zoom({ zoomInTitle: 'Zoom avant', zoomOutTitle: 'Zoom arrière' }).addTo(map)

  let anyTileLoaded = false
  const tiles = L.tileLayer(IGN_PLAN_TILES_URL, {
    maxZoom: MAX_ZOOM,
    attribution: IGN_ATTRIBUTION,
  })
  tiles.on('tileload', () => {
    anyTileLoaded = true
  })
  // Hors ligne ou service en panne : aucune tuile ne vient, la carte laisse
  // place à l'adresse en texte. Une tuile en échec parmi d'autres ne compte pas.
  tiles.on('tileerror', () => {
    if (!anyTileLoaded) onTilesUnavailable()
  })
  tiles.addTo(map)

  // Un point rond plutôt que l'icône image de Leaflet : aucun fichier à servir.
  L.circleMarker(center, {
    radius: 10,
    color: '#ffffff',
    weight: 3,
    fillColor: '#0e3b4e',
    fillOpacity: 1,
  }).addTo(map)

  return { destroy: () => map.remove() }
}
