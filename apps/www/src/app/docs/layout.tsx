import { DocsLayout } from "@fumadocs/base-ui/layouts/docs";
import { Logo } from "@/components/logo";
import { GITHUB_URL } from "@/lib/site";
import { source } from "@/lib/source";

export default function Layout({ children }: LayoutProps<"/docs">) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      nav={{ title: <Logo />, url: "/" }}
      githubUrl={GITHUB_URL}
      links={[
        { text: "Demo", url: "/demo" },
        { text: "Pricing", url: "/pricing" },
        { text: "Changelog", url: "/changelog" },
      ]}
    >
      {children}
    </DocsLayout>
  );
}
