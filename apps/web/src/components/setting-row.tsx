import { cn } from "@/lib/utils";

/**
 * One setting: label + one-line explanation on the left, the control on the right (stacked on
 * phones). Blueprint 06 §3.7 — every setting explains itself.
 */
export function SettingRow({
  label,
  description,
  htmlFor,
  children,
  className,
  stack,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
  /** Put the control under the text at every width (wide controls such as lists). */
  stack?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 py-4 first:pt-0 last:pb-0",
        !stack && "sm:flex-row sm:items-start sm:justify-between sm:gap-8",
        className,
      )}
    >
      <div className="min-w-0 sm:max-w-md">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-sm font-medium">
            {label}
          </label>
        ) : (
          <p className="text-sm font-medium">{label}</p>
        )}
        {description && <p className="mt-0.5 text-sm text-pretty text-muted-foreground">{description}</p>}
      </div>
      <div className={cn("shrink-0", stack && "w-full")}>{children}</div>
    </div>
  );
}

export function SettingGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("divide-y", className)}>{children}</div>;
}
