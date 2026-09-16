import type { StoragePort } from "./port";
import { GoogleDriveStorage } from "./drive";
import { MemoryStorage } from "./memory";
import { SupabaseStorage } from "./supabase";

let instance: StoragePort | undefined;

export function getStorage(): StoragePort {
  if (instance) return instance;
  // Google Drive takes priority when configured (the point of adding it was to stop using Supabase Storage),
  // so an incomplete Supabase config left over from before does not silently win.
  const driveRoot = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  const driveKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const bucket = process.env.STORAGE_BUCKET ?? "pitch-files";
  if (driveRoot && driveKey) {
    instance = new GoogleDriveStorage(driveRoot);
  } else if (url && key) {
    instance = new SupabaseStorage(url, key, bucket);
  } else if (memoryStorageAllowed()) {
    instance = new MemoryStorage();
  } else {
    throw new Error("Storage is not configured (GOOGLE_DRIVE_ROOT_FOLDER_ID / GOOGLE_SERVICE_ACCOUNT_KEY, or SUPABASE_URL / SUPABASE_SECRET_KEY)");
  }
  return instance;
}

export function setStorageForTests(s: StoragePort): void {
  instance = s;
}

export const SIGNED_URL_TTL_SECONDS = () => Math.min(Math.max(Number(process.env.SIGNED_URL_TTL_SECONDS ?? 60), 10), 300);
export const MAX_UPLOAD_BYTES = () => Math.min(Number(process.env.MAX_UPLOAD_BYTES ?? 52_428_800), 104_857_600);

/** In-memory storage is for local development and automated tests only — never when APP_ENV is production. */
export function memoryStorageAllowed(): boolean {
  if (process.env.APP_ENV === "production" || process.env.APP_ENV === "staging") return false;
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_MEMORY_STORAGE === "1";
}
