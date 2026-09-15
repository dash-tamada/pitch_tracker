import Link from "next/link";
import { getDb } from "@/server/db/client";
import { requirePageSession } from "@/server/lib/page-session";
import { listNotifications } from "@/server/modules/notifications/service";
import { ActionForm } from "@/components/action-form";
import { Empty, fmtDateTime, PageHeader } from "@/components/ui";

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ unread?: string; cursor?: string }> }) {
  const { actor } = await requirePageSession();
  const sp = await searchParams;
  const page = await listNotifications(getDb(), actor, { ...(sp.unread === "1" ? { unread: "1" } : {}), ...(sp.cursor ? { cursor: sp.cursor } : {}) });
  return (
    <>
      <PageHeader title="Notifications" subtitle={`${page.unread} unread`} actions={<>
        <Link className="btn-secondary" href={sp.unread === "1" ? "/notifications" : "/notifications?unread=1"}>{sp.unread === "1" ? "Show all" : "Unread only"}</Link>
        {page.unread > 0 && <ActionForm endpoint="/api/v1/notifications/read" fields={[]} extra={{ all: true }} submitLabel="Mark all read" />}
      </>} />
      {page.items.length === 0 ? <Empty>No notifications.</Empty> : (
        <div className="table-wrap"><table className="data">
          <thead><tr><th>When</th><th>Notification</th><th>Pitch</th><th></th></tr></thead>
          <tbody>{page.items.map((n) => (
            <tr key={n.id} className={n.readAt ? "" : "unread"}><td>{fmtDateTime(n.createdAt)}</td><td>{n.title}</td>
              <td>{n.pitchId ? <Link href={`/pitches/${n.pitchId}`}>{n.pitchTitle ?? "Open"}</Link> : "—"}</td>
              <td>{!n.readAt && <ActionForm endpoint="/api/v1/notifications/read" fields={[]} extra={{ ids: [n.id] }} submitLabel="Mark read" />}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      {page.nextCursor && <div className="pager"><Link className="btn-secondary" href={`/notifications?cursor=${page.nextCursor}${sp.unread === "1" ? "&unread=1" : ""}`}>Older →</Link></div>}
    </>
  );
}
