import { cn } from "@/lib/utils";

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-grid h-5 min-w-5 place-items-center rounded border bg-muted px-1 font-mono text-[11px] text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
