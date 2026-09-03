/**
 * Sanitized close-key suggestions: qa.md R30, and the N10/N14 rule it serves.
 *
 * A stale tool key comes back as `tool_not_found` with up to five close keys under
 * `details.suggestions`. The API builds that list from the WHOLE integration catalog, because it
 * does not hold the agent's policy — so left alone it names the exact tools the agent is
 * forbidden to run, which is the enumeration every refusal in this feature avoids.
 *
 * This is a field edit on an error payload, not result transformation. `gateway.run` on success
 * stays a pass-through, and any other error code passes through untouched.
 *
 * Run: pnpm exec vitest run tests/unit/gateway-run-suggestions.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  normalizeGatewayPolicy,
  sanitizeGatewayRunError,
} from "../../src/tools/gateway-policy.ts";
import {
  NORMALIZED_POLICY,
  cleanupRelayDirs,
  forgeRelayRequest,
  readRelayResponse,
  startGatewayRelay,
  stubToolError,
} from "../utils/gateway.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  cleanupRelayDirs();
});

function notFound(suggestions: unknown): string {
  return JSON.stringify({
    code: "tool_not_found",
    message: "GET_ISSU is not a tool of github.",
    retryable: false,
    next_step: "Call the tool by a key that search returned.",
    details: { suggestions },
  });
}

describe("R30: suggestions are filtered against the resolved policy", () => {
  it("drops a denied key and keeps the allowed ones", () => {
    const sanitized = sanitizeGatewayRunError(
      notFound(["GET_ISSUE", "DELETE_REPOSITORY", "LIST_ISSUES"]),
      "github",
      NORMALIZED_POLICY,
    );

    assert.deepEqual(JSON.parse(sanitized).details.suggestions, [
      "GET_ISSUE",
      "LIST_ISSUES",
    ]);
  });

  it("drops a key the policy has never heard of", () => {
    const sanitized = sanitizeGatewayRunError(
      notFound(["GET_ISSUE", "FORCE_PUSH", "ARCHIVE_REPOSITORY"]),
      "github",
      NORMALIZED_POLICY,
    );

    assert.deepEqual(JSON.parse(sanitized).details.suggestions, ["GET_ISSUE"]);
  });

  it("drops keys that belong to another integration", () => {
    const sanitized = sanitizeGatewayRunError(
      notFound(["SEND_MESSAGE", "GET_ISSUE"]),
      "github",
      NORMALIZED_POLICY,
    );

    assert.deepEqual(JSON.parse(sanitized).details.suggestions, ["GET_ISSUE"]);
  });

  it("removes the details object entirely when nothing survives", () => {
    const sanitized = sanitizeGatewayRunError(
      notFound(["DELETE_REPOSITORY", "FORCE_PUSH"]),
      "github",
      NORMALIZED_POLICY,
    );
    const parsed = JSON.parse(sanitized);

    assert.equal(parsed.details, undefined);
    // The rest of the envelope is untouched: the model still learns what to do next.
    assert.equal(parsed.code, "tool_not_found");
    assert.equal(
      parsed.next_step,
      "Call the tool by a key that search returned.",
    );
  });

  it("leaves every other envelope alone", () => {
    const executionFailed = JSON.stringify({
      code: "tool_execution_failed",
      message: "The provider could not run the tool: 422 unprocessable.",
      retryable: false,
      details: { suggestions: ["DELETE_REPOSITORY"] },
    });

    assert.equal(
      sanitizeGatewayRunError(executionFailed, "github", NORMALIZED_POLICY),
      executionFailed,
    );
    assert.equal(
      sanitizeGatewayRunError("not json", "github", NORMALIZED_POLICY),
      "not json",
    );
  });

  it("caps the sanitized list at five keys", () => {
    // Through intake, like production: the brand on `NormalizedGatewayPolicy` is what stops a
    // hand-built lookalike being passed to a decision, and that includes here.
    const policy = normalizeGatewayPolicy({
      integrations: {
        github: {
          provider: "composio",
          connection: "github-work",
          toolkitVersion: "20250827_00",
          tools: Object.fromEntries(
            Array.from({ length: 8 }, (_, i) => [
              `TOOL_${i}`,
              { permission: "allow" as const, readOnly: null },
            ]),
          ),
        },
      },
    });
    const sanitized = sanitizeGatewayRunError(
      notFound(Array.from({ length: 8 }, (_, i) => `TOOL_${i}`)),
      "github",
      policy,
    );

    assert.equal(JSON.parse(sanitized).details.suggestions.length, 5);
  });
});

describe("R30 on the wire", () => {
  it("the model never sees a denied key in a gateway.run error", async () => {
    // A key the policy never heard of is refused before the callback, so the envelope under test
    // is the one a STALE key produces: the policy still lists it, the provider catalog no longer
    // does, and only the API can tell.
    const relay = await startGatewayRelay();
    stubToolError(
      JSON.parse(notFound(["GET_ISSUE", "DELETE_REPOSITORY", "FORCE_PUSH"])),
      "GET_ISSU is not a tool of github.",
    );
    try {
      await forgeRelayRequest(relay.dir, "stale-1", {
        integration: "github",
        tool: "GET_ISSUE",
        arguments: { issue: 12 },
      });
      const response = await readRelayResponse(relay.dir, "stale-1");

      assert.equal(response.ok, false);
      const error = String(response.error);
      assert.ok(error.includes("GET_ISSUE"));
      assert.ok(
        !error.includes("DELETE_REPOSITORY"),
        `a refusal must not name a denied tool: ${error}`,
      );
      assert.ok(!error.includes("FORCE_PUSH"));
    } finally {
      await relay.stop();
    }
  });
});
