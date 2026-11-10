"use client";

import type { ApiDashboard, AppRole } from "@pinwren/core";
import { useEffect, useRef, useState } from "react";
import {
  useCreateDashboardMutation,
  useDashboardsQuery,
  useDeleteDashboardMutation,
  useDuplicateDashboardMutation,
  useUpdateDashboardMutation,
  useUpdateWorkspacePreferencesMutation,
  useWorkspacePreferencesQuery,
} from "@/lib/store/api/dashboards";
import { defaultLayout, type Layout, normaliseLayout, sameLayout, type Scope } from "./catalog";
import { canEditDashboard, resolveActive } from "./resolve";
import { useLayoutCache, useLegacyLayout } from "./storage";

// The dashboards of one screen for the signed-in person (ADR 0029): the server list (own and shared), which
// one is open, and the actions on it. Layout edits go straight to the server (optimistically); a screen the
// server has not answered yet shows the last layout cached in the browser, and the pre-server localStorage
// layout is imported once into the account.

export type DashboardsApi = ReturnType<typeof useDashboards>;

export function useDashboards({
  scope,
  userId,
  role,
  isAdmin,
  selectedId,
  defaultName,
  onError,
}: {
  scope: Scope;
  userId: string | undefined;
  role: AppRole | undefined;
  isAdmin: boolean;
  /** The dashboard picked in the tabs or the link, if any. */
  selectedId: string | null;
  /** Name for the dashboard created by a person's first edit or the import of their old layout. */
  defaultName: string;
  onError: (e: unknown) => void;
}) {
  const query = useDashboardsQuery(scope, { skip: !userId });
  const prefs = useWorkspacePreferencesQuery(undefined, { skip: !userId });
  const [createRow] = useCreateDashboardMutation();
  const [updateRow] = useUpdateDashboardMutation();
  const [deleteRow] = useDeleteDashboardMutation();
  const [duplicateRow] = useDuplicateDashboardMutation();
  const [updatePrefs] = useUpdateWorkspacePreferencesMutation();
  const legacy = useLegacyLayout(userId, scope, role);
  const { cached, remember } = useLayoutCache(userId, scope, role);
  /** A layout being saved for the first time: shown until the new row is in the list. */
  const [pending, setPending] = useState<{ layout: Layout; createdId: string | null } | null>(null);
  const creating = useRef<Promise<string | null> | null>(null);

  const rows = query.data?.dashboards;
  const loaded = rows !== undefined;
  const defaultId = prefs.data?.preferences.dashboardDefaults[scope];
  const { dashboard: active, source } = resolveActive({
    dashboards: rows ?? [],
    selectedId,
    defaultId,
    role,
  });

  const builtin = defaultLayout(scope, role);
  const stored = active ? normaliseLayout(active.layout, scope, role) : null;
  const fallback = legacy.layout ?? cached ?? builtin;
  const base = loaded ? (stored ?? legacy.layout ?? builtin) : fallback;
  const live =
    pending && !(pending.createdId && rows?.some((r) => r.id === pending.createdId)) ? pending : null;
  const layout = live ? live.layout : base;
  const editable = canEditDashboard(active, isAdmin);

  // Remember what is on screen for the next visit (and for when the server cannot be reached).
  const shown = JSON.stringify(layout);
  useEffect(() => {
    if (loaded && active) remember(JSON.parse(shown) as Layout);
  }, [loaded, active, shown, remember]);

  // One-time import of the layout the browser kept before dashboards lived on the server.
  const importing = useRef(false);
  const legacyLayout = legacy.layout;
  const retire = legacy.retire;
  useEffect(() => {
    if (!loaded || !userId || !legacyLayout || importing.current) return;
    if (rows.some((r) => r.mine)) {
      retire(); // the account already has its own dashboards: the old copy is stale
      return;
    }
    importing.current = true;
    createRow({ scope, name: defaultName, layout: legacyLayout })
      .unwrap()
      .then(retire)
      .catch(() => {
        importing.current = false; // try again on the next visit
      });
  }, [loaded, userId, legacyLayout, rows, retire, createRow, scope, defaultName]);

  const fail = onError;

  /** Save a layout: onto the open dashboard, or as the person's first one. */
  const save = async (next: Layout) => {
    if (!userId) return;
    if (!loaded) {
      remember(next); // the server is unreachable: keep it on this device
      return;
    }
    try {
      if (active) {
        if (!editable) return;
        await updateRow({ id: active.id, scope, patch: { layout: next } }).unwrap();
        return;
      }
      if (creating.current) {
        // Another edit arrived while the first one is still being created: follow it up.
        setPending((p) => ({ layout: next, createdId: p?.createdId ?? null }));
        const id = await creating.current;
        if (id) await updateRow({ id, scope, patch: { layout: next } }).unwrap();
        return;
      }
      setPending({ layout: next, createdId: null });
      const run = createRow({ scope, name: defaultName, layout: next })
        .unwrap()
        .then((r) => r.dashboard.id);
      creating.current = run.catch(() => null).finally(() => (creating.current = null));
      const id = await run;
      setPending((p) => (p ? { ...p, createdId: id } : p));
      retire();
    } catch (e) {
      setPending(null);
      fail(e);
    }
  };

  return {
    loaded,
    /** Edits wait for the first answer (or its failure, which falls back to this device). */
    ready: loaded || query.isError,
    isError: query.isError && !loaded,
    refetch: query.refetch,
    /** Every dashboard of the screen the person can open: own first, then the workspace's. */
    dashboards: rows ?? [],
    active,
    source,
    layout,
    editable,
    defaultId,
    /** Whether the open dashboard differs from what a person who never customised would see. */
    customised: active !== null && !sameLayout(layout, roleDefaultLayout(rows, scope, role) ?? builtin),
    save,
    /** Back to the starting point: the role's published default, or the built-in layout. */
    reset: () => save(roleDefaultLayout(rows, scope, role) ?? builtin),
    create: async (name: string, from?: Layout): Promise<ApiDashboard> =>
      (await createRow({ scope, name, layout: from ?? layout }).unwrap()).dashboard,
    rename: async (id: string, name: string) => {
      await updateRow({ id, scope, patch: { name } }).unwrap();
    },
    duplicate: async (id: string, name?: string): Promise<ApiDashboard> =>
      (await duplicateRow({ id, scope, ...(name ? { name } : {}) }).unwrap()).dashboard,
    remove: async (id: string) => {
      setPending(null); // a layout saved a moment ago must not come back once its dashboard is gone
      await deleteRow({ id, scope }).unwrap();
    },
    makeDefault: async (id: string | null) => {
      await updatePrefs({ dashboardDefaults: { [scope]: id } }).unwrap();
    },
    publish: async (id: string, shared: boolean, defaultRoles: AppRole[]) => {
      await updateRow({ id, scope, patch: { shared, defaultRoles } }).unwrap();
    },
  };
}

/** The layout published as the default for a role on a screen, if the workspace set one. */
function roleDefaultLayout(
  rows: readonly ApiDashboard[] | undefined,
  scope: Scope,
  role: AppRole | undefined,
) {
  const d = role ? rows?.find((r) => r.shared && r.defaultRoles.includes(role)) : undefined;
  return d ? normaliseLayout(d.layout, scope, role) : null;
}
