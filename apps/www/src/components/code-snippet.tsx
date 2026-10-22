import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

/** A one-or-few-line command or snippet with a copy button; `prompt` adds a `$` for shell commands. */
export function CodeSnippet({
  code,
  prompt = false,
  wrap = false,
  label,
  className,
}: {
  code: string;
  prompt?: boolean;
  /** Wrap long lines instead of scrolling (narrow columns). */
  wrap?: boolean;
  label?: string;
  className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "group relative flex items-start gap-2 rounded-xl border bg-card py-2.5 pr-2 pl-4 font-mono text-[13px] leading-relaxed shadow-xs",
        className,
      )}
    >
      <pre
        className={cn(
          "min-w-0 flex-1 py-0.5",
          wrap ? "break-all whitespace-pre-wrap" : "overflow-x-auto whitespace-pre",
        )}
      >
        {prompt && (
          <span className="text-muted-foreground select-none" aria-hidden>
            ${" "}
          </span>
        )}
        <code>{code}</code>
      </pre>
      <CopyButton value={code} label={label ?? "Copy to clipboard"} className="-my-0.5 shrink-0" />
    </div>
  );
}
