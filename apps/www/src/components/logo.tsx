import {
  GLYPH,
  GLYPH_VIEWBOX,
  LOGO_VIEWBOX,
  MARK_BIRD,
  MARK_DETAIL,
  MARK_FACE,
  MARK_VIEWBOX,
  WORD_DOT,
  WORD_LETTERS,
} from "@/components/brand/paths";
import { cn } from "@/lib/utils";

// Brand colours (brand/README.md). The mark keeps its own colours in both themes; the letters follow the text.
const ORANGE = "#F04424";
const NAVY = "#17243A";

function MarkPaths() {
  return (
    <>
      <path fill="#FFFFFF" d={MARK_FACE} />
      <path fill={ORANGE} fillRule="evenodd" d={MARK_BIRD} />
      <path fill={NAVY} d={MARK_DETAIL} />
    </>
  );
}

/** The Pinwren mark: a wren inside a map pin, with a speech bubble on its chest. */
export function LogoMark({ className }: { className?: string | undefined }) {
  return (
    <svg viewBox={MARK_VIEWBOX} className={cn("size-7 shrink-0", className)} aria-hidden>
      <MarkPaths />
    </svg>
  );
}

/** Mark and wordmark. The letters use `currentColor`, so they are navy on light and white on dark. */
export function Logo({ className }: { className?: string | undefined }) {
  return (
    <svg viewBox={LOGO_VIEWBOX} className={cn("h-7 w-auto shrink-0 text-foreground", className)} role="img">
      <title>Pinwren</title>
      <MarkPaths />
      <path fill="currentColor" fillRule="evenodd" d={WORD_LETTERS} />
      <path fill={ORANGE} d={WORD_DOT} />
    </svg>
  );
}

/** The mark in one colour (`currentColor`), for launcher buttons and other small UI. */
export function LogoGlyph({ className }: { className?: string | undefined }) {
  return (
    <svg viewBox={GLYPH_VIEWBOX} className={cn("size-5 shrink-0", className)} fill="currentColor" aria-hidden>
      <path fillRule="evenodd" d={GLYPH} />
    </svg>
  );
}
