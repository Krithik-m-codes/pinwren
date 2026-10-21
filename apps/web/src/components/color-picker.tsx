"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { useSyncedState } from "@/lib/use-synced-state";
import { sliderValue } from "@/lib/form";

const SWATCHES = [
  "#5b5bd6",
  "#3e63dd",
  "#0090ff",
  "#00a2c7",
  "#12a594",
  "#30a46c",
  "#e5484d",
  "#e54666",
  "#d6409f",
  "#8e4ec6",
  "#f76b15",
  "#ffc53d",
  "#18181b",
  "#71717a",
];

export const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function hexToHsl(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.replace(/./g, "$&$&");
  const r = Number.parseInt(h.slice(0, 2), 16) / 255;
  const g = Number.parseInt(h.slice(2, 4), 16) / 255;
  const b = Number.parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hue * 60, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const tone = (s: number, l: number): [number, number] => [Math.max(s, 40), Math.min(Math.max(l, 35), 65)];

/**
 * Colour picker built from design-system parts (no native `<input type=color>`): preset swatches, a
 * hue slider that keeps the current saturation and lightness, and a hex field.
 */
export function ColorPicker({
  value,
  onChange,
  onCommit,
  id = "color",
  label = "Accent colour",
}: {
  value: string;
  /** Live updates while picking (drives the preview). */
  onChange: (hex: string) => void;
  /** The final value — save it. */
  onCommit: (hex: string) => void;
  id?: string;
  /** Accessible name; the current value is appended. */
  label?: string;
}) {
  const [text, setText] = useSyncedState(value);
  const valid = HEX.test(value);
  const [h, s0, l0] = valid ? hexToHsl(value) : [240, 60, 60];
  const [s, l] = tone(s0, l0);
  const gradient = [0, 60, 120, 180, 240, 300, 360].map((x) => hslToHex(x, s, l)).join(",");

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open && HEX.test(value)) onCommit(value.toLowerCase());
      }}
    >
      <PopoverTrigger
        render={<Button id={id} variant="outline" className="w-36 justify-start gap-2 font-mono" />}
        aria-label={`${label} ${value}`}
      >
        <span
          className="size-4 rounded-[4px] ring-1 ring-foreground/15"
          style={{ background: valid ? value : "transparent" }}
        />
        {value}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-3">
        <div className="grid grid-cols-7 gap-1.5">
          {SWATCHES.map((c) => {
            const active = c.toLowerCase() === value.toLowerCase();
            return (
              <button
                key={c}
                type="button"
                aria-pressed={active}
                aria-label={c}
                onClick={() => {
                  onChange(c);
                  onCommit(c);
                }}
                className="grid size-7 place-items-center rounded-md ring-1 ring-foreground/10 transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                style={{ background: c }}
              >
                {active && <Check className="size-3.5 text-white mix-blend-difference" />}
              </button>
            );
          })}
        </div>
        <div className="grid gap-1.5">
          <span className="text-xs text-muted-foreground">Hue</span>
          <div
            className="h-2 rounded-full"
            style={{ background: `linear-gradient(to right, ${gradient})` }}
            aria-hidden
          />
          <Slider
            aria-label="Hue"
            min={0}
            max={360}
            value={[Math.round(h)]}
            onValueChange={(v) => onChange(hslToHex(sliderValue(v), s, l))}
            onValueCommitted={(v) => onCommit(hslToHex(sliderValue(v), s, l))}
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor={`${id}-hex`} className="text-xs text-muted-foreground">
            Hex
          </label>
          <Input
            id={`${id}-hex`}
            value={text}
            spellCheck={false}
            className="font-mono"
            aria-invalid={!HEX.test(text) || undefined}
            onChange={(e) => {
              const v = e.target.value.trim();
              setText(v);
              if (HEX.test(v)) onChange(v.toLowerCase());
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && HEX.test(text)) onCommit(text.toLowerCase());
            }}
          />
          {!HEX.test(text) && <p className="text-xs text-destructive">Use a hex colour like #5b5bd6</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
