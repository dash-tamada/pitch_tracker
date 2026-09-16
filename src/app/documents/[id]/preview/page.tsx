import { getDb } from "@/server/db/client";
import { pageData, requirePageSession } from "@/server/lib/page-session";
import { uuidParam } from "@/server/lib/http";
import { viewVersion } from "@/server/modules/documents/service";
import { getStorage } from "@/server/modules/storage";
import { DocumentPreview } from "@/components/document-preview";

/**
 * Deliberately outside the (app) layout: this is meant to be opened in a small popup (see ViewInPopupButton),
 * not to carry the full nav shell. It never redirects to the raw file — DocumentPreview fetches the bytes
 * itself and renders them inside our own UI, so the browser's native PDF/image viewer chrome (print, download,
 * zoom toolbar) never appears.
 */
export default async function DocumentPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requirePageSession();
  const { id } = await params;
  const db = getDb(actor);
  const data = await pageData(() => viewVersion(db, getStorage(), actor, uuidParam(id, "Document")));
  if (!data) return <p className="notice">You do not have access to this document.</p>;
  return <DocumentPreview url={data.url} mime={data.mime} filename={data.filename} />;
}
