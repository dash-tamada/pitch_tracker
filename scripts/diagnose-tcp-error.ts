/**
 * When a pg connection fails with an AggregateError, Node's default console.error prints it with the
 * sub-errors collapsed to "[Error]" placeholders and, in some cases, an empty top-level .message — which is
 * exactly the unhelpful "Stopped:" (nothing after it) that diagnose-lowlevel.ts printed. This script expands
 * every layer by hand: top-level error name/message/code, then each entry in .errors (if it's an
 * AggregateError) with its own code/address/port/message. That tells us definitively whether this is
 * ECONNREFUSED (nothing listening), ENOTFOUND (bad hostname), ETIMEDOUT (blocked/unreachable), or something
 * else entirely — instead of guessing from an empty string.
 *
 * Usage: npx tsx scripts/diagnose-tcp-error.ts
 */
import { config } from "dotenv";
import pg from "pg";
import { connectionConfig } from "../src/server/db/ssl";

config({ path: ".env.local", quiet: true });

function dump(label: string, e: unknown, indent = "  ") {
  if (e && typeof e === "object") {
    const rec = e as Record<string, unknown>;
    console.log(`${indent}${label}: name=${String(rec.name)} code=${String(rec.code ?? "(none)")} message=${JSON.stringify(String(rec.message ?? ""))}`);
    if (rec.address || rec.port) console.log(`${indent}  address=${String(rec.address)} port=${String(rec.port)} syscall=${String(rec.syscall)}`);
    const sub = rec.errors;
    if (Array.isArray(sub)) {
      console.log(`${indent}  -- ${sub.length} nested error(s) --`);
      sub.forEach((s, i) => dump(`errors[${i}]`, s, indent + "    "));
    }
  } else {
    console.log(`${indent}${label}: ${String(e)}`);
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const u = new URL(url);
  console.log(`Attempting a raw TCP+Postgres connection to ${u.hostname}:${u.port || "5432"} as ${JSON.stringify(u.username)}, database ${JSON.stringify(u.pathname.slice(1))} ...`);
  const client = new pg.Client(connectionConfig(url));
  const start = Date.now();
  try {
    await client.connect();
    console.log(`SUCCESS after ${Date.now() - start}ms — connected as ${(await client.query("select current_user")).rows[0].current_user}`);
    await client.end();
  } catch (e) {
    console.log(`FAILED after ${Date.now() - start}ms\n`);
    dump("top-level error", e);
  }
}

main();
