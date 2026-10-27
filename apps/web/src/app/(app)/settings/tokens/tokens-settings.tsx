"use client";

import { API_TOKEN_SCOPES } from "@pinwren/core";
import { KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useTimeAgo } from "@/components/feedback-meta";
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
import type { Key } from "@/lib/i18n/en";
import { useT } from "@/lib/i18n/provider";
import {
  errorMessage,
  useCreateTokenMutation,
  useRevokeTokenMutation,
  useTokensQuery,
} from "@/lib/store/api";

const SCOPE_INFO: Record<(typeof API_TOKEN_SCOPES)[number], Key> = {
  "feedback:read": "settings1.scopeFeedbackRead",
  "feedback:write": "settings1.scopeFeedbackWrite",
  "comments:write": "settings1.scopeCommentsWrite",
};
const EXPIRY: { value: "30" | "90" | "365" | "never"; label: Key }[] = [
  { value: "30", label: "settings1.expiry30" },
  { value: "90", label: "settings1.expiry90" },
  { value: "365", label: "settings1.expiry365" },
  { value: "never", label: "settings1.expiryNever" },
];

const dateOnly = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

/** Personal API tokens for `/api/v1` (F-081). Secrets are shown once. */
export function TokensSettings() {
  const tr = useT();
  const timeAgo = useTimeAgo();
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);
  const tokens = useTokensQuery(undefined);
  const [revokeToken, revoke] = useRevokeTokenMutation();
  const revokeNow = (t: ApiToken) => {
    revokeToken(t.id)
      .unwrap()
      .then(() => {
        toast.success(tr("settings1.tokenRevoked", { name: t.name }));
        setRevoking(null);
      })
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tr("settings1.apiTokens")}</CardTitle>
        <CardDescription>
          {tr("settings1.apiTokensDescriptionBefore")}
          <code className="font-mono">/api/v1</code>
          {tr("settings1.apiTokensDescriptionMiddle")}
          <code className="font-mono">Authorization: Bearer pwt_…</code>
          {tr("settings1.apiTokensDescriptionAfter")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex justify-end">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> {tr("settings1.createToken")}
          </Button>
        </div>
        {tokens.isLoading && <Skeleton className="h-24" />}
        {tokens.isError && <ErrorState error={tokens.error} retry={() => void tokens.refetch()} />}
        {tokens.data?.tokens.length === 0 && (
          <EmptyState
            icon={KeyRound}
            title={tr("settings1.noTokensYet")}
            description={tr("settings1.noTokensYetDescription")}
          />
        )}
        {tokens.data && tokens.data.tokens.length > 0 && (
          <ul className="divide-y rounded-lg border" aria-label={tr("settings1.apiTokens")}>
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
                      {expired && <Badge variant="destructive">{tr("settings1.expired")}</Badge>}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <code className="font-mono">{t.prefix}…</code>
                      <span>· {tr("settings1.created", { time: timeAgo(t.createdAt) })}</span>
                      <span>
                        ·{" "}
                        {t.lastUsedAt
                          ? tr("settings1.used", { time: timeAgo(t.lastUsedAt) })
                          : tr("settings1.neverUsed")}
                      </span>
                      <span>
                        ·{" "}
                        {t.expiresAt
                          ? tr(expired ? "settings1.expiredOn" : "settings1.expiresOn", {
                              date: dateOnly(t.expiresAt),
                            })
                          : tr("settings1.noExpiry")}
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
                    {tr("settings1.revoke")}
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
        title={tr("settings1.yourNewApiToken")}
        description={tr("settings1.yourNewApiTokenDescription")}
        onClose={() => setSecret(null)}
      />
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={tr("settings1.revokeTitle", { name: revoking?.name ?? "" })}
        description={tr("settings1.revokeDescription")}
        confirmLabel={tr("settings1.revokeToken")}
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
  const t = useT();
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
        <DialogTitle>{t("settings1.createAnApiToken")}</DialogTitle>
        <DialogDescription>{t("settings1.createAnApiTokenDescription")}</DialogDescription>
      </DialogHeader>
      <Field id="token-name" label={t("settings1.name")} error={errors.name?.message}>
        <Input
          {...controlProps("token-name", errors.name?.message)}
          {...form.register("name")}
          maxLength={80}
          placeholder={t("settings1.tokenNamePlaceholder")}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog's first field; focus moves into a dialog on open
          autoFocus
        />
      </Field>
      <Controller
        control={form.control}
        name="scopes"
        render={({ field }) => (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{t("settings1.scopes")}</legend>
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
                  <span className="block text-xs text-muted-foreground">{t(SCOPE_INFO[sc])}</span>
                </label>
              </div>
            ))}
          </fieldset>
        )}
      />
      <div className="grid gap-2">
        <Label>{t("settings1.expires")}</Label>
        <Controller
          control={form.control}
          name="expiry"
          render={({ field }) => (
            <Select
              items={EXPIRY.map((x) => ({ value: x.value, label: t(x.label) }))}
              value={field.value}
              onValueChange={(v) => v && field.onChange(v)}
            >
              <SelectTrigger className="w-40" aria-label={t("settings1.expires")}>
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
          )}
        />
      </div>
      <FormError message={errors.scopes?.message ?? errors.root?.message} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("settings1.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("settings1.creating") : t("settings1.createToken")}
        </Button>
      </DialogFooter>
    </form>
  );
}
