import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
process.env.SESSION_TOKEN_PEPPER ??= Buffer.alloc(32, 7).toString("base64");
process.env.MFA_ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString("base64");
// Runtime singletons (tenantDb/getPlatformDb) must point at the test database, never the development one.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.PLATFORM_DATABASE_URL = process.env.TEST_PLATFORM_DATABASE_URL;
