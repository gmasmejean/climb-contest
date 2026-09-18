// Dexie (packages/sync côté juge, Lot 6) a besoin d'un IndexedDB réel — jsdom
// n'en fournit pas. `fake-indexeddb/auto` enregistre les globals nécessaires.
import 'fake-indexeddb/auto'
