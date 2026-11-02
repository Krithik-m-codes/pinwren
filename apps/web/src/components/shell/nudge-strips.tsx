"use client";

import { ArrowUpCircle, Heart, Star, X } from "lucide-react";
import { useEffect, useState } from "react";
import { safeHref } from "@pinwren/core";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";
import { useEntitlementsQuery } from "@/lib/store/api";
import { useNudgeState } from "@/lib/nudges/storage";
import {
  REPO_URL,
  SPONSOR_URL,
  SUPPORT_ACTED_SNOOZE_DAYS,
  SUPPORT_SNOOZE_DAYS,
  snoozeUntil,
  supportCardVisible,
  updateStripVisible,
  versionNumber,
} from "@/lib/nudges/state";
import { useViewer } from "@/lib/viewer";

const strip =
  "flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-primary/20 bg-primary/5 px-4 py-2 text-sm";
const link = "font-medium underline-offset-4 hover:underline";

/**
 * "A newer Pinwren is out" for instance admins, one dismissal per release. The server decides who may see
 * it (`/me`.update is null for everyone else, in Cloud, and with PINWREN_NUDGES=false). It never blocks
 * anything: a thin strip with a release-notes link and the update command.
 */
export function UpdateStrip() {
  const { t } = useI18n();
  const { me, userId } = useViewer();
  const { state, patch } = useNudgeState(userId);
  const update = me?.update;
  if (!me?.nudges || !update?.latest || !updateStripVisible(state, update.latest)) return null;
  const notes = safeHref(update.url);
  const latest = update.latest;
  return (
    <div role="status" data-testid="update-strip" className={strip}>
      <ArrowUpCircle className="size-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        {t("edition.updateStrip", { latest: versionNumber(latest), current: versionNumber(me.version) })}{" "}
        <span className="text-muted-foreground">{t("edition.updateHow")}</span>{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">
          docker compose pull &amp;&amp; docker compose up -d
        </code>
      </span>
      {notes && (
        <a href={notes} target="_blank" rel="noopener noreferrer" className={link}>
          {t("edition.releaseNotes")}
        </a>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("edition.dismiss")}
        data-testid="update-strip-dismiss"
        onClick={() => patch({ dismissedUpdate: latest })}
      >
        <X />
      </Button>
    </div>
  );
}

/**
 * A rare, polite ask to star the repository or sponsor the project. Instance admins on a Community install
 * only, after two weeks of use, at most once a month, dismissible, with "don't ask again". Never on Cloud.
 */
export function SupportNudge() {
  const { t } = useI18n();
  const { me, userId } = useViewer();
  const community = useEntitlementsQuery(undefined).data?.edition === "community";
  const { state, patch } = useNudgeState(userId);
  // The clock is read once per mount: render stays pure and the strip does not flicker at a boundary.
  const [now] = useState(() => Date.now());
  const eligible = !!me?.nudges && me.instanceAdmin && community;
  useEffect(() => {
    if (eligible && !state.firstSeen) patch({ firstSeen: new Date().toISOString() });
  }, [eligible, state.firstSeen, patch]);
  if (!eligible || !supportCardVisible(state, now)) return null;
  const acted = () => patch({ supportSnoozedUntil: snoozeUntil(Date.now(), SUPPORT_ACTED_SNOOZE_DAYS) });
  return (
    <div role="status" data-testid="support-nudge" className={strip}>
      <Heart className="size-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">{t("edition.supportText")}</span>
      <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={link} onClick={acted}>
        <Star className="mr-1 inline size-3.5" />
        {t("edition.star")}
      </a>
      <a href={SPONSOR_URL} target="_blank" rel="noopener noreferrer" className={link} onClick={acted}>
        <Heart className="mr-1 inline size-3.5" />
        {t("edition.sponsor")}
      </a>
      <Button
        variant="ghost"
        size="xs"
        data-testid="support-nudge-never"
        onClick={() => patch({ supportOptOut: true })}
      >
        {t("edition.dontAskAgain")}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("edition.dismiss")}
        data-testid="support-nudge-dismiss"
        onClick={() => patch({ supportSnoozedUntil: snoozeUntil(Date.now(), SUPPORT_SNOOZE_DAYS) })}
      >
        <X />
      </Button>
    </div>
  );
}
