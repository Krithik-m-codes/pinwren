import { defineConfig, defineDocs } from "fumadocs-mdx/config";

export const docs = defineDocs({
  dir: "content/docs",
});

export default defineConfig({
  mdxOptions: {
    // ```npm code blocks become npm / pnpm / yarn / bun tabs; the choice is remembered across pages.
    remarkNpmOptions: { persist: { id: "package-manager" } },
    rehypeCodeOptions: {
      // The "-default" variants keep comments above 4.5:1 contrast on the page background.
      themes: { light: "github-light-default", dark: "github-dark-default" },
    },
  },
});
