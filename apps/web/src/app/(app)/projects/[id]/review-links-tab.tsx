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
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "never", label: "Never (revoke it instead)" },
] as const;

const reviewLinkForm = z.object({
  label: z.string().trim().min(1, "Give the link a name").max(80),
  url: z
    .url({ protocol: /^https?$/, error: "Enter the full page address, starting with https://" })
    .max(2000),
  expiry: z.enum(["7", "30", "90", "never"]),
});

export function linkState(l: Pick<ReviewLink, "revokedAt" | "expiresAt">, now = Date.now()) {
  if (l.revokedAt) return { label: "Revoked", active: false } as const;
  if (l.expiresAt && Date.parse(l.expiresAt) <= now) return { label: "Expired", active: false } as const;
  return { label: "Active", active: true } as const;
}

export function ReviewLinksTab({ project }: { project: ProjectDetail }) {
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
            Review links
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => setCreating(true)}
              data-testid="new-review-link"
            >
              <Link2 /> New link
            </Button>
          </CardTitle>
          <CardDescription>
            Send a client or reviewer a link that shows the widget on your site, even where it is hidden for
            everyone else. They give their name when they send feedback, and each item is marked with the link
            it came through.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {made && (
            <div
              className="grid gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3"
              data-testid="review-link-made"
            >
              <p className="text-sm font-medium">
                “{made.label}” is ready. Copy the link now: it won&apos;t be shown again.
              </p>
              <div className="relative">
                <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 pr-12 font-mono text-xs leading-relaxed">
                  {made.url}
                </pre>
                <CopyButton value={made.url} label="Copy review link" className="absolute top-2 right-2" />
              </div>
              <div className="flex flex-wrap gap-2">
                <ButtonLink href={made.url} external size="sm" variant="outline">
                  <ExternalLink /> Open it
                </ButtonLink>
                <Button size="sm" variant="ghost" onClick={() => setMade(null)}>
                  Done
                </Button>
              </div>
            </div>
          )}
          {links.isLoading && <Skeleton className="h-16 w-full" />}
          {links.isError && <ErrorState error={links.error} retry={() => void links.refetch()} />}
          {links.data?.links.length === 0 && (
            <div className="grid justify-items-start gap-2 rounded-lg border border-dashed p-4 text-sm">
              <p className="font-medium">No review links yet</p>
              <p className="text-muted-foreground">
                Make one for each client or review round, so you can see who sent what and switch a link off
                when the review is over.
              </p>
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
                            Used <RelativeTime iso={l.lastUsedAt} />
                          </>
                        ) : (
                          "Not used yet"
                        )}
                        {state.active && l.expiresAt && (
                          <>
                            {" · "}stops working <LocalDate iso={l.expiresAt} />
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
                        {l.feedbackCount} {l.feedbackCount === 1 ? "item" : "items"}
                      </ButtonLink>
                    ) : (
                      <span className="px-2 text-xs text-muted-foreground">No items</span>
                    )}
                    <Badge variant={state.active ? "secondary" : "outline"} className="font-normal">
                      {state.label}
                    </Badge>
                    {state.active && (
                      <Button size="sm" variant="ghost" onClick={() => setConfirm(l)}>
                        Revoke
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
              Pins are private on this project, so each guest sees only what they sent. Turn on “Show existing
              pins to visitors” on the Privacy &amp; data tab to let reviewers see each other&apos;s comments.
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
        title={`Revoke “${confirm?.label ?? ""}”?`}
        description="The link stops showing the widget at once. People who already have it can't use it any more; what they sent stays in the inbox."
        confirmLabel="Revoke"
        pending={revoking.isLoading}
        onConfirm={() => {
          if (!confirm) return;
          revoke({ id: confirm.id, projectId: project.id })
            .unwrap()
            .then(() => {
              toast.success("Link revoked");
              setConfirm(null);
            })
            .catch((e: unknown) => toast.error("Not revoked", { description: errorMessage(e) }));
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
  const [create] = useCreateReviewLinkMutation();
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
        <DialogTitle>New review link</DialogTitle>
        <DialogDescription>
          The name is shown on everything sent through the link. The page must be on one of the project&apos;s
          allowed sites.
        </DialogDescription>
      </DialogHeader>
      <Field id="rl-label" label="Name" error={errors.label?.message}>
        <Input
          {...controlProps("rl-label", errors.label?.message)}
          {...form.register("label")}
          placeholder="Acme sign-off round"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog's first field; focus moves into a dialog on open
          autoFocus
        />
      </Field>
      <Field id="rl-url" label="Page" error={errors.url?.message}>
        <Input
          {...controlProps("rl-url", errors.url?.message)}
          {...form.register("url")}
          placeholder="https://staging.example.com/"
        />
      </Field>
      <Field id="rl-expiry" label="Stops working after">
        <Select items={EXPIRY} value={expiry} onValueChange={(v) => v && form.setValue("expiry", v)}>
          <SelectTrigger id="rl-expiry" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXPIRY.map((x) => (
              <SelectItem key={x.value} value={x.value}>
                {x.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <FormError message={errors.root?.message} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating…" : "Create link"}
        </Button>
      </DialogFooter>
    </form>
  );
}
