import { Accordion, Accordions } from "@fumadocs/base-ui/components/accordion";
import { Callout } from "@fumadocs/base-ui/components/callout";
import { File, Files, Folder } from "@fumadocs/base-ui/components/files";
import { Step, Steps } from "@fumadocs/base-ui/components/steps";
import { Tab, Tabs } from "@fumadocs/base-ui/components/tabs";
import { TypeTable } from "@fumadocs/base-ui/components/type-table";
import defaultMdxComponents from "@fumadocs/base-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { EnvTable } from "@/components/docs/env-table";
import { NewIn } from "@/components/docs/new-in";

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    Accordion,
    Accordions,
    Callout,
    EnvTable,
    File,
    Files,
    Folder,
    NewIn,
    Step,
    Steps,
    Tab,
    Tabs,
    TypeTable,
    ...components,
  };
}
