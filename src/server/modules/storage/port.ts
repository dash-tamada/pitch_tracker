/** Storage abstraction so business logic never talks to a vendor SDK directly (and tests can use memory). */
export interface StoragePort {
  /** One-time URL the browser can PUT exactly one object to. */
  createSignedUploadUrl(key: string): Promise<{ url: string }>;
  /** Server-side read (for validation). Returns null if the object does not exist. */
  download(key: string, maxBytes: number): Promise<Buffer | null>;
  move(fromKey: string, toKey: string): Promise<void>;
  remove(keys: string[]): Promise<void>;
  /** Short-lived read URL; `downloadName` forces Content-Disposition: attachment. */
  createSignedReadUrl(key: string, ttlSeconds: number, downloadName?: string): Promise<string>;
}

export class StorageError extends Error {}
