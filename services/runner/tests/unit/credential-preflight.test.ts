/**
 * Unit tests for the Daytona credential-substitution preflight.
 *
 * Run: pnpm exec vitest run tests/unit/credential-preflight.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  awaitCredentialSubstitution,
  type PreflightSandbox,
} from "../../src/engines/sandbox_agent/credential-preflight.ts";

/** A sandbox whose probe responses play back in order (the last repeats forever). */
function sandboxAnswering(bodies: (string | Error)[]): {
  sandbox: PreflightSandbox;
  commands: string[];
} {
  const commands: string[] = [];
  let index = 0;
  return {
    commands,
    sandbox: {
      async runProcess(request) {
        commands.push(request.args?.[1] ?? request.command);
        const body = bodies[Math.min(index, bodies.length - 1)];
        index += 1;
        if (body instanceof Error) throw body;
        return { exitCode: 0, stdout: body };
      },
    },
  };
}

function harness(bodies: (string | Error)[], budgetMs = 25_000) {
  const { sandbox, commands } = sandboxAnswering(bodies);
  const logs: string[] = [];
  let clock = 0;
  const run = awaitCredentialSubstitution({
    sandbox,
    baseUrl: "https://gateway.example/",
    apiKeyVar: "OPENAI_API_KEY",
    log: (m) => logs.push(m),
    budgetMs,
    pollMs: 2_000,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });
  return { run, logs, commands };
}

describe("awaitCredentialSubstitution", () => {
  it("returns immediately when the first probe substitutes", async () => {
    const { run, logs, commands } = harness([
      '{"error":{"message":"you must provide a model parameter"}}',
    ]);
    await run;
    assert.equal(commands.length, 1);
    assert.deepEqual(logs, []);
    // The probe expands the env var in the sandbox shell; the raw value never appears here,
    // and the endpoint is the connection's own chat path.
    assert.match(commands[0], /Bearer \$OPENAI_API_KEY/);
    assert.match(commands[0], /https:\/\/gateway\.example\/chat\/completions/);
  });

  it("waits out a raw placeholder echo and confirms once substitution lands", async () => {
    const { run, logs, commands } = harness([
      "LiteLLM Virtual Key expected. Received=dtn_****9maz",
      '{"error":{"message":"Received=dtn_****9maz"}}',
      '{"error":{"message":"you must provide a model parameter"}}',
    ]);
    await run;
    assert.equal(commands.length, 3);
    assert.match(logs[0], /raw placeholder echoed \(probe 1/);
    assert.match(logs[2], /substitution confirmed after 3 probes/);
  });

  it("gives up fail-open when the budget is spent", async () => {
    const { run, logs, commands } = harness(
      ["Received=dtn_****9maz"],
      6_000, // budget covers probes at t=0, 2s, 4s; the next poll would pass it
    );
    await run;
    assert.ok(commands.length >= 2);
    assert.match(logs[logs.length - 1], /proceeding fail-open/);
  });

  it("fails open when the exec channel itself errors", async () => {
    const { run, logs, commands } = harness([new Error("daemon gone")]);
    await run;
    assert.equal(commands.length, 1);
    assert.match(logs[0], /probe errored, proceeding: daemon gone/);
  });

  it("treats an empty body as substituted (nothing to judge by)", async () => {
    const { run, logs } = harness([""]);
    await run;
    assert.deepEqual(logs, []);
  });
});
