import { connection } from "next/server";
import { notFound } from "next/navigation";
import { creatorDb } from "@/server/db/client";
import { requireCreatorPageSession } from "@/server/lib/creator-page-session";
import { AppError } from "@/server/lib/errors";
import { getLookups } from "@/server/modules/lookups/service";
import { getMyPitch } from "@/server/modules/creator-portal/pitch";
import { listMyPitchDocuments } from "@/server/modules/creator-portal/documents";
import { PortalUploadPanel } from "@/components/portal-upload-panel";

const STAGE_LABEL: Record<string, string> = { REJECTED: "Rejected", APPROVED: "Approved" };

export default async function PortalPitchDetailPage({ params }: { params: Promise<{ token: string; pitchId: string }> }) {
  await connection();
  const { token, pitchId } = await params;
  const { companyId, creator } = await requireCreatorPageSession(token);

  let pitch;
  try {
    pitch = await getMyPitch(companyId, creator.creatorId, pitchId);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const [documents, lookups] = await Promise.all([
    listMyPitchDocuments(companyId, creator.creatorId, pitchId),
    getLookups(creatorDb(companyId, creator.creatorId)),
  ]);
  const rejected = pitch.currentStageKey === "REJECTED";
  const categories = (lookups.DOCUMENT_CATEGORY ?? []).filter((l) => l.active);

  return (
    <main className="main">
      <div className="page-head">
        <div>
          <h1 className="page-title">{pitch.title}</h1>
          <p className="subtle">{pitch.pitchCode} · {pitch.formatKey} · {pitch.languageKey}</p>
        </div>
        <a className="btn-secondary" href={`/portal/${token}/pitches`}>Back to your pitches</a>
      </div>

      <span className={`badge ${rejected ? "b-rejected" : pitch.currentStageKey === "APPROVED" ? "b-approved" : "b-new"}`}>
        {STAGE_LABEL[pitch.currentStageKey] ?? pitch.currentStageKey}
      </span>

      <div className="section" style={{ marginTop: 16 }}>
        <h2>Documents</h2>
        {documents.length === 0 ? (
          <p className="empty">No documents uploaded yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Category</th><th>Title</th><th>Latest version</th><th>File</th></tr></thead>
              <tbody>
                {documents.map((d) => {
                  const latest = d.versions[0];
                  return (
                    <tr key={d.id}>
                      <td>{d.categoryKey}</td><td>{d.title}</td>
                      <td>{latest ? `v${latest.versionNo}` : "—"}</td>
                      <td>{latest?.originalFilename ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {rejected ? (
        <p className="notice">This pitch has been rejected and can no longer receive uploads.</p>
      ) : (
        <PortalUploadPanel token={token} pitchId={pitch.id} categories={categories} />
      )}
    </main>
  );
}
