import type { Metadata } from "next";
import { TokensSettings } from "./tokens-settings";

export const metadata: Metadata = { title: "API tokens" };

export default function TokensPage() {
  return <TokensSettings />;
}
