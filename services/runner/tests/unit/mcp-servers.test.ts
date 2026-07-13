/**
 * Unit tests for the user-declared MCP server conversion — HTTP enabled, stdio disabled.
 *
 * `resolve_mcp_servers` (Python) emits the McpServerConfig wire shape; the wire is unchanged.
 *
 * - HTTP (`transport: "http"` + `url`) is DELIVERED. A remote server has no child process on the
 *   runner host: the harness connects to the URL with the named secret in a request header, so it
 *   does not bypass the sandbox boundary. The resolved secret arrives on the wire under the
 *   server's `env` map (the SDK resolver merges named secrets into `env` regardless of transport,
 *   and the wire has no separate `headers` field), so each `env` entry becomes an HTTP header.
 * - STDIO is DISABLED: a stdio server runs an arbitrary process on the RUNNER HOST, outside the
 *   sandbox boundary, so it throws `USER_MCP_UNSUPPORTED_MESSAGE` (parity with the removed code
 *   execution) until its security is fixed.
 * - A command-less stdio server or a url-less http server was never deliverable and is skipped.
 *
 * The SSRF guard resolves hostnames via DNS (`tools/ssrf-guard.ts`), so tests here use IP literals
 * to stay network-free; the DNS-resolution path itself is covered in `ssrf-guard.test.ts`.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/mcp-servers.test.ts)
 */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import { toAcpMcpServers } from "../../src/engines/sandbox_agent.ts";
import type { McpServerHttp } from "../../src/engines/sandbox_agent/mcp.ts";
import { USER_MCP_UNSUPPORTED_MESSAGE } from "../../src/tools/mcp-bridge.ts";
import type { McpServerConfig } from "../../src/protocol.ts";

describe("toAcpMcpServers (http enabled, stdio disabled)", () => {
  it("maps empty input to []", async () => {
    assert.deepEqual(await toAcpMcpServers(undefined), [], "undefined -> []");
    assert.deepEqual(await toAcpMcpServers([]), [], "[] -> []");
  });

  it("throws the unsupported error for a stdio server", async () => {
    const servers: McpServerConfig[] = [
      {
        name: "github",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_x", LOG_LEVEL: "info" },
      },
    ];
    await assert.rejects(
      () => toAcpMcpServers(servers),
      new RegExp(USER_MCP_UNSUPPORTED_MESSAGE),
    );
  });

  it("delivers an http server, routing the resolved secret into a header", async () => {
    const out = await toAcpMcpServers([
      {
        name: "linear",
        transport: "http",
        url: "https://93.184.216.34/sse",
        // The SDK resolver put the resolved `linear-mcp-token` secret here under the
        // author-chosen header name "Authorization"; the wire has no separate `headers` key.
        env: { Authorization: "Bearer secret-token-value" },
      },
    ]);

    assert.equal(out.length, 1, "one server delivered");
    const server = out[0] as McpServerHttp;
    assert.equal(server.type, "http", "ACP http variant");
    assert.equal(server.name, "linear");
    assert.equal(server.url, "https://93.184.216.34/sse");
    assert.deepEqual(
      server.headers,
      [{ name: "Authorization", value: "Bearer secret-token-value" }],
      "env entry -> request header",
    );
  });

  it("delivers an http server with no secrets as an empty header list", async () => {
    const out = await toAcpMcpServers([
      { name: "public", transport: "http", url: "https://93.184.216.34/sse" },
    ]);
    const server = out[0] as McpServerHttp;
    assert.equal(server.type, "http");
    assert.deepEqual(server.headers, [], "no env -> no headers");
  });

  it("does not throw on a mix of http (delivered) and command-less stdio (skipped)", async () => {
    const out = await toAcpMcpServers([
      {
        name: "remote",
        transport: "http",
        url: "https://93.184.216.34/mcp",
        env: { "X-Api-Key": "k" },
      },
      { name: "broken", transport: "stdio" }, // no command -> never launched, skipped
      { name: "no-url", transport: "http" }, // no url -> never deliverable, skipped
    ]);

    assert.equal(out.length, 1, "only the valid http server is delivered");
    assert.equal((out[0] as McpServerHttp).name, "remote");
  });
});

describe("toAcpMcpServers SSRF guard (http url scheme/host)", () => {
  const previousAllowlist = process.env.AGENTA_AGENT_MCPS_HOST_ALLOWLIST;
  // Egress defaults permissive (unset -> allowed); this suite exercises the guard, so arm it.
  beforeEach(() => {
    process.env.AGENTA_INSECURE_EGRESS_ALLOWED = "false";
  });
  afterEach(() => {
    delete process.env.AGENTA_INSECURE_EGRESS_ALLOWED;
    if (previousAllowlist === undefined)
      delete process.env.AGENTA_AGENT_MCPS_HOST_ALLOWLIST;
    else process.env.AGENTA_AGENT_MCPS_HOST_ALLOWLIST = previousAllowlist;
  });

  const http = (url: string): McpServerConfig[] => [
    {
      name: "s",
      transport: "http",
      url,
      env: { Authorization: "Bearer secret" },
    },
  ];

  it("rejects a non-https url (the secret would ride in clear text)", async () => {
    await assert.rejects(
      () => toAcpMcpServers(http("http://93.184.216.34/sse")),
      /must use https/,
    );
  });

  it("rejects the cloud metadata host (169.254.169.254)", async () => {
    await assert.rejects(
      () => toAcpMcpServers(http("https://169.254.169.254/latest/meta-data/")),
      /internal\/metadata host/,
    );
  });

  it("rejects localhost and loopback / private literals", async () => {
    for (const url of [
      "https://localhost/mcp",
      "https://127.0.0.1/mcp",
      "https://10.0.0.5/mcp",
      "https://192.168.1.10/mcp",
      "https://172.16.4.4/mcp",
      "https://[::1]/mcp",
    ]) {
      await assert.rejects(
        () => toAcpMcpServers(http(url)),
        /internal\/metadata host/,
        `should reject ${url}`,
      );
    }
  });

  it("rejects hex/octal/integer IPv4 and IPv4-mapped IPv6 evasions", async () => {
    for (const url of [
      "https://0x7f000001/mcp", // hex IPv4 -> 127.0.0.1
      "https://017700000001/mcp", // octal IPv4 -> 127.0.0.1
      "https://2130706433/mcp", // integer IPv4 -> 127.0.0.1
      "https://[::ffff:127.0.0.1]/mcp", // IPv4-mapped IPv6 loopback
      "https://[::ffff:169.254.169.254]/mcp", // IPv4-mapped IPv6 metadata host
    ]) {
      await assert.rejects(
        () => toAcpMcpServers(http(url)),
        /internal\/metadata host/,
        `should reject ${url}`,
      );
    }
  });

  it("rejects a malformed url", async () => {
    await assert.rejects(
      () => toAcpMcpServers(http("not a url")),
      /not a valid URL/,
    );
  });

  it("allows a public ip literal unchanged", async () => {
    const out = await toAcpMcpServers(http("https://93.184.216.34/sse"));
    assert.equal(out.length, 1);
    assert.equal((out[0] as McpServerHttp).url, "https://93.184.216.34/sse");
  });

  it("allowlist opts a host out of the https + internal-host checks", async () => {
    process.env.AGENTA_AGENT_MCPS_HOST_ALLOWLIST = "localhost,10.0.0.5";
    // http://localhost is normally rejected twice over (non-https + internal); allowlisted -> ok.
    const out = await toAcpMcpServers(http("http://localhost:9000/mcp"));
    assert.equal(out.length, 1, "allowlisted host is delivered");
    assert.equal((out[0] as McpServerHttp).url, "http://localhost:9000/mcp");
    // A private IP literal in the allowlist is also permitted.
    assert.equal(
      (await toAcpMcpServers(http("https://10.0.0.5/mcp"))).length,
      1,
      "allowlisted private literal delivered",
    );
    // A host NOT in the allowlist is still rejected.
    await assert.rejects(
      () => toAcpMcpServers(http("https://127.0.0.1/mcp")),
      /internal\/metadata host/,
    );
  });
});
