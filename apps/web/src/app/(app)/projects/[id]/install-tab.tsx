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
  INSTALL_HINT_KEYS,
  INSTALL_LABELS,
  INSTALL_METHODS,
  installSnippets,
  patternForOrigin,
} from "@/lib/install";
import { useLazyIdentitySecretQuery, useRotateIdentitySecretMutation } from "@/lib/store/api";
import { useT } from "@/lib/i18n/provider";
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
  const t = useT();
  const browserOrigin = useOrigin();
  const snippets = installSnippets(project.publicUrl, project.publicKey);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {t("projects2.installTheWidget")}
          {project.lastSeenAt ? (
            <Badge
              variant="secondary"
              className="ml-auto gap-1.5 font-normal"
              data-testid="install-connected"
            >
              <span className="size-1.5 rounded-full bg-emerald-500" /> {t("projects2.connectedSeen")}{" "}
              <RelativeTime iso={project.lastSeenAt} />
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-auto gap-1.5 font-normal" data-testid="install-waiting">
              <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />{" "}
              {t("projects2.waitingForYourSite")}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          {t("projects2.pickHowSiteBuilt")} <code className="font-mono text-xs">{project.publicUrl}</code>.
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
              {t("projects2.hintOpenedAt")} <code className="font-mono">{browserOrigin}</code>,{" "}
              {t("projects2.hintButAddress")} (<code className="font-mono">PINWREN_URL</code>){" "}
              {t("projects2.hintIs")} <code className="font-mono">{project.publicUrl}</code>.{" "}
              {t("projects2.hintSnippetsUse")} <code className="font-mono">PINWREN_URL</code>{" "}
              {t("projects2.hintAndRestart")}
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
              <p className="text-xs text-muted-foreground">{t(INSTALL_HINT_KEYS[m])}</p>
              <CodeBlock code={snippets[m]} label={t("projects2.copySnippet")} />
            </TabsContent>
          ))}
        </Tabs>
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {t("projects2.projectKey")}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
            {project.publicKey}
          </code>
          <CopyButton value={project.publicKey} label={t("projects2.copyProjectKey")} size="icon-xs" />
          <span>{t("projects2.publicByDesign")}</span>
        </p>
      </CardContent>
    </Card>
  );
}

/** "Is it working?": the CLI check, then a real report end to end. */
function VerifyCard({ project }: { project: ProjectDetail }) {
  const t = useT();
  const connected = !!project.lastSeenAt;
  const site = project.allowedOrigins[0];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{connected ? t("projects2.sendTestReport") : t("projects2.checkInstallation")}</CardTitle>
        <CardDescription>
          {connected ? t("projects2.widgetLoadedDescription") : t("projects2.widgetNotLoadedDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {connected ? (
          <ol className="grid gap-2 text-sm" data-testid="test-report-steps">
            {[t("projects2.testStep1"), t("projects2.testStep2"), t("projects2.testStep3")].map((step, i) => (
              <li key={step} className="flex items-start gap-2.5">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium tabular-nums">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
            <li className="pt-1">
              <ButtonLink href={`/inbox?project=${project.id}`} size="sm" variant="outline">
                <Send /> {t("projects2.openTheInbox")}
              </ButtonLink>
            </li>
          </ol>
        ) : (
          <ul className="grid gap-1.5 text-sm text-muted-foreground">
            <li>{t("projects2.checkSnippet")}</li>
            <li>{t("projects2.checkDomain")}</li>
            <li>{t("projects2.checkReach", { url: project.publicUrl })}</li>
          </ul>
        )}
        <div className="grid gap-1.5">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Terminal className="size-4 text-muted-foreground" /> {t("projects2.verifyFromTerminal")}
          </p>
          <CodeBlock
            code={doctorCommand(project.publicUrl, project.publicKey, site)}
            label={t("projects2.copyCommand")}
          />
          <p className="text-xs text-muted-foreground">
            {t("projects2.checksServer")} <code className="font-mono">widget.js</code>{" "}
            {t("projects2.checksSettings")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function OriginsCard({ project }: { project: ProjectDetail }) {
  const t = useT();
  const save = useProjectPatch(project.id);
  const [testUrl, setTestUrl] = useState("");
  const origins = project.allowedOrigins;
  const form = useZodForm(originForm, { defaultValues: { host: "" } });
  const { errors } = form.formState;
  const draft = useWatch({ control: form.control, name: "host" });
  const add = form.handleSubmit(({ host }) => {
    form.reset({ host: "" });
    if (origins.includes(host)) return;
    save.mutate({
      patch: { allowedOrigins: [...origins, host] },
      message: t("projects2.addedHost", { host }),
    });
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
    save.mutate({
      patch: { allowedOrigins: [...origins, pattern] },
      message: t("projects2.allowedPattern", { pattern }),
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("projects2.allowedSites")}</CardTitle>
        <CardDescription>
          {t("projects2.originsDescription1")} <code className="font-mono">*.example.com</code>{" "}
          {t("projects2.originsDescription2")} <code className="font-mono">localhost:3000</code>{" "}
          {t("projects2.originsDescription3")}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {origins.length === 0 && (
          <p
            className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
            data-testid="no-origins-warning"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {t("projects2.noSitesAllowed")}
          </p>
        )}
        {project.rejectedOrigins.length > 0 && (
          <ul className="grid gap-2" aria-label={t("projects2.refusedSites")} data-testid="rejected-origins">
            {project.rejectedOrigins.map((r) => (
              <li
                key={r.origin}
                className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm"
              >
                <Ban className="size-4 shrink-0 text-destructive" />
                <span className="min-w-0 flex-1">
                  {t("projects2.blockedRequestFrom")}{" "}
                  <code className="font-mono text-xs break-all">{r.origin}</code>{" "}
                  <span className="text-muted-foreground">
                    <RelativeTime iso={r.at} />
                    {r.count > 1 && ` · ${t("projects2.timesCount", { count: r.count })}`}
                  </span>
                </span>
                {patternForOrigin(r.origin) && (
                  <Button size="sm" variant="outline" onClick={() => allow(r.origin)}>
                    {t("projects2.allow")}
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
                    aria-label={t("projects2.removeHost", { host: o })}
                    className="rounded p-0.5 hover:bg-foreground/10"
                    onClick={() =>
                      save.mutate({
                        patch: { allowedOrigins: origins.filter((x) => x !== o) },
                        message: t("projects2.removedHost", { host: o }),
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
              aria-label={t("projects2.addASite")}
            />
            <Button type="submit" variant="outline" disabled={!draft.trim()}>
              <Plus /> {t("projects2.add")}
            </Button>
          </div>
          <FieldError id="add-site" message={errors.host?.message} />
        </form>
        <div className="grid gap-2">
          <Label htmlFor="test-url" className="text-muted-foreground">
            {t("projects2.testAUrl")}
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
                {testResult ? t("projects2.allowedBadge") : t("projects2.blockedBadge")}
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
  const t = useT();
  const [reveal] = useLazyIdentitySecretQuery();
  const [rotate] = useRotateIdentitySecretMutation();
  return (
    <SecretCard
      title={t("projects2.verifiedIdentity")}
      testId="identity-secret"
      hasSecret={project.hasIdentitySecret}
      reveal={() => reveal(project.id).unwrap()}
      rotate={() => rotate(project.id).unwrap()}
      rotateTitle={t("projects2.rotateIdentitySecretQuestion")}
      rotateDescription={t("projects2.rotateIdentitySecretDescription")}
      rotatedMessage={t("projects2.identitySecretRotated")}
      description={
        <>
          {t("projects2.identityDescription1")} <code className="font-mono text-xs">Pinwren.identify</code>.{" "}
          {t("projects2.identityDescription2")}
        </>
      }
    >
      <CodeBlock code={SIGN_SNIPPET} label={t("projects2.copyExample")} />
    </SecretCard>
  );
}
