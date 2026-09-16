/**
 * Prints how DATABASE_URL actually parses — protocol, host, port, username, database name — with the
 * password masked. Use this when the app can't connect at all (ECONNREFUSED, ENOTFOUND, etc): it tells you
 * whether the connection string itself is well-formed, without ever showing the password back to you.
 *
 * Usage: npx tsx scripts/diagnose-db-url.ts
 */
import { config } from "dotenv";
import { readFileSync } from "node:fs";

config({ path: ".env.local", quiet: true });

function show(name: string, raw: string | undefined) {
  console.log(`\n${name}:`);
  if (!raw) { console.log("  (not set)"); return; }
  try {
    const u = new URL(raw);
    console.log(`  protocol: ${u.protocol}`);
    console.log(`  username: ${JSON.stringify(u.username)}`);
    console.log(`  password: ${u.password ? `(set, ${u.password.length} chars)` : "(EMPTY — likely the bug)"}`);
    console.log(`  hostname: ${JSON.stringify(u.hostname)}`);
    console.log(`  port:     ${JSON.stringify(u.port) || "(default, 5432)"}`);
    console.log(`  database: ${JSON.stringify(u.pathname.slice(1))}`);
    console.log(`  raw length: ${raw.length} chars`);
  } catch (e) {
    console.log(`  FAILED TO PARSE AS A URL: ${e instanceof Error ? e.message : String(e)}`);
    console.log(`  raw length: ${raw.length} chars, starts with: ${JSON.stringify(raw.slice(0, 12))}`);
  }
}

show("DATABASE_URL", process.env.DATABASE_URL);
show("PLATFORM_DATABASE_URL", process.env.PLATFORM_DATABASE_URL);

if (process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL) {
  try {
    const a = new URL(process.env.DATABASE_URL);
    const b = new URL(process.env.PLATFORM_DATABASE_URL);
    const literallyIdentical = a.hostname === b.hostname && (a.port || "5432") === (b.port || "5432");
    console.log(`\nDATABASE_URL host:port = ${a.hostname}:${a.port || "5432"}`);
    console.log(`PLATFORM_DATABASE_URL host:port = ${b.hostname}:${b.port || "5432"}`);
    console.log(literallyIdentical
      ? "  (literally identical string — same target)"
      : "  (different strings — note \"localhost\" and \"127.0.0.1\" usually reach the same machine, but a genuinely different host or port here would explain why one connects and the other doesn't)");
  } catch { /* already reported above if either failed to parse */ }
}

// Also check for a duplicate key further down the file overriding or conflicting with the first.
const fileText = readFileSync(".env.local", "utf8");
for (const name of ["DATABASE_URL", "PLATFORM_DATABASE_URL"]) {
  const matches = fileText.split(/\r?\n/).filter((l) => new RegExp(`^\\s*${name}\\s*=`).test(l));
  console.log(`\n.env.local has ${matches.length} line(s) starting with "${name}=".`);
  if (matches.length > 1) console.log("  That's a bug — dotenv only honors one of them. Remove the extra line(s).");
}
