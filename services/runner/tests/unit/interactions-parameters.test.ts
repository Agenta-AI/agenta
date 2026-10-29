/**
 * The effective turn config on the interaction row (effective-turn-config plan, T3/T4).
 *
 * A gate answered out-of-band (mobile, the API's M2 dispatcher) resumes references-only, so the
 * SDK re-hydrates the referenced variant's HEAD revision instead of the config the gated turn
 * was running. The SDK now stamps that config on the `/run` wire as `effectiveParameters`; the
 * runner echoes it — opaquely — onto the row it writes at every pause, and the answering client
 * replays it as `data.parameters`.
 *
 * Three things must hold, and each has bitten before:
 *  (a) present  -> the POSTed body carries `data.parameters` verbatim;
 *  (b) absent   -> the KEY is absent, not `null`/`{}` (a legacy row's shape is unchanged, and
 *      an empty inline config would still suppress hydration server-side and run a bare agent);
 *  (c) the new field must NOT move `configFingerprint` — that hash decides warm-resume vs cold
 *      replay, so a shift there would send every resume cold.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/interactions-parameters.test.ts)
 */
import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";

import type { AgentRunRequest } from "../../src/protocol.ts";

const postedBodies: Array<{ url: string; body: any }> = [];

vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
  postedBodies.push({
    url: url as string,
    body: init?.body ? JSON.parse(init.body as string) : undefined,
  });
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});

const { buildInteractionData, createInteraction } =
  await import("../../src/sessions/interactions.ts");
const { configFingerprint } =
  await import("../../src/engines/sandbox_agent/session-identity.ts");
const EFFECTIVE_PARAMETERS = {
  agent: {
    instructions: "Draft config, not committed anywhere.",
    llm: { model: "anthropic/claude-sonnet-4-5" },
    runner: { permissions: { default: "allow_reads" } },
  },
};

function request(
  effectiveParameters?: Record<string, unknown>,
): AgentRunRequest {
  return {
    harness: "pi_core",
    sandbox: "local",
    sessionId: "sess-1",
    model: "anthropic/claude-sonnet-4-5",
    messages: [{ role: "user", content: "hi" }],
    runContext: {
      workflow: {
        artifact: { id: "wf-1" },
        variant: { id: "var-1", slug: "agent.default" },
      },
    },
    ...(effectiveParameters ? { effectiveParameters } : {}),
  } as AgentRunRequest;
}

beforeEach(() => {
  postedBodies.length = 0;
});

describe("buildInteractionData", () => {
  it("carries the stamped effective config alongside request + references", () => {
    const data = buildInteractionData(request(EFFECTIVE_PARAMETERS), "Bash", {
      command: "echo hi",
    });
    assert.deepEqual(data.request, {
      tool: "Bash",
      args: { command: "echo hi" },
    });
    assert.deepEqual(data.references, {
      workflow: { id: "wf-1" },
      workflow_variant: { id: "var-1", slug: "agent.default" },
    });
    assert.deepEqual(data.parameters, EFFECTIVE_PARAMETERS);
  });

  it("omits parameters entirely when the request carries none", () => {
    const data = buildInteractionData(request(), "Bash", {
      command: "echo hi",
    });
    assert.equal(data.parameters, undefined);
  });

  it("treats an empty stamped config as absent (never an empty inline config)", () => {
    const data = buildInteractionData(request({}), "Bash", null);
    assert.equal(data.parameters, undefined);
  });
});

describe("createInteraction with the effective config", () => {
  it("POSTs data.parameters when the turn stamped one", async () => {
    await createInteraction(
      "sess-1",
      "turn-1",
      "tok-1",
      "user_approval",
      buildInteractionData(request(EFFECTIVE_PARAMETERS), "Bash", {
        command: "echo hi",
      }),
      () => "Secret t",
    );

    assert.equal(postedBodies.length, 1);
    assert.deepEqual(
      postedBodies[0].body.data.parameters,
      EFFECTIVE_PARAMETERS,
    );
  });

  it("omits the key from the POSTed JSON when the turn stamped none", async () => {
    await createInteraction(
      "sess-1",
      "turn-1",
      "tok-2",
      "user_approval",
      buildInteractionData(request(), "Bash", { command: "echo hi" }),
      () => "Secret t",
    );

    const data = postedBodies[0].body.data;
    // Not `null`, not `{}` — the key must not be present at all: the API DTO would persist a
    // null and a replaying client would send an empty inline config, suppressing hydration.
    assert.equal("parameters" in data, false);
    assert.ok(data.request);
  });
});

describe("configFingerprint", () => {
  it("is unchanged by the effective config (warm resumes must not go cold)", () => {
    assert.equal(
      configFingerprint(request(EFFECTIVE_PARAMETERS)),
      configFingerprint(request()),
    );
  });

  it("still moves when a real config field changes (the guard is not vacuous)", () => {
    const changed = {
      ...request(EFFECTIVE_PARAMETERS),
      model: "openai/gpt-4o-mini",
    } as AgentRunRequest;
    assert.notEqual(configFingerprint(changed), configFingerprint(request()));
  });
});
