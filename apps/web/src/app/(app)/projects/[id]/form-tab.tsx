"use client";

import {
  type CustomFieldBase,
  type CustomFieldDef,
  customFieldsReplace,
  MAX_CUSTOM_FIELDS,
} from "@pinwren/core";
import {
  ChevronDown,
  ChevronUp,
  Download,
  FormInput,
  GripVertical,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FieldEditor } from "@/components/custom-fields/field-editor";
import { FormPreview } from "@/components/custom-fields/form-preview";
import { KIND_META } from "@/components/feedback-meta";
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
import type { ProjectDetail } from "@/lib/api";
import { blankField, FIELD_TYPE_META } from "@/lib/custom-fields";
import { useI18n } from "@/lib/i18n/provider";
import { errorMessage, useCustomFieldsQuery, useSaveCustomFieldsMutation } from "@/lib/store/api";
import { useViewer } from "@/lib/viewer";
import { cn } from "@/lib/utils";

let uid = 0;
type Row = { uid: number; field: CustomFieldBase };

const toBase = (d: CustomFieldDef): CustomFieldBase => {
  const { id: _id, projectId: _p, position: _pos, ...rest } = d;
  return rest;
};
const toRows = (defs: readonly CustomFieldBase[]): Row[] => defs.map((field) => ({ uid: ++uid, field }));
const sameType = (a: string, b: string) =>
  a === b || (["text", "textarea"].includes(a) && ["text", "textarea"].includes(b));

/**
 * Project › Form (ADR 0029): the questions this project's report form asks, their order and rules, with a live
 * preview. Admins build it and save it as a whole; everyone else reads it.
 */
export function FormTab({ project }: { project: ProjectDetail }) {
  const { t } = useI18n();
  const query = useCustomFieldsQuery(project.id);
  if (query.isLoading)
    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  if (query.isError || !query.data)
    return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const saved = query.data.fields.map(toBase);
  // A new copy of the saved form (after a save or a reload from the server) starts a fresh draft.
  return <Builder key={JSON.stringify(saved)} project={project} saved={saved} title={t("cfields.title")} />;
}

function Builder({
  project,
  saved,
  title,
}: {
  project: ProjectDetail;
  saved: CustomFieldBase[];
  title: string;
}) {
  const { t, tn } = useI18n();
  const { isAdmin } = useViewer();
  const [rows, setRows] = useState<Row[]>(() => toRows(saved));
  const [editing, setEditing] = useState<{ row: Row | null; field: CustomFieldBase } | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  const [confirmSave, setConfirmSave] = useState<string[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [announce, setAnnounce] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [save, saving] = useSaveCustomFieldsMutation();

  const fields = rows.map((r) => r.field);
  const dirty = JSON.stringify(fields) !== JSON.stringify(saved);
  const savedKeys = new Set(saved.map((f) => f.key));
  const full = rows.length >= MAX_CUSTOM_FIELDS;

  /** Saved fields this save would delete (with their answers): gone from the form, or turned into another kind of answer. */
  const losses = () =>
    saved
      .filter((s) => {
        const now = fields.find((f) => f.key === s.key);
        return !now || !sameType(now.type, s.type);
      })
      .map((s) => s.label);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length || from === to) return;
    const next = [...rows];
    const [item] = next.splice(from, 1);
    if (!item) return;
    next.splice(to, 0, item);
    setRows(next);
    setAnnounce(
      t("cfields.moved", { label: item.field.label || item.field.key, n: to + 1, total: next.length }),
    );
  };

  const commit = () => {
    setServerError(null);
    const parsed = customFieldsReplace.safeParse({ fields });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setServerError(first ? first.message : t("cfields.errGeneric"));
      return;
    }
    const gone = losses();
    if (gone.length && confirmSave === null) {
      setConfirmSave(gone);
      return;
    }
    save({ projectId: project.id, fields })
      .unwrap()
      .then(() => {
        setConfirmSave(null);
        toast.success(t("cfields.saved"));
      })
      .catch((e: unknown) => {
        setConfirmSave(null);
        setServerError(errorMessage(e));
      });
  };

  const exportJson = () => {
    const blob = new Blob([`${JSON.stringify({ fields }, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.slug}-form.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FormInput className="size-4" /> {title}
          </CardTitle>
          <CardDescription>{t("cfields.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && (
              <Button
                type="button"
                disabled={full}
                data-testid="add-field"
                onClick={() =>
                  setEditing({ row: null, field: blankField(new Set(fields.map((f) => f.key))) })
                }
              >
                <Plus /> {t("cfields.addField")}
              </Button>
            )}
            <span className="text-sm text-muted-foreground tabular-nums" data-testid="field-count">
              {t("cfields.count", { n: rows.length, max: MAX_CUSTOM_FIELDS })}
            </span>
            <span className="grow" />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={exportJson}
              disabled={rows.length === 0}
            >
              <Download /> {t("cfields.export")}
            </Button>
            {isAdmin && (
              <Button type="button" variant="outline" size="sm" onClick={() => setImporting(true)}>
                <Upload /> {t("cfields.import")}
              </Button>
            )}
          </div>

          {rows.length === 0 ? (
            <EmptyState
              icon={FormInput}
              title={t("cfields.emptyTitle")}
              description={isAdmin ? t("cfields.emptyAdmin") : t("cfields.emptyViewer")}
              className="py-8"
            />
          ) : (
            <ul className="grid gap-2" aria-label={title} data-testid="field-list">
              {rows.map((r, i) => {
                const f = r.field;
                const Icon = FIELD_TYPE_META[f.type].icon;
                return (
                  // Rows are draggable with the pointer; the handle and the arrow buttons do the same by keyboard.
                  <li
                    key={r.uid}
                    data-testid="field-row"
                    draggable={isAdmin}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", String(r.uid));
                      setDragging(r.uid);
                    }}
                    onDragOver={(e) => {
                      if (dragging === null) return;
                      e.preventDefault();
                      setOver(i);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = rows.findIndex((x) => x.uid === dragging);
                      setDragging(null);
                      setOver(null);
                      if (from >= 0) move(from, i);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border bg-card p-2 pr-2",
                      dragging === r.uid && "opacity-50",
                      over === i && dragging !== r.uid && "border-primary ring-2 ring-primary/30",
                    )}
                  >
                    {isAdmin && (
                      <button
                        type="button"
                        aria-label={t("cfields.reorder", { label: f.label || f.key })}
                        aria-describedby="field-reorder-help"
                        data-testid="field-handle"
                        className="cursor-grab rounded p-1 text-muted-foreground hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing"
                        onKeyDown={(e) => {
                          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                            e.preventDefault();
                            move(i, i + (e.key === "ArrowUp" ? -1 : 1));
                          } else if (e.key === "Home" || e.key === "End") {
                            e.preventDefault();
                            move(i, e.key === "Home" ? 0 : rows.length - 1);
                          }
                        }}
                      >
                        <GripVertical className="size-4" />
                      </button>
                    )}
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-medium">
                        <span className="truncate">{f.label}</span>
                        {f.required && <Badge variant="secondary">{t("cfields.badgeRequired")}</Badge>}
                        {f.audience === "internal" && (
                          <Badge variant="outline" className="gap-1">
                            <Lock className="size-3" /> {t("cfields.badgeInternal")}
                          </Badge>
                        )}
                        {f.pii && (
                          <Badge variant="outline" className="gap-1">
                            <ShieldAlert className="size-3" /> {t("cfields.badgePii")}
                          </Badge>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        <span className="font-mono">{f.key}</span> · {t(FIELD_TYPE_META[f.type].labelKey)} ·{" "}
                        {f.kinds.map((k) => t(KIND_META[k].labelKey)).join(", ")}
                      </p>
                    </div>
                    {isAdmin && (
                      <div className="flex shrink-0 items-center">
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("cfields.moveUp", { label: f.label || f.key })}
                          disabled={i === 0}
                          onClick={() => move(i, i - 1)}
                        >
                          <ChevronUp />
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("cfields.moveDown", { label: f.label || f.key })}
                          disabled={i === rows.length - 1}
                          onClick={() => move(i, i + 1)}
                        >
                          <ChevronDown />
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("cfields.editField", { label: f.label || f.key })}
                          data-testid="edit-field"
                          onClick={() => setEditing({ row: r, field: f })}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("cfields.deleteField", { label: f.label || f.key })}
                          onClick={() => setRemoving(r)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p id="field-reorder-help" className="text-xs text-muted-foreground">
            {isAdmin ? t("cfields.reorderHelp") : t("cfields.readOnlyHelp")}
          </p>
          <p className="sr-only" role="status" aria-live="polite">
            {announce}
          </p>

          {serverError && (
            <p role="alert" className="text-sm text-destructive" data-testid="form-error">
              {serverError}
            </p>
          )}

          {isAdmin && (
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <Button
                type="button"
                disabled={!dirty || saving.isLoading}
                onClick={commit}
                data-testid="save-form"
              >
                <Save /> {saving.isLoading ? t("cfields.saving") : t("cfields.save")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!dirty || saving.isLoading}
                onClick={() => {
                  setRows(toRows(saved));
                  setServerError(null);
                }}
              >
                <RotateCcw /> {t("cfields.discard")}
              </Button>
              {dirty && <span className="text-xs text-muted-foreground">{t("cfields.unsaved")}</span>}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="lg:sticky lg:top-4">
        <FormPreview fields={fields} />
      </div>

      {editing && (
        <FieldEditor
          key={editing.row?.uid ?? "new"}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          initial={editing.field}
          locked={!!editing.row && savedKeys.has(editing.row.field.key)}
          takenKeys={new Set(rows.filter((r) => r !== editing.row).map((r) => r.field.key))}
          onSave={(field) => {
            const row = editing.row;
            setRows((cur) =>
              row ? cur.map((r) => (r === row ? { ...r, field } : r)) : [...cur, ...toRows([field])],
            );
            if (!row) setAnnounce(t("cfields.added", { label: field.label }));
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("cfields.deleteTitle", { label: removing?.field.label ?? "" })}
        description={
          savedKeys.has(removing?.field.key ?? "")
            ? t("cfields.deleteSavedDescription")
            : t("cfields.deleteDescription")
        }
        confirmLabel={t("cfields.deleteConfirm")}
        onConfirm={() => {
          setRows((cur) => cur.filter((r) => r !== removing));
          setRemoving(null);
        }}
      />
      <ConfirmDialog
        open={confirmSave !== null}
        onOpenChange={(o) => !o && setConfirmSave(null)}
        title={t("cfields.confirmSaveTitle")}
        description={
          <>
            {tn("cfields.confirmSaveDescription", confirmSave?.length ?? 0)}
            <span className="mt-2 block font-medium">{confirmSave?.join(", ")}</span>
          </>
        }
        confirmLabel={t("cfields.confirmSave")}
        pending={saving.isLoading}
        onConfirm={commit}
      />
      <ImportDialog
        open={importing}
        onOpenChange={setImporting}
        onImport={(list) => {
          setRows(toRows(list));
          setServerError(null);
          setImporting(false);
          toast.success(t("cfields.imported", { n: list.length }));
        }}
      />
    </div>
  );
}

/** Paste a form exported from another project (or written by hand): checked with the same rules as a save. */
function ImportDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (fields: CustomFieldBase[]) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  const run = () => {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      setError(t("cfields.importBadJson"));
      return;
    }
    // Either `{ "fields": [...] }` (an export) or the bare list.
    const list = Array.isArray(json) ? json : (json as { fields?: unknown } | null)?.fields;
    const parsed = customFieldsReplace.safeParse({ fields: list });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const at = issue && typeof issue.path[1] === "number" ? ` (#${issue.path[1] + 1})` : "";
      setError(`${issue?.message ?? t("cfields.errGeneric")}${at}`);
      return;
    }
    // The parsed values carry every default, in the shape the builder edits.
    onImport(parsed.data.fields);
    setText("");
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("cfields.importTitle")}</DialogTitle>
          <DialogDescription>{t("cfields.importDescription")}</DialogDescription>
        </DialogHeader>
        <Textarea
          ref={ref}
          rows={10}
          className="font-mono text-xs"
          value={text}
          aria-label={t("cfields.importLabel")}
          aria-invalid={error ? true : undefined}
          placeholder='{ "fields": [ { "key": "order", "type": "text", "label": "Order number" } ] }'
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
        {error && (
          <p role="alert" className="text-sm text-destructive" data-testid="import-error">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("cfields.cancel")}
          </Button>
          <Button type="button" disabled={!text.trim()} onClick={run} data-testid="import-run">
            {t("cfields.importRun")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
