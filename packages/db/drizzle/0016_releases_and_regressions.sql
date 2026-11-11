CREATE TABLE "project_release" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"version" text NOT NULL,
	"commit" text,
	"notes" text,
	"deployed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "fixed_in_release_id" uuid;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "fixed_in_next_release" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "regression_of_id" uuid;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "regression_confidence" text;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "regression_signals" jsonb;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "sig_path" text;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "sig_anchor" text;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "sig_errors" text[];--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "detect_regressions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "auto_reopen_regressions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project_release" ADD CONSTRAINT "project_release_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_release" ADD CONSTRAINT "project_release_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_release" ADD CONSTRAINT "project_release_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_release" ADD CONSTRAINT "project_release_project_tenant_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."project"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_release_project_version_uq" ON "project_release" USING btree ("project_id",lower("version"));--> statement-breakpoint
CREATE INDEX "project_release_project_deployed_idx" ON "project_release" USING btree ("project_id","deployed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_release_id_org_uq" ON "project_release" USING btree ("id","org_id");--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_fixed_in_release_id_project_release_id_fk" FOREIGN KEY ("fixed_in_release_id") REFERENCES "public"."project_release"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_regression_of_id_feedback_id_fk" FOREIGN KEY ("regression_of_id") REFERENCES "public"."feedback"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_regression_tenant_fk" FOREIGN KEY ("regression_of_id","org_id") REFERENCES "public"."feedback"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_fixed_in_tenant_fk" FOREIGN KEY ("fixed_in_release_id","org_id") REFERENCES "public"."project_release"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_fixed_in_idx" ON "feedback" USING btree ("fixed_in_release_id") WHERE "feedback"."fixed_in_release_id" is not null;--> statement-breakpoint
CREATE INDEX "feedback_regression_of_idx" ON "feedback" USING btree ("regression_of_id") WHERE "feedback"."regression_of_id" is not null;--> statement-breakpoint
CREATE INDEX "feedback_sig_anchor_idx" ON "feedback" USING btree ("project_id","sig_anchor") WHERE "feedback"."sig_anchor" is not null;--> statement-breakpoint
CREATE INDEX "feedback_sig_errors_idx" ON "feedback" USING gin ("sig_errors");
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."project_release" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
