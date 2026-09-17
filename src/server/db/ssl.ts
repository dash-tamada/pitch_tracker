/**
 * TLS settings for PostgreSQL connections.
 *
 * Managed databases (Supabase) must be reached over TLS with the server certificate verified,
 * otherwise anyone on the network path can impersonate the database. Supabase signs its
 * certificates with its own root CA, which is not in Node's default trust store, so the CA is
 * supplied through DATABASE_CA_CERT (PEM text, or the PEM base64-encoded on one line).
 *
 * `pg` lets `sslmode` in the URL override an explicit `ssl` object, so when a CA is configured
 * the ssl* query parameters are removed from the URL and verification is set here instead.
 */
import type { PoolConfig } from "pg";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", ""]);

export function decodeCaCert(raw: string | undefined): string | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  if (v.includes("-----BEGIN CERTIFICATE-----")) return v.replace(/\\n/g, "\n");
  const decoded = Buffer.from(v, "base64").toString("utf8");
  if (!decoded.includes("-----BEGIN CERTIFICATE-----")) throw new Error("DATABASE_CA_CERT is not a PEM certificate (or base64 of one)");
  return decoded;
}

export function connectionConfig(
  connectionString: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Pick<PoolConfig, "connectionString" | "ssl"> {
  const url = new URL(connectionString);
  const ca = decodeCaCert(env.DATABASE_CA_CERT);
  const remote = !LOCAL_HOSTS.has(url.hostname.replace(/^\[|\]$/g, ""));
  const strictEnv = env.APP_ENV === "production" || env.APP_ENV === "staging";

  if (ca) {
    for (const k of [...url.searchParams.keys()]) if (/^ssl/i.test(k) || k === "uselibpqcompat") url.searchParams.delete(k);
    return { connectionString: url.toString(), ssl: { ca, rejectUnauthorized: true } };
  }
  if (remote && strictEnv) {
    throw new Error("DATABASE_CA_CERT must be set for a remote database in staging/production (see docs/DEPLOYMENT.md)");
  }
  if (!remote) {
    // Local Postgres (dev/test) never speaks TLS. A connection string that started life as a copy-pasted
    // remote/Supabase example can carry a stray `sslmode=require` (or similar) query parameter — `pg` lets
    // that override an explicit `ssl` option, so it must be stripped here, not just set to false, or the
    // client still attempts SSL and the server rejects it with "The server does not support SSL connections".
    for (const k of [...url.searchParams.keys()]) if (/^ssl/i.test(k) || k === "uselibpqcompat") url.searchParams.delete(k);
    return { connectionString: url.toString(), ssl: false };
  }
  return { connectionString };
}
