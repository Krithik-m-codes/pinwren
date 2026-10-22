import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";
import { env } from "../env";
import { type Cidr, inCidr, ipBytes, isBlockedAddress, parseCidr } from "./ip";

// Every request to a URL a user typed (webhooks, panel actions, tracker base URLs) goes through here
// (ADR 0021). The host is resolved once, every resolved address is checked, and the socket connects
// to exactly the checked address (the lookup hook hands it to `net.connect`), so a DNS answer that
// changes between check and connect (rebinding) can't reach an internal service. Redirects are never
// followed, the response is capped and there is always a timeout.

export type OutboundErrorCategory =
  | "invalid_url"
  | "blocked_address"
  | "dns_error"
  | "timeout"
  | "connection_failed"
  | "tls_error"
  | "too_large";

export class OutboundError extends Error {
  constructor(
    readonly category: OutboundErrorCategory,
    message: string = category.replaceAll("_", " "),
  ) {
    super(message);
    this.name = "OutboundError";
  }
}

export type OutboundPolicy = {
  /** Development/test escape hatch: no address checks at all. Never on by default. */
  allowPrivate: boolean;
  /** Host names (exact, or `*.example.internal`) whose addresses are allowed even when private. */
  hosts: string[];
  /** Address ranges allowed even when private. */
  cidrs: Cidr[];
};

export function parseAllowlist(raw: string | undefined): Pick<OutboundPolicy, "hosts" | "cidrs"> {
  const hosts: string[] = [];
  const cidrs: Cidr[] = [];
  for (const item of (raw ?? "").split(/[\s,]+/).filter(Boolean)) {
    const cidr = parseCidr(item);
    if (cidr) cidrs.push(cidr);
    // `gitlab.internal:8443` → the port is not part of the rule.
    else hosts.push(item.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, ""));
  }
  return { hosts, cidrs };
}

let cachedPolicy: OutboundPolicy | undefined;
export function outboundPolicy(): OutboundPolicy {
  if (cachedPolicy) return cachedPolicy;
  const e = env();
  cachedPolicy = {
    allowPrivate: e.PINWREN_OUTBOUND_ALLOW_PRIVATE,
    ...parseAllowlist(e.PINWREN_OUTBOUND_ALLOWLIST),
  };
  return cachedPolicy;
}

function hostAllowed(host: string, policy: OutboundPolicy): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return policy.hosts.some((rule) => (rule.startsWith("*.") ? h.endsWith(rule.slice(1)) : h === rule));
}

/** May this resolved address be contacted for `host`? */
export function addressAllowed(address: string, host: string, policy: OutboundPolicy): boolean {
  if (policy.allowPrivate || hostAllowed(host, policy)) return true;
  if (!isBlockedAddress(address)) return true;
  const b = ipBytes(address);
  return !!b && policy.cidrs.some((c) => inCidr(b, c));
}

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;
const systemResolver: Resolver = (host) => dnsLookup(host, { all: true, order: "verbatim" });

export type OutboundInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  /** Default 10 s. */
  timeoutMs?: number;
  /** Response bytes read at most. Default 1 MiB. */
  maxBytes?: number;
  /** Over `maxBytes`: cut the body (true) or fail with `too_large` (false, default). */
  truncate?: boolean;
  /**
   * The URL comes from the operator's environment (GITHUB_API_URL, the release check), not from a
   * user: private addresses are allowed. Timeouts, size caps and no-redirects still apply.
   */
  trusted?: boolean;
  /** Tests only. */
  policy?: OutboundPolicy;
  resolver?: Resolver;
};

export type OutboundFetch = (url: string, init?: OutboundInit) => Promise<Response>;

function categorize(err: unknown): OutboundError {
  if (err instanceof OutboundError) return err;
  const code = (err as { code?: string }).code ?? "";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA")
    return new OutboundError("dns_error");
  if (/CERT|TLS|SSL/i.test(code)) return new OutboundError("tls_error");
  return new OutboundError("connection_failed");
}

const NULL_BODY = new Set([101, 204, 205, 304]);

/**
 * A `fetch` replacement for user-supplied URLs. Resolves to a `Response` (any status, 3xx included — a
 * redirect is reported, not followed); rejects only with an `OutboundError`, whose `category` is safe to
 * show to the user.
 */
export const safeFetch: OutboundFetch = async (rawUrl, init = {}) => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new OutboundError("invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new OutboundError("invalid_url");
  if (url.username || url.password)
    throw new OutboundError("invalid_url", "credentials in URLs are not allowed");

  const policy = init.trusted
    ? { allowPrivate: true, hosts: [], cidrs: [] }
    : (init.policy ?? outboundPolicy());
  const resolver = init.resolver ?? systemResolver;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const literal = isIP(host) !== 0;
  if (literal && !addressAllowed(host, host, policy)) throw new OutboundError("blocked_address");

  // Called by net.connect for host names: the addresses checked here are the ones connected to.
  const lookup: LookupFunction = (hostname, options, callback) => {
    resolver(hostname)
      .then((all) => {
        if (!all.length) throw new OutboundError("dns_error");
        // One private answer blocks the whole name: otherwise the connection could pick it.
        if (all.some((a) => !addressAllowed(a.address, hostname, policy))) {
          throw new OutboundError("blocked_address");
        }
        const wanted = options.family === 4 || options.family === 6 ? options.family : 0;
        const usable = wanted ? all.filter((a) => a.family === wanted) : all;
        if (!usable.length) throw new OutboundError("dns_error");
        if (options.all) callback(null, usable);
        else callback(null, usable[0]?.address ?? "", usable[0]?.family ?? 4);
      })
      .catch((err: unknown) => {
        callback(err as NodeJS.ErrnoException, "", 4);
      });
  };

  const maxBytes = init.maxBytes ?? 1024 * 1024;
  const timeoutMs = init.timeoutMs ?? 10_000;
  const mod = url.protocol === "https:" ? https : http;

  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const fail = (err: OutboundError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      reject(err);
    };
    const req = mod.request(
      url,
      {
        method: init.method ?? "GET",
        headers: init.headers,
        // No keep-alive pool: a pooled socket would skip the lookup (and its check) on the next request.
        agent: false,
        ...(literal ? {} : { lookup }),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let cut = false;
        res.on("data", (chunk: Buffer) => {
          if (cut) return;
          size += chunk.length;
          if (size > maxBytes) {
            if (!init.truncate) {
              fail(new OutboundError("too_large"));
              return;
            }
            chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
            cut = true;
            done();
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", done);
        res.on("error", (err) => fail(categorize(err)));
        function done() {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (cut) res.destroy();
          const status = res.statusCode ?? 502;
          const headers = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (v === undefined) continue;
            for (const one of Array.isArray(v) ? v : [v]) headers.append(k, one);
          }
          const body = NULL_BODY.has(status) || status < 200 ? null : Buffer.concat(chunks);
          resolve(new Response(body, { status: status < 200 ? 502 : status, headers }));
        }
      },
    );
    const timer = setTimeout(() => {
      fail(new OutboundError("timeout"));
    }, timeoutMs);
    init.signal?.addEventListener("abort", () => {
      fail(new OutboundError("timeout"));
    });
    req.on("error", (err) => {
      // The lookup's own OutboundError arrives here unchanged.
      fail(categorize(err));
    });
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
};

/** Human text for a failed request: the category only — never the remote response. */
export function outboundErrorText(err: unknown): string {
  const category = err instanceof OutboundError ? err.category : "connection_failed";
  switch (category) {
    case "blocked_address":
      return "blocked: the address is private or reserved (see PINWREN_OUTBOUND_ALLOWLIST)";
    case "timeout":
      return "timed out";
    case "dns_error":
      return "host not found";
    case "tls_error":
      return "TLS error";
    case "too_large":
      return "response too large";
    case "invalid_url":
      return "invalid URL";
    default:
      return "connection failed";
  }
}
