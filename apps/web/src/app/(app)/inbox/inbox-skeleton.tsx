import { Skeleton } from "@/components/ui/skeleton";

/** The inbox frame while the session and the first page of the list stream in (part of the static shell). */
export function InboxSkeleton() {
  return (
    <div aria-busy className="flex h-svh min-h-0 flex-col md:h-[calc(100svh-1rem)]">
      <div className="flex h-12 items-center gap-2 border-b px-3">
        <Skeleton className="size-7" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="ml-auto h-8 w-64" />
      </div>
      <ul className="flex-1">
        {["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"].map((k) => (
          <li key={k} className="flex items-center gap-3 border-b px-4 py-3">
            <Skeleton className="size-4 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
