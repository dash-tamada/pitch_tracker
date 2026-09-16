import { getDb } from "@/server/db/client";
import { pageData, requirePageSession } from "@/server/lib/page-session";
import { can } from "@/server/modules/authz/policy";
import { getCreatorProfile } from "@/server/modules/creators/service";
import { getLookups } from "@/server/modules/lookups/service";
import { CreatorForm } from "@/components/creator-form";
import { PageHeader } from "@/components/ui";

export default async function EditCreatorPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requirePageSession();
  const { id } = await params;
  if (!can(actor, "creator.edit")) return <p className="notice">You do not have permission to edit creators.</p>;
  const db = getDb(actor);
  const profile = await pageData(() => getCreatorProfile(db, actor, id));
  if (!profile) return <p className="notice">You do not have access to this creator.</p>;
  const lookups = await getLookups(db);
  const active = (t: string) => (lookups[t] ?? []).filter((l) => l.active);
  return (
    <>
      <PageHeader title={`Edit ${profile.creator.fullName}`} />
      <CreatorForm languages={active("LANGUAGE")} genres={active("GENRE")} initial={profile.creator} />
    </>
  );
}
