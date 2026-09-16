import { expect, test, type Page } from "@playwright/test";
import { base32Decode, stepAt, hotp } from "../src/server/modules/auth/totp";

const PASSWORD = "Demo-Monsoon-2026!";
const problems: string[] = [];

async function chooseUser(page: Page, name: string) {
  const select = page.locator('select[name="recipientId"]');
  await select.locator("option", { hasText: name }).first().waitFor({ state: "attached" });
  const value = await select.locator("option", { hasText: name }).first().getAttribute("value");
  await select.selectOption(value!);
}

async function signIn(page: Page, who: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(`${who}@demo.example.test`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/(dashboard|mfa-setup)$/);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(`CSP ${e.violatedDirective} sample=${JSON.stringify(e.sample)} source=${e.sourceFile}:${e.lineNumber} el=${(e.target as Element)?.outerHTML?.slice(0, 200)}`);
    });
  });
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) problems.push(`${page.url()} :: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`${page.url()} :: ${e.message}`));
});

test.afterAll(() => {
  // Any CSP violation or React error on any page fails the run.
  expect(problems, problems.join("\n")).toEqual([]);
});

test("security headers are present on every page", async ({ request }) => {
  const res = await request.get("/login");
  const h = res.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["x-powered-by"]).toBeUndefined();
});

test("employee journey: new pitch → upload script V1 → download → reject needs a reason → forward", async ({ page }) => {
  await signIn(page, "employee.a");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await page.goto("/pitches/new");
  await page.getByLabel("Search existing creators by name or mobile").fill("Anjali");
  await page.getByRole("button", { name: "Anjali Rao" }).click();
  await page.getByLabel("Pitch name *").fill("E2E Railway Story");
  await page.getByLabel("Format *").selectOption("WEB_SERIES");
  await page.getByLabel("Language *").selectOption("TELUGU");
  await page.getByRole("button", { name: "Submit pitch" }).click();
  await expect(page.getByText("Pitch submitted. Upload the script")).toBeVisible();
  await expect(page.getByLabel("Where is this story now?")).toContainText("Submitted");

  // upload
  await page.getByRole("button", { name: "+ Upload new document" }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "railway-script.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n%%EOF") });
  await page.getByLabel("Title *").fill("Script");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByRole("cell", { name: /V1\s*Current/ })).toBeVisible();

  // a disguised file is refused
  await page.getByRole("button", { name: "+ Upload new document" }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "evil.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ this is not a pdf") });
  await page.getByLabel("Title *").fill("Evil");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.locator("p.error[role=alert]")).toContainText("File contents do not match its extension");

  // download is served as an attachment
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download" }).first().click()]);
  expect(download.suggestedFilename()).toBe("railway-script.pdf");

  // workflow: assign to self
  await page.locator(".tabs").getByRole("link", { name: "Workflow" }).click();
  await page.getByRole("button", { name: /Assigned → Initial Review/ }).click();
  await chooseUser(page, "Employee A");
  await page.getByRole("button", { name: "Assigned", exact: true }).click();
  await expect(page.getByLabel("Where is this story now?")).toContainText("Initial Review");

  // rejection without a reason is refused by the server
  await page.locator(".tabs").getByRole("link", { name: "Workflow" }).click();
  await page.getByRole("button", { name: /Rejected → Rejected/ }).click();
  await page.locator('select[name="rejectionCategoryKey"]').selectOption("WEAK_STORY");
  await page.locator('textarea[name="rejectionReason"]').fill("short");
  await page.getByRole("button", { name: "Rejected", exact: true }).click();
  await expect(page.locator("p.error[role=alert]")).toContainText("Some required information is missing");

  // forward to Employee B at the next level
  await page.reload();
  await page.getByRole("button", { name: /Forwarded → Internal Review/ }).click();
  await chooseUser(page, "Employee B");
  await page.locator('form:has(select[name="recipientId"]) textarea[name="remarks"]').fill("Strong concept. Please review.");
  await page.getByRole("button", { name: "Forwarded", exact: true }).click();
  await expect(page.getByLabel("Where is this story now?")).toContainText("Employee B");
  await expect(page.locator(".timeline")).toContainText("Strong concept. Please review.");

  // store the URL for the IDOR test
  test.info().annotations.push({ type: "pitch", description: page.url() });
});

test("an uninvolved employee cannot open someone else's pitch by URL (IDOR)", async ({ page, browser }) => {
  const owner = await browser.newPage();
  await signIn(owner, "employee.a");
  await owner.goto("/pitches?q=E2E%20Railway%20Story");
  const href = await owner.getByRole("link", { name: "E2E Railway Story" }).getAttribute("href");
  expect(href).toMatch(/^\/pitches\/[0-9a-f-]{36}$/);
  await owner.close();

  await signIn(page, "employee.c");
  const res = await page.goto(href!);
  expect(res?.status()).toBe(404);
  const api = await page.request.get(`/api/v1${href}/timeline`);
  expect(api.status()).toBe(404);
});

test("CEO must enrol two-factor authentication, then sees the CEO / COO desk", async ({ page }) => {
  await signIn(page, "ceo");
  await expect(page).toHaveURL(/\/mfa-setup$/);
  await page.getByRole("button", { name: "Set up authenticator app" }).click();
  const secret = (await page.locator("code.secret").innerText()).replace(/\s/g, "");
  await page.getByLabel("6-digit code").fill(hotp(base32Decode(secret), stepAt(Date.now())));
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.goto("/management");
  await expect(page.getByRole("heading", { name: "CEO / COO Desk" })).toBeVisible();
  await page.goto("/pitches?view=kanban");
  await expect(page.getByRole("region", { name: "CEO / COO" })).toBeVisible();
  const lastJourney = page.getByRole("link", { name: "The Last Journey" }).first();
  await lastJourney.click();
  // The Last Journey is seeded into Production: the hero shows that status, and the READY TO GO banner
  // (shown only from platform approval until greenlight) must no longer appear.
  await expect(page.getByRole("heading", { name: "The Last Journey", level: 1 })).toBeVisible();
  await expect(page.getByText("Current status")).toBeVisible();
  await expect(page.getByText("👍 READY TO GO")).toHaveCount(0);
  for (const tab of ["Script & Documents", "Workflow", "Remarks", "Platform Pitches", "Creator", "Projects", "Ratings", "Images", "Development", "Production", "Activity Log"]) {
    await page.locator(".tabs").getByRole("link", { name: tab, exact: true }).click();
    await expect(page.locator(".tabs").getByRole("link", { name: tab, exact: true })).toHaveAttribute("aria-current", "page");
  }
  await page.locator(".tabs").getByRole("link", { name: "Platform Pitches", exact: true }).click();
  await expect(page.locator(".timeline").first()).toContainText("Second draft requested");
  for (const path of ["/dashboard", "/reviews", "/creators", "/platforms", "/development", "/production", "/analytics", "/notifications", "/search?q=Netflix", "/account"]) {
    const r = await page.goto(path);
    expect(r?.status(), path).toBe(200);
  }
});

test("admin manages users but cannot read pitches", async ({ page }) => {
  await signIn(page, "admin");
  await expect(page).toHaveURL(/\/mfa-setup$/); // Admin also requires MFA
  await page.getByRole("button", { name: "Set up authenticator app" }).click();
  const secret = (await page.locator("code.secret").innerText()).replace(/\s/g, "");
  await page.getByLabel("6-digit code").fill(hotp(base32Decode(secret), stepAt(Date.now())));
  await page.getByRole("button", { name: "Confirm" }).click();
  await page.waitForURL(/\/dashboard$/);
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Users & roles" })).toBeVisible();
  await page.goto("/settings?tab=audit");
  await expect(page.getByRole("cell", { name: "document.downloaded" }).first()).toBeVisible();
  await page.goto("/pitches");
  await expect(page.getByText("You do not have access to pitches.")).toBeVisible();
});

test("platform Super Admin: MFA, company console with counts only; company users cannot open it", async ({ page, browser }) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill("platform.admin@example.test");
  await page.getByLabel("Password").fill("Platform-Console-2026!");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/mfa-setup$/); // platform accounts always need MFA
  await page.getByRole("button", { name: "Set up authenticator app" }).click();
  const secret = (await page.locator("code.secret").innerText()).replace(/\s/g, "");
  await page.getByLabel("6-digit code").fill(hotp(base32Decode(secret), stepAt(Date.now())));
  await page.getByRole("button", { name: "Confirm" }).click();
  await page.waitForURL(/\/platform$/);
  await expect(page.getByRole("heading", { name: "Platform overview" })).toBeVisible();
  await page.goto("/platform/companies");
  await expect(page.getByRole("link", { name: "Demo Films" })).toBeVisible();
  // The platform account has no company: company pages and APIs refuse it.
  expect((await page.request.get("/api/v1/pitches")).status()).toBe(403);
  await page.goto("/pitches");
  await page.waitForURL(/\/platform$/);

  const other = await browser.newPage();
  await signIn(other, "viewer");
  expect((await other.request.get("/api/v1/platform/companies")).status()).toBe(403);
  const r = await other.goto("/platform/companies");
  expect(r?.status()).toBe(404);
  await other.close();
});
