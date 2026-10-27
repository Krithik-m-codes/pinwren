"use client";

import { Fingerprint, KeyRound, Link2, Pencil, Trash2 } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useTimeAgo } from "@/components/feedback-meta";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import { ProviderIcon } from "@/components/provider-icon";
import { EmptyState, ErrorState } from "@/components/states";
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
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";
import type { TFn } from "@/lib/i18n/english";
import { useT } from "@/lib/i18n/provider";
import { passkeyNameForm, PROVIDER_NAMES, providerName, signInErrorMessage } from "@/lib/sign-in-forms";
import { errorMessage } from "@/lib/store/api";
import { useAppDispatch } from "@/lib/store/hooks";
import {
  type OAuthProvider,
  type Passkey,
  passkeysChanged,
  useDeletePasskeyMutation,
  useLinkedAccountsQuery,
  usePasskeysQuery,
  useRenamePasskeyMutation,
  useSignInMethodsQuery,
  useUnlinkAccountMutation,
} from "@/lib/store/api/sign-in";
import { describeAgent } from "./account-security";

// Settings › Profile: the sign-in methods besides the password (wave 5). Passkeys are registered and
// removed here; Google / GitHub accounts are connected (Better Auth `linkSocial`) and disconnected.
// Everything goes through Better Auth's own endpoints.

const PROFILE_PATH = "/settings";

const subscribeNever = () => () => {
  // read once after hydration
};

/** `?error=` on the Profile page after connecting Google / GitHub failed (Better Auth redirects back). */
function useLinkError(): string | null {
  return useSyncExternalStore(
    subscribeNever,
    () => signInErrorMessage(new URLSearchParams(window.location.search).get("error")),
    () => null,
  );
}

// --- Passkeys ---------------------------------------------------------------------------------------

/** A passkey's label: its own name, else the device type. */
const passkeyLabel = (p: Passkey, t: TFn) =>
  p.name?.trim() ||
  (p.deviceType === "multiDevice" ? t("settings2.syncedPasskey") : t("settings2.passkeyOnSecurityKey"));

export function PasskeysCard() {
  const t = useT();
  const timeAgo = useTimeAgo();
  const methods = useSignInMethodsQuery(undefined);
  const q = usePasskeysQuery(undefined);
  const [open, setOpen] = useState<"add" | { rename: Passkey } | { remove: Passkey } | null>(null);
  const [remove, removing] = useDeletePasskeyMutation();
  const enabled = methods.data?.passkey ?? true;
  const passkeys = q.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t("settings2.passkeys")}
          {passkeys.length > 0 && (
            <Badge variant="secondary" className="font-normal" data-testid="passkey-count">
              {passkeys.length}
            </Badge>
          )}
        </CardTitle>
        <CardDescription className="text-pretty">{t("settings2.passkeysDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {!enabled && (
          <p className="rounded-lg bg-muted p-3 text-sm text-pretty text-muted-foreground">
            {t("settings2.passkeysOff")}
          </p>
        )}
        {q.isLoading && <Skeleton className="h-11" />}
        {q.isError && <ErrorState error={q.error} retry={() => void q.refetch()} className="py-6" />}
        {q.data && passkeys.length === 0 && (
          <EmptyState
            icon={Fingerprint}
            title={t("settings2.noPasskeysYet")}
            description={enabled ? t("settings2.addOneToSignIn") : undefined}
            className="py-6"
          />
        )}
        {passkeys.length > 0 && (
          <ul className="-my-1 divide-y" aria-label={t("settings2.passkeys")}>
            {passkeys.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5" data-testid="passkey-row">
                <span className="grid size-8 place-items-center rounded-full bg-muted">
                  <Fingerprint className="size-4 text-muted-foreground" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{passkeyLabel(p, t)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {p.backedUp ? t("settings2.synced") : t("settings2.thisDeviceOnly")}
                    {p.createdAt ? ` · ${t("settings2.addedAgo", { time: timeAgo(p.createdAt) })}` : ""}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("settings2.renameNamed", { name: passkeyLabel(p, t) })}
                  onClick={() => setOpen({ rename: p })}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("settings2.removeNamed", { name: passkeyLabel(p, t) })}
                  onClick={() => setOpen({ remove: p })}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {enabled && (
          <Button variant="outline" className="justify-self-start" onClick={() => setOpen("add")}>
            <KeyRound /> {t("settings2.addAPasskey")}
          </Button>
        )}
      </CardContent>

      <Dialog open={open === "add" || (!!open && "rename" in open)} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-md">
          {open === "add" && <AddPasskey onDone={() => setOpen(null)} />}
          {open && open !== "add" && "rename" in open && (
            <RenamePasskey passkey={open.rename} onDone={() => setOpen(null)} />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!open && open !== "add" && "remove" in open}
        onOpenChange={(o) => !o && setOpen(null)}
        title={t("settings2.removeThisPasskeyQ")}
        description={t("settings2.removePasskeyDesc")}
        confirmLabel={t("settings2.removeConfirm")}
        pending={removing.isLoading}
        onConfirm={() => {
          if (!open || open === "add" || !("remove" in open)) return;
          remove(open.remove.id)
            .unwrap()
            .then(() => {
              toast.success(t("settings2.passkeyRemoved"));
              setOpen(null);
            })
            .catch((e: unknown) => toast.error(errorMessage(e)));
        }}
      />
    </Card>
  );
}

/** Name it, then the browser's own passkey dialog. */
function AddPasskey({ onDone }: { onDone: () => void }) {
  const t = useT();
  const dispatch = useAppDispatch();
  const defaultName = useSyncExternalStore(
    subscribeNever,
    () => describeAgent(navigator.userAgent, t),
    () => "",
  );
  const form = useZodForm(passkeyNameForm, { values: { name: defaultName } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async ({ name }) => {
    const { error } = await authClient.passkey.addPasskey({ name });
    if (error) {
      const msg = error.message ?? "";
      form.setError("root", {
        message: /fresh|session/i.test(msg)
          ? t("settings2.passkeyFreshSession")
          : /cancel|not allowed|abort/i.test(msg)
            ? t("settings2.passkeyNotSaved")
            : msg || t("settings2.couldntAddPasskey"),
      });
      return;
    }
    dispatch(passkeysChanged());
    toast.success(t("settings2.passkeyAdded"), { description: t("settings2.useItOnSignIn") });
    onDone();
  });
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t("settings2.addAPasskey")}</DialogTitle>
        <DialogDescription>{t("settings2.addPasskeyDesc")}</DialogDescription>
      </DialogHeader>
      <Field
        id="passkey-name"
        label={t("settings2.name")}
        help={t("settings2.passkeyNameHelp")}
        error={errors.name?.message}
      >
        <Input
          {...controlProps("passkey-name", errors.name?.message, true)}
          {...form.register("name")}
          maxLength={60}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog's only field
          autoFocus
        />
      </Field>
      <FormError message={errors.root?.message} />
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("settings2.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          <Fingerprint /> {isSubmitting ? t("settings2.waitingForDevice") : t("settings2.createPasskey")}
        </Button>
      </DialogFooter>
    </form>
  );
}

function RenamePasskey({ passkey, onDone }: { passkey: Passkey; onDone: () => void }) {
  const t = useT();
  const [rename] = useRenamePasskeyMutation();
  const form = useZodForm(passkeyNameForm, { defaultValues: { name: passkeyLabel(passkey, t) } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async ({ name }) => {
    try {
      await rename({ id: passkey.id, name }).unwrap();
      toast.success(t("settings2.passkeyRenamed"));
      onDone();
    } catch (e) {
      form.setError("root", { message: errorMessage(e) });
    }
  });
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t("settings2.renamePasskey")}</DialogTitle>
      </DialogHeader>
      <Field id="passkey-rename" label={t("settings2.name")} error={errors.name?.message}>
        <Input
          {...controlProps("passkey-rename", errors.name?.message)}
          {...form.register("name")}
          maxLength={60}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog's only field
          autoFocus
        />
      </Field>
      <FormError message={errors.root?.message} />
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("settings2.cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("settings2.saving") : t("settings2.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}

// --- Connected accounts -----------------------------------------------------------------------------

/**
 * Google / GitHub accounts that sign in to this one. Shown when the server offers a provider or the
 * account already has one connected (a provider switched off later can still be disconnected).
 */
export function ConnectedAccountsCard() {
  const t = useT();
  const timeAgo = useTimeAgo();
  const methods = useSignInMethodsQuery(undefined);
  const q = useLinkedAccountsQuery(undefined);
  const [unlink, unlinking] = useUnlinkAccountMutation();
  const [pending, setPending] = useState<OAuthProvider | null>(null);
  const [confirm, setConfirm] = useState<{ providerId: string; accountId: string } | null>(null);
  const linkError = useLinkError();

  const accounts = q.data ?? [];
  const offered = (["google", "github"] as const).filter((p) => methods.data?.[p]);
  const linked = accounts.filter((a) => a.providerId === "google" || a.providerId === "github");
  const rows = (["google", "github"] as const).filter(
    (p) => offered.includes(p) || linked.some((a) => a.providerId === p),
  );
  if (methods.isLoading || q.isLoading) return <Skeleton className="h-40 rounded-xl" />;
  if (!rows.length && !q.isError) return null;
  const hasPassword = accounts.some((a) => a.providerId === "credential");
  // Better Auth keeps at least one way in: the last connected account can't be removed.
  const onlyOne = accounts.length <= 1;

  const connect = async (provider: OAuthProvider) => {
    setPending(provider);
    const { error } = await authClient.linkSocial({
      provider,
      callbackURL: PROFILE_PATH,
      errorCallbackURL: PROFILE_PATH,
    });
    if (error) {
      toast.error(
        error.message ?? t("settings2.couldntReachProvider", { provider: PROVIDER_NAMES[provider] }),
      );
      setPending(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings2.connectedAccounts")}</CardTitle>
        <CardDescription className="text-pretty">{t("settings2.connectedAccountsDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {linkError && (
          <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-pretty text-destructive">
            {linkError}
          </p>
        )}
        {q.isError && <ErrorState error={q.error} retry={() => void q.refetch()} className="py-6" />}
        {q.data && (
          <ul className="-my-1 divide-y" aria-label={t("settings2.connectedAccounts")}>
            {rows.map((p) => {
              const account = linked.find((a) => a.providerId === p);
              return (
                <li key={p} className="flex flex-wrap items-center gap-3 py-2.5" data-provider={p}>
                  <span className="grid size-8 place-items-center rounded-full bg-muted">
                    <ProviderIcon provider={p} className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{PROVIDER_NAMES[p]}</p>
                    <p className="text-xs text-muted-foreground">
                      {account
                        ? t("settings2.connectedAgo", { time: timeAgo(account.createdAt) })
                        : t("settings2.notConnected")}
                      {account && !offered.includes(p) ? ` · ${t("settings2.noLongerOffered")}` : ""}
                    </p>
                  </div>
                  {account ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={onlyOne}
                      title={onlyOne ? t("settings2.onlyWayToSignIn") : undefined}
                      onClick={() =>
                        setConfirm({ providerId: account.providerId, accountId: account.accountId })
                      }
                    >
                      {t("settings2.disconnect")}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending !== null}
                      onClick={() => void connect(p)}
                    >
                      <Link2 /> {pending === p ? t("settings2.redirecting") : t("settings2.connect")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {q.data && !hasPassword && (
          <p className="text-xs text-pretty text-muted-foreground">{t("settings2.noPasswordHint")}</p>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t("settings2.disconnectProviderQ", {
          provider: confirm ? providerName(confirm.providerId) : "",
        })}
        description={t("settings2.disconnectDesc")}
        confirmLabel={t("settings2.disconnect")}
        pending={unlinking.isLoading}
        onConfirm={() => {
          if (!confirm) return;
          unlink(confirm)
            .unwrap()
            .then(() => {
              toast.success(t("settings2.disconnected"));
              setConfirm(null);
            })
            .catch((e: unknown) => toast.error(errorMessage(e)));
        }}
      />
    </Card>
  );
}
