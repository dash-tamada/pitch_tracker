import { getDb } from "@/server/db/client";
import { pageData, requirePageSession } from "@/server/lib/page-session";
import { can, clearanceAllows } from "@/server/modules/authz/policy";
import { getLookups } from "@/server/modules/lookups/service";
import { getPitchDetail } from "@/server/modules/pitches/service";
import { PitchForm } from "@/components/pitch-form";
import { PageHeader } from "@/components/ui";

export default async function EditPitchPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requirePageSession();
  const { id } = await params;
  if (!can(actor, "pitch.edit")) return <p className="notice">You do not have permission to edit pitches.</p>;
  const db = getDb();
  const d = await pageData(() => getPitchDetail(db, actor, id));
  if (!d) return <p className="notice">You do not have access to this pitch.</p>;
  const lookups = await getLookups(db);
  const active = Object.fromEntries(Object.entries(lookups).map(([k, v]) => [k, v.filter((l) => l.active || true)]));
  return (
    <>
      <PageHeader title={`Edit ${d.pitch.title}`} subtitle={`${d.pitch.pitchCode} · status and owner change only through workflow actions`} />
      <PitchForm lookups={active} initial={{ ...d.pitch, creatorId: d.creator.id, creatorName: d.creator.name }}
        allowedConfidentiality={(["STANDARD", "CONFIDENTIAL", "RESTRICTED"] as const).filter((c) => clearanceAllows(actor.clearance, c))} />
    </>
  );
}
