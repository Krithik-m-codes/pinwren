import { isIP } from "node:net";

// IP parsing and classification for outbound requests (SSRF guard, ADR 0021). Bytes, not strings, so
// every spelling of an address ("::ffff:127.0.0.1", "0:0:0:0:0:ffff:7f00:1", "[::1]") compares the same.

export type Cidr = { bytes: Uint8Array; prefix: number };

function v4Bytes(s: string): Uint8Array | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  const out = new Uint8Array(4);
  for (const [i, p] of parts.entries()) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out[i] = n;
  }
  return out;
}

function v6Bytes(input: string): Uint8Array | null {
  let s = input.replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  // A dotted IPv4 tail ("::ffff:1.2.3.4") becomes two hex groups.
  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (dotted?.[1]) {
    const v4 = v4Bytes(dotted[1]);
    if (!v4) return null;
    const hex = (a: number, b: number) => ((a << 8) | b).toString(16);
    s = `${s.slice(0, -dotted[1].length)}${hex(v4[0] ?? 0, v4[1] ?? 0)}:${hex(v4[2] ?? 0, v4[3] ?? 0)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...new Array<string>(fill).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const out = new Uint8Array(16);
  for (const [i, g] of groups.entries()) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    const n = Number.parseInt(g, 16);
    out[i * 2] = n >> 8;
    out[i * 2 + 1] = n & 0xff;
  }
  return out;
}

/** 4 bytes for IPv4, 16 for IPv6, null for anything else (host names included). */
export function ipBytes(ip: string): Uint8Array | null {
  const s = ip.trim().replace(/^\[|\]$/g, "");
  const kind = isIP(s.split("%")[0] ?? "");
  if (kind === 4) return v4Bytes(s);
  if (kind === 6) return v6Bytes(s);
  return null;
}

export function parseCidr(raw: string): Cidr | null {
  const [addr, len] = raw.trim().split("/");
  const bytes = addr ? ipBytes(addr) : null;
  if (!bytes) return null;
  const max = bytes.length * 8;
  const prefix = len === undefined ? max : Number(len);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) return null;
  return { bytes, prefix };
}

export function inCidr(bytes: Uint8Array, cidr: Cidr): boolean {
  if (bytes.length !== cidr.bytes.length) return false;
  let bits = cidr.prefix;
  for (let i = 0; bits > 0; i++, bits -= 8) {
    const mask = bits >= 8 ? 0xff : (0xff << (8 - bits)) & 0xff;
    if (((bytes[i] ?? 0) & mask) !== ((cidr.bytes[i] ?? 0) & mask)) return false;
  }
  return true;
}

const cidrs = (list: string[]) =>
  list.map((c) => {
    const parsed = parseCidr(c);
    if (!parsed) throw new Error(`bad CIDR ${c}`);
    return parsed;
  });

/** Non-public IPv4: this-network, private, CGNAT (incl. cloud metadata 100.100.100.200), loopback, link-local (169.254.169.254), documentation, benchmarking, multicast, reserved, broadcast. */
const BLOCKED_V4 = cidrs([
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
]);

/** Non-public IPv6: unspecified, loopback, IPv4-compatible, discard, IETF/Teredo, documentation, ULA (incl. fd00:ec2::254), site-local, link-local, multicast. */
const BLOCKED_V6 = cidrs([
  "::/128",
  "::1/128",
  "::/96",
  "100::/64",
  "2001::/23",
  "2001:db8::/32",
  "fc00::/7",
  "fec0::/10",
  "fe80::/10",
  "ff00::/8",
]);

const MAPPED = cidrs(["::ffff:0:0/96", "64:ff9b::/96", "64:ff9b:1::/48"]);
const SIX_TO_FOUR = cidrs(["2002::/16"]);

/**
 * True for every address an outbound request must not reach by default. IPv6 forms that embed an IPv4
 * address (mapped, NAT64, 6to4) are judged by that IPv4 address. Unparseable input is blocked.
 */
export function isBlockedAddress(ip: string): boolean {
  const b = ipBytes(ip);
  if (!b) return true;
  if (b.length === 4) return BLOCKED_V4.some((c) => inCidr(b, c));
  if (MAPPED.some((c) => inCidr(b, c))) return isBlockedAddress(Array.from(b.slice(12)).join("."));
  if (SIX_TO_FOUR.some((c) => inCidr(b, c))) return isBlockedAddress(Array.from(b.slice(2, 6)).join("."));
  return BLOCKED_V6.some((c) => inCidr(b, c));
}
