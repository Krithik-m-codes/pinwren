import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

/** Shared frame for the legal placeholders: a loud "draft" banner until real documents replace them. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <article className="container-page max-w-3xl py-16 sm:py-20">
      <h1 className="text-4xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Draft · last updated {updated}</p>
      <div
        role="note"
        className="border-warning/50 bg-warning/10 mt-8 flex gap-3 rounded-xl border p-4 text-sm"
      >
        <TriangleAlert className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          <strong>Draft — not legal advice.</strong> This is a placeholder that describes how the project
          intends to behave. It is not a binding agreement and will be replaced by reviewed documents before
          Pinwren Cloud launches.
        </p>
      </div>
      <div className="prose dark:prose-invert mt-10 max-w-none">{children}</div>
    </article>
  );
}
