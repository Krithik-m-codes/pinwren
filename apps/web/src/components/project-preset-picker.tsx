"use client";

import { Globe, MessagesSquare } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Key } from "@/lib/i18n/en";
import { useT } from "@/lib/i18n/provider";
import type { ProjectPreset } from "@/lib/store/api/onboarding";
import { cn } from "@/lib/utils";

const PRESETS: { value: ProjectPreset; title: Key; description: Key; icon: typeof Globe }[] = [
  {
    value: "public-site",
    title: "components1.presetPublicTitle",
    description: "components1.presetPublicDescription",
    icon: Globe,
  },
  {
    value: "review",
    title: "components1.presetReviewTitle",
    description: "components1.presetReviewDescription",
    icon: MessagesSquare,
  },
];

/**
 * "What is this site for?" when a project is created (wave-5 §3.5): picks who sees pins on the page. Both
 * can be changed later on Project › Privacy & data. Base UI ToggleGroup, so arrow keys move between them.
 */
export function ProjectPresetPicker({
  value,
  onChange,
  id,
}: {
  value: ProjectPreset;
  onChange: (v: ProjectPreset) => void;
  id?: string;
}) {
  const t = useT();
  return (
    <ToggleGroup
      id={id}
      aria-label={t("components1.presetLabel")}
      value={[value]}
      onValueChange={(v) => {
        const next = v[0] as ProjectPreset | undefined;
        if (next && next !== value) onChange(next);
      }}
      spacing={2}
      className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2"
    >
      {PRESETS.map((p) => (
        <ToggleGroupItem
          key={p.value}
          value={p.value}
          variant="outline"
          data-testid={`preset-${p.value}`}
          className={cn(
            "h-auto w-full flex-col items-start justify-start gap-1 rounded-lg! px-3 py-2.5 text-left whitespace-normal",
            "aria-pressed:border-primary aria-pressed:bg-primary/5 aria-pressed:ring-1 aria-pressed:ring-primary/40",
          )}
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <p.icon className="size-4 text-muted-foreground" />
            {t(p.title)}
          </span>
          <span className="text-xs font-normal text-muted-foreground">{t(p.description)}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
