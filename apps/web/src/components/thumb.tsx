"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Screenshot thumbnail filling its (relative, sized) parent. Desktop captures crop to the top of the
 * page; portrait phone captures are letterboxed instead, so they don't read as a zoomed-in crop.
 */
export function Thumb({ src, className }: { src: string; className?: string }) {
  const [portrait, setPortrait] = useState(false);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- session-authenticated asset; next/image would fetch it without the cookie
    <img
      src={src}
      alt=""
      loading="lazy"
      onLoad={(e) => setPortrait(e.currentTarget.naturalHeight > e.currentTarget.naturalWidth)}
      className={cn(
        "absolute inset-0 size-full",
        portrait ? "bg-muted object-contain" : "object-cover object-top",
        className,
      )}
    />
  );
}
