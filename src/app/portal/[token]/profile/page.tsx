import { connection } from "next/server";
import { creatorDb } from "@/server/db/client";
import { requireCreatorPageSession } from "@/server/lib/creator-page-session";
import { getMyProfile } from "@/server/modules/creator-portal/profile";
import { getLookups } from "@/server/modules/lookups/service";
import { PortalLogoutButton } from "@/components/portal-logout-button";
import { PortalPasswordForm } from "@/components/portal-password-form";
import { PortalProfileForm } from "@/components/portal-profile-form";
import { PortalProjectsPanel } from "@/components/portal-projects-panel";

export default async function PortalProfilePage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const { companyId, creator } = await requireCreatorPageSession(token);
  const db = creatorDb(companyId, creator.creatorId);
  const [{ profile, projects }, lookups] = await Promise.all([getMyProfile(companyId, creator.creatorId), getLookups(db)]);
  const active = (t: string) => (lookups[t] ?? []).filter((l) => l.active);

  return (
    <main className="main">
      <div className="page-head">
        <div>
          <h1 className="page-title">{profile.profileCompleted ? "My profile" : "Set up your profile"}</h1>
          <p className="subtle">
            {profile.profileCompleted
              ? "Keep your profile up to date — this is what the company sees alongside your pitches."
              : "Complete your profile before submitting your first pitch."}
          </p>
        </div>
        <div className="head-actions">
          {profile.profileCompleted && <a className="btn-secondary" href={`/portal/${token}/pitches`}>Back to your pitches</a>}
          <PortalLogoutButton token={token} />
        </div>
      </div>
      <PortalProfileForm token={token} languages={active("LANGUAGE")} initial={profile} />
      <PortalProjectsPanel token={token} languages={active("LANGUAGE")} genres={active("GENRE")} initial={projects} />
      <PortalPasswordForm token={token} />
    </main>
  );
}
