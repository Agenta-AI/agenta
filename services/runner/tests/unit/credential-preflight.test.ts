/**
 * Unit tests for the Daytona credential-substitution preflight.
 *
 * Run: pnpm exec vitest run tests/unit/credential-preflight.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  awaitCredentialSubstitution,
  buildCredentialPreflightInput,
  deliversModelSecretOnCreate,
  type ControlProbeRequest,
  type ControlProbeResponse,
} from "../../src/engines/sandbox_agent/credential-preflight.ts";

interface HarnessOptions {
  /** The model connection's provider and how it is reached; together they pick the shape. */
  provider?: string;
  deployment?: string;
  /** The real key value the runner holds, used only by its own auth call. */
  controlKey?: string;
  /** What that call answers, an error it throws, or "pending" for one that never settles. */
  control?: ControlProbeResponse | Error | "pending";
  baseUrl?: string;
  apiKeyVar?: string;
  /** Clock milliseconds each sandbox probe consumes, for deadline tests. */
  probeCostMs?: number;
  /** Drive the real fetch-backed probe instead of an injected one. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Drive one preflight against a scripted sandbox (the last body repeats forever) and a
 * scripted runner call, on a fake clock that only moves when the code sleeps or probes.
 */
function harness(
  bodies: (string | Error)[],
  budgetMs = 25_000,
  options: HarnessOptions = {},
) {
  const commands: string[] = [];
  const logs: string[] = [];
  const controlRequests: ControlProbeRequest[] = [];
  let index = 0;
  let clock = 0;
  const run = awaitCredentialSubstitution({
    sandbox: {
      async runProcess(request) {
        commands.push(request.args?.[1] ?? request.command);
        clock += options.probeCostMs ?? 0;
        const body = bodies[Math.min(index, bodies.length - 1)];
        index += 1;
        if (body instanceof Error) throw body;
        return { exitCode: 0, stdout: body };
      },
    },
    baseUrl: options.baseUrl ?? "https://gateway.example/",
    apiKeyVar: options.apiKeyVar ?? "OPENAI_API_KEY",
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.deployment ? { deployment: options.deployment } : {}),
    ...(options.controlKey ? { controlKey: options.controlKey } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.fetchImpl
      ? { fetchImpl: options.fetchImpl }
      : {
          controlProbe: async (request) => {
            controlRequests.push(request);
            if (options.control instanceof Error) throw options.control;
            if (options.control === "pending")
              return new Promise<ControlProbeResponse>(() => {});
            return options.control ?? { status: 200 };
          },
        }),
    log: (m) => logs.push(m),
    budgetMs,
    pollMs: 2_000,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });
  return { run, logs, commands, controlRequests, elapsed: () => clock };
}

/** The OpenRouter body observed in production: a 401 that never names the key. */
const BARE_401 =
  '{"error":{"message":"No auth credentials found","code":401}}\n401';

/** A direct OpenRouter connection, the one the production defect was reported on. */
const OPENROUTER: HarnessOptions = {
  provider: "openrouter",
  deployment: "direct",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKeyVar: "OPENROUTER_API_KEY",
  controlKey: "sk-or-real-key-value",
};

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

describe("the differential: judging a provider that does not echo the key", () => {
  // The production defect (AGE-4249): on the direct OpenRouter connection a bad bearer comes
  // back as a 401 that never names the key, so the masked-echo instrument is blind and the
  // preflight fails open on probe 1. The second instrument compares that answer against the
  // runner's own call to the provider's documented auth endpoint.

  it("convicts a bare 401 when the auth endpoint accepted the same key", async () => {
    const { run, logs, commands, controlRequests } = harness(
      [BARE_401],
      3_000,
      { ...OPENROUTER, control: { status: 200 } },
    );
    assert.equal(await run, "stuck");
    assert.ok(commands.length >= 1);
    assert.equal(
      controlRequests.length,
      1,
      "exactly one runner call per preflight",
    );
    const stuck = logs[logs.length - 1];
    assert.match(stuck, /STUCK/);
    assert.match(stuck, /auth endpoint accepted the same key/);
  });

  it("fails open when the auth endpoint refused the key too", async () => {
    const { run, logs, commands } = harness([BARE_401], 3_000, {
      ...OPENROUTER,
      control: { status: 401 },
    });
    assert.equal(await run, "ok");
    assert.equal(commands.length, 1, "a refused key must not be re-probed");
    assert.match(logs[0], /refused the same key/);
    assert.match(logs[0], /the key itself is being rejected/);
  });

  it("fails open on every status that is neither 200 nor 401, naming it", async () => {
    // Only a positive answer from a purpose-built auth endpoint is acceptance. A 403, a
    // missing route, a throttle, or a provider outage says something about the request, not
    // about the key, and reading any of them as proof would convict a healthy sandbox.
    for (const status of [403, 404, 405, 429, 500, 502]) {
      const { run, logs, commands } = harness([BARE_401], 3_000, {
        ...OPENROUTER,
        control: { status },
      });
      assert.equal(await run, "ok", `status ${status}`);
      assert.equal(commands.length, 1, `status ${status}`);
      assert.match(logs[0], /gave no verdict/, `status ${status}`);
      assert.match(logs[0], new RegExp(`HTTP ${status}`), `status ${status}`);
    }
  });

  it("fails open when the runner's own call throws or times out", async () => {
    const { run, logs } = harness([BARE_401], 3_000, {
      ...OPENROUTER,
      control: new Error("control timed out"),
    });
    assert.equal(await run, "ok");
    assert.match(logs[0], /gave no verdict \(control timed out\)/);
  });

  it("fails open when the runner's own call returns no status", async () => {
    const { run, logs } = harness([BARE_401], 3_000, {
      ...OPENROUTER,
      control: {},
    });
    assert.equal(await run, "ok");
    assert.match(logs[0], /gave no verdict \(no status\)/);
  });

  it("makes no runner call and fails open when the runner holds no key", async () => {
    const { run, logs, controlRequests } = harness([BARE_401], 3_000, {
      ...OPENROUTER,
      controlKey: undefined,
    });
    assert.equal(await run, "ok");
    assert.equal(controlRequests.length, 0);
    assert.match(logs[0], /no key to check it against/);
  });

  it("fails open on a sandbox status that is not 401", async () => {
    const { run } = harness(['{"data":[{"id":"gpt-5.5"}]}\n200'], 3_000, {
      ...OPENROUTER,
      control: { status: 200 },
    });
    assert.equal(await run, "ok");
  });

  it("aborts the runner's call as soon as the preflight stops needing it", async () => {
    // A healthy sandbox returns on probe 1 while the runner's call is still in flight.
    // Nothing reads it after that, so it must not be left running.
    const { run, controlRequests } = harness(
      ['{"data":[{"id":"gpt-5.5"}]}\n200'],
      3_000,
      { ...OPENROUTER, control: "pending" },
    );
    assert.equal(await run, "ok");
    assert.equal(controlRequests.length, 1);
    assert.equal(controlRequests[0].signal.aborted, true);
  });

  it("aborts the runner's call after a conviction too", async () => {
    const { run, controlRequests } = harness([BARE_401], 3_000, {
      ...OPENROUTER,
      control: { status: 200 },
    });
    assert.equal(await run, "stuck");
    assert.equal(controlRequests[0].signal.aborted, true);
  });

  it("never puts the real key in a log line or in the sandbox command", async () => {
    const secret = "sk-or-real-key-value-0123456789";
    const { run, logs, commands } = harness([BARE_401], 3_000, {
      ...OPENROUTER,
      controlKey: secret,
      control: { status: 200 },
    });
    await run;
    for (const line of [...logs, ...commands]) {
      assert.ok(!line.includes(secret), `key leaked into: ${line}`);
    }
  });

  it("redacts even a very short key value", async () => {
    // The redactor takes no view on what a key looks like. A three-character value is still
    // the run's credential, and a length rule would be the one hole a leak walks through.
    const secret = "abc";
    const { run, logs } = harness(
      [`{"error":{"message":"bad key abc, sorry"}}\n401`],
      3_000,
      { ...OPENROUTER, controlKey: secret, control: { status: 401 } },
    );
    assert.equal(await run, "ok");
    assert.ok(logs.length > 0);
    for (const line of logs) {
      assert.ok(!/abc/.test(line), `key leaked into: ${line}`);
    }
  });
});

describe("the one deadline", () => {
  it("caps each probe by what is left of the grace and never runs past it", async () => {
    // Probe 1 starts with the full 10s, so curl gets its own 8s ceiling. Probe 2 starts at 5s
    // spent and gets 5s. A third probe would have to run past the deadline, so the loop
    // convicts instead of sleeping onto it.
    const { run, commands, elapsed } = harness(
      ["Received=dtn_****9maz"],
      10_000,
      { probeCostMs: 3_000 },
    );
    assert.equal(await run, "stuck");
    assert.equal(commands.length, 2);
    assert.match(commands[0], /curl -s -m 8 /);
    assert.match(commands[1], /curl -s -m 5 /);
    assert.ok(elapsed() <= 10_000, `finished at ${elapsed()}ms`);
  });

  it("starts no probe at all when there is no grace to spend", async () => {
    // The body would convict if it were ever read. Reaching the fail-open answer with zero
    // commands proves the deadline is checked before a probe is started, not after.
    const { run, logs, commands } = harness(["Received=dtn_****9maz"], 0);
    assert.equal(await run, "ok");
    assert.equal(commands.length, 0);
    assert.match(logs[0], /grace spent after 0 probes/);
  });

  it("sends no key to the provider when there is no grace to spend", async () => {
    // The runner's call is started before the loop's own deadline check, so it needs the
    // same gate. Otherwise a preflight with no time left would still put the real key on the
    // wire for an answer nothing would read.
    const { run, commands, controlRequests } = harness(
      ["Received=dtn_****9maz"],
      0,
      { ...OPENROUTER, control: { status: 200 } },
    );
    assert.equal(await run, "ok");
    assert.equal(controlRequests.length, 0, "no key leaves the runner");
    assert.equal(commands.length, 0);
  });

  it("a slow probe cannot push the total past the budget", async () => {
    const { run, commands } = harness(["Received=dtn_****9maz"], 10_000, {
      probeCostMs: 9_000,
    });
    assert.equal(await run, "stuck");
    assert.equal(commands.length, 1, "one 9s probe already spends the grace");
  });
});

describe("provider shapes", () => {
  it("uses the OpenAI-compatible chat probe when the deployment is not direct", async () => {
    const { run, commands } = harness([BARE_401], 3_000, {
      deployment: "custom",
      controlKey: "sk-real-key-value",
    });
    await run;
    assert.match(commands[0], /-X POST /);
    assert.match(commands[0], /https:\/\/gateway\.example\/chat\/completions/);
    assert.match(commands[0], /Authorization: Bearer \$OPENAI_API_KEY/);
  });

  it("uses OpenRouter's documented key endpoint on a direct connection", async () => {
    const { run, commands, controlRequests } = harness([BARE_401], 3_000, {
      ...OPENROUTER,
      control: { status: 200 },
    });
    await run;
    assert.match(commands[0], /'https:\/\/openrouter\.ai\/api\/v1\/key'/);
    assert.ok(!commands[0].includes("-X POST"), "the auth probe is a GET");
    assert.match(commands[0], /Authorization: Bearer \$OPENROUTER_API_KEY/);
    assert.equal(controlRequests[0].method, "GET");
    assert.equal(controlRequests[0].url, "https://openrouter.ai/api/v1/key");
    assert.equal(controlRequests[0].body, undefined);
    assert.equal(
      controlRequests[0].headers.Authorization,
      `Bearer ${OPENROUTER.controlKey}`,
    );
  });

  it("uses Anthropic's model list on a direct connection", async () => {
    const secret = "sk-ant-real-key-value";
    const { run, commands, controlRequests } = harness([BARE_401], 3_000, {
      provider: "anthropic",
      deployment: "direct",
      baseUrl: "https://api.anthropic.com",
      apiKeyVar: "ANTHROPIC_API_KEY",
      controlKey: secret,
      control: { status: 200 },
    });
    await run;
    assert.match(
      commands[0],
      /'https:\/\/api\.anthropic\.com\/v1\/models\?limit=1'/,
    );
    assert.match(commands[0], /x-api-key: \$ANTHROPIC_API_KEY/);
    assert.match(commands[0], /anthropic-version: 2023-06-01/);
    assert.ok(
      !commands[0].includes(secret),
      "the key never enters the sandbox command",
    );
    assert.equal(
      controlRequests[0].url,
      "https://api.anthropic.com/v1/models?limit=1",
    );
    assert.equal(controlRequests[0].headers["x-api-key"], secret);
    assert.equal(controlRequests[0].headers["anthropic-version"], "2023-06-01");
    assert.equal(controlRequests[0].headers.Authorization, undefined);
  });

  it("uses OpenAI's model list on a direct connection", async () => {
    const { run, commands, controlRequests } = harness([BARE_401], 3_000, {
      provider: "openai",
      deployment: "direct",
      baseUrl: "https://api.openai.com/v1",
      controlKey: "sk-real-key-value",
      control: { status: 200 },
    });
    assert.equal(await run, "stuck");
    assert.match(commands[0], /'https:\/\/api\.openai\.com\/v1\/models'/);
    assert.equal(controlRequests[0].url, "https://api.openai.com/v1/models");
  });

  it("never applies the differential to a custom gateway, even on a 200", async () => {
    // The LiteLLM credits proxy lands here. Its masked 401 is what convicts a stuck sandbox,
    // and a 401 from its chat endpoint has too many other causes to attribute.
    const { run, controlRequests } = harness([BARE_401], 3_000, {
      provider: "openai",
      deployment: "custom",
      controlKey: "sk-real-key-value",
      control: { status: 200 },
    });
    assert.equal(await run, "ok");
    assert.equal(controlRequests.length, 0, "no runner call is made at all");
  });

  it("never applies the differential to a tenant gateway labelled direct", async () => {
    // A vault custom-provider record for a known family is labelled `direct` by the resolver
    // while keeping its own URL. Without the canonical-base check the runner would send the
    // real key to that gateway's /models and read the answer as a verdict about our sandbox.
    const { run, commands, controlRequests } = harness([BARE_401], 3_000, {
      provider: "openai",
      deployment: "direct",
      baseUrl: "https://tenant-gateway.example/v1",
      controlKey: "sk-real-key-value",
      control: { status: 200 },
    });
    assert.equal(await run, "ok");
    assert.equal(controlRequests.length, 0, "no key leaves the runner");
    assert.match(commands[0], /chat\/completions/);
  });

  it("matches the canonical base through a trailing slash and an uppercase host", async () => {
    for (const baseUrl of [
      "https://api.openai.com/v1/",
      "https://API.OpenAI.COM/v1",
      "  https://api.openai.com/v1  ",
    ]) {
      const { run, controlRequests } = harness([BARE_401], 3_000, {
        provider: "openai",
        deployment: "direct",
        baseUrl,
        controlKey: "sk-real-key-value",
        control: { status: 200 },
      });
      assert.equal(await run, "stuck", baseUrl);
      assert.equal(
        controlRequests[0].url,
        "https://api.openai.com/v1/models",
        baseUrl,
      );
    }
  });

  it("does not match a canonical host reached over plain http", async () => {
    const { run, controlRequests } = harness([BARE_401], 3_000, {
      provider: "openai",
      deployment: "direct",
      baseUrl: "http://api.openai.com/v1",
      controlKey: "sk-real-key-value",
      control: { status: 200 },
    });
    assert.equal(await run, "ok");
    assert.equal(controlRequests.length, 0);
  });

  it("does not match a canonical base carrying a query or credentials", async () => {
    // The bare `?` and `#` cases matter because `url.search` and `url.hash` are both empty
    // strings for them, so a check that read those two properties would let them through.
    for (const baseUrl of [
      "https://api.openai.com/v1?tenant=acme",
      "https://api.openai.com/v1?",
      "https://api.openai.com/v1#",
      "https://api.openai.com/v1#frag",
      "https://user:pass@api.openai.com/v1",
    ]) {
      const { run, controlRequests } = harness([BARE_401], 3_000, {
        provider: "openai",
        deployment: "direct",
        baseUrl,
        controlKey: "sk-real-key-value",
        control: { status: 200 },
      });
      assert.equal(await run, "ok", baseUrl);
      assert.equal(controlRequests.length, 0, baseUrl);
    }
  });

  it("keeps a direct provider outside the three on the chat probe", async () => {
    const { run, commands, controlRequests } = harness([BARE_401], 3_000, {
      provider: "gemini",
      deployment: "direct",
      controlKey: "sk-real-key-value",
      control: { status: 200 },
    });
    assert.equal(await run, "ok");
    assert.match(commands[0], /chat\/completions/);
    assert.equal(controlRequests.length, 0);
  });

  it("asks the sandbox probe for the HTTP status", async () => {
    const { run, commands } = harness([BARE_401], 3_000, OPENROUTER);
    await run;
    assert.match(commands[0], /http_code/);
  });

  it("single-quotes the URL, so the sandbox shell cannot rewrite it", async () => {
    // Double quotes would let the shell expand `$USER` and run the backtick command before
    // curl saw the URL. The probe would then call some other host and this instrument would
    // report a verdict about a request it never made.
    const { run, commands } = harness([BARE_401], 3_000, {
      baseUrl: "https://gateway.example/$USER/`id`/v1",
    });
    await run;
    assert.ok(
      commands[0].includes(
        "'https://gateway.example/$USER/`id`/v1/chat/completions'",
      ),
      commands[0],
    );
    assert.ok(commands[0].includes("-d '{}' "), commands[0]);
  });

  it("escapes a single quote inside the URL rather than closing the string", async () => {
    const { run, commands } = harness([BARE_401], 3_000, {
      baseUrl: "https://gateway.example/o'brien/v1",
    });
    await run;
    assert.ok(
      commands[0].includes(
        "'https://gateway.example/o'\\''brien/v1/chat/completions'",
      ),
      commands[0],
    );
  });

  it("fails open when the binding name is not a shell-safe variable name", async () => {
    // The name is interpolated into a shell command. Anything but a variable name is an
    // upstream programming error, and the preflight refuses rather than building the string.
    const { run, logs, commands } = harness([BARE_401], 3_000, {
      ...OPENROUTER,
      apiKeyVar: "KEY; curl evil.example",
    });
    assert.equal(await run, "ok");
    assert.equal(commands.length, 0, "nothing is ever run in the sandbox");
    assert.match(logs[0], /not a shell-safe environment variable name/);
  });
});

describe("the runner's own request", () => {
  it("refuses to follow a redirect, so the key cannot be sent to another host", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (
      url: string | URL | Request,
      init: RequestInit,
    ) => {
      seen.push({ url: String(url), init });
      return new Response("{}", { status: 401 });
    }) as unknown as typeof fetch;
    const { run } = harness([BARE_401], 3_000, { ...OPENROUTER, fetchImpl });
    assert.equal(await run, "ok");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, "https://openrouter.ai/api/v1/key");
    assert.equal(seen[0].init.redirect, "error");
    assert.equal(seen[0].init.method, "GET");
    assert.equal(seen[0].init.body, undefined);
    assert.ok(seen[0].init.signal, "the request carries an abort signal");
  });

  it("gives up on a provider that never answers, instead of waiting forever", async () => {
    // The preflight's own abort signal cannot end this call: nothing fires it until the
    // preflight has already stopped waiting. Only a timer inside the request can. Before it
    // existed, a fetch that never settles held `await control` open for the whole run.
    let requestSignal: AbortSignal | undefined;
    const fetchImpl = (async (
      _url: string | URL | Request,
      init: RequestInit,
    ) => {
      requestSignal = init.signal ?? undefined;
      // Never resolves on its own; only the abort ends it, exactly like a hung provider.
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
    }) as unknown as typeof fetch;
    // A tiny budget makes the request's own deadline tiny too, so this finishes in
    // milliseconds of real time rather than the eight second default.
    const { run, logs } = harness([BARE_401], 20, {
      ...OPENROUTER,
      fetchImpl,
    });
    assert.equal(await run, "ok");
    assert.match(logs[0], /gave no verdict/);
    assert.equal(requestSignal?.aborted, true);
  });
});

describe("buildCredentialPreflightInput: what the acquire path hands the preflight", () => {
  // `acquireEnvironment` cannot be driven without a live provider, so this builder is where
  // the kickoff's wiring is pinned. The key value has exactly one destination.
  const candidate = {
    binding: { name: "OPENROUTER_API_KEY" },
    value: "sk-or-real-key-value",
  };

  it("routes the candidate value only into the runner call's credential", () => {
    const input = buildCredentialPreflightInput({
      baseUrl: " https://openrouter.ai/api/v1 ",
      candidate,
      provider: "openrouter",
      deployment: "direct",
    });
    assert.equal(input.baseUrl, "https://openrouter.ai/api/v1");
    assert.equal(input.apiKeyVar, "OPENROUTER_API_KEY");
    assert.equal(input.provider, "openrouter");
    assert.equal(input.deployment, "direct");
    assert.equal(input.controlKey, candidate.value);
    const serialized = JSON.stringify(input);
    assert.equal(
      serialized.split(candidate.value).length - 1,
      1,
      "the value appears once, as the runner call's credential",
    );
  });

  it("keeps the key out of every log line the preflight then writes", async () => {
    const input = buildCredentialPreflightInput({
      baseUrl: "https://openrouter.ai/api/v1",
      candidate,
      provider: "openrouter",
      deployment: "direct",
    });
    const logs: string[] = [];
    const commands: string[] = [];
    let clock = 0;
    const verdict = await awaitCredentialSubstitution({
      ...input,
      sandbox: {
        async runProcess(req) {
          commands.push(req.args?.[1] ?? req.command);
          return { exitCode: 0, stdout: BARE_401 };
        },
      },
      controlProbe: async () => ({ status: 200 }),
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
