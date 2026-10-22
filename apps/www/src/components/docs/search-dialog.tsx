"use client";

import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from "@fumadocs/base-ui/components/dialog/search";
import { useStaticSearch } from "fumadocs-core/search/client/orama-static";

const SUGGESTED = [
  { type: "page" as const, id: "quickstart", content: "Quickstart", url: "/docs/quickstart" },
  { type: "page" as const, id: "install", content: "Install the widget", url: "/docs/widget" },
  {
    type: "page" as const,
    id: "env",
    content: "Environment variables",
    url: "/docs/self-hosting/environment",
  },
  { type: "page" as const, id: "webhooks", content: "Webhooks", url: "/docs/integrations/webhooks" },
];

/** The ⌘K dialog: Orama over the prerendered `/api/search` index, entirely in the browser. */
export default function StaticSearchDialog(props: SharedProps) {
  const search = useStaticSearch({ from: "/api/search" });
  return (
    <SearchDialog {...search} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList defaultItems={SUGGESTED} />
      </SearchDialogContent>
    </SearchDialog>
  );
}
