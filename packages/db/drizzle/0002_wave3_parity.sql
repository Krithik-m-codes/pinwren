CREATE TYPE "public"."issue_provider" AS ENUM('github', 'gitlab');--> statement-breakpoint
CREATE TABLE "brand_asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"key" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_integration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"provider" "issue_provider" NOT NULL,
	"token" text NOT NULL,
	"token_hint" text NOT NULL,
	"repo" text NOT NULL,
	"api_url" text,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"auto_create" text DEFAULT 'manual' NOT NULL,
	"webhook_secret" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"feedback_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"provider" "issue_provider" NOT NULL,
	"number" integer NOT NULL,
	"url" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_setting" (
	"org_id" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_setting_org_id_key_pk" PRIMARY KEY("org_id","key")
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "widget_branding" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "action_secret" text;--> statement-breakpoint
ALTER TABLE "brand_asset" ADD CONSTRAINT "brand_asset_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_asset" ADD CONSTRAINT "brand_asset_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_template" ADD CONSTRAINT "email_template_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_template" ADD CONSTRAINT "email_template_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_integration" ADD CONSTRAINT "issue_integration_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_integration" ADD CONSTRAINT "issue_integration_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_integration" ADD CONSTRAINT "issue_integration_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_link" ADD CONSTRAINT "issue_link_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_link" ADD CONSTRAINT "issue_link_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_link" ADD CONSTRAINT "issue_link_integration_id_issue_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."issue_integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_setting" ADD CONSTRAINT "org_setting_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_setting" ADD CONSTRAINT "org_setting_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_asset_org_idx" ON "brand_asset" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_template_org_key_uq" ON "email_template" USING btree ("org_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_integration_project_provider_uq" ON "issue_integration" USING btree ("project_id","provider");--> statement-breakpoint
CREATE INDEX "issue_integration_repo_idx" ON "issue_integration" USING btree ("provider","repo");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_link_feedback_integration_uq" ON "issue_link" USING btree ("feedback_id","integration_id");--> statement-breakpoint
CREATE INDEX "issue_link_integration_number_idx" ON "issue_link" USING btree ("integration_id","number");