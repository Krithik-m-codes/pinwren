import * as prettier from "prettier";
import { z } from "zod";

// Prints TypeScript types from Zod schemas (via Zod's JSON Schema output), so the published SDK carries
// plain types with no dependency on Zod or on the server's packages. Only the JSON Schema shapes our
// wire schemas produce are supported; anything else fails loudly instead of degrading to `any`.

type Json = boolean | Record<string, unknown>;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const KEY = /^[A-Za-z_$][\w$]*$/;
const pad = (n: number) => "  ".repeat(n);
const wrap = (t: string) => (/[|&]/.test(t) ? `(${t})` : t);

function union(parts: string[]): string {
  return [...new Set(parts)].join(" | ");
}

export function printType(schema: Json, depth = 0): string {
  if (schema === true || (isObj(schema) && Object.keys(schema).filter((k) => k !== "default").length === 0)) {
    return "unknown";
  }
  if (schema === false) return "never";
  const s = schema;
  if ("$ref" in s) throw new Error("codegen: $ref is not supported — inline the schema");
  if ("const" in s) return JSON.stringify(s.const);
  if (Array.isArray(s.enum)) return union(s.enum.map((v) => JSON.stringify(v)));
  for (const k of ["anyOf", "oneOf"] as const) {
    const list = s[k];
    if (Array.isArray(list)) return union(list.map((x) => printType(x as Json, depth)));
  }
  if (Array.isArray(s.allOf)) return s.allOf.map((x) => wrap(printType(x as Json, depth))).join(" & ");
  if (Array.isArray(s.type)) {
    return union(s.type.map((t) => printType({ ...s, type: t as string }, depth)));
  }
  switch (s.type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array": {
      if (Array.isArray(s.prefixItems)) {
        return `[${s.prefixItems.map((x) => printType(x as Json, depth)).join(", ")}]`;
      }
      return `${wrap(s.items === undefined ? "unknown" : printType(s.items as Json, depth))}[]`;
    }
    case "object": {
      const props = isObj(s.properties) ? s.properties : {};
      const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
      const extra = s.additionalProperties;
      const keys = Object.keys(props);
      if (!keys.length) {
        return extra === undefined || extra === false
          ? "Record<string, never>"
          : `Record<string, ${printType(extra as Json, depth)}>`;
      }
      const lines = keys.map((k) => {
        const name = KEY.test(k) ? k : JSON.stringify(k);
        const t = printType(props[k] as Json, depth + 1);
        // `| undefined` on optional fields: callers with exactOptionalPropertyTypes can pass a maybe-value.
        return required.has(k)
          ? `${pad(depth + 1)}${name}: ${t};`
          : `${pad(depth + 1)}${name}?: ${t} | undefined;`;
      });
      if (extra !== undefined && extra !== false) {
        lines.push(`${pad(depth + 1)}[key: string]: unknown;`);
      }
      return `{\n${lines.join("\n")}\n${pad(depth)}}`;
    }
    default:
      throw new Error(`codegen: unsupported schema ${JSON.stringify(s).slice(0, 120)}`);
  }
}

export type TypeSpec = { name: string; schema: z.ZodType; io: "input" | "output"; doc: string };

export async function generate(specs: TypeSpec[], header: string, filepath: string): Promise<string> {
  const out = [header];
  for (const spec of specs) {
    const json = z.toJSONSchema(spec.schema, { io: spec.io, unrepresentable: "throw" }) as Record<
      string,
      unknown
    >;
    delete json.$schema;
    out.push(`/** ${spec.doc} */\nexport type ${spec.name} = ${printType(json)};\n`);
  }
  const options = (await prettier.resolveConfig(filepath)) ?? {};
  // The repo's Tailwind plugin is irrelevant here (and needs the dashboard's stylesheet).
  return prettier.format(out.join("\n"), { ...options, filepath, plugins: [] });
}
