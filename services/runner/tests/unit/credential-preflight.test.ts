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
  it("returns ok immediately when the first probe substitutes", async () => {
    const { run, logs, commands } = harness([
      '{"error":{"message":"you must provide a model parameter"}}',
    ]);
    assert.equal(await run, "ok");
    assert.equal(commands.length, 1);
    assert.deepEqual(logs, []);
    // The probe expands the env var in the sandbox shell; the raw value never appears here,
    // and the endpoint is the connection's own chat path.
    assert.match(commands[0], /Bearer \$OPENAI_API_KEY/);
    assert.match(commands[0], /https:\/\/gateway\.example\/chat\/completions/);
  });

  it("tolerates early raw echoes and returns ok once substitution shows", async () => {
    const { run, logs, commands } = harness([
      "LiteLLM Virtual Key expected. Received=dtn_****9maz",
      '{"error":{"message":"Received=dtn_****9maz"}}',
      '{"error":{"message":"you must provide a model parameter"}}',
    ]);
    assert.equal(await run, "ok");
    assert.equal(commands.length, 3);
    assert.match(logs[0], /raw placeholder echoed \(probe 1/);
    assert.match(logs[2], /substitution confirmed after 3 probes/);
  });

  it("convicts the sandbox as STUCK after consecutive raw echoes", async () => {
    // The fault is binary and permanent per sandbox (2026-08-30 measurement), so the verdict
    // is "stuck", never a fail-open wait: only a fresh sandbox can serve the run.
    const { run, logs, commands } = harness(["Received=dtn_****9maz"]);
    assert.equal(await run, "stuck");
    assert.equal(commands.length, 4, "four consecutive raw echoes convict");
    assert.match(
      logs[logs.length - 1],
      /STUCK: raw placeholder on all 4 probes/,
    );
  });

  it("convicts early when the budget runs out first", async () => {
    const { run, logs } = harness(["Received=dtn_****9maz"], 3_000);
    assert.equal(await run, "stuck");
    assert.match(logs[logs.length - 1], /STUCK/);
  });

  it("fails open (ok) when the exec channel itself errors", async () => {
    const { run, logs, commands } = harness([new Error("daemon gone")]);
    assert.equal(await run, "ok");
    assert.equal(commands.length, 1);
    assert.match(logs[0], /probe errored, proceeding: daemon gone/);
  });

  it("treats an empty body as substituted (nothing to judge by)", async () => {
    const { run, logs } = harness([""]);
    assert.equal(await run, "ok");
    assert.deepEqual(logs, []);
  });
});
