"use client";

import { useState } from "react";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProjectDetail } from "@/lib/api";
import { inviteForm } from "@/lib/form-schemas";
import { useT } from "@/lib/i18n/provider";
import { installSnippets } from "@/lib/install";
import { errorMessage, useBillingQuery, useInviteMemberMutation, useMeQuery } from "@/lib/store/api";
import { useWorkspacesQuery } from "@/lib/store/api/people";
import { OnboardingForm } from "./onboarding-form";

const STEPS = 3;

/**
 * Cloud first run, after the confirmation link: the personal workspace already exists, so the steps are
 * name it and create the first project, copy the widget snippet, then invite teammates (within the plan's
 * seats). Each step after the first can be skipped; the project page is where it ends.
 */
export function CloudOnboarding() {
  const t = useT();
  const me = useMeQuery(undefined);
  const workspaces = useWorkspacesQuery(undefined);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const current = workspaces.data?.find((w) => w.id === me.data?.orgId);
  if (!current) return <Skeleton className="h-96 rounded-xl" />;

  const finish = () => {
    if (!project) return;
    window.location.assign(new URL(`/projects/${project.id}`, window.location.href).href);
  };
  return (
    <div className="grid gap-3">
      <p className="text-center text-sm text-muted-foreground" data-testid="onboarding-step">
        {t("cloud.stepOf", { current: step, total: STEPS })}
      </p>
      {step === 1 && (
        <OnboardingForm
          workspace={current}
          onCreated={(created) => {
            setProject(created);
            setStep(2);
          }}
        />
      )}
      {step === 2 && project && <InstallStep project={project} onNext={() => setStep(3)} />}
      {step === 3 && <InviteStep onDone={finish} />}
    </div>
  );
}

function InstallStep({ project, onNext }: { project: ProjectDetail; onNext: () => void }) {
  const t = useT();
  const snippet = installSnippets(project.publicUrl, project.publicKey).html;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("cloud.installTitle")}</CardTitle>
        <CardDescription>{t("cloud.installDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="relative">
          <pre
            className="overflow-x-auto rounded-lg border bg-muted/50 p-3 pr-12 font-mono text-xs leading-relaxed"
            data-testid="onboarding-snippet"
          >
            {snippet}
          </pre>
          <CopyButton value={snippet} label={t("cloud.copySnippet")} className="absolute top-2 right-2" />
        </div>
        <Button onClick={onNext}>{t("cloud.continue")}</Button>
      </CardContent>
    </Card>
  );
}

export function InviteStep({ onDone }: { onDone: () => void }) {
  const t = useT();
  const billing = useBillingQuery(undefined);
  const [invite] = useInviteMemberMutation();
  const [sent, setSent] = useState<string[]>([]);
  const form = useZodForm(inviteForm, { defaultValues: { email: "", role: "member" } });
  const { errors, isSubmitting } = form.formState;
  const seats = billing.data?.usage.seats;
  const full = !!seats && seats.limit !== null && seats.used >= seats.limit;

  const submit = form.handleSubmit(async ({ email }) => {
    try {
      await invite({ email, role: "member" }).unwrap();
      setSent((s) => [...s, email]);
      form.reset({ email: "", role: "member" });
      void billing.refetch();
    } catch (e) {
      form.setError("root", { message: errorMessage(e, t("cloud.inviteFailed")) });
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("cloud.inviteTitle")}</CardTitle>
        <CardDescription>{t("cloud.inviteDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {billing.data && seats && (
          <p className="text-sm text-muted-foreground" data-testid="onboarding-seats">
            {seats.limit === null
              ? t("cloud.seatsUnlimited", { used: seats.used, plan: billing.data.planName })
              : t("cloud.seatsLimited", {
                  used: seats.used,
                  limit: seats.limit,
                  plan: billing.data.planName,
                })}
          </p>
        )}
        {full ? (
          <p className="rounded-lg bg-muted p-3 text-sm text-pretty" data-testid="onboarding-seats-full">
            {t("cloud.seatsFull")}
          </p>
        ) : (
          <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
            <Field id="invite-email" label={t("cloud.inviteEmail")} error={errors.email?.message}>
              <Input
                {...controlProps("invite-email", errors.email?.message)}
                {...form.register("email")}
                type="email"
                autoComplete="off"
              />
            </Field>
            <FormError message={errors.root?.message} />
            <Button type="submit" variant="outline" disabled={isSubmitting}>
              {t("cloud.inviteSend")}
            </Button>
          </form>
        )}
        {sent.map((email) => (
          <p key={email} className="text-sm" role="status">
            {t("cloud.inviteSent", { email })}
          </p>
        ))}
        <Button onClick={onDone}>{sent.length ? t("cloud.finish") : t("cloud.skip")}</Button>
      </CardContent>
    </Card>
  );
}
