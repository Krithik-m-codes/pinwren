"use client";

import { useEffect } from "react";
import { DEFAULT_LANDING, landingCookie, readLandingCookie } from "@/lib/landing";
import { useUiStateQuery, useUpdateUiStateMutation } from "@/lib/store/api/dashboards";

/**
 * Keeps the start-page cookie (which `/` reads on the server) equal to the account's choice, and moves a
 * choice made on this device before it was stored on the account (ADR 0037) up to the account.
 */
export function UiStateSync() {
  const { data } = useUiStateQuery(undefined);
  const [save] = useUpdateUiStateMutation();
  const startPage = data?.uiState.startPage;
  useEffect(() => {
    if (!data) return;
    const cookie = readLandingCookie(document.cookie);
    if (startPage && startPage !== cookie) document.cookie = landingCookie(startPage);
    else if (!startPage && cookie !== DEFAULT_LANDING) void save({ startPage: cookie });
  }, [data, startPage, save]);
  return null;
}
