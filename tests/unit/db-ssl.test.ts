import { describe, expect, it } from "vitest";
import { connectionConfig, decodeCaCert } from "@/server/db/ssl";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIBdummy\n-----END CERTIFICATE-----";
const REMOTE = "postgres://pitch_app.abcdefgh:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres";

describe("database TLS configuration", () => {
  it("accepts PEM text, PEM with escaped newlines, and base64 PEM", () => {
    expect(decodeCaCert(PEM)).toBe(PEM);
    expect(decodeCaCert(PEM.replace(/\n/g, "\\n"))).toBe(PEM);
    expect(decodeCaCert(Buffer.from(PEM).toString("base64"))).toBe(PEM);
    expect(decodeCaCert("  ")).toBeUndefined();
    expect(() => decodeCaCert("bm90IGEgY2VydA==")).toThrow(/not a PEM/);
  });

  it("verifies the server certificate when a CA is given, and URL sslmode cannot weaken it", () => {
    const cfg = connectionConfig(`${REMOTE}?sslmode=no-verify&sslrootcert=/tmp/x&application_name=a`, { DATABASE_CA_CERT: PEM, APP_ENV: "production" });
    expect(cfg.ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
    const url = new URL(cfg.connectionString!);
    expect(url.searchParams.has("sslmode")).toBe(false);
    expect(url.searchParams.has("sslrootcert")).toBe(false);
    expect(url.searchParams.get("application_name")).toBe("a");
  });

  it("refuses a remote database without a CA in production and staging", () => {
    expect(() => connectionConfig(REMOTE, { APP_ENV: "production" })).toThrow(/DATABASE_CA_CERT/);
    expect(() => connectionConfig(REMOTE, { APP_ENV: "staging" })).toThrow(/DATABASE_CA_CERT/);
  });

  it("leaves a remote connection string with no CA unchanged outside production/staging", () => {
    expect(connectionConfig(REMOTE, { APP_ENV: "development" })).toEqual({ connectionString: REMOTE });
  });

  it("local Postgres always gets ssl: false, and any stray sslmode/ssl* query param is stripped", () => {
    const local = "postgres://pitch_app:pw@localhost:5432/pitch_dev";
    expect(connectionConfig(local, { APP_ENV: "production" })).toEqual({ connectionString: local, ssl: false });

    // A connection string that started life as a copy-pasted remote/Supabase example can carry sslmode=require;
    // pg would otherwise honor that and try (and fail) to negotiate TLS with a local server that doesn't speak it.
    const localWithStraySsl = `${local}?sslmode=require&application_name=a`;
    const cfg = connectionConfig(localWithStraySsl, { APP_ENV: "development" });
    expect(cfg.ssl).toBe(false);
    const url = new URL(cfg.connectionString!);
    expect(url.searchParams.has("sslmode")).toBe(false);
    expect(url.searchParams.get("application_name")).toBe("a");
  });

  it("a CA cert configured for the remote (platform) pool must not leak into the local (tenant) pool's TLS decision", () => {
    // Realistic .env.local: PLATFORM_DATABASE_URL points at Supabase (needs DATABASE_CA_CERT), DATABASE_URL
    // points at local Postgres. Both calls to connectionConfig() see the same process.env, so DATABASE_CA_CERT
    // being set must not force TLS onto the local connection — local Postgres has no SSL to negotiate and
    // fails with "The server does not support SSL connections" if the client attempts it.
    const local = "postgres://pitch_app:pw@localhost:5432/pitch_dev";
    const cfg = connectionConfig(local, { DATABASE_CA_CERT: PEM, APP_ENV: "production" });
    expect(cfg.ssl).toBe(false);

    // The remote connection in the same environment still gets the CA applied.
    const remoteCfg = connectionConfig(REMOTE, { DATABASE_CA_CERT: PEM, APP_ENV: "production" });
    expect(remoteCfg.ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
  });
});
