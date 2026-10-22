import { AlertCircle, type LucideIcon, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/store/api/base";
import { cn } from "@/lib/utils";

/** The one empty state used across screens: icon, a short title, one sentence, optional action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-14 text-center", className)}>
      <span className="mb-1 grid size-10 place-items-center rounded-full bg-muted">
        <Icon className="size-4.5 text-muted-foreground" />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-pretty text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  error,
  retry,
  className,
}: {
  error: unknown;
  retry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn("flex flex-col items-center justify-center gap-2 px-6 py-14 text-center", className)}
    >
      <span className="mb-1 grid size-10 place-items-center rounded-full bg-destructive/10">
        <AlertCircle className="size-4.5 text-destructive" />
      </span>
      <p className="text-sm font-medium">Something went wrong</p>
      <p className="max-w-sm text-sm text-muted-foreground">{errorMessage(error, "Please try again.")}</p>
      {retry && (
        <Button size="sm" variant="outline" className="mt-2" onClick={retry}>
          <RotateCw /> Try again
        </Button>
      )}
    </div>
  );
}
