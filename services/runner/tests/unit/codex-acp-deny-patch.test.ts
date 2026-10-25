import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { applyCodexAcpDenyPatch } from "../../src/engines/sandbox_agent/codex-acp-patch.ts";

/**
 * Snippets from `@agentclientprotocol/codex-acp` (1.13.1, dist/index.js).
 * Preserves the exact anchor lines so the patch can be tested in isolation and evaluated.
 */
const BUNDLE = `
var McpApprovalOptionId = {
  AllowOnce: "allow_once",
  AllowSession: "allow_session",
  AllowAlways: "allow_always",
  Decline: "decline",
  Cancel: "cancel"
};

function permissionOption2(optionId, name, kind, description) {
  return { optionId, name, kind, description };
}

function cancelledResponse() {
  return { action: "cancel", content: null, _meta: null };
}

function elicitationResponseMeta(response, context) {
  return null;
}

var CreateElicitationResponse = {
  isDecline(response) {
    return response && response.action === "decline";
  }
};

function buildMcpPermissionOptions(isToolApproval) {
  const options = [];
  if (isToolApproval) {
    options.push(permissionOption2(
      McpApprovalOptionId.Cancel,
      "Cancel",
      "reject_once",
      "Cancel this tool call"
    ));
  } else {
    options.push(
      permissionOption2(
        McpApprovalOptionId.Decline,
        "Decline",
        "reject_once",
        "Decline this request and continue."
      )
    );
  }
  return options;
}

function convertMcpPermissionResponse(response, isToolApproval) {
  switch (response.outcome.optionId) {
    case McpApprovalOptionId.Decline:
      return !isToolApproval ? { action: "decline", content: null, _meta: null } : cancelledResponse();
    case McpApprovalOptionId.Cancel:
    default:
      return cancelledResponse();
  }
}

var Handler = class {
  convertElicitationResponse(response, context) {
    if (CreateElicitationResponse.isDecline(response)) {
      return context.isToolApproval ? { action: "cancel", content: null, _meta: elicitationResponseMeta(response, context) } : { action: "decline", content: null, _meta: elicitationResponseMeta(response, context) };
    }
    return cancelledResponse();
  }
};
`;

function load(source: string) {
  return new Function(
    `${source}; return { McpApprovalOptionId, buildMcpPermissionOptions, convertMcpPermissionResponse, Handler };`,
  )() as {
    McpApprovalOptionId: Record<string, string>;
    buildMcpPermissionOptions: (isToolApproval: boolean) => Array<{
      optionId: string;
      name: string;
      kind: string;
      description: string;
    }>;
    convertMcpPermissionResponse: (
      response: { outcome: { optionId: string } },
      isToolApproval: boolean,
    ) => { action: string; content: unknown; _meta: unknown };
    Handler: new () => {
      convertElicitationResponse: (
        response: { action: string },
        context: { isToolApproval: boolean },
      ) => { action: string; content: unknown; _meta: unknown };
    };
  };
}

function patchedBundle(): string {
  const outcome = applyCodexAcpDenyPatch(BUNDLE);
  assert.equal(outcome.kind, "patched");
  return (outcome as { kind: "patched"; source: string }).source;
}

describe("applyCodexAcpDenyPatch", () => {
  it("stock bundle forces cancel on tool approval decline, causing Codex to retry", () => {
    const stock = load(BUNDLE);
    const options = stock.buildMcpPermissionOptions(true);
    assert.deepEqual(
      options.map((o) => o.optionId),
      ["cancel"],
      "stock bundle only offers cancel for tool approval",
    );

    const mcpResult = stock.convertMcpPermissionResponse(
      { outcome: { optionId: stock.McpApprovalOptionId.Decline } },
      true,
    );
    assert.equal(
      mcpResult.action,
      "cancel",
      "stock bundle forces action: cancel for tool approvals",
    );

    const handler = new stock.Handler();
    const elicitationResult = handler.convertElicitationResponse(
      { action: "decline" },
      { isToolApproval: true },
    );
    assert.equal(
      elicitationResult.action,
      "cancel",
      "stock bundle forces action: cancel in convertElicitationResponse for tool approvals",
    );
  });

  it("patched bundle offers Deny (Decline) before Cancel and reports action: decline", () => {
    const patched = load(patchedBundle());
    const options = patched.buildMcpPermissionOptions(true);
    assert.deepEqual(
      options.map((o) => ({ id: o.optionId, name: o.name, kind: o.kind })),
      [
        { id: "decline", name: "Deny", kind: "reject_once" },
        { id: "cancel", name: "Cancel", kind: "reject_once" },
      ],
      "patched bundle offers Deny before Cancel for tool approval",
    );

    const mcpResult = patched.convertMcpPermissionResponse(
      { outcome: { optionId: patched.McpApprovalOptionId.Decline } },
      true,
    );
    assert.equal(
      mcpResult.action,
      "decline",
      "patched bundle maps tool decline to action: decline",
    );

    const handler = new patched.Handler();
    const elicitationResult = handler.convertElicitationResponse(
      { action: "decline" },
      { isToolApproval: true },
    );
    assert.equal(
      elicitationResult.action,
      "decline",
      "patched bundle maps elicitation decline to action: decline",
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
