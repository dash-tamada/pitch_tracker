/**
 * Supabase Storage over its REST API (endpoints verified against @supabase/storage-js 2.116.0 source).
 * Uses the service-role / secret key — SERVER ONLY. Bucket must be private.
 */
import { StorageError, type StoragePort } from "./port";

function encodeKey(key: string): string {
  // Keys are server-generated (uuid-based); still reject anything that could escape the bucket path.
  if (!/^[a-z0-9][a-z0-9/_.-]{0,400}$/i.test(key) || key.includes("..") || key.includes("//")) throw new StorageError("invalid storage key");
  return key.split("/").map(encodeURIComponent).join("/");
}

export class SupabaseStorage implements StoragePort {
  private readonly base: string;
  constructor(url: string, private readonly key: string, private readonly bucket: string) {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") throw new StorageError("SUPABASE_URL must be https");
    this.base = `${u.origin}/storage/v1`;
    if (!/^[a-z0-9-]{3,63}$/.test(bucket)) throw new StorageError("invalid bucket name");
  }

  private headers(extra: Record<string, string> = {}) {
    return { apikey: this.key, authorization: `Bearer ${this.key}`, ...extra };
  }

  private async call(path: string, init: RequestInit): Promise<Response> {
    const res = await fetch(`${this.base}${path}`, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000) });
    return res;
  }

  async createSignedUploadUrl(key: string) {
    const res = await this.call(`/object/upload/sign/${this.bucket}/${encodeKey(key)}`, { method: "POST", headers: this.headers({ "content-type": "application/json" }), body: "{}" });
    if (!res.ok) throw new StorageError(`signed upload failed (${res.status})`);
    const data = (await res.json()) as { url?: string };
    if (!data.url?.startsWith("/object/upload/sign/")) throw new StorageError("unexpected storage response");
    return { url: `${this.base}${data.url}` };
  }

  async download(key: string, maxBytes: number) {
    const res = await this.call(`/object/${this.bucket}/${encodeKey(key)}`, { method: "GET", headers: this.headers() });
    if (res.status === 400 || res.status === 404) return null;
    if (!res.ok || !res.body) throw new StorageError(`download failed (${res.status})`);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new StorageError("object exceeds size limit"); }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }

  async move(fromKey: string, toKey: string) {
    encodeKey(fromKey); encodeKey(toKey);
    const res = await this.call(`/object/move`, { method: "POST", headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({ bucketId: this.bucket, sourceKey: fromKey, destinationKey: toKey }) });
    if (!res.ok) throw new StorageError(`move failed (${res.status})`);
  }

  async remove(keys: string[]) {
    if (!keys.length) return;
    keys.forEach(encodeKey);
    const res = await this.call(`/object/${this.bucket}`, { method: "DELETE", headers: this.headers({ "content-type": "application/json" }), body: JSON.stringify({ prefixes: keys }) });
    if (!res.ok) throw new StorageError(`remove failed (${res.status})`);
  }

  async createSignedReadUrl(key: string, ttlSeconds: number, downloadName?: string) {
    const res = await this.call(`/object/sign/${this.bucket}/${encodeKey(key)}`, { method: "POST", headers: this.headers({ "content-type": "application/json" }), body: JSON.stringify({ expiresIn: ttlSeconds }) });
    if (!res.ok) throw new StorageError(`sign failed (${res.status})`);
    const data = (await res.json()) as { signedURL?: string };
    if (!data.signedURL?.startsWith("/object/sign/")) throw new StorageError("unexpected storage response");
    const dl = downloadName !== undefined ? `&download=${encodeURIComponent(downloadName)}` : "";
    return `${this.base}${data.signedURL}${dl}`;
  }
}
