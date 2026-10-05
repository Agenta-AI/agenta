/**
 * Release QA (2026-10-03): a gateway refusal written for the person reaches the chat as that
 * sentence under its own class, never as "The model provider refused the request (HTTP 403): ...
 * ⟦agenta_code:...⟧".
 *
 * Run: pnpm exec vitest run tests/unit/gateway-wallet-refusal.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { classifyRunError } from "../../src/engines/sandbox_agent/errors.ts";
import { runSandboxAgent } from "../../src/engines/sandbox_agent.ts";
import type { AgentEvent } from "../../src/protocol.ts";
import { fakeHarness } from "../utils/sandbox-agent-harness.ts";

const OUT_OF_CREDIT =
  "You've used all your organization's credits, so we didn't start this request and didn't charge you.";
const NOT_ENABLED =
  "Agenta's included models aren't enabled for your organization. Use your own provider key, or contact us.";

// Pi unwraps `error` before it reports, so its text carries the bare body.
const piBody = (message: string, code: string) =>
  `403 ${JSON.stringify({ message: `${message} ⟦agenta_code:${code}⟧`, type: "permission_error", code })}`;
// Codex keeps only the message line.
const markerOnly = (message: string, code: string) =>
  `unexpected status 403 Forbidden: ${message} ⟦agenta_code:${code}⟧, url: https://example.test/v1/responses`;

describe("a person-facing gateway refusal keeps its own sentence and class", () => {
  for (const [code, message] of [
    ["wallet_balance_exhausted", OUT_OF_CREDIT],
    ["builtin_models_not_enabled", NOT_ENABLED],
  ] as const) {
    it(`${code} from a body`, () => {
      const classified = classifyRunError(new Error(piBody(message, code)), "pi_core", "google");
      assert.deepEqual(classified, { code, message });
    });

    it(`${code} from the marker alone`, () => {
      const classified = classifyRunError(new Error(markerOnly(message, code)), "codex");
      assert.equal(classified.code, code);
      // The gateway's sentence did not survive, so the runner's own short one stands in.
      assert.ok(message.startsWith(classified.message.slice(0, -1)), classified.message);
    });
  }

  it("leaves other gateway refusals to the rules that read them", () => {
    const classified = classifyRunError(
      new Error(piBody("Denied use_llm_endpoints on builtin/agenta", "policy_denied")),
      "pi_core",
    );
    assert.equal(classified.code, "provider_error");
  });

  it("an out-of-credit refusal folded into the answer fails the turn under its class", async () => {
    const { deps, events } = fakeHarness({
      output: markerOnly(OUT_OF_CREDIT, "wallet_balance_exhausted"),
    });

    const result = await runSandboxAgent(
      { harness: "codex", messages: [{ role: "user", content: "say hello" }] },
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, false);
    const [error] = events.filter((event: AgentEvent) => event.type === "error") as Array<
      Extract<AgentEvent, { type: "error" }>
    >;
    assert.equal(error.code, "wallet_balance_exhausted");
    assert.equal(error.message, "You've used all your organization's credits.");
  });
});
