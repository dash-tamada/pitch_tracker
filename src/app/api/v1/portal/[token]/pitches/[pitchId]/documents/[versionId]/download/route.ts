import { NextResponse } from "next/server";
import { uuidParam } from "@/server/lib/http";
import { creatorRoute } from "@/server/lib/creator-http";
import { getMyDownloadUrl } from "@/server/modules/creator-portal/documents";
import { getStorage } from "@/server/modules/storage";

// pitchId in the URL is unused (versionId alone identifies the version and RLS scopes it to this creator's
// own pitches regardless) but kept in the path for symmetry with the documents list route above it.
export const GET = creatorRoute<{ token: string; pitchId: string; versionId: string }>(
  { auth: true, rateLimit: { limit: 20, windowMs: 60_000 } },
  async ({ req, companyId, creator, params }) => {
    const url = await getMyDownloadUrl(companyId, creator!.creatorId, uuidParam(params.versionId, "Document"), getStorage());
    return NextResponse.redirect(new URL(url, req.nextUrl.origin), { status: 303, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  },
);
