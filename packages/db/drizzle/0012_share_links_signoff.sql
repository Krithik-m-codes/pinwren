CREATE TABLE "round_signoff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"round_id" uuid NOT NULL,
	"share_link_id" uuid,
	"decision" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"feedback_id" uuid,
	"round_id" uuid,
	"label" text DEFAULT '' NOT NULL,
	"token_hash" text NOT NULL,
	"password_hash" text,
	"allow_comments" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "share_link_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "share_link_target_ck" CHECK (("share_link"."feedback_id" is null) <> ("share_link"."round_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "share_link_id_org_uq" ON "share_link" USING btree ("id","org_id");
--> statement-breakpoint
ALTER TABLE "review_round" ADD COLUMN "require_signoff" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "round_signoff" ADD CONSTRAINT "round_signoff_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_signoff" ADD CONSTRAINT "round_signoff_round_id_review_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."review_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_signoff" ADD CONSTRAINT "round_signoff_share_link_id_share_link_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."share_link"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_signoff" ADD CONSTRAINT "round_signoff_round_tenant_fk" FOREIGN KEY ("round_id","org_id") REFERENCES "public"."review_round"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_signoff" ADD CONSTRAINT "round_signoff_link_tenant_fk" FOREIGN KEY ("share_link_id","org_id") REFERENCES "public"."share_link"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_round_id_review_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."review_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_project_tenant_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."project"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_feedback_tenant_fk" FOREIGN KEY ("feedback_id","org_id") REFERENCES "public"."feedback"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_round_tenant_fk" FOREIGN KEY ("round_id","org_id") REFERENCES "public"."review_round"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "round_signoff_round_idx" ON "round_signoff" USING btree ("round_id","created_at");--> statement-breakpoint
CREATE INDEX "share_link_project_idx" ON "share_link" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "share_link_feedback_idx" ON "share_link" USING btree ("feedback_id");--> statement-breakpoint
CREATE INDEX "share_link_round_idx" ON "share_link" USING btree ("round_id");
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."share_link" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));

--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."round_signoff" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
