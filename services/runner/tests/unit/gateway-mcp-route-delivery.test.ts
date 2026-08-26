/** Gateway MCP routes delivered to the Claude and Codex ACP sessions. */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  buildSessionMcpServers,
  type SessionMcpServers,
} from "../../src/engines/sandbox_agent/mcp.ts";
import type { McpServerHttp } from "../../src/engines/sandbox_agent/mcp.ts";

const gatewayCredential = "ApiKey gateway-credential";
const gatewayBase = "https://93.184.216.34/gateways/mcps";
const cases = [
  ["builtin", `${gatewayBase}/builtin/mock/mock`],
  ["standard", `${gatewayBase}/standard/mock`],
  ["custom", `${gatewayBase}/custom/mock-custom`],
] as const;
const harnesses = ["claude", "codex"] as const;
const built: SessionMcpServers[] = [];

afterEach(async () => {
  await Promise.all(built.map((session) => session.close()));
  built.length = 0;
});

describe("gateway MCP delivery", () => {
  for (const harness of harnesses) {
    for (const [namespace, url] of cases) {
      it(`${harness} receives the ${namespace} mock route with only gateway credentials`, async () => {
        const session = await buildSessionMcpServers({
          isPi: false,
          isDaytona: false,
          capabilities: { mcpTools: true, toolCalls: true },
          harness,
          toolSpecs: [],
          userMcpServers: [
            {
              name: `mock-${namespace}`,
              connection: {
                type: "http",
                url,
                credentials: [
                  {
                    binding: { kind: "header", name: "X-AG-Credentials" },
                    value: gatewayCredential,
                    usage: "opaque_http",
                  },
                ],
              },
              policy: { tools: { mode: "all" } },
            },
          ],
          relayDir: "/tmp/gateway-mcp-route-delivery",
        });
        built.push(session);

        assert.equal(session.servers.length, 1);
        const server = session.servers[0] as McpServerHttp;
        assert.equal(server.name, `mock-${namespace}`);
        assert.equal(server.url, url);
        assert.deepEqual(server.headers, [
          { name: "X-AG-Credentials", value: gatewayCredential },
        ]);
        const rendered = JSON.stringify(server);
        assert.equal(rendered.includes("upstream-secret"), false);
        assert.equal(rendered.includes("mock-mcp-gateway"), false);
      });
    }
  }
});
