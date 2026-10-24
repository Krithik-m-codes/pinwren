"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";

// A custom accent from design-system parts (no native `<input type=color>`): a hue slider that keeps the
// current saturation and lightness, and a hex field. Mirrors apps/web/src/components/color-picker.tsx.

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

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

export function AccentPicker({
  value,
  custom,
  onChange,
}: {
  value: string;
  /** True when `value` is not one of the presets (the trigger then shows it as selected). */
  custom: boolean;
  onChange: (hex: string) => void;
}) {
  const [text, setText] = useState(value);
  const [h, s0, l0] = hexToHsl(HEX.test(value) ? value : "#5b5bd6");
  const s = Math.max(s0, 40);
  const l = Math.min(Math.max(l0, 35), 65);
  const gradient = [0, 60, 120, 180, 240, 300, 360].map((x) => hslToHex(x, s, l)).join(",");
  return (
    <Popover onOpenChange={(open) => open && setText(value)}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-pressed={custom}
            className="gap-1.5 aria-pressed:ring-2 aria-pressed:ring-ring/60"
          />
        }
        aria-label={`Custom accent colour ${value}`}
      >
        <span className="size-3.5 rounded-[4px] ring-1 ring-foreground/15" style={{ background: value }} />
        Custom
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 gap-3">
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
            onValueChange={(v) => {
              const raw: unknown = v;
              const hue =
                typeof raw === "number" ? raw : Array.isArray(raw) && typeof raw[0] === "number" ? raw[0] : 0;
              const next = hslToHex(hue, s, l);
              setText(next);
              onChange(next);
            }}
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor="playground-accent-hex" className="text-xs text-muted-foreground">
            Hex
          </label>
          <Input
            id="playground-accent-hex"
            value={text}
            spellCheck={false}
            className="font-mono"
            aria-invalid={!HEX.test(text) || undefined}
            onChange={(e) => {
              const v = e.target.value.trim();
              setText(v);
              if (HEX.test(v)) onChange(v.toLowerCase());
            }}
          />
          {!HEX.test(text) && <p className="text-xs text-destructive">Use a hex colour like #5b5bd6</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
