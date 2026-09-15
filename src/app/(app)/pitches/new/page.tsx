import { getDb } from "@/server/db/client";
import { pageData, requirePageSession } from "@/server/lib/page-session";
import { can, clearanceAllows } from "@/server/modules/authz/policy";
import { getCreatorProfile } from "@/server/modules/creators/service";
import { getLookups } from "@/server/modules/lookups/service";
import { PitchForm } from "@/components/pitch-form";
import { PageHeader } from "@/components/ui";

export default async function NewPitchPage({ searchParams }: { searchParams: Promise<{ creatorId?: string }> }) {
  const { actor } = await requirePageSession();
  if (!can(actor, "pitch.create")) return <p className="notice">You do not have permission to create pitches.</p>;
  const db = getDb();
  const { creatorId } = await searchParams;
  const creator = creatorId && /^[0-9a-f-]{36}$/i.test(creatorId) ? await pageData(() => getCreatorProfile(db, actor, creatorId)) : null;
  const lookups = await getLookups(db);
  const active = Object.fromEntries(Object.entries(lookups).map(([k, v]) => [k, v.filter((l) => l.active)]));
  return (
    <>
      <PageHeader title="New pitch" subtitle="A Pitch ID is generated automatically. You can upload the script right after submitting." />
      <PitchForm lookups={active} allowedConfidentiality={(["STANDARD", "CONFIDENTIAL", "RESTRICTED"] as const).filter((c) => clearanceAllows(actor.clearance, c))}
        initial={creator ? { creatorId: creator.creator.id, creatorName: creator.creator.fullName } : undefined} />
    </>
  );
}
