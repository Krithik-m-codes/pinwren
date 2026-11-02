"use client";

import { useT } from "@/lib/i18n/provider";
import { useEntitlementsQuery, useMeQuery } from "@/lib/store/api";

/** Catalogue key per edition. The edition itself comes from the server (mode and licence), never from here. */
const EDITION_KEY = {
  community: "edition.community",
  enterprise: "edition.enterprise",
} as const;

/**
 * The edition next to the logo: "Community Edition" or "Enterprise Edition". Pinwren Cloud shows nothing
 * (it is not an edition people choose). A dot marks that an update is waiting for an instance admin.
 */
export function EditionPill() {
  const t = useT();
  const edition = useEntitlementsQuery(undefined).data?.edition;
  const updateWaiting = !!useMeQuery(undefined).data?.update;
  if (edition !== "community" && edition !== "enterprise") return null;
  return (
    <span
      className="relative inline-flex shrink-0 items-center rounded-full border border-border bg-muted px-1.5 py-px text-[0.625rem] leading-4 font-medium text-muted-foreground"
      data-testid="edition-pill"
      title={updateWaiting ? t("edition.updateWaiting") : undefined}
    >
      {t(EDITION_KEY[edition])}
      {updateWaiting && (
        <>
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary ring-2 ring-sidebar"
            data-testid="edition-update-dot"
          />
          <span className="sr-only">{t("edition.updateWaiting")}</span>
        </>
      )}
    </span>
  );
}
