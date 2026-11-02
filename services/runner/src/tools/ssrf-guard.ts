/**
 * Shared SSRF guard: resolve a URL's host and reject it if any resolved address falls in a
 * blocked range. The range tables (`ssrf-guard-ranges.generated.json`) are generated from
 * Python's `ipaddress` module (`sdks/python/oss/tests/pytest/utils/ssrf_guard_vectors.py`),
 * not hand-transcribed — a Python test regenerates and diffs them against the committed file,
 * and `tests/unit/ssrf-guard-vectors.test.ts` asserts this guard's verdict against a shared
 * fixture of boundary addresses labeled from the same source, so the two runtimes can't drift
 * apart silently.
 *
 * Blocked = private/loopback/link-local/reserved/unspecified (IANA ipv4-special-registry,
 * i.e. Python's `ip.is_private`) OR multicast. IPv6 is checked against the matching IANA
 * ipv6-special-registry blocks, with IPv4-mapped/compatible addresses unwrapped to their
 * embedded IPv4 and checked against the IPv4 table first — mirroring `ipaddress.IPv6Address`,
 * which special-cases `ipv4_mapped` before falling back to IPv6 network membership.
 */
import { isIPv4, isIPv6 } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const _TRUTHY = new Set([
  "true",
  "1",
  "t",
  "y",
  "yes",
  "on",
  "enable",
  "enabled",
]);

/**
 * Whether outbound egress is unrestricted. Mirrors the Python SDK/API flag: reads
 * `AGENTA_INSECURE_EGRESS_ALLOWED` (canonical) with the deprecated `AGENTA_WEBHOOKS_ALLOW_INSECURE`
 * / `AGENTA_WEBHOOK_ALLOW_INSECURE` aliases. When true, http and private/loopback/link-local/
 * metadata targets are permitted (trusted/single-tenant deployments only). Read per-call so tests
 * and hot-reconfig see the current env.
 *
 * Defaults permissive (unset -> true) to match the Python side (`env.py`'s `WebhooksConfig`):
 * zero-config self-host must work out of the box; harden a shared/prod deployment by setting
 * this to `false`.
 */
export function insecureEgressAllowed(): boolean {
  const raw =
    process.env.AGENTA_INSECURE_EGRESS_ALLOWED ??
    process.env.AGENTA_WEBHOOKS_ALLOW_INSECURE ??
    process.env.AGENTA_WEBHOOK_ALLOW_INSECURE ??
    "true";
  return _TRUTHY.has(raw.toLowerCase());
}

const here = dirname(fileURLToPath(import.meta.url));
const RANGES: { ipv4: string[]; ipv6: string[] } = JSON.parse(
  readFileSync(join(here, "ssrf-guard-ranges.generated.json"), "utf-8"),
);

/** [start, end] inclusive, both as 32-bit unsigned ints. */
type IPv4Range = [number, number];

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return (
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  );
}

function cidr4(cidr: string): IPv4Range {
  const [base, prefixStr] = cidr.split("/");
  const prefix = Number(prefixStr);
  const start = ipv4ToInt(base);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const network = (start & mask) >>> 0;
  // Broadcast = network | ~mask. Works for /0 (mask 0 -> 0xffffffff) where a shift-based
  // size overflows (JS shifts are mod 32, so `1 << 32` is `1`, not 2^32).
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  return [network, broadcast];
}

const IPV4_RANGES: IPv4Range[] = RANGES.ipv4.map(cidr4);

function isBlockedIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return IPV4_RANGES.some(([lo, hi]) => n >= lo && n <= hi);
}

/** Rewrite a trailing embedded IPv4 dotted-quad (e.g. `::ffff:93.184.216.34`) to its two hex
 *  hextets, so `expandIPv6` sees pure hex groups regardless of whether the caller already
 *  ran the literal through `new URL()` (which normalizes this for us). */
function normalizeEmbeddedIPv4(ip: string): string {
  const lastColon = ip.lastIndexOf(":");
  if (lastColon === -1) return ip;
  const tail = ip.slice(lastColon + 1);
  if (!tail.includes(".")) return ip;
  const parts = tail.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255))
    return ip;
  const hi = ((parts[0] << 8) | parts[1]).toString(16);
  const lo = ((parts[2] << 8) | parts[3]).toString(16);
  return `${ip.slice(0, lastColon + 1)}${hi}:${lo}`;
}

/** Expand an IPv6 literal (already bracket-stripped) to 8 hextets, resolving `::`. */
function expandIPv6(rawIp: string): number[] {
  const ip = normalizeEmbeddedIPv4(rawIp);
  const [head, tail] = ip.split("::");
  const headParts = head ? head.split(":").filter(Boolean) : [];
  const tailParts = tail ? tail.split(":").filter(Boolean) : [];
  const missing = 8 - headParts.length - tailParts.length;
  const zeros = tail !== undefined ? Array(Math.max(missing, 0)).fill("0") : [];
  const all = [...headParts, ...zeros, ...tailParts];
  return all.map((h) => parseInt(h, 16) || 0);
}

function hextetsToBigInt(hextets: number[]): bigint {
  let value = 0n;
  for (const h of hextets) value = (value << 16n) | BigInt(h);
  return value;
}

/** [start, end] inclusive, both as 128-bit unsigned bigints. */
type IPv6Range = [bigint, bigint];

const IPV6_MAX = (1n << 128n) - 1n;

function cidr6(cidr: string): IPv6Range {
  const [base, prefixStr] = cidr.split("/");
  const prefix = Number(prefixStr);
  const start = hextetsToBigInt(expandIPv6(base));
  const mask = prefix === 0 ? 0n : (IPV6_MAX << BigInt(128 - prefix)) & IPV6_MAX;
  const network = start & mask;
  const broadcast = network | (~mask & IPV6_MAX);
  return [network, broadcast];
}

const IPV6_RANGES: IPv6Range[] = RANGES.ipv6.map(cidr6);

/** Extract the embedded IPv4 from an IPv4-mapped (`::ffff:a.b.c.d`) or IPv4-compatible
 *  (`::a.b.c.d`) address, or `undefined` if this is not such an address. */
function embeddedIPv4(hextets: number[]): string | undefined {
  const [h0, h1, h2, h3, h4, h5] = hextets;
  const isMapped =
    h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0xffff;
  const isCompat =
    h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0;
  if (!isMapped && !isCompat) return undefined;
  const [a, b] = [hextets[6] >> 8, hextets[6] & 0xff];
  const [c, d] = [hextets[7] >> 8, hextets[7] & 0xff];
  return `${a}.${b}.${c}.${d}`;
}

function isBlockedIPv6(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, "");
  const hextets = expandIPv6(bare);

  const mapped = embeddedIPv4(hextets);
  if (mapped) return isBlockedIPv4(mapped);

  const n = hextetsToBigInt(hextets);
  return IPV6_RANGES.some(([lo, hi]) => n >= lo && n <= hi);
}

/** True if `host` (a literal IPv4/IPv6 address) falls in a blocked range. */
export function isBlockedIpLiteral(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIPv4(bare)) return isBlockedIPv4(bare);
  if (isIPv6(bare)) return isBlockedIPv6(bare);
  return false;
}

export interface SsrfGuardResult {
  /** Set when the URL is rejected; `undefined` means it is allowed. */
  error?: string;
  /** The literal IP(s) the host resolved to, when resolution happened. */
  resolvedIps?: string[];
}

/**
 * Resolve `hostname` via DNS and reject if any resolved address is blocked. A literal IP
 * host (already caught by `isBlockedIpLiteral` at the call site) does not need this — this
 * is the rebind-protection path for actual hostnames.
 */
export async function resolveAndCheckHost(
  hostname: string,
): Promise<SsrfGuardResult> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (isIPv4(bare) || isIPv6(bare)) {
    return isBlockedIpLiteral(bare)
      ? { error: `host resolves to a blocked IP range: ${bare}` }
      : { resolvedIps: [bare] };
  }
  let results: { address: string }[];
  try {
    results = await dnsLookup(hostname, { all: true, verbatim: true });
  } catch {
    return { error: `host could not be resolved: ${hostname}` };
  }
  if (results.length === 0) {
    return { error: `host could not be resolved: ${hostname}` };
  }
  const blocked = results.find((r) => isBlockedIpLiteral(r.address));
  if (blocked) {
    return { error: `host resolves to a blocked IP range: ${blocked.address}` };
  }
  return { resolvedIps: results.map((r) => r.address) };
}
