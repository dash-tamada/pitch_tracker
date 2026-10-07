import { redirect } from "next/navigation";
import { connection } from "next/server";
import { creatorDb } from "@/server/db/client";
import { requireCreatorPageSession } from "@/server/lib/creator-page-session";
import { getLookups } from "@/server/modules/lookups/service";
import { PortalPitchForm } from "@/components/portal-pitch-form";
import { WriterShell, portalNav } from "@/components/writer-shell";
import { PortalLogoutButton } from "@/components/portal-logout-button";

export default async function PortalNewPitchPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const { companyId, creator } = await requireCreatorPageSession(token);
  // Same gate as the dashboard — a creator could otherwise reach this URL directly, bypassing the redirect there.
  if (!creator.profileCompleted) redirect(`/portal/${token}/profile`);
  const db = creatorDb(companyId, creator.creatorId);
  const lookups = await getLookups(db);
  const active = { FORMAT: lookups.FORMAT?.filter((l) => l.active) ?? [], LANGUAGE: lookups.LANGUAGE?.filter((l) => l.active) ?? [], GENRE: lookups.GENRE?.filter((l) => l.active) ?? [] };
  return (
    <WriterShell area="Creator portal" nav={portalNav(token, "new")} actions={<PortalLogoutButton token={token} />}>
      <div className="page-head">
        <div>
          <h1 className="page-title">New pitch</h1>
          <p className="subtle">You can upload your script right after submitting.</p>
        </div>
      </div>
      <PortalPitchForm token={token} lookups={active} />
    </WriterShell>
  );
}
