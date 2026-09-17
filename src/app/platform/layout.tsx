import Link from "next/link";
import { requirePlatformPageSession } from "@/server/lib/page-session";
import { LogoutButton } from "@/components/logout-button";

/** Platform (Super Admin) console. Separate from company pages: no pitches, scripts or creators here. */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformPageSession();
  return (
    <div className="shell">
      <nav className="nav" aria-label="Platform">
        <div className="brand">Pitch Tracker<small>Platform administration</small></div>
        <Link href="/platform">Overview</Link>
        <Link href="/platform/companies">Companies</Link>
        <Link href="/platform/plans">Plans & limits</Link>
        <Link href="/platform/audit">Platform audit</Link>
      </nav>
      <main className="main">
        <div className="topbar"><span className="subtle">Super Admin · customer scripts and pitches are not accessible from this console</span>
          <div className="head-actions"><Link href="/platform/security" className="btn-secondary">Reset password</Link><LogoutButton /></div></div>
        {children}
      </main>
    </div>
  );
}
