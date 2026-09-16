import { randomUUID } from "node:crypto";
import type { StoragePort } from "./port";

/**
 * In-memory storage for tests and local development without a cloud bucket. Never used in production.
 * Signed URLs point at /api/v1/dev-storage/*, which only works when this adapter is active and NODE_ENV is not production.
 */
export class MemoryStorage implements StoragePort {
  readonly objects = new Map<string, Buffer>();
  readonly uploadTokens = new Map<string, { key: string; expires: number }>();
  readonly readTokens = new Map<string, { key: string; expires: number; name?: string; inline?: boolean; contentType?: string }>();

  async createSignedUploadUrl(key: string) {
    const token = randomUUID();
    this.uploadTokens.set(token, { key, expires: Date.now() + 2 * 3600_000 });
    return { url: `/api/v1/dev-storage/upload/${token}` };
  }
  /** Stands in for the provider accepting the browser's PUT. Single use. */
  acceptUpload(token: string, bytes: Buffer): boolean {
    const t = this.uploadTokens.get(token);
    this.uploadTokens.delete(token);
    if (!t || t.expires < Date.now() || this.objects.has(t.key)) return false;
    this.objects.set(t.key, bytes);
    return true;
  }
  put(key: string, bytes: Buffer) { this.objects.set(key, bytes); }
  async download(key: string, maxBytes: number) {
    const b = this.objects.get(key);
    if (!b) return null;
    if (b.length > maxBytes) throw new Error("object exceeds size limit");
    return b;
  }
  async move(from: string, to: string) {
    const b = this.objects.get(from);
    if (!b) throw new Error("missing object");
    this.objects.set(to, b); this.objects.delete(from);
  }
  async remove(keys: string[]) { keys.forEach((k) => this.objects.delete(k)); }
  async createSignedReadUrl(key: string, ttl: number, name?: string, opts?: { inline?: boolean; contentType?: string }) {
    const token = randomUUID();
    this.readTokens.set(token, { key, expires: Date.now() + ttl * 1000, ...(name !== undefined ? { name } : {}), ...opts });
    return `/api/v1/dev-storage/read/${token}`;
  }
  read(token: string): { bytes: Buffer; name?: string; inline?: boolean; contentType?: string } | null {
    const t = this.readTokens.get(token);
    if (!t || t.expires < Date.now()) return null;
    const bytes = this.objects.get(t.key);
    return bytes ? { bytes, name: t.name, inline: t.inline, contentType: t.contentType } : null;
  }
}
