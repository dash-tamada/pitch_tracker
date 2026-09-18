import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { notFound } from "@/server/lib/errors";
import { ok, route } from "@/server/lib/http";
import { companyBranding, companyLogoUrl, removeCompanyLogo } from "@/server/modules/tenancy/company";
import { getStorage } from "@/server/modules/storage";

/**
 * Any signed-in company member may view the logo (it's a branding element in everyone's sidebar, not a
 * company.manage-only artifact) — mirrors document-versions/[id]/download's redirect-to-signed-URL pattern.
 * Deliberately not resolved to a URL at SSR/page-render time: minting the signed URL from inside this route
 * handler, in response to the browser's own request for the image, keeps URL minting and URL serving in the
 * same runtime context every time (some environments run Server Component rendering and Route Handlers as
 * separately isolated module graphs, so a token minted during a page render is not guaranteed visible to a
 * route handler serving it a moment later).
 */
export const GET = route({ auth: true, rateLimit: { limit: 120, windowMs: 60_000 } }, async ({ req }) => {
  const brand = await companyBranding(getDb());
  if (!brand?.logoKey) throw notFound("Logo");
  const url = await companyLogoUrl(getDb(), getStorage(), brand.logoKey);
  return NextResponse.redirect(new URL(url!, req.nextUrl.origin), { status: 303, headers: { "Cache-Control": "no-store" } });
});

export const DELETE = route({ auth: true, rateLimit: { limit: 20, windowMs: 60_000 } }, async ({ session, ctx }) =>
  ok(await removeCompanyLogo(getDb(), session!.actor, getStorage(), ctx)));
