"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, type ProjectDetail, qk } from "@/lib/api";
import { useProjectPatch } from "./use-project";

export function DangerTab({ project: p }: { project: ProjectDetail }) {
  const qc = useQueryClient();
  const router = useRouter();
  const save = useProjectPatch(p.id);
  const [confirm, setConfirm] = useState<"rotate" | "archive" | null>(null);
  const rotate = useMutation({
    mutationFn: () => api<{ project: ProjectDetail }>(`/projects/${p.id}/rotate-key`, { method: "POST" }),
    onSuccess: ({ project }) => {
      qc.setQueryData(qk.project(p.id), { project });
      setConfirm(null);
      toast.success("New key generated", {
        description: "Update the snippet on your site — the old key stopped working.",
      });
    },
    onError: (e) => toast.error(e.message),
  });
  const archived = !!p.archivedAt;

  return (
    <Card className="max-w-3xl ring-destructive/20">
      <CardHeader>
        <CardTitle>Danger zone</CardTitle>
        <CardDescription>These take effect on your site immediately.</CardDescription>
      </CardHeader>
      <CardContent>
        <SettingGroup>
          <SettingRow
            label="Rotate the project key"
            description={
              <>
                Current key <code className="font-mono text-foreground">{p.publicKey}</code>. The old key
                stops working at once, so the widget is offline until you update the snippet.
              </>
            }
          >
            <Button variant="outline" onClick={() => setConfirm("rotate")}>
              <KeyRound /> Rotate key
            </Button>
          </SettingRow>
          <SettingRow
            label={archived ? "Restore this project" : "Archive this project"}
            description={
              archived
                ? "Turns the widget back on and lists the project again. Feedback was kept."
                : "Switches the widget off and hides the project. Feedback is kept and you can restore it any time."
            }
          >
            {archived ? (
              <Button
                variant="outline"
                onClick={() => save.mutate({ patch: { archived: false }, message: "Project restored" })}
              >
                <ArchiveRestore /> Restore
              </Button>
            ) : (
              <Button variant="destructive" onClick={() => setConfirm("archive")}>
                <Archive /> Archive
              </Button>
            )}
          </SettingRow>
        </SettingGroup>
      </CardContent>
      <ConfirmDialog
        open={confirm === "rotate"}
        onOpenChange={(o) => setConfirm(o ? "rotate" : null)}
        title="Rotate the project key?"
        description="The widget on your site stops working until you replace the key in the snippet."
        confirmLabel="Rotate key"
        pending={rotate.isPending}
        onConfirm={() => rotate.mutate()}
      />
      <ConfirmDialog
        open={confirm === "archive"}
        onOpenChange={(o) => setConfirm(o ? "archive" : null)}
        title={`Archive ${p.name}?`}
        description="The widget stops loading on your site and the project leaves your lists. You can restore it from this page."
        confirmLabel="Archive project"
        pending={save.isPending}
        onConfirm={() =>
          save.mutate(
            { patch: { archived: true }, message: "Project archived" },
            {
              onSuccess: () => {
                setConfirm(null);
                router.push("/projects");
              },
            },
          )
        }
      />
    </Card>
  );
}
