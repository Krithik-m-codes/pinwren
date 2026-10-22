"use client";

import { RootProvider } from "@fumadocs/base-ui/provider/next";
import type { ReactNode } from "react";
import StaticSearchDialog from "@/components/docs/search-dialog";

/** Theme (next-themes via Fumadocs) and the ⌘K docs search, shared by the marketing pages and the docs. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <RootProvider
      search={{ SearchDialog: StaticSearchDialog }}
      theme={{
        attribute: "class",
        defaultTheme: "system",
        enableSystem: true,
        disableTransitionOnChange: true,
      }}
    >
      {children}
    </RootProvider>
  );
}
