import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
process.env.SESSION_TOKEN_PEPPER ??= Buffer.alloc(32, 7).toString("base64");
process.env.MFA_ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString("base64");
