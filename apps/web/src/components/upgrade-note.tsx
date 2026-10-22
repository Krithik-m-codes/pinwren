import { Sparkles } from "lucide-react";

const NAMES: Record<string, string> = { white_label: "White-label" };

/**
 * A setting that only takes effect with an Enterprise licence feature (ADR 0019): it is still saved, so
 * nothing is lost, and applies as soon as a licence with the feature is installed.
 */
export function UpgradeNote({ feature, applied }: { feature: string; applied?: boolean }) {
  return (
    <span
      className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400"
      data-testid="upgrade-note"
    >
      <Sparkles className="mt-px size-3.5 shrink-0" />
      <span>
        {NAMES[feature] ?? feature} is an Enterprise feature.{" "}
        {applied
          ? "Your choice is saved and takes effect once a licence with it is installed."
          : "You can set it now; it takes effect once a licence with it is installed (Settings › Licence)."}
      </span>
    </span>
  );
}
