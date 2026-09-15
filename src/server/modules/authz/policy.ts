/**
 * Resource access policy. Every read and write of a pitch goes through here, and the
 * same rules compile to a SQL condition so lists, search and exports are filtered identically.
 */
import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { pitches } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import type { Permission, RoleKey } from "./permissions";

export type Clearance = "STANDARD" | "CONFIDENTIAL" | "RESTRICTED";
const CLEARANCE_RANK: Record<Clearance, number> = { STANDARD: 1, CONFIDENTIAL: 2, RESTRICTED: 3 };

export interface Actor {
  readonly userId: string;
  readonly roles: ReadonlySet<RoleKey | string>;
  readonly permissions: ReadonlySet<Permission | string>;
  readonly clearance: Clearance;
  readonly mfaSatisfied: boolean;
}

export function can(actor: Actor, permission: Permission): boolean {
  return actor.permissions.has(permission);
}

export function requirePermission(actor: Actor, permission: Permission): void {
  if (!can(actor, permission)) throw new AppError("FORBIDDEN", "You do not have permission to do this.");
}

export function hasAnyRole(actor: Actor, roleKeys: readonly string[] | null | undefined): boolean {
  if (!roleKeys || roleKeys.length === 0) return true;
  return roleKeys.some((r) => actor.roles.has(r));
}

export function clearanceAllows(clearance: Clearance, level: Clearance): boolean {
  return CLEARANCE_RANK[clearance] >= CLEARANCE_RANK[level];
}

export interface PitchAccessFacts {
  confidentiality: Clearance;
  currentOwnerId: string | null;
  archivedAt: Date | null;
  /** participant reasons this actor holds on the pitch */
  participantReasons: readonly string[];
}

/**
 * View rule (documented in ARCHITECTURE.md §4.4):
 *  - explicit GRANTED participant → allowed regardless of clearance (executive decision, audited)
 *  - otherwise clearance must cover the pitch's confidentiality AND the actor must be
 *    view_all, the current owner, or a participant.
 *  - archived pitches additionally need pitch.restore.
 */
export function canViewPitch(actor: Actor, p: PitchAccessFacts): boolean {
  if (!can(actor, "pitch.view") && !can(actor, "pitch.view_all")) return false;
  if (p.archivedAt && !can(actor, "pitch.restore")) return false;
  if (p.participantReasons.includes("GRANTED")) return true;
  if (!clearanceAllows(actor.clearance, p.confidentiality)) return false;
  return can(actor, "pitch.view_all") || p.currentOwnerId === actor.userId || p.participantReasons.length > 0;
}

/** SQL twin of canViewPitch for list/search queries. Must stay behaviourally identical (tested). */
export function pitchVisibilityCondition(actor: Actor, includeArchived = false): SQL {
  if (!can(actor, "pitch.view") && !can(actor, "pitch.view_all")) return sql`false`;
  const allowed = (Object.keys(CLEARANCE_RANK) as Clearance[]).filter((c) => clearanceAllows(actor.clearance, c));
  const archived = includeArchived && can(actor, "pitch.restore") ? sql`true` : isNull(pitches.archivedAt);

  const participant = sql`EXISTS (SELECT 1 FROM pitch_participants pp
      WHERE pp.pitch_id = ${pitches.id} AND pp.user_id = ${actor.userId})`;
  const granted = sql`EXISTS (SELECT 1 FROM pitch_participants pp
      WHERE pp.pitch_id = ${pitches.id} AND pp.user_id = ${actor.userId} AND pp.reason = 'GRANTED')`;

  const withinClearance = sql`${pitches.confidentiality} IN (${sql.join(allowed.map((c) => sql`${c}`), sql`, `)})`;
  const involvement = can(actor, "pitch.view_all")
    ? sql`true`
    : or(eq(pitches.currentOwnerId, actor.userId), participant)!;

  return and(archived, or(granted, and(withinClearance, involvement)))!;
}
