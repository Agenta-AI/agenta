/**
 * Shared SSRF guard: resolve a URL's host and reject it if any resolved address falls in a
 * blocked range. Mirrors the Python webhook validator (`api/oss/src/core/webhooks/utils.py`)
 * range-for-range so the two runtimes agree on what "internal" means — parity is the point
 * (this guard once drifted from the webhook one — keep them in sync).
 *
 * Blocked = private/loopback/link-local/reserved/unspecified (IANA ipv4-special-registry,
 * i.e. Python's `ip.is_private`) OR multicast (224.0.0.0/4). IPv6 is checked against the
 * matching IANA ipv6-special-registry blocks, with IPv4-mapped/compatible addresses unwrapped
 * to their embedded IPv4 and checked against the IPv4 table.
 */
import { isIPv4, isIPv6 } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

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

/** [start, end] inclusive, both as 32-bit unsigned ints. */
type IPv4Range = [number, number];

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return (
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  );
}

function cidr4(base: string, prefix: number): IPv4Range {
  const start = ipv4ToInt(base);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const network = (start & mask) >>> 0;
  // Broadcast = network | ~mask. Works for /0 (mask 0 -> 0xffffffff) where a shift-based
  // size overflows (JS shifts are mod 32, so `1 << 32` is `1`, not 2^32).
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  return [network, broadcast];
}

/** IANA ipv4-special-registry "private" set — mirrors Python's `ipaddress._private_networks`. */
const IPV4_PRIVATE_RANGES: IPv4Range[] = [
  cidr4("0.0.0.0", 8),
  cidr4("10.0.0.0", 8),
  cidr4("127.0.0.0", 8),
  cidr4("169.254.0.0", 16),
  cidr4("172.16.0.0", 12),
  cidr4("192.0.0.0", 29),
  cidr4("192.0.0.170", 31),
  cidr4("192.0.2.0", 24),
  cidr4("192.168.0.0", 16),
  cidr4("198.18.0.0", 15),
  cidr4("198.51.100.0", 24),
  cidr4("203.0.113.0", 24),
  cidr4("240.0.0.0", 4),
  cidr4("255.255.255.255", 32),
];
/** Multicast — not part of `is_private` in Python, checked as its own predicate. */
const IPV4_MULTICAST: IPv4Range = cidr4("224.0.0.0", 4);

function isBlockedIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return (
    IPV4_PRIVATE_RANGES.some(([lo, hi]) => n >= lo && n <= hi) ||
    (n >= IPV4_MULTICAST[0] && n <= IPV4_MULTICAST[1])
  );
}

/** Expand an IPv6 literal (already bracket-stripped) to 8 hextets, resolving `::`. */
function expandIPv6(ip: string): number[] {
  const [head, tail] = ip.split("::");
  const headParts = head ? head.split(":").filter(Boolean) : [];
  const tailParts = tail ? tail.split(":").filter(Boolean) : [];
  const missing = 8 - headParts.length - tailParts.length;
  const zeros = tail !== undefined ? Array(Math.max(missing, 0)).fill("0") : [];
  const all = [...headParts, ...zeros, ...tailParts];
  return all.map((h) => parseInt(h, 16) || 0);
}

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

  const isZero = (n: number) => n === 0;
  if (hextets.every(isZero)) return true; // ::  (unspecified)
  if (hextets.slice(0, 7).every(isZero) && hextets[7] === 1) return true; // ::1 (loopback)
  if ((hextets[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
  if ((hextets[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 (unique-local/private)
  if ((hextets[0] & 0xff00) === 0xff00) return true; // ff00::/8 (multicast)
  if (
    hextets[0] === 0x0100 &&
    hextets[1] === 0 &&
    hextets[2] === 0 &&
    hextets[3] === 0
  )
    return true; // 100::/64 (discard-only)
  if (hextets[0] === 0x2001) {
    if (hextets[1] === 0 && (hextets[2] & 0xfe00) === 0) return true; // 2001::/23
    if (hextets[1] === 2 && hextets[2] === 0) return true; // 2001:2::/48
    if (hextets[1] === 0xdb8) return true; // 2001:db8::/32
    if ((hextets[1] & 0xfff0) === 0x10 && hextets[1] >> 4 === 1) return true; // 2001:10::/28
  }
  return false;
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
