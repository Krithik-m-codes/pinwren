"use client";

import { API_TOKEN_SCOPES } from "@pinwren/core";
import { KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { timeAgo } from "@/components/feedback-meta";
import { SecretDialog } from "@/components/secret-dialog";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Controller } from "react-hook-form";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import type { ApiToken } from "@/lib/api";
import { createTokenForm } from "@/lib/form-schemas";
import {
  errorMessage,
  useCreateTokenMutation,
  useRevokeTokenMutation,
  useTokensQuery,
} from "@/lib/store/api";

const SCOPE_INFO: Record<(typeof API_TOKEN_SCOPES)[number], string> = {
  "feedback:read": "List and read feedback",
  "feedback:write": "Change status, priority, assignee and title",
  "comments:write": "Post comments as you",
};
const EXPIRY: { value: "30" | "90" | "365" | "never"; label: string }[] = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "Never" },
];

const dateOnly = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

/** Personal API tokens for `/api/v1` (F-081). Secrets are shown once. */
export function TokensSettings() {
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);
  const tokens = useTokensQuery(undefined);
  const [revokeToken, revoke] = useRevokeTokenMutation();
  const revokeNow = (t: ApiToken) => {
    revokeToken(t.id)
      .unwrap()
      .then(() => {
        toast.success(`Token “${t.name}” revoked`);
        setRevoking(null);
      })
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>API tokens</CardTitle>
        <CardDescription>
          For scripts and integrations calling <code className="font-mono">/api/v1</code> with{" "}
          <code className="font-mono">Authorization: Bearer pwt_…</code>. A token acts as you.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex justify-end">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> Create token
          </Button>
        </div>
        {tokens.isLoading && <Skeleton className="h-24" />}
        {tokens.isError && <ErrorState error={tokens.error} retry={() => void tokens.refetch()} />}
        {tokens.data?.tokens.length === 0 && (
          <EmptyState
            icon={KeyRound}
            title="No tokens yet"
            description="Create one for each script or service, so you can revoke them one at a time."
          />
        )}
        {tokens.data && tokens.data.tokens.length > 0 && (
          <ul className="divide-y rounded-lg border" aria-label="API tokens">
            {tokens.data.tokens.map((t) => {
              const expired = !!t.expiresAt && new Date(t.expiresAt) < new Date();
              return (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5"
                  data-token={t.name}
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{t.name}</span>
                      {expired && <Badge variant="destructive">Expired</Badge>}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <code className="font-mono">{t.prefix}…</code>
                      <span>· created {timeAgo(t.createdAt)}</span>
                      <span>· {t.lastUsedAt ? `used ${timeAgo(t.lastUsedAt)}` : "never used"}</span>
                      <span>
                        ·{" "}
                        {t.expiresAt
                          ? `${expired ? "expired" : "expires"} ${dateOnly(t.expiresAt)}`
                          : "no expiry"}
                      </span>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {t.scopes.map((s) => (
                      <Badge key={s} variant="secondary" className="font-mono font-normal">
                        {s}
                      </Badge>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setRevoking(t)}>
                    Revoke
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      <CreateTokenDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(s) => {
          setCreating(false);
          setSecret(s);
        }}
      />
      <SecretDialog
        secret={secret}
        title="Your new API token"
        description="Send it as a Bearer token. Revoke it here if it ever leaks."
        onClose={() => setSecret(null)}
      />
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={`Revoke “${revoking?.name ?? ""}”?`}
        description="Anything using it stops working immediately."
        confirmLabel="Revoke token"
        pending={revoke.isLoading}
        onConfirm={() => revoking && revokeNow(revoking)}
      />
    </Card>
  );
}

function CreateTokenDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (secret: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && <CreateTokenForm onCreated={onCreated} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function CreateTokenForm({
  onCreated,
  onCancel,
}: {
  onCreated: (secret: string) => void;
  onCancel: () => void;
}) {
  const [create] = useCreateTokenMutation();
  const form = useZodForm(createTokenForm, {
    defaultValues: { name: "", scopes: ["feedback:read"], expiry: "90" },
  });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async ({ name, scopes, expiry }) => {
    try {
      const { secret } = await create({
        name,
        scopes,
        ...(expiry !== "never" ? { expiresInDays: Number(expiry) } : {}),
      }).unwrap();
      onCreated(secret);
    } catch (e) {
      form.setError("root", { message: errorMessage(e) });
    }
  });
  return (
    <form className="grid gap-4" noValidate onSubmit={(e) => void submit(e)}>
      <DialogHeader>
        <DialogTitle>Create an API token</DialogTitle>
        <DialogDescription>Give it only the scopes it needs.</DialogDescription>
      </DialogHeader>
      <Field id="token-name" label="Name" error={errors.name?.message}>
        <Input
          {...controlProps("token-name", errors.name?.message)}
          {...form.register("name")}
          maxLength={80}
          placeholder="CI triage bot"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog's first field; focus moves into a dialog on open
          autoFocus
        />
      </Field>
      <Controller
        control={form.control}
        name="scopes"
        render={({ field }) => (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Scopes</legend>
            {API_TOKEN_SCOPES.map((sc) => (
              <div key={sc} className="flex items-start gap-2.5 text-sm">
                <Checkbox
                  id={`scope-${sc}`}
                  className="mt-0.5"
                  checked={field.value.includes(sc)}
                  onCheckedChange={(on) =>
                    field.onChange(on ? [...field.value, sc] : field.value.filter((x) => x !== sc))
                  }
                />
                <label htmlFor={`scope-${sc}`}>
                  <code className="font-mono text-xs">{sc}</code>
                  <span className="block text-xs text-muted-foreground">{SCOPE_INFO[sc]}</span>
                </label>
              </div>
            ))}
          </fieldset>
        )}
      />
      <div className="grid gap-2">
        <Label>Expires</Label>
        <Controller
          control={form.control}
          name="expiry"
          render={({ field }) => (
            <Select items={EXPIRY} value={field.value} onValueChange={(v) => v && field.onChange(v)}>
              <SelectTrigger className="w-40" aria-label="Expires">
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
          )}
        />
      </div>
      <FormError message={errors.scopes?.message ?? errors.root?.message} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating…" : "Create token"}
        </Button>
      </DialogFooter>
    </form>
  );
}
