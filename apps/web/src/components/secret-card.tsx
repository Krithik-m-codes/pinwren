"use client";

import { Eye, KeyRound, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { errorMessage } from "@/lib/store/api";

/**
 * A project secret an admin can reveal and rotate (webhook-action signing, signed identity). The value
 * is fetched only when asked for and kept in this component, never in the store.
 */
export function SecretCard({
  title,
  description,
  hasSecret,
  reveal,
  rotate,
  testId,
  rotateTitle,
  rotateDescription,
  rotatedMessage,
  children,
}: {
  title: string;
  description: React.ReactNode;
  hasSecret: boolean;
  reveal: () => Promise<{ secret: string }>;
  rotate: () => Promise<{ secret: string }>;
  testId: string;
  rotateTitle: string;
  rotateDescription: string;
  rotatedMessage: string;
  children?: React.ReactNode;
}) {
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState<"reveal" | "rotate" | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const run = (kind: "reveal" | "rotate") => {
    setBusy(kind);
    (kind === "reveal" ? reveal() : rotate())
      .then((r) => {
        setSecret(r.secret);
        if (kind === "rotate") {
          setConfirmRotate(false);
          toast.success(rotatedMessage);
        }
      })
      .catch((e: unknown) => toast.error(errorMessage(e)))
      .finally(() => setBusy(null));
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {secret ? (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-2 pl-3">
            <code className="min-w-0 flex-1 font-mono text-xs break-all select-all" data-testid={testId}>
              {secret}
            </code>
            <CopyButton value={secret} label="Copy" size="sm" variant="outline" />
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <KeyRound className="size-4" />
            {hasSecret ? "A secret is set." : "Created the first time you reveal it."}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {!secret && (
            <Button variant="outline" size="sm" disabled={busy === "reveal"} onClick={() => run("reveal")}>
              <Eye /> Reveal secret
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setConfirmRotate(true)}>
            <RefreshCw /> Rotate
          </Button>
        </div>
        {children}
      </CardContent>
      <ConfirmDialog
        open={confirmRotate}
        onOpenChange={setConfirmRotate}
        title={rotateTitle}
        description={rotateDescription}
        confirmLabel="Rotate"
        pending={busy === "rotate"}
        onConfirm={() => run("rotate")}
      />
    </Card>
  );
}
