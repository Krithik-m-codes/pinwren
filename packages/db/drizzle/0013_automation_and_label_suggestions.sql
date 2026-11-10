CREATE TABLE "automation_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"trigger" jsonb NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"rotation" integer DEFAULT 0 NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"rule_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"feedback_id" uuid,
	"event_id" text,
	"event" text NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "label_suggestion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"feedback_id" uuid NOT NULL,
	"label_id" uuid,
	"name" text NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "automation_rule_id_org_uq" ON "automation_rule" USING btree ("id","org_id");--> statement-breakpoint
ALTER TABLE "project" ALTER COLUMN "ai_config" SET DEFAULT '{"enabled":false,"autoSummary":true,"autoSeverity":true,"detectDuplicates":true,"generateRepro":true,"allowReplayInAi":false,"autoLabels":true,"autoApplyLabels":false}'::jsonb;--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rule" ADD CONSTRAINT "automation_rule_project_tenant_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."project"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_rule_id_automation_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_rule_tenant_fk" FOREIGN KEY ("rule_id","org_id") REFERENCES "public"."automation_rule"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_project_tenant_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."project"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_feedback_tenant_fk" FOREIGN KEY ("feedback_id","org_id") REFERENCES "public"."feedback"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suggestion" ADD CONSTRAINT "label_suggestion_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suggestion" ADD CONSTRAINT "label_suggestion_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suggestion" ADD CONSTRAINT "label_suggestion_label_id_label_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."label"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suggestion" ADD CONSTRAINT "label_suggestion_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suggestion" ADD CONSTRAINT "label_suggestion_feedback_tenant_fk" FOREIGN KEY ("feedback_id","org_id") REFERENCES "public"."feedback"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suggestion" ADD CONSTRAINT "label_suggestion_label_tenant_fk" FOREIGN KEY ("label_id","org_id") REFERENCES "public"."label"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_rule_project_idx" ON "automation_rule" USING btree ("project_id","enabled");--> statement-breakpoint
CREATE INDEX "automation_run_rule_idx" ON "automation_run" USING btree ("rule_id","created_at");--> statement-breakpoint
CREATE INDEX "automation_run_project_idx" ON "automation_run" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_run_rule_event_uq" ON "automation_run" USING btree ("rule_id","event_id") WHERE "automation_run"."event_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "label_suggestion_feedback_name_uq" ON "label_suggestion" USING btree ("feedback_id",lower("name"));--> statement-breakpoint
CREATE INDEX "label_suggestion_feedback_idx" ON "label_suggestion" USING btree ("feedback_id","status");--> statement-breakpoint
CREATE INDEX "label_suggestion_org_pending_idx" ON "label_suggestion" USING btree ("org_id","feedback_id") WHERE "label_suggestion"."status" = 'pending';
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."automation_rule" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));

--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."automation_run" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));

--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."label_suggestion" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
