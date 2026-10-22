import env from "@/generated/env.json";

type EnvVar = {
  name: string;
  type: string;
  values: string[] | null;
  default: string | null;
  required: boolean;
  range: string | null;
  description: string;
  source: string;
};

/** Inline `code` in the generated descriptions, without pulling a Markdown renderer into the page. */
function Rich({ text }: { text: string }) {
  return text
    .split(/(`[^`]+`)/g)
    .map((part, i) =>
      part.startsWith("`") && part.endsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : part,
    );
}

function typeLabel(v: EnvVar) {
  if (v.values) return v.values.map((x) => `"${x}"`).join(" | ");
  if (v.range) return `${v.type} (${v.range})`;
  return v.type;
}

/**
 * Every environment variable the server reads, generated at build time from the Zod schema in
 * `packages/api/src/env.ts` (scripts/prepare.mjs), grouped by topic.
 */
export function EnvTable({ group }: { group?: string }) {
  const groups = (env.groups as { title: string; items: EnvVar[] }[]).filter(
    (g) => !group || g.title === group,
  );
  return (
    <div className="not-prose space-y-8">
      {groups.map((g) => (
        <section key={g.title} aria-labelledby={`env-${g.title}`}>
          {!group && (
            <h3 id={`env-${g.title}`} className="mb-3 text-base font-semibold">
              {g.title}
            </h3>
          )}
          <div className="relative overflow-x-auto rounded-xl border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground uppercase">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Variable
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Type
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Default
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {g.items.map((v) => (
                  <tr key={v.name} id={`env-${v.name}`} className="align-top">
                    <td className="px-3 py-2.5">
                      <code className="font-mono text-[13px] font-medium whitespace-nowrap">{v.name}</code>
                      {v.required && (
                        <span className="bg-brand-soft text-brand ml-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium">
                          required
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{typeLabel(v)}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">{v.default ?? "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-foreground">
                      <Rich text={v.description || "—"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <p className="text-xs text-muted-foreground">
        Generated from <code className="font-mono">{env.generatedFrom}</code> on every build.
      </p>
    </div>
  );
}
