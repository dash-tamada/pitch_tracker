import Link from "next/link";
import { requirePlatformPageSession } from "@/server/lib/page-session";
import { LogoutButton } from "@/components/logout-button";
import { AccountLink, NavLinks } from "@/components/nav-links";

const NAV = [
  { href: "/platform", label: "Overview", exact: true },
  { href: "/platform/companies", label: "Companies" },
  { href: "/platform/plans", label: "Plans & limits" },
  { href: "/platform/audit", label: "Platform audit" },
];

/** Platform (Super Admin) console. Separate from company pages: no pitches, scripts or creators here. */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformPageSession();
  return (
    <div className="shell is-platform">
      <nav className="nav" aria-label="Platform">
        <div className="brand">
          <span className="brand-logo-fallback" aria-hidden="true">P</span>
          <span className="brand-text"><span className="name">Pitch Tracker</span><small>Platform console</small></span>
        </div>
        <span className="nav-tag">Super Admin</span>
        <NavLinks items={NAV} />
        <AccountLink href="/platform/security" label="Security" />
      </nav>
      <main className="main">
        <div className="topbar">
          <p className="console-note">
            <span aria-hidden="true">🔒</span> Customer scripts, pitches and creators are not accessible from this console.
          </p>
          <div className="head-actions">
            <Link href="/platform/security" className="btn-secondary">Reset password</Link>
            <LogoutButton />
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
