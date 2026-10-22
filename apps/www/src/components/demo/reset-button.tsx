"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Throws the visitor's sandbox away and reloads, so the seeded review starts over. */
export function ResetDemoButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/demo-api/reset", { method: "POST" });
        } finally {
          location.reload();
        }
      }}
    >
      <RotateCcw aria-hidden />
      {busy ? "Resetting…" : "Reset demo"}
    </Button>
  );
}
