import assert from "node:assert/strict";
import { describe, it } from "vitest";

import patchSpec from "../../src/engines/sandbox_agent/codex-acp-patch.json" with { type: "json" };
import { applyCodexAcpDenyPatch } from "../../src/engines/sandbox_agent/codex-acp-patch.ts";
import {
  CODEX_ACP_2_8_0_DENY_FIXTURE,
  CODEX_ACP_2_8_0_MCP_HELPERS,
} from "./fixtures/codex-acp-2.8.0-deny-anchors.ts";

/**
 * Anchors and `convertMcpPermissionResponse` are verbatim excerpts from
 * `@agentclientprotocol/codex-acp@2.8.0` `dist/index.js`. See the fixture
 * file for the npm pack checksums.
 */
const BUNDLE = CODEX_ACP_2_8_0_DENY_FIXTURE;
const MCP_DECLINE = patchSpec.deny.replacements[1];

function loadMcp(source: string) {
  return new Function(
    `${source}; return { McpApprovalOptionId, convertMcpPermissionResponse };`,
  )() as {
    McpApprovalOptionId: Record<string, string>;
    convertMcpPermissionResponse: (
      response: { outcome: { outcome: string; optionId: string } },
      isToolApproval: boolean,
      persistOptions: Set<string>,
    ) => { action: string; content: unknown; _meta: unknown };
  };
}

function patchedMcpHelpers(): string {
  assert.equal(
    CODEX_ACP_2_8_0_MCP_HELPERS.split(MCP_DECLINE.find).length - 1,
    MCP_DECLINE.count,
  );
  return CODEX_ACP_2_8_0_MCP_HELPERS.split(MCP_DECLINE.find).join(
    MCP_DECLINE.replace,
  );
}

function patchedBundle(): string {
  const outcome = applyCodexAcpDenyPatch(BUNDLE);
  assert.equal(outcome.kind, "patched");
  return (outcome as { kind: "patched"; source: string }).source;
}

describe("applyCodexAcpDenyPatch", () => {
  it("matches the published 2.8.0 anchors, including CreateElicitationResponse2", () => {
    assert.match(
      BUNDLE,
      /CreateElicitationResponse2\.isDecline\(response\)/,
    );
    assert.equal(
      BUNDLE.includes("CreateElicitationResponse.isDecline"),
      false,
    );
    assert.equal(applyCodexAcpDenyPatch(BUNDLE).kind, "patched");
  });

  it("stock bundle forces cancel on tool approval decline, causing Codex to retry", () => {
    assert.match(
      BUNDLE,
      /if \(isToolApproval\) \{\n    options\.push\(permissionOption2\(\n      McpApprovalOptionId\.Cancel,/,
    );
    assert.match(
      BUNDLE,
      /case McpApprovalOptionId\.Decline:\n      return !isToolApproval \? \{ action: "decline", content: null, _meta: null \} : cancelledResponse\(\);/,
    );
    assert.match(
      BUNDLE,
      /if \(CreateElicitationResponse2\.isDecline\(response\)\) \{\n      return context\.isToolApproval \? \{ action: "cancel"/,
    );

    const stock = loadMcp(CODEX_ACP_2_8_0_MCP_HELPERS);
    const mcpResult = stock.convertMcpPermissionResponse(
      {
        outcome: {
          outcome: "selected",
          optionId: stock.McpApprovalOptionId.Decline,
        },
      },
      true,
      new Set(),
    );
    assert.equal(
      mcpResult.action,
      "cancel",
      "stock 2.8.0 bundle forces action: cancel for tool approvals",
    );
  });

  it("patched bundle offers Deny (Decline) before Cancel and reports action: decline", () => {
    const patched = patchedBundle();
    assert.match(
      patched,
      /if \(isToolApproval\) \{\n    \/\* agenta:tool-deny \*\/\n    options\.push\(\n      permissionOption2\(\n        McpApprovalOptionId\.Decline,\n        "Deny",\n        "reject_once",\n        "Decline this tool call"\n      \),\n      permissionOption2\(\n        McpApprovalOptionId\.Cancel,/,
    );
    assert.match(
      patched,
      /case McpApprovalOptionId\.Decline:\n      return \{ action: "decline", content: null, _meta: null \};/,
    );
    assert.match(
      patched,
      /if \(CreateElicitationResponse2\.isDecline\(response\)\) \{\n      return \{ action: "decline", content: null, _meta: elicitationResponseMeta\(response, context\) \};\n    \}/,
    );

    const mcp = loadMcp(patchedMcpHelpers());
    const mcpResult = mcp.convertMcpPermissionResponse(
      {
        outcome: {
          outcome: "selected",
          optionId: mcp.McpApprovalOptionId.Decline,
        },
      },
      true,
      new Set(),
    );
    assert.equal(
      mcpResult.action,
      "decline",
      "patched bundle maps tool decline to action: decline",
    );
  });

  it("is idempotent, so applying twice is a no-op", () => {
    const first = applyCodexAcpDenyPatch(BUNDLE);
    assert.equal(first.kind, "patched");
    const second = applyCodexAcpDenyPatch(
      (first as { source: string }).source,
    );
    assert.equal(second.kind, "already-patched");
  });

  it("fails closed when an anchor has drifted", () => {
    const drifted = BUNDLE.replace(
      'McpApprovalOptionId.Cancel,\n      "Cancel",',
      'McpApprovalOptionId.Cancel,\n      "Abort",',
    );
    assert.equal(applyCodexAcpDenyPatch(drifted).kind, "anchor-missing");
    assert.equal(applyCodexAcpDenyPatch("").kind, "anchor-missing");
  });
});
