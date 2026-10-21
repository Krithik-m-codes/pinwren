import type { VariantProps } from "class-variance-authority";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A link that looks like a button. Kept a real `<a>` (not Base UI Button rendering a link, which
 * adds role="button"), so it reads as a link and opens in a new tab with the usual gestures.
 */
export function ButtonLink({
  href,
  external,
  variant = "default",
  size = "default",
  className,
  children,
  ...rest
}: {
  href: string;
  /** Off-site: a plain anchor that opens in a new tab. */
  external?: boolean;
  className?: string;
  children: React.ReactNode;
} & VariantProps<typeof buttonVariants> &
  Omit<React.ComponentProps<"a">, "href" | "className" | "children">) {
  const cls = cn(buttonVariants({ variant, size }), className);
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls} {...rest}>
      {children}
    </Link>
  );
}
