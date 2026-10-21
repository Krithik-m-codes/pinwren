"use client";

import { originMatches } from "@annota/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Inbox, KeyRound, Plus, X } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { toast } from "sonner";
import { timeAgo } from "@/components/feedback-meta";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, type Project } from "@/lib/api";

export function ProjectSettings({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["project", id],
    queryFn: () => api<{ project: Project }>(`/projects/${id}`),
    // Poll until the widget pings /w/config, so "Waiting for your site" flips live (blueprint 06 §3.5).
    refetchInterval: (q) => (q.state.data?.project.lastSeenAt ? false : 4000),
  });
  const save = useMutation({
    mutationFn: (patch: Partial<Pick<Project, "name" | "allowedOrigins" | "publicRead">>) =>
      api<{ project: Project }>(`/projects/${id}`, { method: "PATCH", json: patch }),
    onSuccess: ({ project }) => {
      qc.setQueryData(["project", id], { project });
      void qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Saved");
    },
    onError: (e) => toast.error(e.message),
  });
  const rotate = useMutation({
    mutationFn: () => api<{ project: Project }>(`/projects/${id}/rotate-key`, { method: "POST" }),
    onSuccess: ({ project }) => {
      qc.setQueryData(["project", id], { project });
      toast.success("New key generated — update the snippet on your site");
    },
  });

  if (query.isPending) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full max-w-3xl" />
      </div>
    );
  }
  if (query.isError) return <p className="p-6 text-sm text-destructive">{query.error.message}</p>;
  const p = query.data.project;

  return (
    <>
      <PageHeader title={p.name}>
        <Button size="sm" variant="outline" render={<Link href={`/inbox?project=${p.id}`} />}>
          <Inbox /> Open inbox
        </Button>
      </PageHeader>
      <div className="mx-auto grid w-full max-w-3xl gap-4 p-4">
        <InstallCard project={p} />
        <OriginsCard
          project={p}
          onSave={(allowedOrigins) => save.mutate({ allowedOrigins })}
          saving={save.isPending}
        />
        <Card>
          <CardHeader>
            <CardTitle>Visibility</CardTitle>
            <CardDescription>Control what visitors on your site can see.</CardDescription>
          </CardHeader>
          <CardContent>
            <label className="flex items-start justify-between gap-6" htmlFor="public-read">
              <span>
                <span className="block text-sm font-medium">Show existing pins to visitors</span>
                <span className="block text-sm text-muted-foreground">
                  Reviewers see each other&apos;s comments on the page. Turn off for private bug reporting.
                </span>
              </span>
              <Switch
                id="public-read"
                checked={p.publicRead}
                onCheckedChange={(publicRead) => save.mutate({ publicRead })}
              />
            </label>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4" /> Project key
            </CardTitle>
            <CardDescription>
              Public by design — it only works from your allowed sites. Rotate it if it&apos;s being abused.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <code className="rounded-md bg-muted px-2 py-1 font-mono text-sm">{p.publicKey}</code>
            <Button variant="outline" size="sm" onClick={() => rotate.mutate()} disabled={rotate.isPending}>
              Rotate key
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function InstallCard({ project }: { project: Project }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const snippets = {
    html: `<script src="${origin}/widget.js" data-project="${project.publicKey}" async></script>`,
    next: `// app/layout.tsx\nimport Script from "next/script";\n\n<Script src="${origin}/widget.js" data-project="${project.publicKey}" strategy="afterInteractive" />`,
    gtm: `<!-- Google Tag Manager → Custom HTML tag, trigger: All Pages -->\n<script src="${origin}/widget.js" data-project="${project.publicKey}" async></script>`,
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Install the widget
          {project.lastSeenAt ? (
            <Badge variant="secondary" className="ml-auto gap-1.5 font-normal">
              <span className="size-1.5 rounded-full bg-emerald-500" /> Connected · seen{" "}
              {timeAgo(project.lastSeenAt)}
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-auto gap-1.5 font-normal">
              <span className="size-1.5 animate-pulse rounded-full bg-amber-500" /> Waiting for your site
            </Badge>
          )}
        </CardTitle>
        <CardDescription>Add this before the closing &lt;/body&gt; tag on every page.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="html">
          <TabsList>
            <TabsTrigger value="html">HTML</TabsTrigger>
            <TabsTrigger value="next">Next.js</TabsTrigger>
            <TabsTrigger value="gtm">Tag Manager</TabsTrigger>
          </TabsList>
          {Object.entries(snippets).map(([k, code]) => (
            <TabsContent key={k} value={k}>
              <CodeBlock code={code} />
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 pr-12 font-mono text-xs leading-relaxed">
        {code}
      </pre>
      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute top-2 right-2"
        aria-label="Copy snippet"
        onClick={async () => {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

function OriginsCard({
  project,
  onSave,
  saving,
}: {
  project: Project;
  onSave: (origins: string[]) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [testUrl, setTestUrl] = useState("");
  const origins = project.allowedOrigins;
  const add = () => {
    const host = draft
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");
    if (!host || origins.includes(host)) return setDraft("");
    onSave([...origins, host]);
    setDraft("");
  };
  const testResult = testUrl.trim()
    ? origins.some((o) => {
        try {
          return originMatches(new URL(testUrl.includes("://") ? testUrl : `https://${testUrl}`).origin, o);
        } catch {
          return false;
        }
      })
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Allowed sites</CardTitle>
        <CardDescription>
          Feedback is only accepted from these domains. Use <code className="font-mono">*.example.com</code>{" "}
          for all subdomains and <code className="font-mono">localhost:3000</code> for local development.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ul className="flex flex-wrap gap-2">
          {origins.length === 0 && (
            <li className="text-sm text-muted-foreground">No sites yet — nothing can submit.</li>
          )}
          {origins.map((o) => (
            <li key={o}>
              <Badge variant="secondary" className="gap-1 py-1 pr-1 font-mono">
                {o}
                <button
                  type="button"
                  aria-label={`Remove ${o}`}
                  className="rounded p-0.5 hover:bg-foreground/10"
                  onClick={() => onSave(origins.filter((x) => x !== o))}
                  disabled={saving}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="www.example.com" />
          <Button type="submit" variant="outline" disabled={!draft.trim() || saving}>
            <Plus /> Add
          </Button>
        </form>
        <div className="grid gap-2">
          <Label htmlFor="test-url" className="text-muted-foreground">
            Test a URL
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="test-url"
              value={testUrl}
              onChange={(e) => setTestUrl(e.target.value)}
              placeholder="https://shop.example.com/cart"
            />
            {testResult !== null && (
              <Badge variant={testResult ? "secondary" : "destructive"} className="shrink-0">
                {testResult ? "Allowed" : "Blocked"}
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
