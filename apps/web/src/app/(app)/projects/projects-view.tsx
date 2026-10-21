"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderPlus, Globe } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { timeAgo } from "@/components/feedback-meta";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Project } from "@/lib/api";
import { here } from "@/lib/routes";

export function ProjectsView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<{ projects: Project[] }>("/projects"),
  });
  const creating = params.get("new") === "1";
  const setCreating = (open: boolean) => router.replace(here(pathname, open ? "new=1" : undefined));

  return (
    <>
      <PageHeader title="Projects">
        <Button size="sm" onClick={() => setCreating(true)}>
          <FolderPlus /> New project
        </Button>
      </PageHeader>
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {projects.isPending && [0, 1, 2].map((i) => <Skeleton key={i} className="h-36" />)}
        {projects.data?.projects.map((p) => (
          <Link key={p.id} href={`/projects/${p.id}`} className="group">
            <Card className="h-full transition-colors group-hover:border-foreground/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {p.name}
                  {p.lastSeenAt ? (
                    <Badge variant="secondary" className="ml-auto gap-1 font-normal">
                      <span className="size-1.5 rounded-full bg-emerald-500" /> Installed
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="ml-auto font-normal">
                      Not installed
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="flex items-center gap-1.5 truncate">
                  <Globe className="size-3.5 shrink-0" />
                  {p.allowedOrigins.join(", ") || "No allowed sites yet"}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  <span className="font-medium text-foreground tabular-nums">{p.openCount ?? 0}</span> open
                </span>
                <span>
                  {p.lastSeenAt ? `Seen ${timeAgo(p.lastSeenAt)}` : `Created ${timeAgo(p.createdAt)}`}
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
        {projects.data?.projects.length === 0 && (
          <Card className="sm:col-span-2 xl:col-span-3">
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <FolderPlus className="size-6 text-muted-foreground" />
              <p className="font-medium">Create your first project</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                A project is one website. You&apos;ll get a script tag to add the feedback widget to it.
              </p>
              <Button size="sm" onClick={() => setCreating(true)}>
                New project
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function CreateProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState("");
  const [site, setSite] = useState("");
  const create = useMutation({
    mutationFn: () => {
      const host = site
        .trim()
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, "");
      return api<{ project: Project }>("/projects", {
        method: "POST",
        json: { name: name.trim(), allowedOrigins: host ? [host] : [] },
      });
    },
    onSuccess: ({ project }) => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
      router.push(`/projects/${project.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>One project per website. You can allow more domains later.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="p-name">Name</Label>
            <Input
              id="p-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Marketing site"
              required
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog's only field; focus moves into a dialog on open
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="p-site">Website domain</Label>
            <Input
              id="p-site"
              value={site}
              onChange={(e) => setSite(e.target.value)}
              placeholder="www.example.com"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
