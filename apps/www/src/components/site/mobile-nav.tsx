"use client";

import { Menu } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { GITHUB_URL } from "@/lib/site";

const LINKS = [
  { label: "Features", href: "/#features" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "Compare", href: "/#compare" },
  { label: "Docs", href: "/docs" },
  { label: "Pricing", href: "/pricing" },
  { label: "Changelog", href: "/changelog" },
  { label: "Live demo", href: "/demo" },
] as const;

export function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu" />}
      >
        <Menu aria-hidden />
      </SheetTrigger>
      <SheetContent side="right" className="w-72">
        <SheetHeader>
          <SheetTitle>
            <Logo />
          </SheetTitle>
        </SheetHeader>
        <nav aria-label="Mobile" className="flex flex-col gap-1 px-4">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href as Route}
              onClick={() => setOpen(false)}
              className="rounded-md px-2 py-2 text-[15px] font-medium hover:bg-muted"
            >
              {l.label}
            </Link>
          ))}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md px-2 py-2 text-[15px] font-medium hover:bg-muted"
          >
            GitHub
          </a>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
