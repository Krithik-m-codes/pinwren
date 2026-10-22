"use client";

import { useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const MANAGERS = {
  npm: "npm install @pinwren/widget",
  pnpm: "pnpm add @pinwren/widget",
  yarn: "yarn add @pinwren/widget",
  bun: "bun add @pinwren/widget",
} as const;
type Manager = keyof typeof MANAGERS;

const SCRIPT = `<script
  src="https://feedback.example.com/widget.js"
  data-project="pk_…"
  async
></script>`;

const INIT = `import { init } from "@pinwren/widget";

init({
  projectKey: "pk_…",
  endpoint: "https://feedback.example.com",
});`;

function Code({ code, label }: { code: string; label: string }) {
  return (
    <div className="relative rounded-xl border bg-muted/40">
      <pre className="p-3.5 pr-11 font-mono text-[12px] leading-relaxed break-all whitespace-pre-wrap">
        <code>{code}</code>
      </pre>
      <CopyButton value={code} label={label} className="absolute top-1.5 right-1.5" />
    </div>
  );
}

/** Script tag vs npm, with a package-manager switch for the npm route. */
export function InstallTabs({ className }: { className?: string }) {
  const [pm, setPm] = useState<Manager>("npm");
  return (
    <Tabs defaultValue="script" className={cn("gap-3", className)}>
      <TabsList aria-label="Install method">
        <TabsTrigger value="script">Script tag</TabsTrigger>
        <TabsTrigger value="npm">npm package</TabsTrigger>
      </TabsList>
      <TabsContent value="script">
        <Code code={SCRIPT} label="Copy the script tag" />
      </TabsContent>
      <TabsContent value="npm" className="space-y-2.5">
        <div role="radiogroup" aria-label="Package manager" className="flex gap-1">
          {(Object.keys(MANAGERS) as Manager[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={pm === m}
              onClick={() => setPm(m)}
              className={cn(
                "rounded-md px-2 py-0.5 font-mono text-[12px] transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                pm === m ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m}
            </button>
          ))}
        </div>
        <Code code={MANAGERS[pm]} label="Copy the install command" />
        <Code code={INIT} label="Copy the init code" />
      </TabsContent>
    </Tabs>
  );
}
