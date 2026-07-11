/** Unit tests for typed user HTTP-MCP credentials and SSRF validation. */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import { toAcpMcpServers } from "../../src/engines/sandbox_agent.ts";
import {
  validateUserMcpServers,
  type McpServerHttp,
} from "../../src/engines/sandbox_agent/mcp.ts";
import { USER_MCP_UNSUPPORTED_MESSAGE } from "../../src/tools/mcp-bridge.ts";
import type { McpServerConfig } from "../../src/protocol.ts";

const credential = (name = "Authorization", value = "Bearer secret") => ({
  binding: { kind: "header" as const, name },
  value,
  usage: "opaque_http" as const,
});
const http = (url: string): McpServerConfig[] => [
  {
    name: "s",
    transport: "http",
    url,
    credentials: [credential()],
  },
];

describe("toAcpMcpServers typed credential materialization", () => {
  it("maps empty input to []", async () => {
    assert.deepEqual(await toAcpMcpServers(undefined), []);
    assert.deepEqual(await toAcpMcpServers([]), []);
  });

  it("keeps stdio disabled even with non-secret process environment", async () => {
    await assert.rejects(
      () =>
        toAcpMcpServers([
          {
            name: "github",
            transport: "stdio",
            command: "npx",
            environment: { LOG_LEVEL: "info" },
          },
        ]),
      new RegExp(USER_MCP_UNSUPPORTED_MESSAGE),
    );
  });

  it("combines public headers and secret bindings only at the ACP boundary", async () => {
    const out = await toAcpMcpServers([
      {
        name: "linear",
        transport: "http",
        url: "https://93.184.216.34:8443/sse",
        headers: { "X-Client": "agenta" },
        credentials: [credential("Authorization", "Bearer secret-token-value")],
      },
    ]);
    const server = out[0] as McpServerHttp;
    assert.equal(
      server.url,
      "https://93.184.216.34:8443/sse",
      "exact URL and port preserved",
    );
    assert.deepEqual(server.headers, [
      { name: "X-Client", value: "agenta" },
      { name: "Authorization", value: "Bearer secret-token-value" },
    ]);
  });

  it("delivers a public HTTP server with no headers", async () => {
    const out = await toAcpMcpServers([
      { name: "public", transport: "http", url: "https://93.184.216.34/sse" },
    ]);
    assert.deepEqual((out[0] as McpServerHttp).headers, []);
  });

  it("skips structurally incomplete servers", async () => {
    const out = await toAcpMcpServers([
      {
        name: "remote",
        transport: "http",
        url: "https://93.184.216.34/mcp",
        credentials: [credential("X-Api-Key", "k-secret")],
      },
      { name: "broken", transport: "stdio" },
      { name: "no-url", transport: "http" },
    ]);
    assert.deepEqual(
      out.map((server) => server.name),
      ["remote"],
    );
  });
});

describe("validateUserMcpServers role validation", () => {
  it("rejects process environment on HTTP and HTTP fields on stdio", async () => {
    await assert.rejects(
      () =>
        validateUserMcpServers([
          {
            name: "s",
            transport: "http",
            url: "https://93.184.216.34",
            environment: { TOKEN: "x" },
          },
        ]),
      /cannot carry process environment/,
    );
    await assert.rejects(
      () =>
        validateUserMcpServers([
          { name: "s", transport: "stdio", command: "x", headers: { X: "y" } },
        ]),
      /cannot carry HTTP headers/,
    );
  });

  it("rejects empty or malformed credentials and headers", async () => {
    const cases: McpServerConfig[] = [
      {
        name: "s",
        transport: "http",
        url: "https://93.184.216.34",
        headers: { "": "x" },
      },
      {
        name: "s",
        transport: "http",
        url: "https://93.184.216.34",
        headers: { X: "" },
      },
      {
        name: "s",
        transport: "http",
        url: "https://93.184.216.34",
        credentials: [credential("", "secret")],
      },
      {
        name: "s",
        transport: "http",
        url: "https://93.184.216.34",
        credentials: [credential("X", "")],
      },
      {
        name: "s",
        transport: "http",
        url: "https://93.184.216.34",
        credentials: [
          { ...credential("X", "secret"), usage: "environment" as never },
        ],
      },
    ];
    for (const server of cases)
      await assert.rejects(() => validateUserMcpServers([server]));
  });

  it("rejects duplicate public and secret bindings case-insensitively", async () => {
    await assert.rejects(
      () =>
        validateUserMcpServers([
          {
            name: "s",
            transport: "http",
            url: "https://93.184.216.34",
            headers: { Authorization: "public" },
            credentials: [credential("authorization", "secret")],
          },
        ]),
      /duplicate HTTP MCP header binding/,
    );
  });
});

describe("HTTP-MCP SSRF guard", () => {
  const previousAllowlist = process.env.AGENTA_AGENT_MCPS_HOST_ALLOWLIST;
  afterEach(() => {
    if (previousAllowlist === undefined)
      delete process.env.AGENTA_AGENT_MCPS_HOST_ALLOWLIST;
    else process.env.AGENTA_AGENT_MCPS_HOST_ALLOWLIST = previousAllowlist;
  });

  it("always rejects non-HTTPS, including allowlisted hosts", async () => {
    process.env.AGENTA_AGENT_MCPS_HOST_ALLOWLIST = "localhost";
    await assert.rejects(
      () => toAcpMcpServers(http("http://localhost:9000/mcp")),
      /must use https/,
    );
  });

  it("rejects metadata, localhost, private, malformed, and address-evasion URLs", async () => {
    for (const url of [
      "https://169.254.169.254/latest/meta-data/",
      "https://localhost/mcp",
      "https://127.0.0.1/mcp",
      "https://10.0.0.5/mcp",
      "https://192.168.1.10/mcp",
      "https://172.16.4.4/mcp",
      "https://[::1]/mcp",
      "https://0x7f000001/mcp",
      "https://017700000001/mcp",
      "https://2130706433/mcp",
      "https://[::ffff:127.0.0.1]/mcp",
    ])
      await assert.rejects(
        () => toAcpMcpServers(http(url)),
        /internal\/metadata host/,
      );
    await assert.rejects(
      () => toAcpMcpServers(http("not a url")),
      /not a valid URL/,
    );
  });

  it("allows a public IP unchanged and an explicitly allowlisted HTTPS private host", async () => {
    const publicOut = await toAcpMcpServers(
      http("https://93.184.216.34:8443/sse"),
    );
    assert.equal(
      (publicOut[0] as McpServerHttp).url,
      "https://93.184.216.34:8443/sse",
    );
    process.env.AGENTA_AGENT_MCPS_HOST_ALLOWLIST = "10.0.0.5";
    assert.equal(
      (await toAcpMcpServers(http("https://10.0.0.5/mcp"))).length,
      1,
    );
  });
});
