"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { type TFn, tEn } from "@/lib/i18n/english";
import { useT } from "@/lib/i18n/provider";

/** `t` defaults to English for callers outside a translated tree; pass the component's `t` to translate the toasts. */
export async function copyText(text: string, message?: string, t: TFn = tEn) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message ?? t("components2.copied"));
    return true;
  } catch {
    toast.error(t("components2.copyFailed"));
    return false;
  }
}

export function CopyButton({
  value,
  label: labelProp,
  size = "icon-sm",
  variant = "ghost",
  className,
}: {
  value: string;
  label?: string;
  size?: "icon-sm" | "sm" | "icon-xs";
  variant?: "ghost" | "outline";
  className?: string;
}) {
  const t = useT();
  const label = labelProp ?? t("components2.copy");
  const [copied, setCopied] = useState(false);
  const icon = copied ? <Check /> : <Copy />;
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error(t("components2.copyFailed"));
        }
      }}
    >
      {icon}
      {size === "sm" && (copied ? t("components2.copied") : label)}
    </Button>
  );
}
