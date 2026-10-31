CREATE TABLE "billing_event" (
	"org_id" text NOT NULL,
	"webhook_id" text NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_event_org_id_webhook_id_pk" PRIMARY KEY("org_id","webhook_id")
);
--> statement-breakpoint
CREATE TABLE "billing_subscription" (
	"org_id" text PRIMARY KEY NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"interval" text,
	"status" text DEFAULT 'none' NOT NULL,
	"dodo_customer_id" text,
	"dodo_subscription_id" text,
	"product_id" text,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"past_due_since" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_event" ADD CONSTRAINT "billing_event_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscription" ADD CONSTRAINT "billing_subscription_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscription_dodo_sub_uq" ON "billing_subscription" USING btree ("dodo_subscription_id");
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."billing_subscription" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));

--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."billing_event" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
