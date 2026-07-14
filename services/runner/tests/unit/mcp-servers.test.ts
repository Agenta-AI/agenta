/** External HTTP MCP conversion and SSRF policy. */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import { toAcpMcpServers } from "../../src/engines/sandbox_agent.ts";
import type { McpServerHttp } from "../../src/engines/sandbox_agent/mcp.ts";
import type { McpServerConfig } from "../../src/protocol.ts";

const http = (
  url: string,
  headers: Record<string, string> = { Authorization: "Bearer secret" },
): McpServerConfig[] => [
  {
    name: "s",
    connection: { type: "http", url, headers },
    policy: { tools: { mode: "all" } },
  },
];

describe("toAcpMcpServers", () => {
  it("maps empty input to []", async () => {
    assert.deepEqual(await toAcpMcpServers(undefined), [], "undefined -> []");
    assert.deepEqual(await toAcpMcpServers([]), [], "[] -> []");
  });

  it("delivers an HTTP server with resolved headers", async () => {
    const servers = http("https://93.184.216.34/sse", {
      Authorization: "Bearer secret-token-value",
    });
    servers[0].name = "linear";
    const out = await toAcpMcpServers(servers);

    assert.equal(out.length, 1, "one server delivered");
    const server = out[0] as McpServerHttp;
    assert.equal(server.type, "http", "ACP http variant");
    assert.equal(server.name, "linear");
    assert.equal(server.url, "https://93.184.216.34/sse");
    assert.deepEqual(
      server.headers,
      [{ name: "Authorization", value: "Bearer secret-token-value" }],
      "resolved header is delivered to ACP",
    );
  });

  it("delivers an http server with no secrets as an empty header list", async () => {
    const out = await toAcpMcpServers(http("https://93.184.216.34/sse", {}));
    const server = out[0] as McpServerHttp;
    assert.equal(server.type, "http");
    assert.deepEqual(server.headers, [], "no headers stays empty");
  });
});

describe("toAcpMcpServers SSRF guard (http url scheme/host)", () => {
  const previousAllowlist = process.env.AGENTA_AGENT_MCPS_HOST_ALLOWLIST;
  beforeEach(() => {
    process.env.AGENTA_INSECURE_EGRESS_ALLOWED = "false";
  });
  afterEach(() => {
    delete process.env.AGENTA_INSECURE_EGRESS_ALLOWED;
    if (previousAllowlist === undefined)
      delete process.env.AGENTA_AGENT_MCPS_HOST_ALLOWLIST;
    else process.env.AGENTA_AGENT_MCPS_HOST_ALLOWLIST = previousAllowlist;
  });

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
