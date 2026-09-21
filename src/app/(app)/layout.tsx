import Link from "next/link";
import { headers } from "next/headers";
import { getDb } from "@/server/db/client";
import { requirePageSession } from "@/server/lib/page-session";
import type { Permission } from "@/server/modules/authz/permissions";
import { unreadCount } from "@/server/modules/notifications/service";
import { companyBranding } from "@/server/modules/tenancy/company";
import { LogoutButton } from "@/components/logout-button";
import { AccountLink, NavLinks } from "@/components/nav-links";

const NAV: { href: string; label: string; anyOf: Permission[] }[] = [
  { href: "/dashboard", label: "Dashboard", anyOf: ["pitch.view", "pitch.view_all", "analytics.view"] },
  { href: "/pitches", label: "Pitches", anyOf: ["pitch.view", "pitch.view_all"] },
  { href: "/reviews", label: "My Reviews", anyOf: ["pitch.accept", "pitch.approve_executive"] },
  { href: "/management", label: "Management Desk", anyOf: ["pitch.view_all"] },
  { href: "/creators", label: "Creators", anyOf: ["creator.view"] },
  { href: "/platforms", label: "Platforms", anyOf: ["platform.view"] },
  { href: "/development", label: "Development", anyOf: ["development.manage"] },
  { href: "/production", label: "Production", anyOf: ["production.manage"] },
  { href: "/analytics", label: "Analytics", anyOf: ["analytics.view", "report.view"] },
  { href: "/notifications", label: "Notifications", anyOf: ["pitch.view", "creator.view", "user.manage"] },
  { href: "/users", label: "Users", anyOf: ["user.manage", "role.manage"] },
  { href: "/settings", label: "Settings", anyOf: ["config.manage", "workflow.manage", "audit.view"] },
  { href: "/company", label: "Company", anyOf: ["company.manage"] },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { actor } = await requirePageSession();
  // Hiding links is convenience only — every API and page re-checks permissions on the server.
  const items = NAV.filter((n) => n.anyOf.some((p) => actor.permissions.has(p)));
  const db = getDb(actor);
  const [unread, brand] = await Promise.all([unreadCount(db, actor), companyBranding(db)]);
  // Points at a route handler that mints a fresh signed URL and redirects on each request, rather than
  // embedding one resolved at page-render time — see the logo route's own comment for why.
  const hasLogo = Boolean(brand?.logoKey);
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  // Colour is validated as #RRGGBB by the API and a database check constraint before it can reach this style tag.
  const color = brand?.color && /^#[0-9A-Fa-f]{6}$/.test(brand.color) ? brand.color : null;
  const companyName = brand?.name ?? "Pitch Tracker";
  return (
    <div className="shell">
      {color && <style nonce={nonce}>{`:root{--accent:${color}}`}</style>}
      <nav className="nav" aria-label="Main">
        <div className="brand">
          {hasLogo
            ? // eslint-disable-next-line @next/next/no-img-element -- redirects to a signed, time-limited storage URL, not a static asset next/image can optimize
              <img className="brand-logo" src="/api/v1/company/logo" alt="" />
            : <span className="brand-logo-fallback" aria-hidden="true">{companyName.charAt(0).toUpperCase()}</span>}
          <span className="brand-text"><span className="name">{companyName}</span><small>Pitch Tracker · Story Pipeline</small></span>
        </div>
        <NavLinks items={items} />
        <AccountLink href="/account" label="My account" />
      </nav>
      <main className="main">
        <div className="topbar">
          <form action="/search" method="get" role="search">
            <input name="q" placeholder="Search pitches, creators, mobile, platforms, people…" aria-label="Global search" minLength={2} />
            <button className="btn-secondary">Search</button>
          </form>
          <div className="head-actions">
            <Link className="bell" href="/notifications">🔔<span className="sr-only"> Notifications</span>{unread > 0 && <span className="count">{unread}</span>}</Link>
            <LogoutButton />
          </div>
        </div>
        {brand && !brand.setupCompletedAt && actor.permissions.has("company.manage") && (
          <p className="notice">Your company setup is not finished. <Link href="/company">Complete setup</Link></p>
        )}
        {children}
      </main>
    </div>
  );
}
