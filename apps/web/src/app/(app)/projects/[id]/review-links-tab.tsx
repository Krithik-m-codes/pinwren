"use client";

import { ExternalLink, Info, Link2 } from "lucide-react";
import { useState } from "react";
import { useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ButtonLink } from "@/components/button-link";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { LocalDate, RelativeTime } from "@/components/feedback-meta";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import { ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProjectDetail } from "@/lib/api";
import { en, type Key } from "@/lib/i18n/en";
import { useI18n, useT } from "@/lib/i18n/provider";
import { errorMessage } from "@/lib/store/api";
import {
  type ReviewLink,
  useCreateReviewLinkMutation,
  useReviewLinksQuery,
  useRevokeReviewLinkMutation,
} from "@/lib/store/api/onboarding";

// Project settings › Review links (F-012, wave-5 contract §3.5): a page address with a token that shows the
// widget to whoever opens it, whatever the visibility mode, for clients and reviewers. What guests send
// through a link carries its name as the source, and the inbox filters by it. Admins only (the API refuses
// others, and the tab is hidden from them).

const EXPIRY = [
  { value: "7", label: "projects2.days7" },
  { value: "30", label: "projects2.days30" },
  { value: "90", label: "projects2.days90" },
  { value: "never", label: "projects2.neverRevokeInstead" },
] as const satisfies readonly { value: string; label: Key }[];

const reviewLinkForm = z.object({
  label: z.string().trim().min(1, "projects2.giveLinkName").max(80),
  url: z.url({ protocol: /^https?$/, error: "projects2.enterFullPageAddress" }).max(2000),
  expiry: z.enum(["7", "30", "90", "never"]),
});

export function linkState(l: Pick<ReviewLink, "revokedAt" | "expiresAt">, now = Date.now()) {
  if (l.revokedAt) return { label: "projects2.revoked", active: false } as const;
  if (l.expiresAt && Date.parse(l.expiresAt) <= now)
    return { label: "projects2.expired", active: false } as const;
  return { label: "projects2.active", active: true } as const;
}

export function ReviewLinksTab({ project }: { project: ProjectDetail }) {
  const { t, tn } = useI18n();
  const links = useReviewLinksQuery(project.id);
  const [revoke, revoking] = useRevokeReviewLinkMutation();
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<ReviewLink | null>(null);
  const [made, setMade] = useState<{ label: string; url: string } | null>(null);

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {t("projects2.reviewLinks")}
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => setCreating(true)}
              data-testid="new-review-link"
            >
              <Link2 /> {t("projects2.newLink")}
            </Button>
          </CardTitle>
          <CardDescription>{t("projects2.reviewLinksDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {made && (
            <div
              className="grid gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3"
              data-testid="review-link-made"
            >
              <p className="text-sm font-medium">{t("projects2.linkReady", { label: made.label })}</p>
              <div className="relative">
                <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 pr-12 font-mono text-xs leading-relaxed">
                  {made.url}
                </pre>
                <CopyButton
                  value={made.url}
                  label={t("projects2.copyReviewLink")}
                  className="absolute top-2 right-2"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <ButtonLink href={made.url} external size="sm" variant="outline">
                  <ExternalLink /> {t("projects2.openIt")}
                </ButtonLink>
                <Button size="sm" variant="ghost" onClick={() => setMade(null)}>
                  {t("projects2.done")}
                </Button>
              </div>
            </div>
          )}
          {links.isLoading && <Skeleton className="h-16 w-full" />}
          {links.isError && <ErrorState error={links.error} retry={() => void links.refetch()} />}
          {links.data?.links.length === 0 && (
            <div className="grid justify-items-start gap-2 rounded-lg border border-dashed p-4 text-sm">
              <p className="font-medium">{t("projects2.noReviewLinksYet")}</p>
              <p className="text-muted-foreground">{t("projects2.noReviewLinksDescription")}</p>
            </div>
          )}
          {!!links.data?.links.length && (
            <ul className="divide-y rounded-lg border" data-testid="review-links">
              {links.data.links.map((l) => {
                const state = linkState(l);
                return (
                  <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <div className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate font-medium">{l.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {l.lastUsedAt ? (
                          <>
                            {t("projects2.used")} <RelativeTime iso={l.lastUsedAt} />
                          </>
                        ) : (
                          t("projects2.notUsedYet")
                        )}
                        {state.active && l.expiresAt && (
                          <>
                            {" · "}
                            {t("projects2.stopsWorking")} <LocalDate iso={l.expiresAt} />
                          </>
                        )}
                      </span>
                    </div>
                    {l.feedbackCount > 0 ? (
                      <ButtonLink
                        href={`/inbox?project=${project.id}&review=${l.id}&status=all`}
                        size="sm"
                        variant="ghost"
                        className="tabular-nums"
                      >
                        {tn("projects2.itemCount", l.feedbackCount)}
                      </ButtonLink>
                    ) : (
                      <span className="px-2 text-xs text-muted-foreground">{t("projects2.noItems")}</span>
                    )}
                    <Badge variant={state.active ? "secondary" : "outline"} className="font-normal">
                      {t(state.label)}
                    </Badge>
                    {state.active && (
                      <Button size="sm" variant="ghost" onClick={() => setConfirm(l)}>
                        {t("projects2.revoke")}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {!project.publicRead && (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              {t("projects2.pinsPrivateNote")}
            </p>
          )}
        </CardContent>
      </Card>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          {creating && (
            <ReviewLinkForm
              project={project}
              onCancel={() => setCreating(false)}
              onCreated={(m) => {
                setCreating(false);
                setMade(m);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t("projects2.revokeLinkQuestion", { label: confirm?.label ?? "" })}
        description={t("projects2.revokeDescription")}
        confirmLabel={t("projects2.revoke")}
        pending={revoking.isLoading}
        onConfirm={() => {
          if (!confirm) return;
          revoke({ id: confirm.id, projectId: project.id })
            .unwrap()
            .then(() => {
              toast.success(t("projects2.linkRevoked"));
              setConfirm(null);
            })
            .catch((e: unknown) => toast.error(t("projects2.notRevoked"), { description: errorMessage(e) }));
        }}
      />
    </div>
  );
}

function ReviewLinkForm({
  project,
  onCancel,
  onCreated,
}: {
  project: ProjectDetail;
  onCancel: () => void;
  onCreated: (made: { label: string; url: string }) => void;
}) {
  const t = useT();
  const [create] = useCreateReviewLinkMutation();
  // The schema carries catalogue keys for its own messages; anything else (zod defaults) shows as is.
  const msg = (m?: string) => (m && m in en ? t(m as Key) : m);
  const site = project.allowedOrigins[0];
  const form = useZodForm(reviewLinkForm, {
    defaultValues: {
      label: "",
      url: site && !site.startsWith("*.") ? `https://${site}/` : "",
      expiry: "30",
    },
  });
  const { errors, isSubmitting } = form.formState;
  const expiry = useWatch({ control: form.control, name: "expiry" });
  const submit = form.handleSubmit(async ({ label, url, expiry }) => {
    try {
      const res = await create({
        projectId: project.id,
        label,
        url,
        ...(expiry === "never" ? {} : { expiresInDays: Number(expiry) }),
      }).unwrap();
      onCreated({ label, url: res.url });
    } catch (e) {
      form.setError("root", { message: errorMessage(e) });
    }
  });
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t("projects2.newReviewLink")}</DialogTitle>
        <DialogDescription>{t("projects2.newReviewLinkDescription")}</DialogDescription>
      </DialogHeader>
      <Field id="rl-label" label={t("projects2.name")} error={msg(errors.label?.message)}>
        <Input
          {...controlProps("rl-label", msg(errors.label?.message))}
          {...form.register("label")}
          placeholder={t("projects2.acmeSignOffRound")}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog's first field; focus moves into a dialog on open
          autoFocus
        />
      </Field>
      <Field id="rl-url" label={t("projects2.page")} error={msg(errors.url?.message)}>
        <Input
          {...controlProps("rl-url", msg(errors.url?.message))}
          {...form.register("url")}
          placeholder="https://staging.example.com/"
        />
      </Field>
      <Field id="rl-expiry" label={t("projects2.stopsWorkingAfter")}>
        <Select
          items={EXPIRY.map((x) => ({ value: x.value, label: t(x.label) }))}
          value={expiry}
          onValueChange={(v) => v && form.setValue("expiry", v)}
        >
          <SelectTrigger id="rl-expiry" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXPIRY.map((x) => (
              <SelectItem key={x.value} value={x.value}>
                {t(x.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <FormError message={errors.root?.message} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("projects2.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("projects2.creating") : t("projects2.createLink")}
        </Button>
      </DialogFooter>
    </form>
  );
}
