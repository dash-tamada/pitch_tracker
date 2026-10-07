import { redirect } from "next/navigation";
import { connection } from "next/server";
import { CreatorLogoutButton } from "@/components/creator-logout-button";
import { StudioHero } from "@/components/studio-hero";
import { Stat } from "@/components/ui";
import { WriterShell, creatorNav } from "@/components/writer-shell";
import { getPlatformDb } from "@/server/db/client";
import { currentPublicCreator } from "@/server/lib/public-creator-page";
import { listMyPitches, studioStats } from "@/server/modules/public-creators/studio";

/** The Creator Studio. Signing in is on /login (a verified writer number lands here); signing up is on /signup. */
export default async function CreatorHome() {
  await connection(); // dynamic rendering so the CSP nonce is applied
  const me = await currentPublicCreator();
  if (!me) redirect("/login");
  if (!me.hasPhoto) redirect("/creator/profile?complete=1");
  const db = getPlatformDb();
  const [pitches, stats] = await Promise.all([listMyPitches(db, me.creatorId), studioStats(db, me.creatorId)]);
  return (
    <WriterShell area="Creator studio" nav={creatorNav("pitches")} actions={<CreatorLogoutButton />}>
      <div className="dash">
        <StudioHero name={me.fullName} firstName={me.fullName.trim().split(/\s+/)[0] ?? me.fullName} />
        <div className="hero-fade" aria-hidden="true" />
        <div className="cards">
          <Stat label="Pitches" value={stats.pitches} />
          <Stat label="Sent to production houses" value={stats.sends} />
          <Stat label="Production houses" value={stats.houses} />
        </div>
        <div className="section">
          <h2>Your pitches</h2>
          {pitches.length === 0 ? <p className="empty">No pitches yet. Start with your first one.</p> : (
            <table className="data"><thead><tr><th>Title</th><th>Sent to</th><th>Last edited</th><th></th></tr></thead><tbody>
              {pitches.map((d) => (
                <tr key={d.id}><td><a href={`/creator/drafts/${d.id}`}>{d.title}</a>{d.logline && <div className="muted">{d.logline}</div>}</td>
                  <td>{d.sentTo === 0 ? <span className="badge b-new">Not sent yet</span> : <span className="badge b-approved">{d.sentTo} production house{d.sentTo === 1 ? "" : "s"}</span>}</td>
                  <td className="nowrap muted">{d.updatedAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}</td>
                  <td><a className="btn-secondary" href={`/creator/drafts/${d.id}#pitch-to`}>Pitch to</a></td></tr>
              ))}
            </tbody></table>
          )}
        </div>
      </div>
    </WriterShell>
  );
}
