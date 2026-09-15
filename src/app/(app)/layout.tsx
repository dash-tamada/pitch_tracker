import Link from "next/link";
import { requirePageSession } from "@/server/lib/page-session";
import type { Permission } from "@/server/modules/authz/permissions";

const NAV: { href: string; label: string; anyOf: Permission[] }[] = [
  { href: "/dashboard", label: "Dashboard", anyOf: ["pitch.view", "analytics.view"] },
  { href: "/pitches", label: "Pitches", anyOf: ["pitch.view", "pitch.view_all"] },
  { href: "/reviews", label: "My Reviews", anyOf: ["pitch.accept", "pitch.approve_executive"] },
  { href: "/creators", label: "Creators", anyOf: ["creator.view"] },
  { href: "/platforms", label: "Platforms", anyOf: ["platform.view"] },
  { href: "/development", label: "Development", anyOf: ["development.manage"] },
  { href: "/production", label: "Production", anyOf: ["production.manage"] },
  { href: "/analytics", label: "Analytics", anyOf: ["analytics.view"] },
  { href: "/notifications", label: "Notifications", anyOf: ["pitch.view", "creator.view"] },
  { href: "/users", label: "Users", anyOf: ["user.manage"] },
  { href: "/settings", label: "Settings", anyOf: ["config.manage", "workflow.manage"] },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { actor } = await requirePageSession();
  // Hiding links is convenience only — every API and page re-checks permissions on the server.
  const items = NAV.filter((n) => n.anyOf.some((p) => actor.permissions.has(p)));
  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <div className="brand">Pitch Tracker<small>Story Pipeline Control Center</small></div>
        {items.map((n) => <Link key={n.href} href={n.href}>{n.label}</Link>)}
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
