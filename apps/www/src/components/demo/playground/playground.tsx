"use client";

import dynamic from "next/dynamic";

// The playground reads its saved options from localStorage and drives a widget that only exists in the
// browser, so it renders on the client only (no server HTML to mismatch).
export const Playground = dynamic(() => import("./playground-client"), { ssr: false });
