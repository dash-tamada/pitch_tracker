import { redirect } from "next/navigation";
import { connection } from "next/server";
import { requireCreatorPageSession } from "@/server/lib/creator-page-session";
import { listMyPitches } from "@/server/modules/creator-portal/pitch";
import { PortalLogoutButton } from "@/components/portal-logout-button";

const STAGE_LABEL: Record<string, string> = { REJECTED: "Rejected", APPROVED: "Approved" };

export default async function PortalPitchesPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const { companyId, creator } = await requireCreatorPageSession(token);
  // "New pitch" (and this dashboard) stays gated behind profile setup — see profile.ts / schema.ts's own
  // doc comment on profileCompletedAt. A creator who has not completed it yet is sent there first.
  if (!creator.profileCompleted) redirect(`/portal/${token}/profile`);
  const pitches = await listMyPitches(companyId, creator.creatorId);

  return (
    <main className="main">
      <div className="page-head">
        <div>
          <h1 className="page-title">Your pitches</h1>
          <p className="subtle">Submit a new pitch, or open one below to upload your script.</p>
        </div>
        <div className="head-actions">
          <a className="btn-inline" href={`/portal/${token}/pitches/new`}>New pitch</a>
          <a className="btn-secondary" href={`/portal/${token}/profile`}>My profile</a>
          <PortalLogoutButton token={token} />
        </div>
      </div>

      {pitches.length === 0 ? (
        <p className="empty">You haven&apos;t submitted a pitch yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Pitch code</th><th>Title</th><th>Format</th><th>Status</th><th>Submitted</th><th /></tr></thead>
            <tbody>
              {pitches.map((p) => (
                <tr key={p.id}>
                  <td>{p.pitchCode}</td>
                  <td>{p.title}</td>
                  <td>{p.formatKey}</td>
                  <td>
                    <span className={`badge ${p.currentStageKey === "REJECTED" ? "b-rejected" : p.currentStageKey === "APPROVED" ? "b-approved" : "b-new"}`}>
                      {STAGE_LABEL[p.currentStageKey] ?? p.currentStageKey}
                    </span>
                  </td>
                  <td>{new Date(p.createdAt).toLocaleDateString()}</td>
                  <td><a href={`/portal/${token}/pitches/${p.id}`}>Open</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
