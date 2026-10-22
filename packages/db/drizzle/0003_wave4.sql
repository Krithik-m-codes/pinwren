CREATE TYPE "public"."review_round_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."view_layout" AS ENUM('list', 'board');--> statement-breakpoint
CREATE TABLE "email_suppression" (
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"reason" text DEFAULT 'unsubscribe' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_suppression_org_id_email_pk" PRIMARY KEY("org_id","email")
);
--> statement-breakpoint
CREATE TABLE "license" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raw" text NOT NULL,
	"payload" jsonb NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"installed_by" text
);
--> statement-breakpoint
CREATE TABLE "review_round" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"due_at" timestamp with time zone,
	"status" "review_round_status" DEFAULT 'active' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_view" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"layout" "view_layout" DEFAULT 'list' NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "round_id" uuid;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "consent" jsonb;--> statement-breakpoint
ALTER TABLE "feedback_asset" ADD COLUMN "meta" jsonb;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "identity_secret" text;--> statement-breakpoint
ALTER TABLE "email_suppression" ADD CONSTRAINT "email_suppression_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license" ADD CONSTRAINT "license_installed_by_user_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_round" ADD CONSTRAINT "review_round_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_round" ADD CONSTRAINT "review_round_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_round" ADD CONSTRAINT "review_round_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_round_project_status_idx" ON "review_round" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "saved_view_org_idx" ON "saved_view" USING btree ("org_id","owner_id");--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_round_id_review_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."review_round"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_round_idx" ON "feedback" USING btree ("round_id");