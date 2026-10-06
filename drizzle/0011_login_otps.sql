-- One-time codes for signing in with a mobile number over WhatsApp.
--
-- Only hashes are stored: the mobile number and the code are HMAC'd with the server pepper, so a
-- database leak yields neither. A row is created when a code is requested, becomes "verified" when the
-- right code is entered, and — only if the number belongs to more than one account — carries a
-- single-use choice token so the person can pick which account to enter.
CREATE TABLE "login_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mobile_hash" "bytea" NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"ip" "inet",
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"choice_token_hash" "bytea",
	"choice_expires_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "login_otps_mobile_time_idx" ON "login_otps" USING btree ("mobile_hash","created_at");--> statement-breakpoint
CREATE INDEX "login_otps_ip_time_idx" ON "login_otps" USING btree ("ip","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "login_otps_choice_uq" ON "login_otps" USING btree ("choice_token_hash") WHERE "choice_token_hash" IS NOT NULL;--> statement-breakpoint
ALTER TABLE public.login_otps ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Sign-in happens before any company is known, so only the identity role touches this table.
REVOKE ALL ON public.login_otps FROM PUBLIC;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pitch_app') THEN REVOKE ALL ON public.login_otps FROM pitch_app; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON public.login_otps FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON public.login_otps FROM authenticated; END IF;
END $$;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.login_otps TO pitch_platform;--> statement-breakpoint
CREATE POLICY platform_identity ON public.login_otps FOR ALL TO pitch_platform USING (true) WITH CHECK (true);
