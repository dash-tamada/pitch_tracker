import Link from "next/link";
import { getDb } from "@/server/db/client";
import { requirePageSession } from "@/server/lib/page-session";
import type { Permission } from "@/server/modules/authz/permissions";
import { unreadCount } from "@/server/modules/notifications/service";
import { LogoutButton } from "@/components/logout-button";

const NAV: { href: string; label: string; anyOf: Permission[] }[] = [
  { href: "/dashboard", label: "Dashboard", anyOf: ["pitch.view", "pitch.view_all", "analytics.view"] },
  { href: "/pitches", label: "Pitches", anyOf: ["pitch.view", "pitch.view_all"] },
  { href: "/reviews", label: "My Reviews", anyOf: ["pitch.accept", "pitch.approve_executive"] },
  { href: "/management", label: "CEO / COO Desk", anyOf: ["pitch.approve_executive"] },
  { href: "/creators", label: "Creators", anyOf: ["creator.view"] },
  { href: "/platforms", label: "Platforms", anyOf: ["platform.view"] },
  { href: "/development", label: "Development", anyOf: ["development.manage"] },
  { href: "/production", label: "Production", anyOf: ["production.manage"] },
  { href: "/analytics", label: "Analytics", anyOf: ["analytics.view", "report.view"] },
  { href: "/notifications", label: "Notifications", anyOf: ["pitch.view", "creator.view", "user.manage"] },
  { href: "/users", label: "Users", anyOf: ["user.manage", "role.manage"] },
  { href: "/settings", label: "Settings", anyOf: ["config.manage", "workflow.manage", "audit.view"] },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { actor } = await requirePageSession();
  // Hiding links is convenience only — every API and page re-checks permissions on the server.
  const items = NAV.filter((n) => n.anyOf.some((p) => actor.permissions.has(p)));
  const unread = await unreadCount(getDb(), actor);
  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <div className="brand">Pitch Tracker<small>Story Pipeline Control Center</small></div>
        {items.map((n) => <Link key={n.href} href={n.href}>{n.label}</Link>)}
        <Link href="/account">My account</Link>
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
        {children}
      </main>
    </div>
  );
}
