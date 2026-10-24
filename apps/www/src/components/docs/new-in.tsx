import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Marks a page or section that documents a feature from the v0.1 design contract (docs/contracts/wave-4.md)
 * while it is still being built. Remove once the feature has shipped and the page was re-checked against it.
 * Children may be several MDX paragraphs, so nothing here is a `<p>`.
 */
export function NewIn({ version = "0.1", children }: { version?: string; children?: ReactNode }) {
  return (
    <div
      role="note"
      className="bg-brand-soft my-5 flex items-start gap-2.5 rounded-lg border border-brand/30 px-3.5 py-2.5 text-sm [&_p]:my-0 [&_p+p]:mt-1.5"
    >
      <Sparkles className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
      <div className="min-w-0 text-foreground/90">
        <span className="font-semibold text-foreground">New in {version}.</span>
        {children ? (
          <div className="mt-0.5">{children}</div>
        ) : (
          <> This feature is new in this release; details may still change before 1.0.</>
        )}
      </div>
    </div>
  );
}
