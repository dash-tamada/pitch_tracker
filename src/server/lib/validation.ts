import type { z } from "zod";
import { AppError } from "./errors";

/** Parses untrusted input; on failure throws VALIDATION with per-field messages (never echoes values). */
export function parseInput<T extends z.ZodType>(schema: T, raw: unknown): z.infer<T> {
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  throw new AppError("VALIDATION", "Please check the highlighted fields.", fields);
}

export const PAGE_MAX = 100;

export interface Page<T> { items: T[]; nextCursor: string | null }

/** Opaque keyset cursor over (created_at, id). */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([createdAt.toISOString(), id])).toString("base64url");
}

export function decodeCursor(cursor: string | undefined | null): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const [iso, id] = JSON.parse(Buffer.from(cursor, "base64url").toString()) as [string, string];
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("bad");
    return { createdAt, id };
  } catch {
    throw new AppError("VALIDATION", "Invalid page cursor.", { cursor: "Invalid" });
  }
}
