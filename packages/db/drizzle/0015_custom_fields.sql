CREATE TABLE "custom_field" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"help_text" text DEFAULT '' NOT NULL,
	"placeholder" text DEFAULT '' NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"audience" text DEFAULT 'reporter' NOT NULL,
	"kinds" text[] DEFAULT '{bug,idea,question}'::text[] NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_value" jsonb,
	"validation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pii" boolean DEFAULT false NOT NULL,
	"strings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_field" ADD CONSTRAINT "custom_field_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field" ADD CONSTRAINT "custom_field_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field" ADD CONSTRAINT "custom_field_project_tenant_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."project"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_project_key_uq" ON "custom_field" USING btree ("project_id","key");--> statement-breakpoint
CREATE INDEX "custom_field_project_position_idx" ON "custom_field" USING btree ("project_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_id_org_uq" ON "custom_field" USING btree ("id","org_id");--> statement-breakpoint
CREATE INDEX "feedback_custom_fields_idx" ON "feedback" USING gin ("custom_fields" jsonb_path_ops);
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."custom_field" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
