"use client";

import {
  AUDIT_ACTIONS,
  AUDIT_CLOUD_RETENTION_DAYS,
  AUDIT_EXPORT_MAX_ROWS,
  type AuditAction,
  type AuditEntry,
} from "@pinwren/core";
import { Download, Lock, ScrollText, Sparkles } from "lucide-react";
import { useState } from "react";
import { ButtonLink } from "@/components/button-link";
import { DatePicker } from "@/components/date-picker";
import { RelativeTime } from "@/components/feedback-meta";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Key } from "@/lib/i18n/en";
import { useT } from "@/lib/i18n/provider";
import { useAuditLogQuery, useEntitlementsQuery, useMeQuery } from "@/lib/store/api";
import { cn } from "@/lib/utils";
import { SectionTitle } from "../settings-shell";

/** One translated label per recorded action; an action this build doesn't know shows its raw code. */
const ACTION_LABELS: Record<AuditAction, Key> = {
  "member.invited": "audit.action_member_invited",
  "member.created": "audit.action_member_created",
  "member.role_changed": "audit.action_member_role_changed",
  "member.removed": "audit.action_member_removed",
  "member.custom_role_assigned": "audit.action_member_custom_role_assigned",
  "role.created": "audit.action_role_created",
  "role.updated": "audit.action_role_updated",
  "role.deleted": "audit.action_role_deleted",
  "workspace.ownership_transferred": "audit.action_workspace_ownership_transferred",
  "api_token.created": "audit.action_api_token_created",
  "api_token.revoked": "audit.action_api_token_revoked",
  "integration.connected": "audit.action_integration_connected",
  "integration.updated": "audit.action_integration_updated",
  "integration.removed": "audit.action_integration_removed",
  "slack.connected": "audit.action_slack_connected",
  "slack.disconnected": "audit.action_slack_disconnected",
  "webhook.created": "audit.action_webhook_created",
  "webhook.updated": "audit.action_webhook_updated",
  "webhook.removed": "audit.action_webhook_removed",
  "project.created": "audit.action_project_created",
  "project.updated": "audit.action_project_updated",
  "project.key_rotated": "audit.action_project_key_rotated",
  "project.exported": "audit.action_project_exported",
  "license.installed": "audit.action_license_installed",
  "license.removed": "audit.action_license_removed",
  "branding.updated": "audit.action_branding_updated",
  "billing.checkout_started": "audit.action_billing_checkout_started",
  "settings.sign_in_updated": "audit.action_settings_sign_in_updated",
  "settings.email_updated": "audit.action_settings_email_updated",
  "settings.security_updated": "audit.action_settings_security_updated",
  "share_link.created": "audit.action_share_link_created",
  "share_link.revoked": "audit.action_share_link_revoked",
  "review_link.created": "audit.action_review_link_created",
  "review_link.revoked": "audit.action_review_link_revoked",
  "data.erased": "audit.action_data_erased",
  "audit.exported": "audit.action_audit_exported",
};

const ALL = "all";
type Filters = { actor: string; action: string; from: Date | null; to: Date | null };
const NO_FILTERS: Filters = { actor: "", action: ALL, from: null, to: null };

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
const endOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).toISOString();

/** The API's filter parameters for the filter bar (empty ones omitted). */
function argsOf(f: Filters) {
  return {
    ...(f.actor.trim() ? { actor: f.actor.trim() } : {}),
    ...(f.action !== ALL ? { action: f.action } : {}),
    ...(f.from ? { from: startOfDay(f.from) } : {}),
    ...(f.to ? { to: endOfDay(f.to) } : {}),
  };
}

const isFiltered = (f: Filters) => Object.keys(argsOf(f)).length > 0;

function exportHref(f: Filters, format: "csv" | "jsonl") {
  return `/api/audit/export?${new URLSearchParams({ ...argsOf(f), format }).toString()}`;
}

/** `key: value` pairs of an entry's `data`, scalars only (the full object is in the exports). */
function detailsOf(data: AuditEntry["data"]): string {
  return Object.entries(data)
    .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" · ");
}

/**
 * Settings › Audit log (F-092, ADR 0044): who changed what in the workspace. Workspace Admins on Business
 * (Cloud) or an Enterprise licence with the feature; everyone else sees why they can't.
 */
export function AuditSettings() {
  const t = useT();
  const me = useMeQuery(undefined);
  const entitlements = useEntitlementsQuery(undefined);
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [applied, setApplied] = useState<Filters>(NO_FILTERS);

  if (me.isLoading || entitlements.isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (!me.data?.permissions.includes("audit.read")) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={Lock}
            title={t("audit.adminsOnlyTitle")}
            description={t("audit.adminsOnlyDescription")}
          />
        </CardContent>
      </Card>
    );
  }
  if (!entitlements.data) {
    return <ErrorState error={entitlements.error} retry={() => void entitlements.refetch()} />;
  }
  const cloud = entitlements.data.edition === "cloud";
  if (!entitlements.data.features.includes("audit_log")) {
    return (
      <div className="grid gap-4">
        <SectionTitle title={t("audit.title")} description={t("audit.description")} />
        <Card data-testid="audit-upgrade">
          <CardContent>
            <EmptyState
              icon={Sparkles}
              title={t("audit.upgradeTitle")}
              description={
                cloud
                  ? t("audit.upgradeCloud", { days: AUDIT_CLOUD_RETENTION_DAYS })
                  : t("audit.upgradeSelfHost")
              }
              action={
                cloud ? (
                  <ButtonLink href="/settings/billing">{t("audit.upgradePlans")}</ButtonLink>
                ) : (
                  <ButtonLink href="/settings/license" variant="outline">
                    {t("audit.upgradeLicence")}
                  </ButtonLink>
                )
              }
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const apply = () => setApplied(draft);
  const clear = () => {
    setDraft(NO_FILTERS);
    setApplied(NO_FILTERS);
  };
  const exportLink = cn(buttonVariants({ variant: "outline", size: "sm" }));

  return (
    <div className="grid gap-4">
      <SectionTitle
        title={t("audit.title")}
        description={t("audit.description")}
        action={
          <div className="flex flex-wrap gap-2">
            <a
              href={exportHref(applied, "csv")}
              download
              className={exportLink}
              data-testid="audit-export-csv"
            >
              <Download /> {t("audit.exportCsv")}
            </a>
            <a
              href={exportHref(applied, "jsonl")}
              download
              className={exportLink}
              data-testid="audit-export-jsonl"
            >
              <Download /> {t("audit.exportJsonl")}
            </a>
          </div>
        }
      />

      <Card>
        <CardContent className="grid gap-4">
          <form
            className="flex flex-wrap items-end gap-3"
            aria-label={t("audit.applyFilters")}
            onSubmit={(e) => {
              e.preventDefault();
              apply();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="audit-action">{t("audit.filterAction")}</Label>
              <Select
                items={[
                  { value: ALL, label: t("audit.allActions") },
                  ...AUDIT_ACTIONS.map((a) => ({ value: a, label: t(ACTION_LABELS[a]) })),
                ]}
                value={draft.action}
                onValueChange={(v) => v && setDraft({ ...draft, action: v })}
              >
                <SelectTrigger id="audit-action" className="w-60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t("audit.allActions")}</SelectItem>
                  {AUDIT_ACTIONS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {t(ACTION_LABELS[a])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="audit-actor">{t("audit.filterActor")}</Label>
              <Input
                id="audit-actor"
                className="w-56"
                value={draft.actor}
                maxLength={200}
                placeholder={t("audit.actorPlaceholder")}
                onChange={(e) => setDraft({ ...draft, actor: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="audit-from">{t("audit.filterFrom")}</Label>
              <DatePicker
                id="audit-from"
                value={draft.from}
                placeholder={t("audit.anyDate")}
                onChange={(from) => setDraft({ ...draft, from })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="audit-to">{t("audit.filterTo")}</Label>
              <DatePicker
                id="audit-to"
                value={draft.to}
                placeholder={t("audit.anyDate")}
                onChange={(to) => setDraft({ ...draft, to })}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit">{t("audit.applyFilters")}</Button>
              {(isFiltered(applied) || isFiltered(draft)) && (
                <Button type="button" variant="ghost" onClick={clear}>
                  {t("audit.clearFilters")}
                </Button>
              )}
            </div>
          </form>

          {/* A new filter set is a new list: remounting drops the loaded pages. */}
          <AuditTable key={JSON.stringify(argsOf(applied))} filters={applied} />

          <p className="text-xs text-muted-foreground">
            {t("audit.exportNote", { max: AUDIT_EXPORT_MAX_ROWS.toLocaleString() })}
            {cloud && ` ${t("audit.retentionNote", { days: AUDIT_CLOUD_RETENTION_DAYS })}`}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/** The loaded pages, each its own cached query keyed by the previous page's cursor. */
function AuditTable({ filters }: { filters: Filters }) {
  const t = useT();
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  return (
    <Table aria-label={t("audit.tableLabel")} data-testid="audit-table">
      <TableHeader>
        <TableRow>
          <TableHead className="w-32">{t("audit.colWhen")}</TableHead>
          <TableHead>{t("audit.colActor")}</TableHead>
          <TableHead>{t("audit.colAction")}</TableHead>
          <TableHead>{t("audit.colTarget")}</TableHead>
        </TableRow>
      </TableHeader>
      {cursors.map((cursor, i) => (
        <AuditPage
          key={cursor ?? "first"}
          filters={filters}
          cursor={cursor}
          first={i === 0}
          last={i === cursors.length - 1}
          onMore={(next) => setCursors((c) => [...c, next])}
        />
      ))}
    </Table>
  );
}

function AuditPage({
  filters,
  cursor,
  first,
  last,
  onMore,
}: {
  filters: Filters;
  cursor: string | undefined;
  first: boolean;
  last: boolean;
  onMore: (cursor: string) => void;
}) {
  const t = useT();
  const query = useAuditLogQuery({ ...argsOf(filters), cursor });
  const note = (children: React.ReactNode) => (
    <TableBody>
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={4}>{children}</TableCell>
      </TableRow>
    </TableBody>
  );

  if (query.isLoading) {
    return note(
      <div className="grid gap-2" aria-busy="true">
        {Array.from({ length: first ? 5 : 2 }, (_, i) => (
          <Skeleton key={i} className="h-8" />
        ))}
      </div>,
    );
  }
  if (!query.data) return note(<ErrorState error={query.error} retry={() => void query.refetch()} />);
  const { items, nextCursor } = query.data;
  if (first && items.length === 0) {
    return note(
      isFiltered(filters) ? (
        <EmptyState
          icon={ScrollText}
          title={t("audit.emptyFilteredTitle")}
          description={t("audit.emptyFilteredDescription")}
        />
      ) : (
        <EmptyState
          icon={ScrollText}
          title={t("audit.emptyTitle")}
          description={t("audit.emptyDescription")}
        />
      ),
    );
  }
  return (
    <TableBody>
      {items.map((e) => {
        const label = (ACTION_LABELS as Record<string, Key | undefined>)[e.action];
        const details = detailsOf(e.data);
        return (
          <TableRow key={e.id} data-action={e.action}>
            <TableCell className="align-top whitespace-nowrap text-muted-foreground">
              <span title={new Date(e.createdAt).toLocaleString()}>
                <RelativeTime iso={e.createdAt} />
              </span>
            </TableCell>
            <TableCell className="align-top">
              <span className="break-words">{e.actorLabel}</span>
              {e.actorIp && (
                <span className="block text-xs text-muted-foreground">
                  {t("audit.ip", { ip: e.actorIp })}
                </span>
              )}
            </TableCell>
            <TableCell className="align-top">
              <span className="font-medium">{label ? t(label) : e.action}</span>
              {details && <span className="block text-xs break-words text-muted-foreground">{details}</span>}
            </TableCell>
            <TableCell className="align-top">
              {e.targetType && (
                <span className="font-mono text-xs break-all text-muted-foreground">
                  {e.targetType}
                  {e.targetId && ` · ${e.targetId}`}
                </span>
              )}
            </TableCell>
          </TableRow>
        );
      })}
      {last && nextCursor && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={4} className="text-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onMore(nextCursor)}
              data-testid="audit-load-more"
            >
              {query.isFetching ? t("audit.loadingMore") : t("audit.loadMore")}
            </Button>
          </TableCell>
        </TableRow>
      )}
    </TableBody>
  );
}
