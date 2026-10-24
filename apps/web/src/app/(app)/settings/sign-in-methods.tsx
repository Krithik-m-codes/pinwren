"use client";

import { Fingerprint, KeyRound, Link2, Pencil, Trash2 } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { timeAgo } from "@/components/feedback-meta";
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
const passkeyLabel = (p: Passkey) =>
  p.name?.trim() || (p.deviceType === "multiDevice" ? "Synced passkey" : "Passkey on a security key");

export function PasskeysCard() {
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
          Passkeys
          {passkeys.length > 0 && (
            <Badge variant="secondary" className="font-normal" data-testid="passkey-count">
              {passkeys.length}
            </Badge>
          )}
        </CardTitle>
        <CardDescription className="text-pretty">
          Sign in with your fingerprint, face, screen lock or a security key instead of a password. Saved in
          your password manager or on this device.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {!enabled && (
          <p className="rounded-lg bg-muted p-3 text-sm text-pretty text-muted-foreground">
            Passkeys are switched off on this server (Settings › Security). You can still remove the ones you
            have.
          </p>
        )}
        {q.isLoading && <Skeleton className="h-11" />}
        {q.isError && <ErrorState error={q.error} retry={() => void q.refetch()} className="py-6" />}
        {q.data && passkeys.length === 0 && (
          <EmptyState
            icon={Fingerprint}
            title="No passkeys yet"
            description={enabled ? "Add one to sign in without typing a password." : undefined}
            className="py-6"
          />
        )}
        {passkeys.length > 0 && (
          <ul className="-my-1 divide-y" aria-label="Passkeys">
            {passkeys.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5" data-testid="passkey-row">
                <span className="grid size-8 place-items-center rounded-full bg-muted">
                  <Fingerprint className="size-4 text-muted-foreground" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{passkeyLabel(p)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {p.backedUp ? "Synced" : "This device only"}
                    {p.createdAt ? ` · added ${timeAgo(p.createdAt)}` : ""}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Rename ${passkeyLabel(p)}`}
                  onClick={() => setOpen({ rename: p })}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${passkeyLabel(p)}`}
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
            <KeyRound /> Add a passkey
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
        title="Remove this passkey?"
        description="You won't be able to sign in with it any more. Remove it from your password manager or device too."
        confirmLabel="Remove"
        pending={removing.isLoading}
        onConfirm={() => {
          if (!open || open === "add" || !("remove" in open)) return;
          remove(open.remove.id)
            .unwrap()
            .then(() => {
              toast.success("Passkey removed");
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
  const dispatch = useAppDispatch();
  const defaultName = useSyncExternalStore(
    subscribeNever,
    () => describeAgent(navigator.userAgent),
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
          ? "For your security, sign out and back in, then add the passkey within a day of signing in."
          : /cancel|not allowed|abort/i.test(msg)
            ? "The passkey wasn't saved. Try again when you're ready."
            : msg || "Couldn't add the passkey",
      });
      return;
    }
    dispatch(passkeysChanged());
    toast.success("Passkey added", { description: "Use it on the sign-in page." });
    onDone();
  });
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Add a passkey</DialogTitle>
        <DialogDescription>
          Your browser asks where to save it: your password manager, this device, or a security key.
        </DialogDescription>
      </DialogHeader>
      <Field
        id="passkey-name"
        label="Name"
        help="So you can tell your passkeys apart."
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
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          <Fingerprint /> {isSubmitting ? "Waiting for your device…" : "Create passkey"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function RenamePasskey({ passkey, onDone }: { passkey: Passkey; onDone: () => void }) {
  const [rename] = useRenamePasskeyMutation();
  const form = useZodForm(passkeyNameForm, { defaultValues: { name: passkeyLabel(passkey) } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async ({ name }) => {
    try {
      await rename({ id: passkey.id, name }).unwrap();
      toast.success("Passkey renamed");
      onDone();
    } catch (e) {
      form.setError("root", { message: errorMessage(e) });
    }
  });
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Rename passkey</DialogTitle>
      </DialogHeader>
      <Field id="passkey-rename" label="Name" error={errors.name?.message}>
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
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save"}
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
      toast.error(error.message ?? `Couldn't reach ${PROVIDER_NAMES[provider]}`);
      setPending(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected accounts</CardTitle>
        <CardDescription className="text-pretty">
          Sign in with Google or GitHub as well. The address there can differ from your Pinwren email.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {linkError && (
          <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-pretty text-destructive">
            {linkError}
          </p>
        )}
        {q.isError && <ErrorState error={q.error} retry={() => void q.refetch()} className="py-6" />}
        {q.data && (
          <ul className="-my-1 divide-y" aria-label="Connected accounts">
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
                      {account ? `Connected ${timeAgo(account.createdAt)}` : "Not connected"}
                      {account && !offered.includes(p) ? " · no longer offered on this server" : ""}
                    </p>
                  </div>
                  {account ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={onlyOne}
                      title={onlyOne ? "It's your only way to sign in" : undefined}
                      onClick={() =>
                        setConfirm({ providerId: account.providerId, accountId: account.accountId })
                      }
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending !== null}
                      onClick={() => void connect(p)}
                    >
                      <Link2 /> {pending === p ? "Redirecting…" : "Connect"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {q.data && !hasPassword && (
          <p className="text-xs text-pretty text-muted-foreground">
            You sign in without a password. To add one, use “Forgot password?” on the sign-in page.
          </p>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Disconnect ${confirm ? providerName(confirm.providerId) : ""}?`}
        description="You won't be able to sign in with it any more. You can connect it again later."
        confirmLabel="Disconnect"
        pending={unlinking.isLoading}
        onConfirm={() => {
          if (!confirm) return;
          unlink(confirm)
            .unwrap()
            .then(() => {
              toast.success("Disconnected");
              setConfirm(null);
            })
            .catch((e: unknown) => toast.error(errorMessage(e)));
        }}
      />
    </Card>
  );
}
