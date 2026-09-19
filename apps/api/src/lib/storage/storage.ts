/**
 * Interface de stockage de fichiers (SPEC.md § 6.1, ADR-058). Aucune
 * dépendance à un fournisseur : l'API ne connaît que ces opérations. Une clé
 * est toujours construite par le serveur (`competitions/<id>/videos/<id>`),
 * jamais à partir d'une entrée client.
 */
export interface ByteRange {
  /** Premier octet inclus. */
  start: number
  /** Dernier octet inclus. */
  end: number
}

export interface StoredObject {
  /** Taille totale de l'objet, pas de la plage renvoyée. */
  size: number
  /** Flux des octets demandés (toute la plage, ou tout l'objet). */
  stream: ReadableStream<Uint8Array>
}

export interface StorageAdapter {
  /** Commence un envoi. Réinitialise un envoi précédent de la même clé. */
  beginUpload(key: string): Promise<void>
  /** Octets déjà reçus pour un envoi en cours (0 si aucun). */
  uploadedBytes(key: string): Promise<number>
  /**
   * Ajoute `chunk` à la suite de l'envoi. `offset` DOIT égaler `uploadedBytes` :
   * sinon lève `StorageOffsetError`, pour que l'appelant renvoie l'offset
   * attendu au client (reprise après coupure).
   */
  appendChunk(key: string, offset: number, chunk: Uint8Array): Promise<number>
  /** Lit les `length` premiers octets d'un envoi en cours ou d'un objet terminé. */
  readHead(key: string, length: number): Promise<Uint8Array>
  /** Termine l'envoi : l'objet devient lisible sous `key`. */
  completeUpload(key: string): Promise<{ size: number }>
  /** Abandonne un envoi en cours (sans erreur s'il n'existe pas). */
  abortUpload(key: string): Promise<void>
  /** Ouvre un objet terminé, éventuellement une plage. `null` s'il n'existe pas. */
  open(key: string, range?: ByteRange): Promise<StoredObject | null>
  /** Supprime un objet terminé (sans erreur s'il n'existe pas). */
  delete(key: string): Promise<void>
}

/** L'offset annoncé par le client ne correspond pas à ce que le stockage a reçu. */
export class StorageOffsetError extends Error {
  constructor(public readonly expectedOffset: number) {
    super(`Offset inattendu : le stockage attend ${expectedOffset}.`)
  }
}

/** Une clé qui sortirait de la racine du stockage, ou mal formée. */
export class InvalidStorageKeyError extends Error {
  constructor(key: string) {
    super(`Clé de stockage invalide : ${key}`)
  }
}
