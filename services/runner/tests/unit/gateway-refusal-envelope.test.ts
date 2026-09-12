/**
 * OR28: what a gateway refusal carries by the time it reaches the caller.
 *
 * Measured live on 2026-09-12, one data-plane `403 model_not_allowed` per harness: Pi and Claude
 * ended the run with the refusal as prose under the generic `runner_error`, and Codex reported
 * the run as a SUCCESS with the refusal sitting in the transcript as if the model had said it.
 * Nothing on any of the three carried the gateway's own code where a client could match on it.
 *
 * Three seams close that, and each has a case here: the live `error` event now carries the
 * envelope beside the runner's failure class, a refusal folded into the answer fails the turn,
 * and the recovery runs at the transport boundary so the pooled session path answers like the
 * one-shot path.
 *
 * Run: pnpm exec vitest run tests/unit/gateway-refusal-envelope.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  carriesGatewayRefusalMarker,
  errorEventWithDetail,
} from "../../src/gateway-error.ts";
import { withGatewayErrorDetail } from "../../src/engines/sandbox_agent/engine.ts";
import { runSandboxAgent } from "../../src/engines/sandbox_agent.ts";
import type { AgentEvent } from "../../src/protocol.ts";
import { fakeHarness } from "../utils/sandbox-agent-harness.ts";

// What a harness reports when the gateway refuses the model, in the two shapes that survive:
// the whole OpenAI-shaped body (Pi, the Anthropic SDK) and the marker alone (Codex).
const BODY_REFUSAL =
  '403: {"error":{"message":"Model mock/echo not allowed on custom/or28 ' +
  '⟦agenta_code:model_not_allowed⟧","type":"invalid_request_error",' +
  '"code":"model_not_allowed"}}';
// Pi's error helper unwraps `error` before reporting, so its text carries the bare body.
const PI_BARE_BODY_REFUSAL =
  '403: {"message":"Model mock/echo not allowed on custom/or28 ' +
  '\u27e6agenta_code:model_not_allowed\u27e7","type":"invalid_request_error",' +
  '"code":"model_not_allowed"}';
const MARKER_REFUSAL =
  "unexpected status 403 Forbidden: Model gpt-5.5 not allowed on custom/or28 " +
  "⟦agenta_code:model_not_allowed⟧, url: https://example.test/v1/responses";

describe("the live error event carries the gateway's envelope", () => {
  it("recovers the full envelope from a harness that kept the body", () => {
    const event = errorEventWithDetail(BODY_REFUSAL, "runner_error");
    assert.equal(event.type, "error");
    assert.equal(event.message, BODY_REFUSAL);
    // The runner's failure class and the gateway's code are separate fields, because they answer
    // different questions: one picks a recovery path, the other says what was refused.
    assert.equal(event.code, "runner_error");
    assert.equal(event.detail?.code, "model_not_allowed");
    assert.equal(event.detail?.retryable, false);
    assert.equal(
      event.detail?.next_step,
      "choose a model the connection allows",
    );
  });

  it("recovers the full envelope from Pi, which unwraps the body before reporting it", () => {
    const event = errorEventWithDetail(PI_BARE_BODY_REFUSAL, "runner_error");
    assert.equal(event.detail?.code, "model_not_allowed");
    assert.equal(
      event.detail?.next_step,
      "choose a model the connection allows",
    );
    assert.equal(
      (event.detail?.details as Record<string, unknown>)?.type,
      "invalid_request_error",
    );
  });

  it("recovers the code alone from a harness that kept only the marker", () => {
    const event = errorEventWithDetail(MARKER_REFUSAL, "runner_error");
    assert.equal(event.detail?.code, "model_not_allowed");
    // The marker path cannot invent what the body carried, so a caller can tell a code-only
    // result from a full envelope and fall back to a generic recovery prompt.
    assert.equal(event.detail?.next_step, undefined);
    assert.equal(event.detail?.details, undefined);
  });

  it("leaves an ordinary run failure exactly as it was", () => {
    const event = errorEventWithDetail("sandbox went away", "sandbox_gone");
    assert.deepEqual(event, {
      type: "error",
      message: "sandbox went away",
      code: "sandbox_gone",
    });
  });

  it("recognizes the marker only where the gateway stamped one", () => {
    assert.equal(carriesGatewayRefusalMarker(MARKER_REFUSAL), true);
    assert.equal(carriesGatewayRefusalMarker(BODY_REFUSAL), true);
    assert.equal(carriesGatewayRefusalMarker("403 Forbidden"), false);
    assert.equal(carriesGatewayRefusalMarker(undefined), false);
  });
});

describe("the transport boundary settles the envelope for every engine path", () => {
  it("recovers the code on a result the session path built without one", () => {
    const settled = withGatewayErrorDetail({ ok: false, error: BODY_REFUSAL });
    assert.equal(settled.errorDetail?.code, "model_not_allowed");
  });

  it("leaves a result that already carries its envelope untouched", () => {
    const detail = {
      code: "endpoint_inactive",
      message: "off",
      retryable: false,
    };
    const settled = withGatewayErrorDetail({
      ok: false,
      error: BODY_REFUSAL,
      errorDetail: detail,
    });
    assert.equal(settled.errorDetail, detail);
  });

  it("leaves a successful result untouched", () => {
    const result = { ok: true as const, output: "hello", events: [] };
    assert.equal(withGatewayErrorDetail(result), result);
  });
});

describe("a refusal folded into the answer fails the turn", () => {
  it("codex no longer reports a refused run as a success", async () => {
    const { deps, events } = fakeHarness({ output: MARKER_REFUSAL });

    const result = await runSandboxAgent(
      {
        harness: "codex",
        messages: [{ role: "user", content: "say hello" }],
      },
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.errorDetail?.code, "model_not_allowed");
    const errors = events.filter(
      (event: AgentEvent) => event.type === "error",
    ) as Array<Extract<AgentEvent, { type: "error" }>>;
    assert.equal(errors.length, 1);
    assert.equal(errors[0].detail?.code, "model_not_allowed");
    // The marker is machinery, not prose: it leaves the sentence the person reads.
    assert.ok(!errors[0].message.includes("agenta_code"), errors[0].message);
  });

  it("an ordinary answer is still an ordinary answer", async () => {
    const { deps } = fakeHarness({ output: "403 is a status code" });

    const result = await runSandboxAgent(
      {
        harness: "codex",
        messages: [{ role: "user", content: "say hello" }],
      },
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
  });
});
