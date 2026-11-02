/**
 * The approval key is DIAGNOSED in logs, never printed.
 *
 * `approvedCallKey` embeds the full canonical arguments, so the two lines that logged it put
 * user content in the runner log. Observed live on 2026-08-27, an ordinary QA run:
 *
 *   [gateway] approval key target=gmail.CREATE_EMAIL_DRAFT key="run_tool#{\"arguments\":
 *   {\"body\":\"hello\",\"recipient_email\":\"qa-target@example.com\", ...
 *
 * The run's own deny-set does not help: `seedForRun(request).redactString` holds credentials,
 * and none of that is a credential. It is the caller's message.
 *
 * These tests pin the two properties that make the digest a safe replacement rather than a
 * cosmetic one: both sides digest through the SAME helper, and no argument VALUE survives.
 *
 * Run: pnpm exec vitest run tests/unit/approval-key-logging.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  approvalKeyDigest,
  approvedCallKey,
  extractApprovalDecisions,
  topLevelArgNames,
} from "../../src/responder.ts";
import type { AgentRunRequest } from "../../src/protocol.ts";

/** The live shape from the log above: outer `run_tool` wrapping the provider arguments. */
const OUTER_INPUT = {
  integration: "gmail",
  tool: "CREATE_EMAIL_DRAFT",
  arguments: {
    body: "hello",
    recipient_email: "qa-target@example.com",
    subject: "park-stage measurement",
  },
};

describe("the approval key digest", () => {
  it("is the SAME on the gate side and the extract side for one key", () => {
    // The property that matters. A test on the digest function alone would still pass if the
    // two call sites drifted onto different implementations — and a drifted digest reports a
    // mismatch that is an artifact of the logging, which is worse than logging nothing.
    const gateKey = approvedCallKey("run_tool", OUTER_INPUT);
    assert.ok(gateKey, "the fixture must produce a key");

    const request = {
      messages: [
        { role: "user", content: "draft it" },
        {
          role: "assistant",
          content: [
            {
              type: "tool_result",
              toolCallId: "tc-1",
              toolName: "run_tool",
              input: OUTER_INPUT,
              output: { approved: true, interactionToken: "tok-1" },
            },
          ],
        },
      ],
    } as unknown as AgentRunRequest;

    const storedKeys = [...extractApprovalDecisions(request).keys()];
    assert.deepEqual(
      storedKeys.map(approvalKeyDigest),
      [approvalKeyDigest(gateKey)],
      "the stored key and the gate key must digest identically",
    );
  });

  it("leaks no argument value", () => {
    const digest = approvalKeyDigest(approvedCallKey("run_tool", OUTER_INPUT));
    for (const secret of [
      "hello",
      "qa-target@example.com",
      "park-stage measurement",
    ]) {
      assert.ok(
        !digest.includes(secret),
        `the digest must not carry ${secret}`,
      );
    }
    assert.match(digest, /^[0-9a-f]{12}$/);
  });

  it("distinguishes different keys and repeats for the same one", () => {
    const a = approvalKeyDigest(approvedCallKey("run_tool", OUTER_INPUT));
    const b = approvalKeyDigest(
      approvedCallKey("run_tool", { ...OUTER_INPUT, tool: "SEND_EMAIL" }),
    );
    assert.notEqual(a, b, "a different key must give a different digest");
    assert.equal(
      a,
      approvalKeyDigest(approvedCallKey("run_tool", OUTER_INPUT)),
      "the same key must give the same digest",
    );
  });

  it("says `none` for an unkeyable call rather than throwing", () => {
    assert.equal(approvalKeyDigest(undefined), "none");
  });
});

describe("the argument-name hint", () => {
  it("names the OUTER argument keys, sorted, with no values", () => {
    // This is what separates identity drift from an ordinary miss: the outer world reads
    // `arguments,integration,tool` and the inner one `body,recipient_email,subject`.
    assert.deepEqual(topLevelArgNames(OUTER_INPUT), [
      "arguments",
      "integration",
      "tool",
    ]);
  });

  it("does NOT recurse into nested arguments", () => {
    const names = topLevelArgNames(OUTER_INPUT);
    for (const nested of ["body", "recipient_email", "subject"]) {
      assert.ok(
        !names.includes(nested),
        `nested name ${nested} must not appear`,
      );
    }
  });

  it("is empty for a non-object input rather than throwing", () => {
    assert.deepEqual(topLevelArgNames(undefined), []);
    assert.deepEqual(topLevelArgNames("text"), []);
    assert.deepEqual(topLevelArgNames([1, 2]), []);
  });
});
