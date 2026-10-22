"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StoreProvider } from "@/lib/store/store-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <StoreProvider>
        <TooltipProvider>
          {children}
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </StoreProvider>
    </ThemeProvider>
  );
}
