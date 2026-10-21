"use client";

import { originMatches } from "@annota/core";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { timeAgo } from "@/components/feedback-meta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ProjectDetail } from "@/lib/api";
import { useProjectPatch } from "./use-project";

export function InstallTab({ project }: { project: ProjectDetail }) {
  return (
    <div className="grid gap-4">
      <InstallCard project={project} />
      <OriginsCard project={project} />
    </div>
  );
}

function InstallCard({ project }: { project: ProjectDetail }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const snippets = {
    html: `<script src="${origin}/widget.js" data-project="${project.publicKey}" async></script>`,
    next: `// app/layout.tsx\nimport Script from "next/script";\n\n<Script src="${origin}/widget.js" data-project="${project.publicKey}" strategy="afterInteractive" />`,
    gtm: `<!-- Google Tag Manager → Custom HTML tag, trigger: All Pages -->\n<script src="${origin}/widget.js" data-project="${project.publicKey}" async></script>`,
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
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
              <div className="relative">
                <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 pr-12 font-mono text-xs leading-relaxed">
                  {code}
                </pre>
                <CopyButton value={code} label="Copy snippet" className="absolute top-2 right-2" />
              </div>
            </TabsContent>
          ))}
        </Tabs>
        <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          Project key
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
            {project.publicKey}
          </code>
          <CopyButton value={project.publicKey} label="Copy project key" size="icon-xs" />
          <span>Public by design — it only works from your allowed sites.</span>
        </p>
      </CardContent>
    </Card>
  );
}

function OriginsCard({ project }: { project: ProjectDetail }) {
  const save = useProjectPatch(project.id);
  const [draft, setDraft] = useState("");
  const [testUrl, setTestUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const origins = project.allowedOrigins;
  const add = () => {
    const host = draft
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");
    if (!host) return;
    if (!/^(\*\.)?[a-z0-9.-]+(:\d{1,5})?$/.test(host)) {
      setError("Enter a domain like www.example.com, *.example.com or localhost:3000");
      return;
    }
    setError(null);
    setDraft("");
    if (origins.includes(host)) return;
    save.mutate({ patch: { allowedOrigins: [...origins, host] }, message: `Added ${host}` });
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
              <Badge variant="secondary" className="h-6 gap-1 pr-1 font-mono">
                {o}
                <button
                  type="button"
                  aria-label={`Remove ${o}`}
                  className="rounded p-0.5 hover:bg-foreground/10"
                  onClick={() =>
                    save.mutate({
                      patch: { allowedOrigins: origins.filter((x) => x !== o) },
                      message: `Removed ${o}`,
                    })
                  }
                >
                  <X className="size-3" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
        <form
          className="grid gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <div className="flex gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="www.example.com"
              aria-label="Add a site"
              aria-invalid={!!error || undefined}
            />
            <Button type="submit" variant="outline" disabled={!draft.trim()}>
              <Plus /> Add
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
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
