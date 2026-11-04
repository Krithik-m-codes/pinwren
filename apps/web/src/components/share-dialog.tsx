"use client";

import { ExternalLink, Link2, Lock } from "lucide-react";
import { useState } from "react";
import { useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ButtonLink } from "@/components/button-link";
import { CopyButton } from "@/components/copy-button";
import { RelativeTime } from "@/components/feedback-meta";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import { ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Switch } from "@/components/ui/switch";
import { en, type Key } from "@/lib/i18n/en";
import { useI18n } from "@/lib/i18n/provider";
import { errorMessage } from "@/lib/store/api";
import {
  type ShareTarget,
  useCreateShareLinkMutation,
  useRevokeShareLinkMutation,
  useShareLinksQuery,
} from "@/lib/store/api/share";
import { useViewer } from "@/lib/viewer";

// "Share": an expiring, revocable, login-free read-only link to one report, or to a review round where a client
// can approve or ask for changes. The URL is shown once, at creation (only a hash of its token is stored).

const EXPIRY = [
  { value: "1", label: "share.days1" },
  { value: "7", label: "share.days7" },
  { value: "30", label: "share.days30" },
  { value: "90", label: "share.days90" },
] as const satisfies readonly { value: string; label: Key }[];

const STATUS = {
  active: "share.statusActive",
  expired: "share.statusExpired",
  revoked: "share.statusRevoked",
} as const satisfies Record<string, Key>;

const shareForm = z.object({
  label: z.string().trim().max(120),
  expiry: z.enum(["1", "7", "30", "90"]),
  allowComments: z.boolean(),
  password: z
    .string()
    .max(128)
    .refine((v) => v === "" || v.length >= 4, "share.passwordShort"),
});

export function ShareDialog({
  target,
  title,
  open,
  onOpenChange,
}: {
  target: ShareTarget;
  /** What is being shared, for the heading: "#42 Checkout broken" or the round's name. */
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const { canWrite } = useViewer();
  const links = useShareLinksQuery(target, { skip: !open });
  const [revoke, revoking] = useRevokeShareLinkMutation();
  const [made, setMade] = useState<string | null>(null);
  const round = target.kind === "round";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setMade(null);
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg" data-testid="share-dialog">
        <DialogHeader>
          <DialogTitle>{t("share.title", { name: title })}</DialogTitle>
          <DialogDescription>
            {t(round ? "share.descriptionRound" : "share.descriptionReport")}
          </DialogDescription>
        </DialogHeader>
        {made && (
          <div
            className="grid gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3"
            data-testid="share-made"
          >
            <p className="text-sm font-medium">{t("share.ready")}</p>
            <div className="relative">
              <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 pr-12 font-mono text-xs leading-relaxed">
                {made}
              </pre>
              <CopyButton value={made} label={t("share.copy")} className="absolute top-2 right-2" />
            </div>
            <p className="text-xs text-muted-foreground">{t("share.shownOnce")}</p>
            <div>
              <ButtonLink href={made} external size="sm" variant="outline">
                <ExternalLink /> {t("share.open")}
              </ButtonLink>
            </div>
          </div>
        )}
        {canWrite && <ShareForm key={made ?? "form"} target={target} onCreated={setMade} />}
        <section aria-label={t("share.existing")} className="grid gap-2">
          <h3 className="text-sm font-medium">{t("share.existing")}</h3>
          {links.isLoading && <Skeleton className="h-12 w-full" />}
          {links.isError && <ErrorState error={links.error} retry={() => void links.refetch()} />}
          {links.data?.links.length === 0 && (
            <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              {t("share.none")}
            </p>
          )}
          {!!links.data?.links.length && (
            <ul className="divide-y rounded-lg border" data-testid="share-links">
              {links.data.links.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <span className="flex items-center gap-1.5 truncate font-medium">
                      {l.label || t(l.kind === "round" ? "share.unnamedRound" : "share.unnamed")}
                      {l.hasPassword && (
                        <Lock
                          className="size-3 text-muted-foreground"
                          aria-label={t("share.passwordProtected")}
                        />
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t("share.views", { n: l.viewCount })}
                      {l.lastViewedAt && (
                        <>
                          {" · "}
                          {t("share.lastViewed")} <RelativeTime iso={l.lastViewedAt} />
                        </>
                      )}
                      {l.status === "active" && (
                        <>
                          {" · "}
                          {t("share.expires")} <RelativeTime iso={l.expiresAt} />
                        </>
                      )}
                      {l.allowComments && ` · ${t("share.commentsOn")}`}
                    </span>
                  </div>
                  <Badge variant={l.status === "active" ? "secondary" : "outline"} className="font-normal">
                    {t(STATUS[l.status])}
                  </Badge>
                  {l.status === "active" && canWrite && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={revoking.isLoading}
                      onClick={() =>
                        void revoke({ id: l.id, target })
                          .unwrap()
                          .then(() => toast.success(t("share.revoked")))
                          .catch((e: unknown) => toast.error(errorMessage(e)))
                      }
                    >
                      {t("share.revoke")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("share.done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShareForm({ target, onCreated }: { target: ShareTarget; onCreated: (url: string) => void }) {
  const { t } = useI18n();
  const [create] = useCreateShareLinkMutation();
  // The schema carries catalogue keys for its own messages; anything else (zod defaults) shows as is.
  const msg = (m?: string) => (m && m in en ? t(m as Key) : m);
  const form = useZodForm(shareForm, {
    defaultValues: { label: "", expiry: "7", allowComments: false, password: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const expiry = useWatch({ control: form.control, name: "expiry" });
  const allowComments = useWatch({ control: form.control, name: "allowComments" });
  const round = target.kind === "round";
  const submit = form.handleSubmit(async (v) => {
    try {
      const res = await create({
        ...(round ? { roundId: target.id } : { feedbackId: target.id }),
        label: v.label,
        expiresInDays: Number(v.expiry),
        allowComments: !round && v.allowComments,
        ...(v.password ? { password: v.password } : {}),
      }).unwrap();
      onCreated(res.url);
    } catch (e) {
      form.setError("root", { message: errorMessage(e) });
    }
  });
  return (
    <form noValidate className="grid gap-3" onSubmit={(e) => void submit(e)}>
      <Field id="share-label" label={t("share.labelOptional")} error={msg(errors.label?.message)}>
        <Input
          {...controlProps("share-label", msg(errors.label?.message))}
          {...form.register("label")}
          maxLength={120}
          placeholder={t("share.labelPlaceholder")}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="share-expiry" label={t("share.expiresAfter")}>
          <Select
            items={EXPIRY.map((x) => ({ value: x.value, label: t(x.label) }))}
            value={expiry}
            onValueChange={(v) => v && form.setValue("expiry", v)}
          >
            <SelectTrigger id="share-expiry" className="w-full">
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
        <Field id="share-password" label={t("share.passwordOptional")} error={msg(errors.password?.message)}>
          <Input
            {...controlProps("share-password", msg(errors.password?.message))}
            {...form.register("password")}
            type="password"
            autoComplete="new-password"
            maxLength={128}
          />
        </Field>
      </div>
      {!round && (
        <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
          <div className="grid gap-0.5">
            <span id="share-comments-label" className="text-sm font-medium">
              {t("share.allowComments")}
            </span>
            <span className="text-xs text-muted-foreground">{t("share.allowCommentsHelp")}</span>
          </div>
          <Switch
            aria-labelledby="share-comments-label"
            checked={allowComments}
            onCheckedChange={(v) => form.setValue("allowComments", v)}
          />
        </div>
      )}
      <FormError message={errors.root?.message} />
      <div>
        <Button type="submit" disabled={isSubmitting} data-testid="share-create">
          <Link2 /> {isSubmitting ? t("share.creating") : t("share.create")}
        </Button>
      </div>
    </form>
  );
}
