"use client";

import { API_TOKEN_SCOPES } from "@pinwren/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { type ApiToken, type ApiTokenScope, api } from "@/lib/api";

const SCOPE_INFO: Record<ApiTokenScope, string> = {
  "feedback:read": "List and read feedback",
  "feedback:write": "Change status, priority, assignee and title",
  "comments:write": "Post comments as you",
};
const EXPIRY = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "Never" },
];
const tokensKey = ["tokens"] as const;

const dateOnly = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

/** Personal API tokens for `/api/v1` (F-081). Secrets are shown once. */
export function TokensSettings() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);
  const tokens = useQuery({ queryKey: tokensKey, queryFn: () => api<{ tokens: ApiToken[] }>("/tokens") });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(`Token “${revoking?.name ?? ""}” revoked`);
      setRevoking(null);
      void qc.invalidateQueries({ queryKey: tokensKey });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>API tokens</CardTitle>
        <CardDescription>
          For scripts and integrations calling <code className="font-mono">/api/v1</code> with{" "}
          <code className="font-mono">Authorization: Bearer ann_…</code>. A token acts as you.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex justify-end">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> Create token
          </Button>
        </div>
        {tokens.isPending && <Skeleton className="h-24" />}
        {tokens.isError && <ErrorState error={tokens.error} retry={() => tokens.refetch()} />}
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
          void qc.invalidateQueries({ queryKey: tokensKey });
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
        pending={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
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
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiTokenScope[]>(["feedback:read"]);
  const [expiry, setExpiry] = useState("90");
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api<{ token: ApiToken; secret: string }>("/tokens", {
        method: "POST",
        json: { name: name.trim(), scopes, ...(expiry !== "never" ? { expiresInDays: Number(expiry) } : {}) },
      }),
    onSuccess: ({ secret }) => {
      setName("");
      setScopes(["feedback:read"]);
      onCreated(secret);
    },
    onError: (e) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) {
              setError("Give the token a name");
              return;
            }
            if (!scopes.length) {
              setError("Pick at least one scope");
              return;
            }
            setError(null);
            create.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Create an API token</DialogTitle>
            <DialogDescription>Give it only the scopes it needs.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="token-name">Name</Label>
            <Input
              id="token-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder="CI triage bot"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog's first field; focus moves into a dialog on open
              autoFocus
            />
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Scopes</legend>
            {API_TOKEN_SCOPES.map((s) => (
              <div key={s} className="flex items-start gap-2.5 text-sm">
                <Checkbox
                  id={`scope-${s}`}
                  className="mt-0.5"
                  checked={scopes.includes(s)}
                  onCheckedChange={(on) => setScopes(on ? [...scopes, s] : scopes.filter((x) => x !== s))}
                />
                <label htmlFor={`scope-${s}`}>
                  <code className="font-mono text-xs">{s}</code>
                  <span className="block text-xs text-muted-foreground">{SCOPE_INFO[s]}</span>
                </label>
              </div>
            ))}
          </fieldset>
          <div className="grid gap-2">
            <Label>Expires</Label>
            <Select items={EXPIRY} value={expiry} onValueChange={(v) => v && setExpiry(v)}>
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
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create token"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
