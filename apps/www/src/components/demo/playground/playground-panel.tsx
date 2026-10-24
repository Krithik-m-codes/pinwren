"use client";

import { Check, ChevronLeft, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AccentPicker } from "./color-picker";
import { ACCENTS, LOCALES, MODES, type PlaygroundSettings, POSITIONS, THEMES } from "./settings";

// The "Widget playground" side panel (SitePing-style): every change re-initialises the real widget on the
// sample page. Collapsible; a bottom-anchored sheet on phones.

type Option<T extends string> = { value: T; label: string };

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (v: T) => void;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={(v) => {
        const next = v[0] as T | undefined;
        if (next && next !== value) onChange(next);
      }}
      spacing={0}
      className="grid w-full auto-cols-fr grid-flow-col rounded-lg bg-muted p-0.5"
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          size="sm"
          className="h-auto min-h-7 rounded-md! border-0 px-2 py-1 text-center whitespace-normal text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs dark:aria-pressed:bg-input/50"
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

function SwitchRow({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  const id = useId();
  // The hint describes the switch; only the label names it (else "Session replay … bug reports" would
  // also answer to "Bug reports").
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="grid text-sm">
        <label htmlFor={id}>{label}</label>
        {hint && (
          <span id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </span>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
    </div>
  );
}

export function PlaygroundPanel({
  settings,
  onChange,
  onReset,
  resetting,
}: {
  settings: PlaygroundSettings;
  onChange: (patch: Partial<PlaygroundSettings>) => void;
  onReset: () => void;
  resetting: boolean;
}) {
  // Open on wide screens, folded away on phones (it would cover the page).
  const [open, setOpen] = useState(() => !matchMedia("(max-width: 1023px)").matches);
  const preset = ACCENTS.some((a) => a.value.toLowerCase() === settings.accent.toLowerCase());
  const mode = MODES.find((m) => m.value === settings.mode);

  if (!open) {
    return (
      <Button
        variant="outline"
        className="fixed top-[4.5rem] left-3 z-30 shadow-md"
        aria-expanded={false}
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal aria-hidden />
        Playground
      </Button>
    );
  }

  return (
    <aside
      id="widget-playground"
      aria-label="Widget playground"
      className="fixed inset-x-3 top-[4.5rem] z-30 flex max-h-[min(70dvh,calc(100dvh-5.5rem))] flex-col overflow-hidden rounded-xl border bg-background shadow-lg lg:right-auto lg:bottom-3 lg:max-h-none lg:w-72"
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Widget playground</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Collapse the playground"
          aria-expanded
          aria-controls="widget-playground"
          onClick={() => setOpen(false)}
        >
          <ChevronLeft aria-hidden />
        </Button>
      </div>
      <div className="grid gap-5 overflow-y-auto overscroll-contain px-4 py-4">
        <Section title="Mode">
          <Segmented
            label="Mode"
            value={settings.mode}
            options={MODES}
            onChange={(v) => onChange({ mode: v })}
          />
          <p className="text-xs text-muted-foreground">{mode?.hint}</p>
        </Section>

        <Section title="Theme">
          <Segmented
            label="Theme"
            value={settings.theme}
            options={THEMES}
            onChange={(v) => onChange({ theme: v })}
          />
        </Section>

        <Section title="Locale">
          <Select
            items={LOCALES.map((l) => ({ value: l.value, label: l.label }))}
            value={settings.locale}
            onValueChange={(v) => {
              if (v) onChange({ locale: v });
            }}
          >
            <SelectTrigger className="w-full" aria-label="Widget language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCALES.map((l) => (
                <SelectItem key={l.value} value={l.value}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>

        <Section title="Position">
          <Segmented
            label="Launcher position"
            value={settings.position}
            options={POSITIONS}
            onChange={(v) => onChange({ position: v })}
          />
        </Section>

        <Section title="Accent colour">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Accent colour">
            {ACCENTS.map((a) => {
              const active = a.value.toLowerCase() === settings.accent.toLowerCase();
              return (
                <button
                  key={a.value}
                  type="button"
                  aria-label={a.label}
                  aria-pressed={active}
                  onClick={() => onChange({ accent: a.value })}
                  className="grid size-7 place-items-center rounded-full ring-offset-2 ring-offset-background transition-transform outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring aria-pressed:ring-2 aria-pressed:ring-foreground/70"
                  style={{ background: a.value }}
                >
                  {active && <Check className="size-3.5 text-white" aria-hidden />}
                </button>
              );
            })}
            <AccentPicker
              value={settings.accent}
              custom={!preset}
              onChange={(accent) => onChange({ accent })}
            />
          </div>
        </Section>

        <Section title="Options">
          <div className="grid gap-3">
            <SwitchRow
              label="Screenshots"
              hint="Attach a screenshot to every comment"
              checked={settings.screenshots}
              onChange={(v) => onChange({ screenshots: v })}
            />
            <SwitchRow
              label="Capture diagnostics"
              checked={settings.diagnostics}
              onChange={(v) => onChange({ diagnostics: v })}
            />
            {settings.diagnostics && <DiagnosticsTester />}
            <SwitchRow
              label="Right-click to comment"
              checked={settings.rightClick}
              onChange={(v) => onChange({ rightClick: v })}
            />
            <SwitchRow
              label="Prefilled identity"
              hint="As if your app called Pinwren.identify()"
              checked={settings.identity}
              onChange={(v) => onChange({ identity: v })}
            />
            <SwitchRow label="Bug reports" checked={settings.bugs} onChange={(v) => onChange({ bugs: v })} />
            <SwitchRow
              label="Session replay"
              hint="Records the last minute for bug reports"
              checked={settings.replay}
              onChange={(v) => onChange({ replay: v })}
            />
          </div>
        </Section>

        <Button variant="outline" size="sm" onClick={onReset} disabled={resetting}>
          <RotateCcw aria-hidden />
          {resetting
            ? "Resetting…"
            : settings.mode === "local"
              ? "Reset local feedback"
              : "Reset demo sandbox"}
        </Button>
      </div>
    </aside>
  );
}

/** Fake page activity, so a bug report sent afterwards shows what the widget captured. */
function DiagnosticsTester() {
  const [done, setDone] = useState<string | null>(null);
  const run = (what: string, fn: () => unknown) => {
    void fn();
    setDone(what);
  };
  return (
    <div className="grid gap-2 rounded-lg border bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">
        Fire fake events, then send a bug report to see them captured.
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          run("Logged 3 console messages", () => {
            console.info("[demo] Pricing page rendered in 412 ms");
            console.warn("[demo] Image /hero.webp is larger than needed (2.1 MB)");
            console.log("[demo] User clicked “Book a call”");
          })
        }
      >
        Log console messages
      </Button>
      <Button
        variant="destructive"
        size="sm"
        onClick={() =>
          run("Logged a console error", () =>
            console.error("[demo] TypeError: Cannot read properties of undefined (reading 'price')"),
          )
        }
      >
        Trigger console.error
      </Button>
      <Button
        variant="destructive"
        size="sm"
        onClick={() =>
          run("Sent a request that fails (500)", () =>
            fetch("/demo-api/checkout", { method: "POST" }).catch(() => undefined),
          )
        }
      >
        Trigger failed fetch
      </Button>
      <p role="status" className="min-h-4 text-xs text-muted-foreground">
        {done}
      </p>
    </div>
  );
}
