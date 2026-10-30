CREATE INDEX "activity_org_actor_idx" ON "activity" USING btree ("org_id","actor_id") WHERE "activity"."actor_id" is not null;--> statement-breakpoint
CREATE INDEX "comment_org_author_idx" ON "comment" USING btree ("org_id","author_id") WHERE "comment"."author_id" is not null;--> statement-breakpoint
CREATE INDEX "feedback_org_reporter_idx" ON "feedback" USING btree ("org_id","reporter_id") WHERE "feedback"."reporter_id" is not null;--> statement-breakpoint
CREATE INDEX "invitation_org_status_created_idx" ON "invitation" USING btree ("organization_id","status","created_at");
--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."user" FOR ALL TO PUBLIC USING (((EXISTS ( SELECT 1 FROM member participant WHERE (participant.user_id = "user".id))) OR (EXISTS ( SELECT 1 FROM feedback participant WHERE (participant.reporter_id = "user".id))) OR (EXISTS ( SELECT 1 FROM comment participant WHERE (participant.author_id = "user".id))) OR (EXISTS ( SELECT 1 FROM activity participant WHERE (participant.actor_id = "user".id))) OR (EXISTS ( SELECT 1 FROM feedback_watcher participant WHERE (participant.user_id = "user".id))))) WITH CHECK (((EXISTS ( SELECT 1 FROM member participant WHERE (participant.user_id = "user".id))) OR (EXISTS ( SELECT 1 FROM feedback participant WHERE (participant.reporter_id = "user".id))) OR (EXISTS ( SELECT 1 FROM comment participant WHERE (participant.author_id = "user".id))) OR (EXISTS ( SELECT 1 FROM activity participant WHERE (participant.actor_id = "user".id))) OR (EXISTS ( SELECT 1 FROM feedback_watcher participant WHERE (participant.user_id = "user".id)))));

--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."organization" FOR ALL TO PUBLIC USING ((id = NULLIF(current_setting('pinwren.org_id'::text, true), ''::text))) WITH CHECK ((id = NULLIF(current_setting('pinwren.org_id'::text, true), ''::text)));

--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."member" FOR ALL TO PUBLIC USING ((organization_id = NULLIF(current_setting('pinwren.org_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('pinwren.org_id'::text, true), ''::text)));

--> statement-breakpoint
CREATE POLICY pinwren_tenant ON public."invitation" FOR ALL TO PUBLIC USING ((organization_id = NULLIF(current_setting('pinwren.org_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('pinwren.org_id'::text, true), ''::text)));
