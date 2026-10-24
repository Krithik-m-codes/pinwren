"use client";

import { Check, ChevronsUpDown, Plus, Settings } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { controlProps, Field, FormError, useZodForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { workspaceNameForm } from "@/lib/account-forms";
import { authClient } from "@/lib/auth-client";
import { useWorkspacesQuery } from "@/lib/store/api/people";

/** A unique-enough slug for a new workspace (Better Auth needs one; people never see it). */
const workspaceSlug = (name: string) =>
  `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "workspace"
  }-${Math.random().toString(36).slice(2, 6)}`;

/**
 * Make another workspace active, then load the app again: the session cookie changes, and the Redux store,
 * router cache and server components all belong to the old workspace.
 */
async function switchTo(orgId: string, path = "/inbox") {
  await authClient.organization.setActive({ organizationId: orgId });
  window.location.assign(new URL(path, window.location.href).href);
}

/**
 * The sidebar brand doubles as the workspace switcher (wave-5 §3.1): every workspace the person belongs to,
 * a way to create another, and the workspace's settings. `children` is the brand block (server-rendered).
 */
export function WorkspaceSwitcher({ orgId, children }: { orgId: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  // Fetched when the menu first opens; the brand itself needs nothing from it.
  const [wanted, setWanted] = useState(false);
  const list = useWorkspacesQuery(undefined, { skip: !wanted });

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) setWanted(true);
        }}
      >
        <DropdownMenuTrigger
          render={
            <SidebarMenuButton
              size="lg"
              className="data-popup-open:bg-sidebar-accent"
              aria-label="Switch workspace"
              data-testid="workspace-switcher"
            />
          }
        >
          {children}
          <ChevronsUpDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            {list.isLoading || list.isUninitialized ? (
              <div className="grid gap-1 p-1">
                <Skeleton className="h-7" />
                <Skeleton className="h-7" />
              </div>
            ) : list.isError ? (
              <DropdownMenuItem onClick={() => void list.refetch()}>
                Couldn&apos;t load. Try again
              </DropdownMenuItem>
            ) : (
              list.data.map((w) => (
                <DropdownMenuItem
                  key={w.id}
                  data-org-id={w.id}
                  disabled={!!switching}
                  onClick={() => {
                    if (w.id === orgId) return;
                    setSwitching(w.id);
                    void switchTo(w.id);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  {w.id === orgId ? (
                    <Check className="size-4" aria-label="Current workspace" />
                  ) : switching === w.id ? (
                    <span className="text-xs text-muted-foreground">Opening…</span>
                  ) : null}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreating(true)}>
            <Plus /> Create workspace
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/settings/workspace" />}>
            <Settings /> Workspace settings
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const form = useZodForm(workspaceNameForm, { defaultValues: { name: "" } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async ({ name }) => {
    const { data, error } = await authClient.organization.create({ name, slug: workspaceSlug(name) });
    if (error) {
      form.setError("root", { message: error.message ?? "Couldn't create the workspace" });
      return;
    }
    // Its first project is the next step.
    await switchTo(data.id, "/projects");
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) form.reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Create a workspace</DialogTitle>
            <DialogDescription>
              A separate team with its own projects, users and settings. You&apos;ll be its owner.
            </DialogDescription>
          </DialogHeader>
          <Field id="new-workspace" label="Workspace name" error={errors.name?.message}>
            <Input
              {...controlProps("new-workspace", errors.name?.message)}
              {...form.register("name")}
              placeholder="Acme Studio"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog's only field
              autoFocus
            />
          </Field>
          <FormError message={errors.root?.message} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating…" : "Create workspace"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
