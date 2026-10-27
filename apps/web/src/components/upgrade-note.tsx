import { Sparkles } from "lucide-react";
import type { Key } from "@/lib/i18n/en";
import { useT } from "@/lib/i18n/provider";

const NAMES: Record<string, Key> = { white_label: "components1.whiteLabel" };

/**
 * A setting that only takes effect with an Enterprise licence feature (ADR 0019): it is still saved, so
 * nothing is lost, and applies as soon as a licence with the feature is installed.
 */
export function UpgradeNote({ feature, applied }: { feature: string; applied?: boolean }) {
  const t = useT();
  const nameKey = NAMES[feature];
  return (
    <span
      className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400"
      data-testid="upgrade-note"
    >
      <Sparkles className="mt-px size-3.5 shrink-0" />
      <span>
        {t("components1.enterpriseFeature", { name: nameKey ? t(nameKey) : feature })}{" "}
        {applied ? t("components1.upgradeApplied") : t("components1.upgradeNotApplied")}
      </span>
    </span>
  );
}
