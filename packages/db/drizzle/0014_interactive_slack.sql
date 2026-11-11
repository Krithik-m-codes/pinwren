ALTER TYPE "public"."feedback_source" ADD VALUE 'slack';
--> statement-breakpoint
CREATE TABLE "slack_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"feedback_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"ts" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_route" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"channel_id" text NOT NULL,
	"channel_name" text,
	"events" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_user_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"slack_user_id" text NOT NULL,
	"user_id" text NOT NULL,
	"source" text DEFAULT 'email' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_workspace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"team_id" text NOT NULL,
	"team_name" text NOT NULL,
	"team_url" text,
	"bot_user_id" text,
	"signing_secret" text NOT NULL,
	"bot_token" text NOT NULL,
	"token_hint" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "slack_message_feedback_channel_uq" ON "slack_message" USING btree ("feedback_id","channel_id");
--> statement-breakpoint
CREATE INDEX "slack_route_workspace_idx" ON "slack_route" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "slack_route_id_org_uq" ON "slack_route" USING btree ("id","org_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "slack_user_link_slack_uq" ON "slack_user_link" USING btree ("workspace_id","slack_user_id");
--> statement-breakpoint
CREATE INDEX "slack_user_link_user_idx" ON "slack_user_link" USING btree ("org_id","user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "slack_workspace_org_uq" ON "slack_workspace" USING btree ("org_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "slack_workspace_team_uq" ON "slack_workspace" USING btree ("team_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "slack_workspace_id_org_uq" ON "slack_workspace" USING btree ("id","org_id");
--> statement-breakpoint
ALTER TABLE "slack_message" ADD CONSTRAINT "slack_message_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "slack_message" ADD CONSTRAINT "slack_message_workspace_id_slack_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."slack_workspace"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "slack_message" ADD CONSTRAINT "slack_message_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "slack_message" ADD CONSTRAINT "slack_message_workspace_tenant_fk" FOREIGN KEY ("workspace_id","org_id") REFERENCES "public"."slack_workspace"("id","org_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "slack_message" ADD CONSTRAINT "slack_message_feedback_tenant_fk" FOREIGN KEY ("feedback_id","org_id") REFERENCES "public"."feedback"("id","org_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "slack_route" ADD CONSTRAINT "slack_route_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "slack_route" ADD CONSTRAINT "slack_route_workspace_id_slack_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."slack_workspace"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "slack_route" ADD CONSTRAINT "slack_route_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "slack_route" ADD CONSTRAINT "slack_route_workspace_tenant_fk" FOREIGN KEY ("workspace_id","org_id") REFERENCES "public"."slack_workspace"("id","org_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "slack_route" ADD CONSTRAINT "slack_route_project_tenant_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."project"("id","org_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "slack_user_link" ADD CONSTRAINT "slack_user_link_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "slack_user_link" ADD CONSTRAINT "slack_user_link_workspace_id_slack_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."slack_workspace"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "slack_user_link" ADD CONSTRAINT "slack_user_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "slack_user_link" ADD CONSTRAINT "slack_user_link_workspace_tenant_fk" FOREIGN KEY ("workspace_id","org_id") REFERENCES "public"."slack_workspace"("id","org_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "slack_workspace" ADD CONSTRAINT "slack_workspace_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "slack_workspace" ADD CONSTRAINT "slack_workspace_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."slack_workspace" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."slack_route" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."slack_user_link" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."slack_message" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
