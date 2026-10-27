"use client";

import { TriangleAlert } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/lib/i18n/provider";

/** A secret the API returns exactly once (API token, webhook signing secret). */
export function SecretDialog({
  secret,
  title,
  description,
  onClose,
}: {
  secret: string | null;
  title: string;
  description: React.ReactNode;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Dialog open={!!secret} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-2 pl-3">
          <code className="min-w-0 flex-1 font-mono text-xs break-all select-all" data-testid="secret-value">
            {secret}
          </code>
          <CopyButton value={secret ?? ""} label={t("components2.copy")} size="sm" variant="outline" />
        </div>
        <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          {t("components2.secretOnce")}
        </p>
        <DialogFooter>
          <Button onClick={onClose}>{t("components2.secretSaved")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
