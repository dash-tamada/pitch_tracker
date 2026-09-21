"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SVGProps } from "react";

export type NavItem = {
  href: string;
  label: string;
  /** Match this path only, never its sub-paths. Use it for a section root such as "/platform",
   *  which would otherwise stay highlighted on every page beneath it. */
  exact?: boolean;
};

/** Minimal inline-SVG line icons — no icon package is installed, and inline SVG keeps this CSP-safe
 *  (see globals.css's own note on charts). Each is a generic, original pictogram, never a brand mark. */
function Icon(props: SVGProps<SVGSVGElement>) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props} />;
}
const ICONS: Record<string, (p: SVGProps<SVGSVGElement>) => React.ReactNode> = {
  "/dashboard": (p) => <Icon {...p}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9 21v-6h6v6" /></Icon>,
  "/pitches": (p) => <Icon {...p}><path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M14 3v5h5" /><path d="M8.5 13h7M8.5 16.5h5" /></Icon>,
  "/reviews": (p) => <Icon {...p}><path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.7l5.9-.9L12 3.5Z" /></Icon>,
  "/management": (p) => <Icon {...p}><path d="M12 3 4 6v5c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V6l-8-3Z" /></Icon>,
  "/creators": (p) => <Icon {...p}><circle cx="9" cy="8" r="3.2" /><path d="M2.5 20c.7-3.6 3.3-6 6.5-6s5.8 2.4 6.5 6" /><circle cx="17.5" cy="9" r="2.6" /><path d="M15.5 14.2c2.6.4 4.5 2.5 5 5.8" /></Icon>,
  "/platforms": (p) => <Icon {...p}><path d="M12 3 3 8l9 5 9-5-9-5Z" /><path d="M3 13l9 5 9-5" /><path d="M3 18l9 5 9-5" /></Icon>,
  "/development": (p) => <Icon {...p}><path d="m8 9-4.5 3.5L8 16" /><path d="m16 9 4.5 3.5L16 16" /><path d="m13.5 5-3 14" /></Icon>,
  "/production": (p) => <Icon {...p}><path d="M4 8.5 20 6v12l-16-2.5V8.5Z" /><path d="M4 8.5v7l-1.5-.5v-6l1.5-.5Z" /><path d="M8 7.3 6.5 9.7M12 6.7l-1.5 2.4M16 6.1l-1.5 2.4" /></Icon>,
  "/analytics": (p) => <Icon {...p}><path d="M4 20V4M4 20h16" /><rect x="7" y="12" width="2.6" height="6" rx=".5" /><rect x="12" y="8" width="2.6" height="10" rx=".5" /><rect x="17" y="14" width="2.6" height="4" rx=".5" /></Icon>,
  "/notifications": (p) => <Icon {...p}><path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 14 6 10Z" /><path d="M10 19a2 2 0 0 0 4 0" /></Icon>,
  "/users": (p) => <Icon {...p}><circle cx="12" cy="8" r="3.4" /><path d="M4.5 20c1-4 3.7-6.5 7.5-6.5s6.5 2.5 7.5 6.5" /></Icon>,
  "/settings": (p) => <Icon {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 13.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2.06 2.06 0 1 1-2.92 2.92l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V19.6a2.06 2.06 0 0 1-4.12 0v-.1a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2.06 2.06 0 1 1-2.92-2.92l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H4.4a2.06 2.06 0 0 1 0-4.12h.1a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06A2.06 2.06 0 1 1 8.57 3.7l.06.06a1.7 1.7 0 0 0 1.87.34H10.6a1.7 1.7 0 0 0 1-1.55V2.4a2.06 2.06 0 0 1 4.12 0v.1a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2.06 2.06 0 1 1 2.92 2.92l-.06.06a1.7 1.7 0 0 0-.34 1.87v.1a1.7 1.7 0 0 0 1.55 1h.19a2.06 2.06 0 0 1 0 4.12h-.1a1.7 1.7 0 0 0-1.55 1Z" /></Icon>,
  "/company": (p) => <Icon {...p}><path d="M4 21V6l7-3 7 3v15" /><path d="M4 21h16" /><path d="M9 9h1.5M9 13h1.5M13.5 9H15M13.5 13H15" /><path d="M10 21v-5h4v5" /></Icon>,
  "/account": (p) => <Icon {...p}><circle cx="12" cy="8" r="3.6" /><path d="M4.8 20c.9-4.2 3.6-6.8 7.2-6.8s6.3 2.6 7.2 6.8" /></Icon>,
  "/platform": (p) => <Icon {...p}><rect x="3" y="4" width="18" height="13" rx="1.6" /><path d="M8 21h8M12 17v4" /><path d="M7 12.5l2.6-3 2.4 2.2 2.4-3.4 2.6 4.2" /></Icon>,
  "/platform/companies": (p) => <Icon {...p}><path d="M4 21V6l7-3 7 3v15" /><path d="M4 21h16" /><path d="M9 9h1.5M9 13h1.5M13.5 9H15M13.5 13H15" /><path d="M10 21v-5h4v5" /></Icon>,
  "/platform/plans": (p) => <Icon {...p}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10.5h18" /><path d="M7 14.5h4" /></Icon>,
  "/platform/audit": (p) => <Icon {...p}><path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M14 3v5h5" /><path d="M8.5 13h7M8.5 16.5h5" /></Icon>,
  "/platform/security": (p) => <Icon {...p}><rect x="5" y="10.5" width="14" height="9.5" rx="1.8" /><path d="M8.5 10.5V8a3.5 3.5 0 1 1 7 0v2.5" /><circle cx="12" cy="15" r="1.2" /></Icon>,
};

/** The item whose href is the longest prefix of the current path — so "/platform/companies" wins
 *  over the section root "/platform" instead of both lighting up. Items marked `exact` only ever
 *  match their own path. */
function bestMatch(pathname: string, items: NavItem[]): string | null {
  return items
    .filter((i) => (i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(`${i.href}/`)))
    .map((i) => i.href)
    .sort((a, b) => b.length - a.length)[0] ?? null;
}

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const current = bestMatch(pathname, items);
  return (
    <div className="nav-links">
      {items.map((n) => {
        const active = n.href === current;
        const IconCmp = ICONS[n.href];
        return (
          <Link key={n.href} href={n.href} className={active ? "nav-link active" : "nav-link"} aria-current={active ? "page" : undefined}>
            {IconCmp?.({})}
            {n.label}
          </Link>
        );
      })}
    </div>
  );
}

export function AccountLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href;
  const IconCmp = ICONS[href];
  return (
    <div className="nav-account">
      <Link href={href} className={active ? "nav-link active" : "nav-link"} aria-current={active ? "page" : undefined}>
        {IconCmp?.({})}
        {label}
      </Link>
    </div>
  );
}
