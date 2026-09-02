/**
 * Unit tests for the Daytona credential-substitution preflight.
 *
 * Run: pnpm exec vitest run tests/unit/credential-preflight.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  awaitCredentialSubstitution,
  credentialPreflightRequest,
  deliversModelSecretOnCreate,
  type ControlProbeRequest,
  type ControlProbeResponse,
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

interface HarnessOptions {
  /** The model connection's provider, which selects the probe shape. */
  provider?: string;
  /** The real key value the runner holds, used only by the control call. */
  controlKey?: string;
  /** What the runner's own control call answers, or an error it throws. */
  control?: ControlProbeResponse | Error;
  baseUrl?: string;
  apiKeyVar?: string;
}

function harness(
  bodies: (string | Error)[],
  budgetMs = 25_000,
  options: HarnessOptions = {},
) {
  const { sandbox, commands } = sandboxAnswering(bodies);
  const logs: string[] = [];
  const controlRequests: ControlProbeRequest[] = [];
  let clock = 0;
  const run = awaitCredentialSubstitution({
    sandbox,
    baseUrl: options.baseUrl ?? "https://gateway.example/",
    apiKeyVar: options.apiKeyVar ?? "OPENAI_API_KEY",
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.controlKey ? { controlKey: options.controlKey } : {}),
    controlProbe: async (request) => {
      controlRequests.push(request);
      if (options.control instanceof Error) throw options.control;
      return options.control ?? { status: 400 };
    },
    log: (m) => logs.push(m),
    budgetMs,
    pollMs: 2_000,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });
  return { run, logs, commands, controlRequests };
}

/** The OpenRouter body observed in production: a 401 that never names the key. */
const BARE_401 =
  '{"error":{"message":"No auth credentials found","code":401}}\n401';

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

describe("the control call: judging a provider that does not echo the key", () => {
  // The production defect (AGE-4249): on the direct OpenRouter connection a bad bearer comes
  // back as a 401 that never names the key, so the masked-echo instrument is blind and the
  // preflight fails open on probe 1. The second instrument is body-independent: the runner
  // holds the real key, so it calls the same URL itself and compares the two answers.

  it("convicts a bare 401 when the runner's own control call was accepted", async () => {
    const { run, logs, commands, controlRequests } = harness(
      [BARE_401],
      3_000,
      {
        controlKey: "sk-real-key-value",
        control: { status: 400 },
      },
    );
    assert.equal(await run, "stuck");
    assert.ok(commands.length >= 1);
    assert.equal(
      controlRequests.length,
      1,
      "exactly one control call per preflight",
    );
    const stuck = logs[logs.length - 1];
    assert.match(stuck, /STUCK/);
    assert.match(stuck, /control call/i);
    assert.match(stuck, /accepted/i);
  });

  it("fails open when the control call is refused too: the key itself is bad", async () => {
    const { run, logs, commands } = harness([BARE_401], 3_000, {
      controlKey: "sk-real-key-value",
      control: { status: 401 },
    });
    assert.equal(await run, "ok");
    assert.equal(
      commands.length,
      1,
      "a refused control call must not be re-probed",
    );
    assert.match(logs[0], /control call/i);
    assert.match(logs[0], /refused|the key itself/i);
  });

  it("fails open when the control call is forbidden (403)", async () => {
    const { run } = harness([BARE_401], 3_000, {
      controlKey: "sk-real-key-value",
      control: { status: 403 },
    });
    assert.equal(await run, "ok");
  });

  it("fails open when the control call throws or times out", async () => {
    const { run, logs } = harness([BARE_401], 3_000, {
      controlKey: "sk-real-key-value",
      control: new Error("control timed out"),
    });
    assert.equal(await run, "ok");
    assert.match(logs[0], /control call/i);
    assert.match(logs[0], /no verdict|proceeding/i);
  });

  it("fails open when the control call returns no status", async () => {
    const { run } = harness([BARE_401], 3_000, {
      controlKey: "sk-real-key-value",
      control: {},
    });
    assert.equal(await run, "ok");
  });

  it("makes no control call and fails open when the runner holds no key", async () => {
    const { run, controlRequests } = harness([BARE_401], 3_000, {});
    assert.equal(await run, "ok");
    assert.equal(controlRequests.length, 0);
  });

  it("fails open on a non-401 status, whatever the control call says", async () => {
    // A 400 from the sandbox means the endpoint read the header and rejected the junk body.
    const { run } = harness(
      ['{"error":{"message":"model is required"}}\n400'],
      3_000,
      { controlKey: "sk-real-key-value", control: { status: 400 } },
    );
    assert.equal(await run, "ok");
  });

  it("never puts the real key in a log line or in the sandbox command", async () => {
    const secret = "sk-real-key-value-0123456789";
    const { run, logs, commands } = harness([BARE_401], 3_000, {
      controlKey: secret,
      control: { status: 400 },
    });
    await run;
    for (const line of [...logs, ...commands]) {
      assert.ok(!line.includes(secret), `key leaked into: ${line}`);
    }
  });
});

describe("provider shapes", () => {
  it("uses the OpenAI-compatible shape by default", async () => {
    const { run, commands, controlRequests } = harness([BARE_401], 3_000, {
      controlKey: "sk-real-key-value",
      control: { status: 400 },
    });
    await run;
    assert.match(commands[0], /https:\/\/gateway\.example\/chat\/completions/);
    assert.match(commands[0], /Authorization: Bearer \$OPENAI_API_KEY/);
    assert.equal(
      controlRequests[0].url,
      "https://gateway.example/chat/completions",
    );
    assert.equal(
      controlRequests[0].headers.Authorization,
      "Bearer sk-real-key-value",
    );
  });

  it("uses the Anthropic shape for a direct Anthropic connection", async () => {
    const secret = "sk-ant-real-key-value";
    const { run, commands, controlRequests } = harness([BARE_401], 3_000, {
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKeyVar: "ANTHROPIC_API_KEY",
      controlKey: secret,
      control: { status: 400 },
    });
    await run;
    assert.match(commands[0], /https:\/\/api\.anthropic\.com\/v1\/messages/);
    assert.match(commands[0], /x-api-key: \$ANTHROPIC_API_KEY/);
    assert.match(commands[0], /anthropic-version: 2023-06-01/);
    assert.ok(
      !commands[0].includes(secret),
      "the key never enters the sandbox command",
    );
    assert.equal(
      controlRequests[0].url,
      "https://api.anthropic.com/v1/messages",
    );
    assert.equal(controlRequests[0].headers["x-api-key"], secret);
    assert.equal(controlRequests[0].headers["anthropic-version"], "2023-06-01");
    assert.equal(controlRequests[0].headers.Authorization, undefined);
  });

  it("asks the sandbox probe for the HTTP status", async () => {
    const { run, commands } = harness([BARE_401], 3_000, {
      controlKey: "sk-real-key-value",
      control: { status: 400 },
    });
    await run;
    assert.match(commands[0], /http_code/);
  });

  it("keeps an unknown provider on the default shape", async () => {
    const { run, commands } = harness([BARE_401], 3_000, {
      provider: "some-new-gateway",
      controlKey: "sk-real-key-value",
      control: { status: 401 },
    });
    assert.equal(await run, "ok");
    assert.match(commands[0], /chat\/completions/);
  });
});

describe("credentialPreflightRequest: what the acquire path hands the preflight", () => {
  // `acquireEnvironment` cannot be driven without a live provider, so this builder is where
  // the kickoff's wiring is pinned. The key value has exactly one destination.
  const candidate = {
    binding: { name: "OPENROUTER_API_KEY" },
    value: "sk-or-real-key-value",
  };

  it("routes the candidate value only into the control-call input", () => {
    const request = credentialPreflightRequest({
      baseUrl: " https://openrouter.ai/api/v1 ",
      candidate,
      provider: "openrouter",
    });
    assert.equal(request.baseUrl, "https://openrouter.ai/api/v1");
    assert.equal(request.apiKeyVar, "OPENROUTER_API_KEY");
    assert.equal(request.provider, "openrouter");
    assert.equal(request.controlKey, candidate.value);
    const serialized = JSON.stringify(request);
    assert.equal(
      serialized.split(candidate.value).length - 1,
      1,
      "the value appears once, as the control key",
    );
  });

  it("keeps the key out of every log line the preflight then writes", async () => {
    const request = credentialPreflightRequest({
      baseUrl: "https://openrouter.ai/api/v1",
      candidate,
      provider: "openrouter",
    });
    const logs: string[] = [];
    const commands: string[] = [];
    let clock = 0;
    const verdict = await awaitCredentialSubstitution({
      ...request,
      sandbox: {
        async runProcess(req) {
          commands.push(req.args?.[1] ?? req.command);
          return { exitCode: 0, stdout: BARE_401 };
        },
      },
      controlProbe: async () => ({ status: 400 }),
      log: (m) => logs.push(m),
      budgetMs: 3_000,
      pollMs: 2_000,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    assert.equal(verdict, "stuck");
    for (const line of [...logs, ...commands]) {
      assert.ok(!line.includes(candidate.value), `key leaked into: ${line}`);
    }
  });
});
