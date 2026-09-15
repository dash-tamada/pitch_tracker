import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/cron/run/route";

const SECRET = "x".repeat(40);
const call = (auth?: string) => GET(new NextRequest("http://localhost/api/cron/run?task=daily", { headers: auth ? { authorization: auth } : {} }));
const original = process.env.CRON_SECRET;
afterEach(() => { process.env.CRON_SECRET = original; });

describe("cron endpoint authentication", () => {
  it("rejects missing, wrong, cookie-style and non-Bearer credentials", async () => {
    process.env.CRON_SECRET = SECRET;
    for (const auth of [undefined, "Bearer wrong", SECRET, `Basic ${SECRET}`, `Bearer ${SECRET}x`]) {
      expect((await call(auth)).status, String(auth)).toBe(401);
    }
  });

  it("stays closed when CRON_SECRET is unset or shorter than 32 characters, even if the caller matches it", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer ")).status).toBe(401);
    process.env.CRON_SECRET = "short-secret";
    expect((await call("Bearer short-secret")).status).toBe(401);
  });
});
