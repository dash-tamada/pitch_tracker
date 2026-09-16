/** Storage abstraction so business logic never talks to a vendor SDK directly (and tests can use memory). */
export interface StoragePort {
  /** One-time URL the browser can PUT exactly one object to. */
  createSignedUploadUrl(key: string): Promise<{ url: string }>;
  /** Server-side read (for validation). Returns null if the object does not exist. */
  download(key: string, maxBytes: number): Promise<Buffer | null>;
  move(fromKey: string, toKey: string): Promise<void>;
  remove(keys: string[]): Promise<void>;
  /**
   * Short-lived read URL. By default `downloadName` forces Content-Disposition: attachment (a download prompt).
   * Pass `opts.inline: true` (with the file's real `contentType`) to instead let the browser render the file
   * — a PDF or image opens directly instead of prompting to save.
   */
  createSignedReadUrl(key: string, ttlSeconds: number, downloadName?: string, opts?: { inline?: boolean; contentType?: string }): Promise<string>;
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}
