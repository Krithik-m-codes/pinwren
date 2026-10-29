-- A join without its own org_id must preserve ownership even during privileged maintenance.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.feedback_label AS link
    JOIN public.feedback AS f ON f.id = link.feedback_id
    JOIN public.label AS l ON l.id = link.label_id
    WHERE f.org_id <> l.org_id
  ) THEN
    RAISE foreign_key_violation USING MESSAGE = 'Existing feedback_label rows cross organizations',
      CONSTRAINT = 'feedback_label_tenant_fk', TABLE = 'feedback_label';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.pinwren_check_feedback_label_tenant() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE valid boolean;
BEGIN
  IF TG_TABLE_NAME = 'feedback_label' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.feedback AS f JOIN public.label AS l ON l.org_id = f.org_id
      WHERE f.id = NEW.feedback_id AND l.id = NEW.label_id
    ) INTO valid;
  ELSIF TG_TABLE_NAME = 'feedback' THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM public.feedback_label AS link JOIN public.label AS l ON l.id = link.label_id
      WHERE link.feedback_id = NEW.id AND l.org_id <> NEW.org_id
    ) INTO valid;
  ELSIF TG_TABLE_NAME = 'label' THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM public.feedback_label AS link JOIN public.feedback AS f ON f.id = link.feedback_id
      WHERE link.label_id = NEW.id AND f.org_id <> NEW.org_id
    ) INTO valid;
  ELSE
    RAISE EXCEPTION 'Invalid tenant integrity trigger target';
  END IF;
  IF NOT valid THEN
    RAISE foreign_key_violation USING MESSAGE = 'feedback_label must link rows in the same organization',
      CONSTRAINT = 'feedback_label_tenant_fk', TABLE = 'feedback_label';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.pinwren_check_feedback_label_tenant() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER feedback_label_tenant_check BEFORE INSERT OR UPDATE ON public.feedback_label
FOR EACH ROW EXECUTE FUNCTION public.pinwren_check_feedback_label_tenant();
--> statement-breakpoint
CREATE TRIGGER feedback_label_feedback_tenant_check AFTER UPDATE OF org_id ON public.feedback
FOR EACH ROW EXECUTE FUNCTION public.pinwren_check_feedback_label_tenant();
--> statement-breakpoint
CREATE TRIGGER feedback_label_label_tenant_check AFTER UPDATE OF org_id ON public.label
FOR EACH ROW EXECUTE FUNCTION public.pinwren_check_feedback_label_tenant();
