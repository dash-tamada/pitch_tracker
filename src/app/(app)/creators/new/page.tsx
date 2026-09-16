import { getDb } from "@/server/db/client";
import { requirePageSession } from "@/server/lib/page-session";
import { can } from "@/server/modules/authz/policy";
import { getLookups } from "@/server/modules/lookups/service";
import { CreatorForm } from "@/components/creator-form";
import { PageHeader } from "@/components/ui";

export default async function NewCreatorPage() {
  const { actor } = await requirePageSession();
  if (!can(actor, "creator.create")) return <p className="notice">You do not have permission to create creators.</p>;
  const lookups = await getLookups(getDb(actor));
  const active = (t: string) => (lookups[t] ?? []).filter((l) => l.active);
  return (
    <>
      <PageHeader title="New creator" />
      <CreatorForm languages={active("LANGUAGE")} genres={active("GENRE")} />
    </>
  );
}
