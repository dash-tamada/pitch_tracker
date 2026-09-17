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
  const remote = !LOCAL_HOSTS.has(url.hostname.replace(/^\[|\]$/g, ""));
  const strictEnv = env.APP_ENV === "production" || env.APP_ENV === "staging";

  if (!remote) {
    // Local Postgres (dev/test) never speaks TLS — regardless of whether DATABASE_CA_CERT happens to be set
    // in the environment for a *different* (remote) connection string, e.g. PLATFORM_DATABASE_URL pointing at
    // Supabase while DATABASE_URL points at local Postgres. This check must come before the CA branch below:
    // env.DATABASE_CA_CERT is a single process-wide variable shared by every connectionConfig() call, so a CA
    // configured for the remote pool must never leak into the local pool's TLS decision.
    // Also strip any stray `sslmode`/`ssl*` query parameter (e.g. carried over from a copy-pasted remote
    // connection string) — `pg` lets that override an explicit `ssl` option, so it must be removed here, not
    // just set to false, or the client still attempts SSL and the server rejects it with
    // "The server does not support SSL connections".
    for (const k of [...url.searchParams.keys()]) if (/^ssl/i.test(k) || k === "uselibpqcompat") url.searchParams.delete(k);
    return { connectionString: url.toString(), ssl: false };
  }

  const ca = decodeCaCert(env.DATABASE_CA_CERT);
  if (ca) {
    for (const k of [...url.searchParams.keys()]) if (/^ssl/i.test(k) || k === "uselibpqcompat") url.searchParams.delete(k);
    return { connectionString: url.toString(), ssl: { ca, rejectUnauthorized: true } };
  }
  if (strictEnv) {
    throw new Error("DATABASE_CA_CERT must be set for a remote database in staging/production (see docs/DEPLOYMENT.md)");
  }
  return { connectionString };
}
