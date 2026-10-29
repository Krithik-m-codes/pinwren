CREATE UNIQUE INDEX "feedback_id_org_uq" ON "feedback" USING btree ("id","org_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "issue_integration_id_org_uq" ON "issue_integration" USING btree ("id","org_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "label_id_org_uq" ON "label" USING btree ("id","org_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "page_id_org_uq" ON "page" USING btree ("id","org_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "project_id_org_uq" ON "project" USING btree ("id","org_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "review_link_id_org_uq" ON "review_link" USING btree ("id","org_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "review_round_id_org_uq" ON "review_round" USING btree ("id","org_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_endpoint_id_org_uq" ON "webhook_endpoint" USING btree ("id","org_id");
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_feedback_tenant_fk" FOREIGN KEY ("feedback_id","org_id") REFERENCES "public"."feedback"("id","org_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_feedback_tenant_fk" FOREIGN KEY ("feedback_id","org_id") REFERENCES "public"."feedback"("id","org_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_project_tenant_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."project"("id","org_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_page_tenant_fk" FOREIGN KEY ("page_id","org_id") REFERENCES "public"."page"("id","org_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_round_tenant_fk" FOREIGN KEY ("round_id","org_id") REFERENCES "public"."review_round"("id","org_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_duplicate_tenant_fk" FOREIGN KEY ("duplicate_of_id","org_id") REFERENCES "public"."feedback"("id","org_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_review_link_tenant_fk" FOREIGN KEY ("review_link_id","org_id") REFERENCES "public"."review_link"("id","org_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "feedback_ai" ADD CONSTRAINT "feedback_ai_feedback_tenant_fk" FOREIGN KEY ("feedback_id","org_id") REFERENCES "public"."feedback"("id","org_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "feedback_ai" ADD CONSTRAINT "feedback_ai_duplicate_tenant_fk" FOREIGN KEY ("duplicate_candidate_id","org_id") REFERENCES "public"."feedback"("id","org_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "feedback_asset" ADD CONSTRAINT "asset_feedback_tenant_fk" FOREIGN KEY ("feedback_id","org_id") REFERENCES "public"."feedback"("id","org_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "issue_integration" ADD CONSTRAINT "issue_integration_project_tenant_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."project"("id","org_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "issue_link" ADD CONSTRAINT "issue_link_feedback_tenant_fk" FOREIGN KEY ("feedback_id","org_id") REFERENCES "public"."feedback"("id","org_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "issue_link" ADD CONSTRAINT "issue_link_integration_tenant_fk" FOREIGN KEY ("integration_id","org_id") REFERENCES "public"."issue_integration"("id","org_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_project_tenant_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."project"("id","org_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_feedback_tenant_fk" FOREIGN KEY ("feedback_id","org_id") REFERENCES "public"."feedback"("id","org_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_project_tenant_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."project"("id","org_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_project_tenant_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."project"("id","org_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_link" ADD CONSTRAINT "review_link_project_tenant_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."project"("id","org_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_round" ADD CONSTRAINT "review_round_project_tenant_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."project"("id","org_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_endpoint_tenant_fk" FOREIGN KEY ("endpoint_id","org_id") REFERENCES "public"."webhook_endpoint"("id","org_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_project_tenant_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."project"("id","org_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."activity" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."api_token" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."brand_asset" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."comment" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."diagnostics" FOR ALL TO PUBLIC USING (exists (select 1 from public.feedback as parent where parent.id = "diagnostics".feedback_id)) WITH CHECK (exists (select 1 from public.feedback as parent where parent.id = "diagnostics".feedback_id));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."email_delivery" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."email_suppression" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."email_template" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."feedback" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."feedback_ai" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."feedback_asset" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."feedback_label" FOR ALL TO PUBLIC USING (exists (select 1 from public.feedback as parent where parent.id = feedback_label.feedback_id) and exists (select 1 from public.label as parent where parent.id = feedback_label.label_id)) WITH CHECK (exists (select 1 from public.feedback as parent where parent.id = feedback_label.feedback_id) and exists (select 1 from public.label as parent where parent.id = feedback_label.label_id));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."feedback_translation" FOR ALL TO PUBLIC USING (exists (select 1 from public.feedback as parent where parent.id = "feedback_translation".feedback_id)) WITH CHECK (exists (select 1 from public.feedback as parent where parent.id = "feedback_translation".feedback_id));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."feedback_watcher" FOR ALL TO PUBLIC USING (exists (select 1 from public.feedback as parent where parent.id = "feedback_watcher".feedback_id)) WITH CHECK (exists (select 1 from public.feedback as parent where parent.id = "feedback_watcher".feedback_id));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."issue_integration" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."issue_link" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."label" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."notification" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."notification_preference" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."org_setting" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."page" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."project" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."review_link" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."review_round" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."saved_view" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."webhook_delivery" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."webhook_endpoint" FOR ALL TO PUBLIC USING (org_id = nullif(current_setting('pinwren.org_id', true), '')) WITH CHECK (org_id = nullif(current_setting('pinwren.org_id', true), ''));
