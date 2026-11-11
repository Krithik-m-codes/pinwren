CREATE TABLE "dashboard" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"scope" text NOT NULL,
	"name" text NOT NULL,
	"layout" jsonb NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"default_roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_scope_check" CHECK ("dashboard"."scope" in ('home', 'inbox', 'projects', 'project', 'notifications')),
	CONSTRAINT "dashboard_roles_shared_check" CHECK ("dashboard"."shared" or cardinality("dashboard"."default_roles") = 0)
);
--> statement-breakpoint
CREATE TABLE "workspace_preference" (
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"dashboard_defaults" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pinned_project_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_preference_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN "ui_state" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "dashboard" ADD CONSTRAINT "dashboard_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard" ADD CONSTRAINT "dashboard_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_preference" ADD CONSTRAINT "workspace_preference_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_preference" ADD CONSTRAINT "workspace_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dashboard_id_org_uq" ON "dashboard" USING btree ("id","org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dashboard_owner_name_uq" ON "dashboard" USING btree ("org_id","owner_id","scope",lower("name"));--> statement-breakpoint
CREATE INDEX "dashboard_scope_idx" ON "dashboard" USING btree ("org_id","scope","shared");
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."dashboard" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));

--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."workspace_preference" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
