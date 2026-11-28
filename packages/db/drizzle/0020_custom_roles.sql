CREATE TABLE "custom_role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "custom_role_id" uuid;--> statement-breakpoint
ALTER TABLE "custom_role" ADD CONSTRAINT "custom_role_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_role" ADD CONSTRAINT "custom_role_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_role_org_name_uq" ON "custom_role" USING btree ("org_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "custom_role_id_org_uq" ON "custom_role" USING btree ("id","org_id");--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_custom_role_tenant_fk" FOREIGN KEY ("custom_role_id","organization_id") REFERENCES "public"."custom_role"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."custom_role" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
