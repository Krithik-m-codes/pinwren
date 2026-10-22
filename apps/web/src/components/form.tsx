"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert } from "lucide-react";
import { type FieldValues, type Resolver, type UseFormProps, useForm } from "react-hook-form";
import type { z } from "zod";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * react-hook-form with a Zod resolver — the one form setup of the dashboard. Schemas come from
 * `@pinwren/core` (the API validates with the same ones) or are built from them in `lib/form-schemas.ts`,
 * so a form refuses exactly what the server would.
 */
export function useZodForm<S extends z.ZodType<FieldValues, FieldValues>>(
  schema: S,
  options: Omit<UseFormProps<z.input<S>, unknown, z.output<S>>, "resolver"> = {},
) {
  return useForm<z.input<S>, unknown, z.output<S>>({
    mode: "onSubmit",
    reValidateMode: "onChange",
    ...options,
    // zodResolver is typed for a concrete schema; for a generic one its types are restated here.
    resolver: zodResolver(schema) as unknown as Resolver<z.input<S>, unknown, z.output<S>>,
  });
}

/** Props that tie a control to its label, help and error text. */
export function controlProps(id: string, error?: string, help?: boolean) {
  const describedBy = [error ? `${id}-error` : null, help ? `${id}-help` : null].filter(Boolean).join(" ");
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy || undefined,
  } as const;
}

/** Label, control, help text and the field's validation message. */
export function Field({
  id,
  label,
  error,
  help,
  children,
  className,
}: {
  id: string;
  label: React.ReactNode;
  error?: string | undefined;
  help?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {help && (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      )}
      <FieldError id={id} message={error} />
    </div>
  );
}

export function FieldError({ id, message }: { id: string; message?: string | undefined }) {
  if (!message) return null;
  return (
    <p id={`${id}-error`} className="text-xs text-destructive">
      {message}
    </p>
  );
}

/** A form-level error (what the server answered). */
export function FormError({ message }: { message?: string | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
      <CircleAlert className="mt-0.5 size-4 shrink-0" /> {message}
    </p>
  );
}
