import { Skeleton } from "@/components/ui/skeleton";

/** A screen's frame while its data streams in: the header bar and a few blocks (part of the static shell). */
export function PageSkeleton({ blocks = 3, narrow = false }: { blocks?: number; narrow?: boolean }) {
  return (
    <div aria-busy>
      <div className="flex h-12 items-center gap-2 border-b px-3">
        <Skeleton className="size-7" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className={narrow ? "mx-auto w-full max-w-5xl space-y-4 p-4" : "space-y-4 p-4"}>
        {Array.from({ length: blocks }, (_, i) => (
          <Skeleton key={i} className={i === 0 ? "h-24 w-full" : "h-40 w-full"} />
        ))}
      </div>
    </div>
  );
}
