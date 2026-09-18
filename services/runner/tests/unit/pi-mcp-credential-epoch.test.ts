/**
 * A rotated MCP gateway credential must not be "delivered" to a Pi run that cannot read it.
 *
 * Pi does not consume the Daytona Secret the plan allocates for an MCP credential. Its endpoint
 * list, headers and credential are serialized by `buildPiExtensionEnv` into the create-time
 * sandbox environment, and that map is fixed once the sandbox exists. The ACP harnesses are the
 * other way round: they receive the Secret PLACEHOLDER in their session config, so rotating the
 * record in place really does change what they send.
 *
 * So the same rotation has two different answers, and the credential epoch is where the runner
 * says which. `secrets` moving is repairable by the live credential route; `direct` moving is
 * not, and the coordinator rebuilds instead (`tryCredentialRoute`, refusal 3). Without Pi's MCP
 * credential in `direct`, the route updates a record the run never consults, reports success,
 * and keeps the session on the credential it started with — which expires, because a gateway
 * credential lives fifteen minutes.
 *
 * Run: pnpm exec vitest run tests/unit/pi-mcp-credential-epoch.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import type { AgentRunRequest } from "../../src/protocol.ts";
import { computeCredentialEpoch } from "../../src/engines/sandbox_agent/session-identity.ts";

/** One gateway-routed MCP server carrying the credential the gateway rotates. */
const request = (harness: string, credential: string): AgentRunRequest =>
  ({
    harness,
    messages: [{ role: "user", content: "hello" }],
    mcpServers: [
      {
        name: "mock-mcp",
        connection: {
          type: "http",
          url: "https://agenta.example/api/gateways/mcps/custom/mock-mcp",
          credentials: [
            {
              binding: { kind: "header", name: "x-ag-credentials" },
              value: credential,
              usage: "opaque_http",
            },
          ],
        },
        policy: { tools: { mode: "all" } },
      },
    ],
  }) as unknown as AgentRunRequest;

describe("a rotated MCP gateway credential on a Pi run", () => {
  it("moves the half no delivery can reach, so the session rebuilds", () => {
    const before = computeCredentialEpoch(request("pi_core", "Secret first"));
    const after = computeCredentialEpoch(request("pi_core", "Secret second"));

    assert.equal(
      before.direct.equals(after.direct),
      false,
      "Pi reads this credential from its create-time environment, so a rotation it cannot " +
        "see must refuse the delivery route",
    );
  });

  it("leaves an ACP harness deliverable, because the placeholder is what it holds", () => {
    for (const harness of ["claude", "codex"]) {
      const before = computeCredentialEpoch(request(harness, "Secret first"));
      const after = computeCredentialEpoch(request(harness, "Secret second"));

      assert.equal(
        before.direct.equals(after.direct),
        true,
        `${harness} receives the Daytona Secret placeholder, so rotating the record in place ` +
          "really does change what it sends; forcing a rebuild would be a wasted one",
      );
      // It still counts as a rotation, or nothing would trigger the delivery at all.
      assert.equal(before.secrets.equals(after.secrets), false);
    }
  });

  it("is the harness, not the presence of a credential, that decides", () => {
    // An unchanged credential moves neither half on any harness.
    const pi = computeCredentialEpoch(request("pi_core", "Secret same"));
    const again = computeCredentialEpoch(request("pi_core", "Secret same"));
    assert.equal(pi.direct.equals(again.direct), true);
    assert.equal(pi.secrets.equals(again.secrets), true);
  });
});
