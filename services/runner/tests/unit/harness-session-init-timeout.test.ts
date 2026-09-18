/**
 * Unit tests for the ACP session-open budget.
 *
 * The bug being pinned: `session/new` rode an `initialize` that never answered, and nothing on
 * that path had a deadline, so a wedged adapter showed up as a session "running" for 17.6 minutes
 * and then as the API watchdog's `lost` — never as an error anyone could read or retry.
 *
 * Run: pnpm exec vitest run tests/unit/harness-session-init-timeout.test.ts
 */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  ACP_INIT_TIMEOUT_ENV,
  acpInitTimeoutMs,
  DEFAULT_ACP_INIT_TIMEOUT_MS,
  openSession,
} from "../../src/environment/harness-session-lifecycle.ts";
import {
  classifyRunError,
  HarnessInitTimeoutError,
} from "../../src/engines/sandbox_agent/errors.ts";
import { resetEnvWarnings } from "../../src/env.ts";

const SILENT = () => {};

/** A session open that never answers: exactly what a cold-installing daemon does. */
const never = <T>(): Promise<T> => new Promise<T>(() => {});

function sessionInput(overrides: Record<string, unknown> = {}) {
  return {
    sandbox: {
      resumeSession: () => never<{ id: string; agentSessionId?: string }>(),
      createSession: () => never<{ id: string }>(),
    },
    persist: { updateSession: async () => undefined },
    acpAgent: "codex",
    harness: "codex",
    cwd: "/work",
    sessionInit: {},
    priorAgentSessionId: undefined,
    localSessionId: undefined,
    continuitySessionKey: undefined,
    log: SILENT,
    timingLog: () => {},
    ...overrides,
  } as never;
}

beforeEach(() => {
  resetEnvWarnings();
  delete process.env[ACP_INIT_TIMEOUT_ENV];
});

afterEach(() => {
  delete process.env[ACP_INIT_TIMEOUT_ENV];
});

describe("the init budget is configurable and wide by default", () => {
  it("defaults to two minutes", () => {
    assert.equal(acpInitTimeoutMs(SILENT), DEFAULT_ACP_INIT_TIMEOUT_MS);
    assert.equal(DEFAULT_ACP_INIT_TIMEOUT_MS, 120_000);
  });

  it("takes the operator's override", () => {
    process.env[ACP_INIT_TIMEOUT_ENV] = "5000";
    assert.equal(acpInitTimeoutMs(SILENT), 5000);
  });

  it("falls back, loudly, on an unusable override rather than failing every run", () => {
    const warnings: string[] = [];
    process.env[ACP_INIT_TIMEOUT_ENV] = "2 minutes";
    assert.equal(
      acpInitTimeoutMs((m) => void warnings.push(m)),
      DEFAULT_ACP_INIT_TIMEOUT_MS,
    );
    assert.equal(warnings.length, 1);
  });
});

describe("a session open that never answers fails the run", () => {
  it("throws a typed error naming the harness instead of hanging", async () => {
    process.env[ACP_INIT_TIMEOUT_ENV] = "30";
    const started = Date.now();
    await assert.rejects(openSession(sessionInput()), (err: unknown) => {
      assert.ok(err instanceof HarnessInitTimeoutError);
      assert.equal(
        (err as Error).message,
        "Codex harness did not initialize within 30ms.",
      );
      return true;
    });
    assert.ok(
      Date.now() - started < 5_000,
      "the budget, not the harness, ended the wait",
    );
  });

  it("names the harness the user picked", async () => {
    process.env[ACP_INIT_TIMEOUT_ENV] = "30";
    await assert.rejects(
      openSession(sessionInput({ harness: "claude", acpAgent: "claude" })),
      /^HarnessInitTimeoutError: Claude harness did not initialize within/,
    );
    await assert.rejects(
      openSession(sessionInput({ harness: "pi_core", acpAgent: "pi" })),
      /^HarnessInitTimeoutError: Pi harness did not initialize within/,
    );
  });

  it("still emits the create_session timing mark, so the stall stays visible", async () => {
    process.env[ACP_INIT_TIMEOUT_ENV] = "30";
    const marks: string[] = [];
    await assert.rejects(
      openSession(
        sessionInput({
          timingLog: (stage: string, _at: number, extra?: string) =>
            void marks.push(`${stage}${extra ?? ""}`),
        }),
      ),
    );
    assert.deepEqual(marks, ["create_session mode=create"]);
  });

  it("does not spend a second budget on a create after a load timed out", async () => {
    process.env[ACP_INIT_TIMEOUT_ENV] = "30";
    let creates = 0;
    const started = Date.now();
    await assert.rejects(
      openSession(
        sessionInput({
          priorAgentSessionId: "agent-1",
          localSessionId: "session-1:codex",
          sandbox: {
            resumeSession: () => never<{ id: string }>(),
            createSession: () => {
              creates += 1;
              return never<{ id: string }>();
            },
          },
        }),
      ),
      (err: unknown) => err instanceof HarnessInitTimeoutError,
    );
    assert.equal(
      creates,
      0,
      "a wedged harness is not retried into a second stall",
    );
    assert.ok(Date.now() - started < 5_000);
  });

  it("a load that FAILS still degrades to a create, as before", async () => {
    let creates = 0;
    const opened = await openSession(
      sessionInput({
        priorAgentSessionId: "agent-1",
        localSessionId: "session-1:codex",
        sandbox: {
          resumeSession: async () => {
            throw new Error("unknown session id");
          },
          createSession: async () => {
            creates += 1;
            return { id: "fresh" };
          },
        },
      }),
    );
    assert.equal(creates, 1);
    assert.equal(opened.mode, "create");
  });
});

describe("the timeout reaches the user as its own failure class", () => {
  it("passes the message through whole and codes it for the client", () => {
    const classified = classifyRunError(
      new HarnessInitTimeoutError(
        "Codex harness did not initialize within 120s.",
      ),
      "codex",
      "openai",
    );
    assert.equal(
      classified.message,
      "Codex harness did not initialize within 120s.",
    );
    assert.equal(classified.code, "harness_init_timeout");
  });

  it("is never mistaken for an auth failure", () => {
    const classified = classifyRunError(
      new HarnessInitTimeoutError(
        "Claude harness did not initialize within 120s.",
      ),
      "claude",
    );
    assert.ok(!/add the project/i.test(classified.message));
  });
});
