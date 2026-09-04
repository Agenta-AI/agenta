/**
 * Unit tests for the Daytona credential-substitution preflight.
 *
 * Run: pnpm exec vitest run tests/unit/credential-preflight.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  awaitCredentialSubstitution,
  deliversModelSecretOnCreate,
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
  it("cancels a slow probe promptly when the turn is Stopped", async () => {
    const controller = new AbortController();
    let probeStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      probeStarted = resolve;
    });
    const run = awaitCredentialSubstitution({
      sandbox: {
        runProcess: async () => {
          probeStarted();
          return new Promise(() => {});
        },
      },
      baseUrl: "https://gateway.example/",
      apiKeyVar: "OPENAI_API_KEY",
      log: () => {},
      signal: controller.signal,
    });

    await started;
    controller.abort();
    await assert.rejects(
      () =>
        Promise.race([
          run,
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("preflight did not cancel")),
              4_000,
            ),
          ),
        ]),
      /acquisition was aborted/,
    );
  });

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

  it("convicts the sandbox as STUCK once the 10s grace is spent", async () => {
    // The grace is deliberately below Daytona's ~30s bound (see the module doc): every
    // healthy sandbox we measured answered on its first probe, so waiting longer only
    // holds a stuck user turn. The verdict is "stuck", never a fail-open pass.
    const { run, logs, commands } = harness(["Received=dtn_****9maz"]);
    assert.equal(await run, "stuck");
    assert.ok(
      commands.length >= 4,
      `expected >=4 probes inside the 10s grace, got ${commands.length}`,
    );
    assert.match(logs[logs.length - 1], /STUCK: raw placeholder on all/);
  });

  it("convicts sooner when the caller passes a smaller budget", async () => {
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

  it("fails open when a HEALTHY echoed key was scrubbed into a full placeholder", async () => {
    // Daytona's egress proxy rewrites real credential values in responses back into
    // `dtn_secret_<id>`. An endpoint that echoes the Authorization header therefore returns
    // this body on a perfectly healthy sandbox. Convicting on it destroyed both acquire
    // attempts and failed a first turn whose real model call would have worked.
    // The id is spelled in the message rather than as a `key` field so the secret scanner
    // does not read this placeholder — the very thing that exists so no real key is here —
    // as a leaked credential.
    const { run, logs, commands } = harness([
      '{"error":{"message":"unauthorized bearer dtn_secret_01j9maz7q0"}}',
    ]);
    assert.equal(await run, "ok");
    assert.equal(commands.length, 1, "an unmasked echo must not be re-probed");
    assert.match(logs[0], /unmasked placeholder-shaped echo/);
  });

  it("convicts on a masked echo, whatever the provider's mask shape", async () => {
    // Masking is what scrubbing cannot forge: the masked string no longer holds the real
    // value for the scrubber to match, so `dtn_` beside a mask means the raw placeholder
    // really went out. Both proven provider shapes must convict.
    for (const masked of [
      "LiteLLM Virtual Key expected. Received=dtn_****9maz",
      '{"error":{"message":"Incorrect API key provided: dtn_secr*****9maz"}}',
    ]) {
      const { run } = harness([masked], 3_000);
      assert.equal(await run, "stuck", masked);
    }
  });
});

describe("deliversModelSecretOnCreate: what arms the race guards", () => {
  // The preflight gates on this AND a declared endpoint; the 401 classifier arms its
  // credential-race reading on this alone. `acquireEnvironment` cannot be driven without a live
  // provider, so this predicate is where that condition is actually pinned.
  const base = {
    isDaytona: true,
    sandboxMode: "create",
    hasModelSecretCandidate: true,
  };

  it("is true for a fresh Daytona sandbox whose model key rides a Secret", () => {
    assert.equal(deliversModelSecretOnCreate(base), true);
  });

  it("is false on a reconnect: that sandbox already proved itself", () => {
    assert.equal(
      deliversModelSecretOnCreate({ ...base, sandboxMode: "reconnect" }),
      false,
    );
  });

  it("is false on a local run: there is no Daytona Secret", () => {
    assert.equal(
      deliversModelSecretOnCreate({ ...base, isDaytona: false }),
      false,
    );
  });

  it("is false for a plaintext-env run: there is no placeholder to substitute", () => {
    assert.equal(
      deliversModelSecretOnCreate({ ...base, hasModelSecretCandidate: false }),
      false,
    );
  });
});
