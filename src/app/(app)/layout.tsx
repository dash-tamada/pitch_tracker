import Link from "next/link";
import { headers } from "next/headers";
import { getDb } from "@/server/db/client";
import { eq } from "drizzle-orm";
import { users } from "@/server/db/schema";
import { requirePageSession } from "@/server/lib/page-session";
import type { Permission } from "@/server/modules/authz/permissions";
import { unreadCount } from "@/server/modules/notifications/service";
import { unseenIntake } from "@/server/modules/pitches/intake";
import { NewPitchAlert } from "@/components/new-pitch-alert";
import { companyBranding } from "@/server/modules/tenancy/company";
import { LogoutButton } from "@/components/logout-button";
import { NavLinks } from "@/components/nav-links";
import { PosterBackdrop } from "@/components/poster-wall";
import { RgbHistogram } from "@/components/rgb-histogram";

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
  const [unread, brand, me, incoming] = await Promise.all([
    unreadCount(db, actor), companyBranding(db),
    db.select({ name: users.fullName }).from(users).where(eq(users.id, actor.userId)).then((r) => r[0]),
    unseenIntake(db, actor).catch((e) => { console.error(JSON.stringify({ level: "error", route: "intake-alert", message: String(e?.cause?.message ?? e?.message).slice(0, 200) })); return []; }),
  ]);
  const first = (me?.name ?? "").trim().split(/\s+/)[0] ?? "";
  const initial = first.charAt(0).toUpperCase() || "U";
  // Points at a route handler that mints a fresh signed URL and redirects on each request, rather than
  // embedding one resolved at page-render time — see the logo route's own comment for why.
  const hasLogo = Boolean(brand?.logoKey);
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  // Colour is validated as #RRGGBB by the API and a database check constraint before it can reach this style tag.
  const color = brand?.color && /^#[0-9A-Fa-f]{6}$/.test(brand.color) ? brand.color : null;
  const companyName = brand?.name ?? "Pitch Tracker";
  return (
    <div className="shell">
      <PosterBackdrop />
      <RgbHistogram />
      <NewPitchAlert items={incoming.map((i) => ({ id: i.id, code: i.code, title: i.title, creator: i.creator }))} />
      {color && <style nonce={nonce}>{`:root{--accent:${color}}`}</style>}
      <nav className="nav" aria-label="Main">
        <div className="brand">
          {hasLogo
            ? // eslint-disable-next-line @next/next/no-img-element -- redirects to a signed, time-limited storage URL, not a static asset next/image can optimize
              <img className="brand-logo" src="/api/v1/company/logo" alt="" />
            : <span className="brand-logo-fallback" aria-hidden="true">{companyName.charAt(0).toUpperCase()}</span>}
          <span className="brand-text"><span className="name">{companyName}</span><small>Pitch Tracker · <span className="italic-accent">Story Pipeline</span></small></span>
        </div>
        <NavLinks items={items} badges={{ "/notifications": unread }} />
        <div className="nav-footer">
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="12" width="26" height="16" rx="2" fill="#ef4b23" /><path d="M3 12 29 6l1.4 4.6L4.4 16.6 3 12Z" fill="#f7f1e4" /><path d="m9 8.8 3.4 3.8M15.8 7.2l3.4 3.8M22.6 5.7 26 9.5" stroke="#14130f" strokeWidth="2.4" /></svg>
          <span>Good stories<br />travel far</span>
        </div>
      </nav>
      <main className="main">
        <div className="topbar">
          <form action="/search" method="get" role="search">
            <svg className="search-ico" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></svg>
            <input name="q" placeholder="Search pitches, creators, mobile, platforms, people…" aria-label="Global search" minLength={2} />
            <button className="search-go">Search</button>
          </form>
          <div className="head-actions">
            <Link className="bell" href="/notifications" aria-label="Notifications">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 14 6 10Z" /><path d="M10 19a2 2 0 0 0 4 0" /></svg>
              {unread > 0 && <span className="bell-dot" />}
            </Link>
            <Link className="profile-chip" href="/account" aria-label="My profile">
              <span className="avatar">{initial}</span>
              {first && <span className="profile-name">{first}</span>}
            </Link>
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
