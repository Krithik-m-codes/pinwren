CREATE TYPE "public"."email_delivery_status" AS ENUM('sent', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."email_digest" AS ENUM('off', 'hourly', 'daily');--> statement-breakpoint
CREATE TABLE "email_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text,
	"to_address" text NOT NULL,
	"template_key" text NOT NULL,
	"subject" text NOT NULL,
	"status" "email_delivery_status" NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "feedback_label" (
	"feedback_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	CONSTRAINT "feedback_label_feedback_id_label_id_pk" PRIMARY KEY("feedback_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "feedback_watcher" (
	"feedback_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_watcher_feedback_id_user_id_pk" PRIMARY KEY("feedback_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "label" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "review_link_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "user_preference" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email_digest" "email_digest" DEFAULT 'off' NOT NULL,
	"email_paused" boolean DEFAULT false NOT NULL,
	"last_digest_at" timestamp with time zone,
	"avatar_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project" ALTER COLUMN "public_read" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "project" ALTER COLUMN "notify_reporter" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "mentions" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "duplicate_of_id" uuid;--> statement-breakpoint
ALTER TABLE "feedback_asset" ADD COLUMN "annotations" jsonb;--> statement-breakpoint
ALTER TABLE "feedback_asset" ADD COLUMN "capture" jsonb;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "event_id" text;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD COLUMN "mentioned" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD COLUMN "priority_changes" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "rejected_origins" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD COLUMN "domain_event_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_label" ADD CONSTRAINT "feedback_label_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_label" ADD CONSTRAINT "feedback_label_label_id_label_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."label"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_watcher" ADD CONSTRAINT "feedback_watcher_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_watcher" ADD CONSTRAINT "feedback_watcher_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_link" ADD CONSTRAINT "review_link_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_link" ADD CONSTRAINT "review_link_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_link" ADD CONSTRAINT "review_link_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_delivery_created_idx" ON "email_delivery" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "feedback_label_label_idx" ON "feedback_label" USING btree ("label_id");--> statement-breakpoint
CREATE INDEX "feedback_watcher_user_idx" ON "feedback_watcher" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "label_project_name_uq" ON "label" USING btree ("project_id",lower("name"));--> statement-breakpoint
CREATE INDEX "review_link_project_idx" ON "review_link" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "two_factor_user_idx" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_duplicate_of_id_feedback_id_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."feedback"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_duplicate_of_idx" ON "feedback" USING btree ("duplicate_of_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_user_event_type_uq" ON "notification" USING btree ("user_id","event_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_delivery_endpoint_event_uq" ON "webhook_delivery" USING btree ("endpoint_id","domain_event_id") WHERE domain_event_id is not null;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "reporter_email_received" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "reporter_email_status" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "reporter_email_priority" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "reporter_email_assigned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "notify_member_ids" text[];--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "notify_emails" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- Wave 5 makes visitorsCanResolve default to false. Projects created before keep the behaviour they had.
UPDATE "project" SET "widget_config" = "widget_config" || '{"visitorsCanResolve": true}'::jsonb WHERE "widget_config"->'visitorsCanResolve' IS NULL;--> statement-breakpoint
-- Integrations (wave 5): Teams / Telegram / ntfy notification channels and Linear / Jira issue sync. New enum
-- values are only added here, never used, so this runs inside the migration transaction (PostgreSQL 12+).
ALTER TYPE "public"."webhook_kind" ADD VALUE IF NOT EXISTS 'teams';--> statement-breakpoint
ALTER TYPE "public"."webhook_kind" ADD VALUE IF NOT EXISTS 'telegram';--> statement-breakpoint
ALTER TYPE "public"."webhook_kind" ADD VALUE IF NOT EXISTS 'ntfy';--> statement-breakpoint
ALTER TYPE "public"."issue_provider" ADD VALUE IF NOT EXISTS 'linear';--> statement-breakpoint
ALTER TYPE "public"."issue_provider" ADD VALUE IF NOT EXISTS 'jira';--> statement-breakpoint
-- Better Auth 1.7 twoFactor plugin fields (accounts, wave 5): enrolment state and the brute-force lock.
ALTER TABLE "two_factor" ADD COLUMN IF NOT EXISTS "verified" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "two_factor" ADD COLUMN IF NOT EXISTS "failed_verification_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "two_factor" ADD COLUMN IF NOT EXISTS "locked_until" timestamp with time zone;--> statement-breakpoint
-- Review links (wave 5): the link a guest's report came through, for its source and the inbox filter.
ALTER TABLE "feedback" ADD COLUMN "review_link_id" uuid;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_review_link_id_review_link_id_fk" FOREIGN KEY ("review_link_id") REFERENCES "public"."review_link"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_review_link_idx" ON "feedback" USING btree ("review_link_id");--> statement-breakpoint
-- Better Auth passkey plugin (sign-in methods, wave 5): WebAuthn credentials registered in Settings › Profile.
CREATE TABLE IF NOT EXISTS "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"aaguid" text
);
--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "passkey_user_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "passkey_credential_id_uq" ON "passkey" USING btree ("credential_id");
