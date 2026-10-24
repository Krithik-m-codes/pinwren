"use client";

import { IMPLEMENTED_LICENSE_FEATURES, type LicenseFeature, PLANNED_LICENSE_FEATURES } from "@pinwren/core";
import { Award, CircleCheck, Clock, FileKey2, Lock, ShieldAlert, TriangleAlert, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { controlProps, FieldError, FormError, useZodForm } from "@/components/form";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { LicenseInfo } from "@/lib/api";
import { licenseForm } from "@/lib/form-schemas";
import {
  errorMessage,
  isForbidden,
  useLicenseQuery,
  useRemoveLicenseMutation,
  useUploadLicenseMutation,
} from "@/lib/store/api";
import { cn } from "@/lib/utils";
import { SectionTitle } from "../settings-shell";

const FEATURE_NAMES: Record<LicenseFeature, string> = {
  sso: "Single sign-on",
  scim: "SCIM provisioning",
  audit_log: "Audit log",
  custom_roles: "Custom roles",
  white_label: "White-label",
  jira: "Jira",
  legal_hold: "Legal hold",
  siem_stream: "SIEM stream",
  priority_support: "Priority support",
};

/** What an implemented entitlement does, next to its name. */
const FEATURE_HINTS: Record<(typeof IMPLEMENTED_LICENSE_FEATURES)[number], string> = {
  white_label: "hide “Powered by Pinwren” in the widget and emails",
};

const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

const STATUS: Record<LicenseInfo["status"], { label: string; className: string }> = {
  none: { label: "Community", className: "" },
  valid: { label: "Active", className: "text-emerald-700 dark:text-emerald-400" },
  grace: { label: "Grace period", className: "text-amber-700 dark:text-amber-400" },
  expired: { label: "Expired · read-only", className: "text-destructive" },
  invalid: { label: "Not valid", className: "text-destructive" },
};

/** Settings › Licence (F-098, ADR 0019): install, inspect and remove the Enterprise licence. Instance admins. */
export function LicenseSettings() {
  const query = useLicenseQuery(undefined);
  const [uploading, setUploading] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removeLicense, removal] = useRemoveLicenseMutation();

  if (query.isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (isForbidden(query.error)) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={Lock}
            title="Instance admins only"
            description="The licence belongs to whoever runs this server (PINWREN_ADMIN_EMAILS)."
          />
        </CardContent>
      </Card>
    );
  }
  if (!query.data) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const l = query.data.license;
  const locked = l.source === "file";
  const d = l.details;

  return (
    <div className="grid gap-4">
      <SectionTitle
        title="Licence"
        description="Enterprise features are unlocked by a signed licence file, verified on this server — nothing is sent anywhere."
        action={
          !locked && (
            <Button size="sm" onClick={() => setUploading(true)} data-testid="upload-license">
              <Upload /> {l.status === "none" ? "Install a licence" : "Replace licence"}
            </Button>
          )
        }
      />

      {l.status === "grace" && l.license && (
        <Banner tone="warn" icon={TriangleAlert}>
          The licence expired on {date(l.license.expiresAt)}. Everything keeps working until{" "}
          {date(l.license.graceEndsAt)}; renew before then.
        </Banner>
      )}
      {l.status === "expired" && (
        <Banner tone="error" icon={ShieldAlert}>
          The licence and its grace period are over. Enterprise settings keep their effect but are read-only
          until a new licence is installed. No data is hidden or deleted.
        </Banner>
      )}
      {l.status === "invalid" && (
        <Banner tone="error" icon={ShieldAlert}>
          The installed licence isn&apos;t valid{l.error ? `: ${l.error}` : ""}. This instance runs as
          Community.
        </Banner>
      )}

      <Card data-testid="license-status">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Award className="size-4 text-muted-foreground" />
            {l.edition === "enterprise" ? "Enterprise" : "Community"}
            <Badge variant="outline" className={cn("ml-auto font-normal", STATUS[l.status].className)}>
              {STATUS[l.status].label}
            </Badge>
          </CardTitle>
          <CardDescription>
            {locked ? (
              <>
                Set by <code className="font-mono text-xs">PINWREN_LICENSE_FILE</code> — replace the file to
                change it.
              </>
            ) : l.source === "upload" ? (
              "Uploaded in this screen."
            ) : (
              "No licence installed. Every Community feature is available; Enterprise ones are listed below."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          {d && (
            <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Customer</dt>
              <dd data-testid="license-customer">{d.customer}</dd>
              {d.email && (
                <>
                  <dt className="text-muted-foreground">Contact</dt>
                  <dd>{d.email}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Licence id</dt>
              <dd>
                <code className="font-mono text-xs">{d.lid}</code>
              </dd>
              <dt className="text-muted-foreground">Valid</dt>
              <dd>
                {date(d.issuedAt)} – {date(d.expiresAt)}
                {l.license && l.status === "valid" && (
                  <span className="text-muted-foreground"> · {l.license.daysLeft} days left</span>
                )}
              </dd>
              <dt className="text-muted-foreground">Grace period</dt>
              <dd>{d.graceDays} days</dd>
              <dt className="text-muted-foreground">Seats</dt>
              <dd className="tabular-nums">
                {l.seats.used} used{l.seats.limit !== null && ` of ${l.seats.limit}`}
                {l.seats.limit !== null && l.seats.used > l.seats.limit && (
                  <span className="text-amber-700 dark:text-amber-400"> · over the limit (not enforced)</span>
                )}
              </dd>
              {d.instance && (
                <>
                  <dt className="text-muted-foreground">Bound to</dt>
                  <dd>
                    <code className="font-mono text-xs">{d.instance}</code>
                  </dd>
                </>
              )}
            </dl>
          )}
          <div className="grid gap-2">
            <p className="text-sm font-medium">Features</p>
            <ul className="grid gap-1.5 sm:grid-cols-2" aria-label="Enterprise features">
              {IMPLEMENTED_LICENSE_FEATURES.map((f) => {
                const on = l.features.includes(f);
                return (
                  <li
                    key={f}
                    className={cn("flex items-center gap-2 text-sm", !on && "text-muted-foreground")}
                    data-feature={f}
                    data-on={on || undefined}
                  >
                    {on ? (
                      <CircleCheck className="size-4 shrink-0 text-emerald-600" />
                    ) : (
                      <span className="size-4 shrink-0 rounded-full border border-dashed" />
                    )}
                    {FEATURE_NAMES[f]}
                    <span className="text-xs text-muted-foreground">{FEATURE_HINTS[f]}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="grid gap-2" data-testid="license-coming-soon">
            <p className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <Clock className="size-3.5" /> Coming soon
            </p>
            <ul className="grid gap-1.5 sm:grid-cols-2" aria-label="Planned Enterprise features">
              {PLANNED_LICENSE_FEATURES.map((f) => (
                <li
                  key={f}
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                  data-feature={f}
                >
                  <span className="size-4 shrink-0 rounded-full border border-dashed" />
                  {FEATURE_NAMES[f]}
                  {l.features.includes(f) && (
                    <Badge variant="outline" className="font-normal">
                      In your licence
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-pretty text-muted-foreground">
              Not built yet. A licence that names them keeps them, and they switch on in the release that
              ships them, with no new licence file.
            </p>
          </div>
          {l.source === "upload" && (
            <div className="border-t pt-4">
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmRemove(true)}
              >
                Remove licence
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <UploadDialog open={uploading} onOpenChange={setUploading} />
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove the licence?"
        description="This instance goes back to Community. Enterprise settings stay saved and apply again once a licence is installed."
        confirmLabel="Remove"
        pending={removal.isLoading}
        onConfirm={() => {
          removeLicense(undefined)
            .unwrap()
            .then(() => {
              setConfirmRemove(false);
              toast.success("Licence removed");
            })
            .catch((e: unknown) => toast.error(errorMessage(e)));
        }}
      />
    </div>
  );
}

function Banner({
  tone,
  icon: Icon,
  children,
}: {
  tone: "warn" | "error";
  icon: typeof TriangleAlert;
  children: React.ReactNode;
}) {
  return (
    <p
      role="status"
      data-testid="license-state-banner"
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
        tone === "warn"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300"
          : "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function UploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && <UploadForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function UploadForm({ onDone }: { onDone: () => void }) {
  const [upload] = useUploadLicenseMutation();
  const file = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const form = useZodForm(licenseForm, { defaultValues: { license: "" } });
  const { errors, isSubmitting } = form.formState;

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 20_000) {
      form.setError("license", { message: "That file is too large to be a licence" });
      return;
    }
    form.setValue("license", (await f.text()).trim(), { shouldValidate: true, shouldDirty: true });
  };
  const submit = form.handleSubmit(async ({ license }) => {
    try {
      const { license: l } = await upload(license).unwrap();
      toast.success(`Licence for ${l.details?.customer ?? "your organisation"} installed`);
      onDone();
    } catch (e) {
      form.setError("license", { message: errorMessage(e) });
    }
  });

  return (
    <form noValidate className="grid gap-4" onSubmit={(e) => void submit(e)}>
      <DialogHeader>
        <DialogTitle>Install a licence</DialogTitle>
        <DialogDescription>Drop the .lic file you received, or paste its contents.</DialogDescription>
      </DialogHeader>
      <button
        type="button"
        onClick={() => file.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void readFile(e.dataTransfer.files[0]);
        }}
        className={cn(
          "grid place-items-center gap-1 rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring",
          over && "border-primary bg-primary/5",
        )}
      >
        <FileKey2 className="size-5" />
        Drop a .lic file here, or click to choose one
      </button>
      <input
        ref={file}
        type="file"
        accept=".lic,text/plain"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid="license-file"
        onChange={(e) => void readFile(e.target.files?.[0])}
      />
      <div className="grid gap-1.5">
        <label htmlFor="license-text" className="text-sm font-medium">
          Licence
        </label>
        <Textarea
          {...controlProps("license-text", errors.license?.message)}
          {...form.register("license")}
          rows={5}
          spellCheck={false}
          className="font-mono text-xs break-all"
          placeholder="eyJ2IjoxLCJraWQiOi…"
        />
        <FieldError id="license-text" message={errors.license?.message} />
      </div>
      <FormError message={errors.root?.message} />
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Verifying…" : "Install licence"}
        </Button>
      </DialogFooter>
    </form>
  );
}
