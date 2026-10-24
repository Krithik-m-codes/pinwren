import { useId } from "react";
import {
  GLYPH,
  GLYPH_VIEWBOX,
  LOGO_VIEWBOX,
  MARK_BIRD,
  MARK_DETAIL,
  MARK_FACE,
  SMALL_BIRD,
  WORD_DOT,
  WORD_LETTERS,
} from "@/components/brand/paths";
import { cn } from "@/lib/utils";

// Brand colours (brand/README.md). The mark keeps its colours in both themes; the letters follow the text.
const ORANGE = "#F04424";
const NAVY = "#17243A";

const SILHOUETTE = GLYPH.slice(0, GLYPH.indexOf("zM") + 1);
const EYE = GLYPH.slice(GLYPH.indexOf("zM") + 1);

/**
 * The simplified mark for small sizes (brand/pinwren-mark-small.svg): the bird-pin, a white head and the eye.
 * The speech lines and wing gaps of the full mark blur together below 48 px.
 */
function SmallMark({ className }: { className?: string | undefined }) {
  const face = useId();
  return (
    <svg viewBox={GLYPH_VIEWBOX} className={cn("size-7 shrink-0", className)} aria-hidden>
      <mask id={face}>
        <path fill="#fff" d={SILHOUETTE} />
        <path fill="#000" fillRule="evenodd" d={SMALL_BIRD} />
      </mask>
      <path fill={ORANGE} d={SILHOUETTE} />
      <circle cx="542" cy="262" r="82" fill="#FFFFFF" mask={`url(#${face})`} />
      <path fill={NAVY} d={EYE} />
    </svg>
  );
}

/** Pinwren's logo: the full lock-up, or with `compact` the mark alone (sidebar, previews). */
export function Logo({ className, compact = false }: { className?: string | undefined; compact?: boolean }) {
  if (compact) return <SmallMark className={className} />;
  return (
    <svg viewBox={LOGO_VIEWBOX} className={cn("h-7 w-auto shrink-0 text-foreground", className)} role="img">
      <title>Pinwren</title>
      <path fill="#FFFFFF" d={MARK_FACE} />
      <path fill={ORANGE} fillRule="evenodd" d={MARK_BIRD} />
      <path fill={NAVY} d={MARK_DETAIL} />
      <path fill="currentColor" fillRule="evenodd" d={WORD_LETTERS} />
      <path fill={ORANGE} d={WORD_DOT} />
    </svg>
  );
}
