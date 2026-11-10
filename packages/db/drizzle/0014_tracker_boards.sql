ALTER TYPE "public"."issue_provider" ADD VALUE 'trello';--> statement-breakpoint
ALTER TYPE "public"."issue_provider" ADD VALUE 'asana';--> statement-breakpoint
ALTER TYPE "public"."issue_provider" ADD VALUE 'clickup';--> statement-breakpoint
ALTER TYPE "public"."issue_provider" ADD VALUE 'notion';--> statement-breakpoint
ALTER TABLE "issue_link" ALTER COLUMN "number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_integration" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_integration" ADD COLUMN "webhook_ref" text;--> statement-breakpoint
ALTER TABLE "issue_integration" ADD COLUMN "webhook_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_link" ADD COLUMN "external_id" text;--> statement-breakpoint
CREATE INDEX "issue_link_integration_external_idx" ON "issue_link" USING btree ("integration_id","external_id");