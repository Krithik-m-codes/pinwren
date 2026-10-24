import { Check } from "lucide-react";
import Link from "next/link";
import { CodeSnippet } from "@/components/code-snippet";
import { InstallTabs } from "@/components/landing/install-tabs";

const COMPOSE = `git clone https://github.com/Krithik-m-codes/pinwren.git
cd pinwren && cp docker/.env.example docker/.env
# set PINWREN_URL, PINWREN_SECRET, POSTGRES_PASSWORD
docker compose -f docker/compose.yml \\
  --env-file docker/.env up -d --build`;

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-20 border-b bg-muted/30 py-24">
      <div className="container-page">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-brand-ink text-sm font-semibold">How it works</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            From <code className="text-brand-ink font-mono text-[0.78em]">docker compose up</code> to the
            first report in minutes
          </h2>
        </div>
        <ol className="mt-14 grid gap-5 lg:grid-cols-3">
          <li className="flex min-w-0 flex-col rounded-2xl border bg-card p-6 shadow-xs">
            <Step n={1} title="Run the server">
              One container plus Postgres 17. Open the URL, create your account, workspace and a project with
              its allowed sites.
            </Step>
            <CodeSnippet
              code={COMPOSE}
              wrap
              label="Copy the Docker commands"
              className="mt-5 text-[11.5px]"
            />
          </li>
          <li className="flex min-w-0 flex-col rounded-2xl border bg-card p-6 shadow-xs">
            <Step n={2} title="Add the widget">
              Paste the snippet from the project’s Install tab, or install it from npm and start it on the
              client.
            </Step>
            <InstallTabs className="mt-5" />
          </li>
          <li className="flex min-w-0 flex-col rounded-2xl border bg-card p-6 shadow-xs">
            <Step n={3} title="Triage and route">
              Comments and reports arrive in the inbox with the screenshot, the pin and the diagnostics. Send
              them to GitHub, GitLab, Slack, Discord, email, a webhook or an AI agent.
            </Step>
            <ul className="mt-5 space-y-2.5 text-sm">
              {[
                "No accounts for clients — guests leave a name if they like",
                "No API keys in the browser — a public key plus an origin allowlist",
                "No per-seat bill — invite the whole team",
              ].map((t) => (
                <li key={t} className="flex gap-2">
                  <Check className="text-success mt-0.5 size-4 shrink-0" aria-hidden />
                  <span className="text-muted-foreground">{t}</span>
                </li>
              ))}
            </ul>
          </li>
        </ol>
        <p className="mt-8 text-center text-sm text-muted-foreground">
          Step-by-step:{" "}
          <Link href="/docs/quickstart" className="font-medium text-foreground underline underline-offset-4">
            Quickstart
          </Link>{" "}
          ·{" "}
          <Link
            href="/docs/self-hosting"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Self-hosting guide
          </Link>
        </p>
      </div>
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="grid size-7 place-items-center rounded-full bg-brand text-sm font-semibold text-brand-foreground">
          {n}
        </span>
        <h3 className="text-lg font-semibold">{title}</h3>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}
