import Link from "next/link";

/** Custom 404 without inline styles (Next's default page uses style attributes, which our CSP blocks). Same page for "does not exist" and "not allowed". */
export default function NotFound() {
  return (
    <main className="auth">
      <div className="section">
        <h1>Not found</h1>
        <p>This page does not exist, or you do not have access to it.</p>
        <p><Link href="/dashboard">Back to dashboard</Link></p>
      </div>
    </main>
  );
}
