"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export async function copyText(text: string, message = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
    return true;
  } catch {
    toast.error("Couldn't copy — select the text and copy it manually");
    return false;
  }
}

export function CopyButton({
  value,
  label = "Copy",
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
          toast.error("Couldn't copy — select the text and copy it manually");
        }
      }}
    >
      {icon}
      {size === "sm" && (copied ? "Copied" : label)}
    </Button>
  );
}
