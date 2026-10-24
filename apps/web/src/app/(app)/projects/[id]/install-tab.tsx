"use client";

import { originMatches } from "@pinwren/core";
import { Ban, Info, Plus, Send, Terminal, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { useWatch } from "react-hook-form";
import { ButtonLink } from "@/components/button-link";
import { CopyButton } from "@/components/copy-button";
import { RelativeTime } from "@/components/feedback-meta";
import { controlProps, FieldError, useZodForm } from "@/components/form";
import { SecretCard } from "@/components/secret-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ProjectDetail } from "@/lib/api";
import { originForm } from "@/lib/form-schemas";
import {
  differentOrigin,
  doctorCommand,
  INSTALL_HINTS,
  INSTALL_LABELS,
  INSTALL_METHODS,
  installSnippets,
  patternForOrigin,
} from "@/lib/install";
import { useLazyIdentitySecretQuery, useRotateIdentitySecretMutation } from "@/lib/store/api";
import { useOrigin } from "@/lib/use-synced-state";
import { useViewer } from "@/lib/viewer";
import { useProjectPatch } from "./use-project";

export function InstallTab({ project }: { project: ProjectDetail }) {
  const { isAdmin } = useViewer();
  return (
    <div className="grid gap-4">
      <InstallCard project={project} />
      <VerifyCard project={project} />
      <OriginsCard project={project} />
      {isAdmin && <IdentityCard project={project} />}
    </div>
  );
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 pr-12 font-mono text-xs leading-relaxed">
        {code}
      </pre>
      <CopyButton value={code} label={label} className="absolute top-2 right-2" />
    </div>
  );
}

function InstallCard({ project }: { project: ProjectDetail }) {
  const browserOrigin = useOrigin();
  const snippets = installSnippets(project.publicUrl, project.publicKey);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Install the widget
          {project.lastSeenAt ? (
            <Badge
              variant="secondary"
              className="ml-auto gap-1.5 font-normal"
              data-testid="install-connected"
            >
              <span className="size-1.5 rounded-full bg-emerald-500" /> Connected · seen{" "}
              <RelativeTime iso={project.lastSeenAt} />
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-auto gap-1.5 font-normal" data-testid="install-waiting">
              <span className="size-1.5 animate-pulse rounded-full bg-amber-500" /> Waiting for your site
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Pick how your site is built. Every snippet loads the widget from{" "}
          <code className="font-mono text-xs">{project.publicUrl}</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {differentOrigin(browserOrigin, project.publicUrl) && (
          <p
            className="flex items-start gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
            data-testid="public-url-hint"
          >
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              You opened the dashboard at <code className="font-mono">{browserOrigin}</code>, but this
              server&apos;s public address (<code className="font-mono">PINWREN_URL</code>) is{" "}
              <code className="font-mono">{project.publicUrl}</code>. The snippets use the public address; if
              it is wrong, change <code className="font-mono">PINWREN_URL</code> and restart.
            </span>
          </p>
        )}
        <Tabs defaultValue="html">
          <div className="-mx-1 overflow-x-auto px-1">
            <TabsList>
              {INSTALL_METHODS.map((m) => (
                <TabsTrigger key={m} value={m}>
                  {INSTALL_LABELS[m]}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {INSTALL_METHODS.map((m) => (
            <TabsContent key={m} value={m} className="grid gap-2">
              <p className="text-xs text-muted-foreground">{INSTALL_HINTS[m]}</p>
              <CodeBlock code={snippets[m]} label="Copy snippet" />
            </TabsContent>
          ))}
        </Tabs>
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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

/** "Is it working?": the CLI check, then a real report end to end. */
function VerifyCard({ project }: { project: ProjectDetail }) {
  const connected = !!project.lastSeenAt;
  const site = project.allowedOrigins[0];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{connected ? "Send a test report" : "Check the installation"}</CardTitle>
        <CardDescription>
          {connected
            ? "The widget has loaded on your site. Try it the way a visitor would."
            : "Nothing has loaded the widget yet. This page updates by itself once it does."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {connected ? (
          <ol className="grid gap-2 text-sm" data-testid="test-report-steps">
            {[
              "Open a page of your site and click the feedback button in the corner.",
              "Choose “Report a bug”, draw on the screenshot if you like, and send it.",
              "It appears in the inbox within seconds, and the team gets an email if email is set up.",
            ].map((t, i) => (
              <li key={t} className="flex items-start gap-2.5">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium tabular-nums">
                  {i + 1}
                </span>
                {t}
              </li>
            ))}
            <li className="pt-1">
              <ButtonLink href={`/inbox?project=${project.id}`} size="sm" variant="outline">
                <Send /> Open the inbox
              </ButtonLink>
            </li>
          </ol>
        ) : (
          <ul className="grid gap-1.5 text-sm text-muted-foreground">
            <li>• The snippet is on the page you opened (view the page source to check).</li>
            <li>• The site&apos;s domain is under Allowed sites below. Refused sites show up there too.</li>
            <li>• Your site can reach {project.publicUrl} (not a localhost address, for a live site).</li>
          </ul>
        )}
        <div className="grid gap-1.5">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Terminal className="size-4 text-muted-foreground" /> Verify from your terminal
          </p>
          <CodeBlock code={doctorCommand(project.publicUrl, project.publicKey, site)} label="Copy command" />
          <p className="text-xs text-muted-foreground">
            Checks the server, <code className="font-mono">widget.js</code> and this project&apos;s settings
            for your site, and says what to fix.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function OriginsCard({ project }: { project: ProjectDetail }) {
  const save = useProjectPatch(project.id);
  const [testUrl, setTestUrl] = useState("");
  const origins = project.allowedOrigins;
  const form = useZodForm(originForm, { defaultValues: { host: "" } });
  const { errors } = form.formState;
  const draft = useWatch({ control: form.control, name: "host" });
  const add = form.handleSubmit(({ host }) => {
    form.reset({ host: "" });
    if (origins.includes(host)) return;
    save.mutate({ patch: { allowedOrigins: [...origins, host] }, message: `Added ${host}` });
  });
  const testResult = testUrl.trim()
    ? origins.some((o) => {
        try {
          return originMatches(new URL(testUrl.includes("://") ? testUrl : `https://${testUrl}`).origin, o);
        } catch {
          return false;
        }
      })
    : null;
  // "Allow" adds the refused origin's host; the API drops it from the refused list in the same save.
  const allow = (origin: string) => {
    const pattern = patternForOrigin(origin);
    if (!pattern || origins.includes(pattern)) return;
    save.mutate({ patch: { allowedOrigins: [...origins, pattern] }, message: `Allowed ${pattern}` });
  };

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
        {origins.length === 0 && (
          <p
            className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
            data-testid="no-origins-warning"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            No sites allowed yet: the widget refuses to load anywhere until you add your site&apos;s domain.
          </p>
        )}
        {project.rejectedOrigins.length > 0 && (
          <ul className="grid gap-2" aria-label="Refused sites" data-testid="rejected-origins">
            {project.rejectedOrigins.map((r) => (
              <li
                key={r.origin}
                className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm"
              >
                <Ban className="size-4 shrink-0 text-destructive" />
                <span className="min-w-0 flex-1">
                  Blocked a request from <code className="font-mono text-xs break-all">{r.origin}</code>{" "}
                  <span className="text-muted-foreground">
                    <RelativeTime iso={r.at} />
                    {r.count > 1 && ` · ${r.count} times`}
                  </span>
                </span>
                {patternForOrigin(r.origin) && (
                  <Button size="sm" variant="outline" onClick={() => allow(r.origin)}>
                    Allow
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {origins.length > 0 && (
          <ul className="flex flex-wrap gap-2">
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
        )}
        <form className="grid gap-1.5" noValidate onSubmit={(e) => void add(e)}>
          <div className="flex gap-2">
            <Input
              {...controlProps("add-site", errors.host?.message)}
              {...form.register("host")}
              placeholder="www.example.com"
              aria-label="Add a site"
            />
            <Button type="submit" variant="outline" disabled={!draft.trim()}>
              <Plus /> Add
            </Button>
          </div>
          <FieldError id="add-site" message={errors.host?.message} />
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

const SIGN_SNIPPET = `// On your server — never in the browser:
import { createHmac } from "node:crypto";
const signature = createHmac("sha256", process.env.PINWREN_IDENTITY_SECRET)
  .update(user.id)
  .digest("hex");

// In the page:
Pinwren.identify({ id: user.id, name: user.name, email: user.email }, { signature });`;

/**
 * Signed identity (wave-4 §4): the host app signs the user id with this secret, and reports from that
 * user show as verified. Org admins only (the API refuses others).
 */
function IdentityCard({ project }: { project: ProjectDetail }) {
  const [reveal] = useLazyIdentitySecretQuery();
  const [rotate] = useRotateIdentitySecretMutation();
  return (
    <SecretCard
      title="Verified identity"
      testId="identity-secret"
      hasSecret={project.hasIdentitySecret}
      reveal={() => reveal(project.id).unwrap()}
      rotate={() => rotate(project.id).unwrap()}
      rotateTitle="Rotate the identity secret?"
      rotateDescription="Signatures made with the old secret stop verifying at once; reports show as unverified until your server signs with the new one."
      rotatedMessage="New identity secret — update your server"
      description={
        <>
          Sign your users&apos; ids on your server with this secret (HMAC-SHA256, hex) and pass the signature
          to <code className="font-mono text-xs">Pinwren.identify</code>. Their reports get a verified badge,
          so you know who really sent them.
        </>
      }
    >
      <CodeBlock code={SIGN_SNIPPET} label="Copy example" />
    </SecretCard>
  );
}
