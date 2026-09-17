import { connection } from "next/server";
import { creatorDb } from "@/server/db/client";
import { requireCreatorPageSession } from "@/server/lib/creator-page-session";
import { getLookups } from "@/server/modules/lookups/service";
import { PortalPitchForm } from "@/components/portal-pitch-form";

export default async function PortalNewPitchPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const { companyId, creator } = await requireCreatorPageSession(token);
  const db = creatorDb(companyId, creator.creatorId);
  const lookups = await getLookups(db);
  const active = { FORMAT: lookups.FORMAT?.filter((l) => l.active) ?? [], LANGUAGE: lookups.LANGUAGE?.filter((l) => l.active) ?? [], GENRE: lookups.GENRE?.filter((l) => l.active) ?? [] };
  return (
    <main className="main">
      <div className="page-head">
        <div>
          <h1 className="page-title">New pitch</h1>
          <p className="subtle">You can upload your script right after submitting.</p>
        </div>
        <a className="btn-secondary" href={`/portal/${token}/pitches`}>Back to your pitches</a>
      </div>
      <PortalPitchForm token={token} lookups={active} />
    </main>
  );
}
