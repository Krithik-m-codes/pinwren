CREATE TABLE "feedback_ai" (
	"feedback_id" uuid PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"suggested_title" text,
	"summary" text,
	"suggested_priority" "priority",
	"suggested_kind" "feedback_kind",
	"duplicate_candidate_id" uuid,
	"duplicate_confidence" integer,
	"duplicate_reason" text,
	"reproduction_steps" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"model" text,
	"tokens_used" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_translation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feedback_id" uuid NOT NULL,
	"target_locale" text NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "ai_config" jsonb DEFAULT '{"enabled":false,"autoSummary":true,"autoSeverity":true,"detectDuplicates":true,"generateRepro":true,"allowReplayInAi":false}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_ai" ADD CONSTRAINT "feedback_ai_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_ai" ADD CONSTRAINT "feedback_ai_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_ai" ADD CONSTRAINT "feedback_ai_duplicate_candidate_id_feedback_id_fk" FOREIGN KEY ("duplicate_candidate_id") REFERENCES "public"."feedback"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_translation" ADD CONSTRAINT "feedback_translation_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_ai_org_idx" ON "feedback_ai" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_translation_locale_uq" ON "feedback_translation" USING btree ("feedback_id","target_locale");