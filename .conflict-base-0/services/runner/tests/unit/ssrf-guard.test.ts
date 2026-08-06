/**
 * Unit tests for the shared SSRF guard (`tools/ssrf-guard.ts`) — the resolve-and-range-block
 * logic mirrored from the webhook validator (`api/oss/src/core/webhooks/utils.py`). Covers the
 * range table directly (`isBlockedIpLiteral`) plus the DNS-resolution path (`resolveAndCheckHost`,
 * with `node:dns/promises` mocked so this stays network-free).
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/ssrf-guard.test.ts)
 */
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";

// `node:dns/promises` is ESM-native and not spy-able via vi.spyOn (non-configurable exports),
// so mock the module and control `lookup` per test through this hoisted mock.
const dnsLookupMock = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup: dnsLookupMock }));

import {
  insecureEgressAllowed,
  isBlockedIpLiteral,
  resolveAndCheckHost,
} from "../../src/tools/ssrf-guard.ts";
import { validateUserMcpUrl } from "../../src/engines/sandbox_agent/mcp.ts";

describe("isBlockedIpLiteral — IPv4", () => {
  it("blocks loopback, private, link-local, reserved, multicast, unspecified", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata host
      "0.0.0.0",
      "224.0.0.1", // multicast
      "240.0.0.1", // reserved
      "255.255.255.255",
      "192.0.2.1", // documentation (TEST-NET-1)
      "198.51.100.1", // documentation (TEST-NET-2)
      "203.0.113.1", // documentation (TEST-NET-3)
      "198.18.0.1", // benchmarking
    ]) {
      assert.equal(isBlockedIpLiteral(ip), true, `${ip} should be blocked`);
    }
  });

  it("allows routable public addresses", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "1.1.1.1", "100.64.0.1"]) {
      assert.equal(isBlockedIpLiteral(ip), false, `${ip} should be allowed`);
    }
  });

  it("blocks hex/octal/integer IPv4 forms once normalized by URL parsing", () => {
    // new URL() normalizes these to dotted-decimal before the guard ever sees the host —
    // confirms the guard blocks the normalized literal, closing the evasion.
    const forms = ["0x7f000001", "017700000001", "2130706433", "0x7f.0.0.1"];
    for (const raw of forms) {
      const host = new URL(`http://${raw}/`).hostname;
      assert.equal(
        isBlockedIpLiteral(host),
        true,
        `${raw} -> ${host} should be blocked`,
      );
    }
  });
});

describe("isBlockedIpLiteral — IPv6", () => {
  it("blocks loopback, unspecified, link-local, unique-local, multicast", () => {
    for (const ip of [
      "::1",
      "::",
      "fe80::1",
      "fc00::1",
      "fd00::1",
      "ff02::1",
    ]) {
      assert.equal(isBlockedIpLiteral(ip), true, `${ip} should be blocked`);
    }
  });

  it("blocks IPv4-mapped and IPv4-compatible addresses embedding a blocked IPv4", () => {
    for (const raw of [
      "::ffff:127.0.0.1",
      "::ffff:169.254.169.254",
      "::127.0.0.1",
      "0:0:0:0:0:ffff:127.0.0.1",
    ]) {
      const host = new URL(`http://[${raw}]/`).hostname.replace(/^\[|\]$/g, "");
      assert.equal(
        isBlockedIpLiteral(host),
        true,
        `${raw} -> ${host} should be blocked`,
      );
    }
  });

  it("allows an IPv4-mapped address embedding a public IPv4", () => {
    const host = new URL("http://[::ffff:93.184.216.34]/").hostname.replace(
      /^\[|\]$/g,
      "",
    );
    assert.equal(isBlockedIpLiteral(host), false);
  });

  it("allows a public IPv6 address", () => {
    assert.equal(
      isBlockedIpLiteral("2606:2800:220:1:248:1893:25c8:1946"),
      false,
    );
  });
});

describe("resolveAndCheckHost — DNS resolution path", () => {
  afterEach(() => {
    dnsLookupMock.mockReset();
  });

  it("passes a literal IP through without a DNS lookup", async () => {
    const result = await resolveAndCheckHost("93.184.216.34");
    assert.deepEqual(result, { resolvedIps: ["93.184.216.34"] });
    assert.equal(dnsLookupMock.mock.calls.length, 0);
  });

  it("rejects a literal blocked IP without a DNS lookup", async () => {
    const result = await resolveAndCheckHost("127.0.0.1");
    assert.match(result.error ?? "", /blocked IP range/);
    assert.equal(dnsLookupMock.mock.calls.length, 0);
  });

  it("rejects a hostname that resolves to a private address (rebind protection)", async () => {
    dnsLookupMock.mockResolvedValue([{ address: "192.168.1.100", family: 4 }]);

    const result = await resolveAndCheckHost("internal.example.com");
    assert.match(result.error ?? "", /blocked IP range/);
  });

  it("accepts a hostname that resolves to a public address", async () => {
    dnsLookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);

    const result = await resolveAndCheckHost("example.com");
    assert.deepEqual(result, { resolvedIps: ["93.184.216.34"] });
  });

  it("rejects when any of multiple resolved addresses is blocked", async () => {
    dnsLookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);

    const result = await resolveAndCheckHost("multi.example.com");
    assert.match(result.error ?? "", /blocked IP range/);
  });

  it("rejects an unresolvable hostname", async () => {
    dnsLookupMock.mockRejectedValue(new Error("ENOTFOUND"));

    const result = await resolveAndCheckHost("this-does-not-exist.invalid");
    assert.match(result.error ?? "", /could not be resolved/);
  });
});

describe("insecureEgressAllowed + validateUserMcpUrl bypass", () => {
  const KEYS = [
    "AGENTA_INSECURE_EGRESS_ALLOWED",
    "AGENTA_WEBHOOKS_ALLOW_INSECURE",
    "AGENTA_WEBHOOK_ALLOW_INSECURE",
    "AGENTA_AGENT_MCPS_HOST_ALLOWLIST",
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("reads the canonical flag and its deprecated aliases", () => {
    assert.equal(insecureEgressAllowed(), true, "unset -> true (permissive default)");
    process.env.AGENTA_INSECURE_EGRESS_ALLOWED = "false";
    assert.equal(insecureEgressAllowed(), false, "canonical false hardens");
    delete process.env.AGENTA_INSECURE_EGRESS_ALLOWED;
    process.env.AGENTA_WEBHOOK_ALLOW_INSECURE = "0";
    assert.equal(insecureEgressAllowed(), false, "deprecated alias false hardens");
  });

  it("agrees with the Python side: unset is permissive, explicit false hardens", () => {
    // Mirrors api/oss/src/utils/env.py's WebhooksConfig.allow_insecure default (`or "true"`).
    assert.equal(insecureEgressAllowed(), true, "unset -> permissive on both sides");
    for (const falsy of ["false", "0", "no", "off"]) {
      process.env.AGENTA_INSECURE_EGRESS_ALLOWED = falsy;
      assert.equal(insecureEgressAllowed(), false, `"${falsy}" -> hardened`);
    }
  });

  it("allows http and private MCP hosts when egress is unrestricted (default)", async () => {
    assert.equal(await validateUserMcpUrl("http://example.com/sse"), undefined);
    assert.equal(await validateUserMcpUrl("http://127.0.0.1/sse"), undefined);
  });

  it("blocks http and private MCP hosts when egress is explicitly restricted", async () => {
    process.env.AGENTA_INSECURE_EGRESS_ALLOWED = "false";
    assert.match(
      (await validateUserMcpUrl("http://example.com/sse")) ?? "",
      /must use https/,
    );
    assert.match(
      (await validateUserMcpUrl("https://127.0.0.1/sse")) ?? "",
      /internal\/metadata host/,
    );
  });

  it("surfaces a DNS-resolution failure distinctly from an SSRF block", async () => {
    process.env.AGENTA_INSECURE_EGRESS_ALLOWED = "false";
    dnsLookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    const msg = (await validateUserMcpUrl("https://nope.invalid/sse")) ?? "";
    assert.match(msg, /could not be resolved/);
    assert.doesNotMatch(msg, /internal\/metadata host/);
    dnsLookupMock.mockReset();
  });
});
