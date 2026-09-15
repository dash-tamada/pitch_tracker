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

  it("leaves local development and tests unchanged", () => {
    const local = "postgres://pitch_app:pw@localhost:5432/pitch_dev";
    expect(connectionConfig(local, { APP_ENV: "production" })).toEqual({ connectionString: local });
    expect(connectionConfig(REMOTE, { APP_ENV: "development" })).toEqual({ connectionString: REMOTE });
  });
});
