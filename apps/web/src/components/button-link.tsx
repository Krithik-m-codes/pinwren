import type { VariantProps } from "class-variance-authority";
import { safeHref } from "@pinwren/core";
import type { Route } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ButtonLinkProps<T extends string> = {
  className?: string | undefined;
  children: React.ReactNode;
} & VariantProps<typeof buttonVariants> &
  // Next's Link declares its own pointer handlers without `| undefined`; nothing passes them here.
  Omit<
    React.ComponentProps<"a">,
    "href" | "className" | "children" | "onClick" | "onMouseEnter" | "onTouchStart"
  > &
  (
    | {
        /** Off-site: a plain anchor that opens in a new tab. */
        external: true;
        href: string;
      }
    | { external?: false; href: Route<T> }
  );

/**
 * A link that looks like a button. Kept a real `<a>` (not Base UI Button rendering a link, which
 * adds role="button"), so it reads as a link and opens in a new tab with the usual gestures.
 */
export function ButtonLink<T extends string>({
  href,
  external,
  variant = "default",
  size = "default",
  className,
  children,
  ...rest
}: ButtonLinkProps<T>) {
  const cls = cn(buttonVariants({ variant, size }), className);
  if (external) {
    // Off-site hrefs are often untrusted (reported page URLs): http(s) only, anything else renders inert.
    return (
      <a
        href={safeHref(href) ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        className={cls}
        {...rest}
      >
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
