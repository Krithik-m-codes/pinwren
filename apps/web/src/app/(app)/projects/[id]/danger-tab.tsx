"use client";

import { Archive, ArchiveRestore, KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProjectDetail } from "@/lib/api";
import { errorMessage, useRotateProjectKeyMutation } from "@/lib/store/api";
import { useT } from "@/lib/i18n/provider";
import { useProjectPatch } from "./use-project";

export function DangerTab({ project: p }: { project: ProjectDetail }) {
  const t = useT();
  const router = useRouter();
  const save = useProjectPatch(p.id);
  const [confirm, setConfirm] = useState<"rotate" | "archive" | null>(null);
  const [rotateKey, rotation] = useRotateProjectKeyMutation();
  const rotate = () => {
    rotateKey(p.id)
      .unwrap()
      .then(() => {
        setConfirm(null);
        toast.success(t("projects2.newKeyGenerated"), {
          description: t("projects2.newKeyGeneratedDescription"),
        });
      })
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };
  const archived = !!p.archivedAt;

  return (
    <Card className="max-w-3xl ring-destructive/20">
      <CardHeader>
        <CardTitle>{t("projects2.dangerZone")}</CardTitle>
        <CardDescription>{t("projects2.dangerZoneDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <SettingGroup>
          <SettingRow
            label={t("projects2.rotateProjectKey")}
            description={
              <>
                {t("projects2.currentKey")} <code className="font-mono text-foreground">{p.publicKey}</code>.{" "}
                {t("projects2.oldKeyStopsAtOnce")}
              </>
            }
          >
            <Button variant="outline" onClick={() => setConfirm("rotate")}>
              <KeyRound /> {t("projects2.rotateKey")}
            </Button>
          </SettingRow>
          <SettingRow
            label={archived ? t("projects2.restoreThisProject") : t("projects2.archiveThisProject")}
            description={archived ? t("projects2.restoreDescription") : t("projects2.archiveDescription")}
          >
            {archived ? (
              <Button
                variant="outline"
                onClick={() =>
                  save.mutate({ patch: { archived: false }, message: t("projects2.projectRestored") })
                }
              >
                <ArchiveRestore /> {t("projects2.restore")}
              </Button>
            ) : (
              <Button variant="destructive" onClick={() => setConfirm("archive")}>
                <Archive /> {t("projects2.archive")}
              </Button>
            )}
          </SettingRow>
        </SettingGroup>
      </CardContent>
      <ConfirmDialog
        open={confirm === "rotate"}
        onOpenChange={(o) => setConfirm(o ? "rotate" : null)}
        title={t("projects2.rotateProjectKeyQuestion")}
        description={t("projects2.rotateConfirmDescription")}
        confirmLabel={t("projects2.rotateKey")}
        pending={rotation.isLoading}
        onConfirm={rotate}
      />
      <ConfirmDialog
        open={confirm === "archive"}
        onOpenChange={(o) => setConfirm(o ? "archive" : null)}
        title={t("projects2.archiveNameQuestion", { name: p.name })}
        description={t("projects2.archiveConfirmDescription")}
        confirmLabel={t("projects2.archiveProject")}
        pending={save.isPending}
        onConfirm={() =>
          save.mutate(
            { patch: { archived: true }, message: t("projects2.projectArchived") },
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
