import { connection } from "next/server";
import { CreatorAuth } from "@/components/creator-auth";
import { WriterShell, creatorNav } from "@/components/writer-shell";
import { CreatorLogoutButton } from "@/components/creator-logout-button";
import { getPlatformDb } from "@/server/db/client";
import { currentPublicCreator } from "@/server/lib/public-creator-page";
import { listMyDrafts } from "@/server/modules/public-creators/drafts";

export default async function CreatorHome() {
  await connection(); // dynamic rendering so the CSP nonce is applied
  const creator = await currentPublicCreator();
  if (!creator) return <main className="auth auth-cinema"><CreatorAuth /></main>;
  const drafts = await listMyDrafts(getPlatformDb(), creator.creatorId);
  return (
    <WriterShell area="Creator studio" nav={creatorNav("pitches")} actions={<CreatorLogoutButton />}>
      <div className="page-head">
        <div><h1 className="page-title">Your pitches</h1><p className="subtle">Welcome, {creator.fullName}. Write your story, upload your script, and send it to a company.</p></div>
        <div className="head-actions"><a className="btn-inline" href="/creator/drafts/new">+ New pitch</a></div>
      </div>
      {drafts.length === 0 ? <p className="empty">No pitches yet. Start with your first one.</p> : (
        <div className="section"><table className="data"><thead><tr><th>Title</th><th>Status</th><th>Last edited</th></tr></thead><tbody>
          {drafts.map((d) => (
            <tr key={d.id}><td><a href={`/creator/drafts/${d.id}`}>{d.title}</a>{d.logline && <div className="muted">{d.logline}</div>}</td>
              <td><span className={d.status === "SENT" ? "badge b-approved" : "badge b-new"}>{d.status === "SENT" ? "Sent" : "Draft"}</span></td><td className="nowrap muted">{d.updatedAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}</td></tr>
          ))}
        </tbody></table></div>
      )}
    </WriterShell>
  );
}
