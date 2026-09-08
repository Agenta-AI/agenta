/**
 * Boundary tests for the hosted-subscription push a `/run` produces: a fake API server records
 * every push, and the assertion is that EXACTLY ONE lands, carrying the refreshed refresh-token
 * identity and the run's generation.
 *
 * WHAT THESE PROVE, AND WHAT THEY DO NOT.
 *
 *   Case 1 is the real HTTP boundary. It POSTs `/run` to a server built by `createAgentServer()`
 *   with NO injected engine, so the request travels the production path: HTTP decode, the token
 *   gate, `runAgent`, `runSandboxAgent`, `buildRunPlan`, the local subscription materialize, and
 *   the acquire. It proves that a `/run` carrying a `modelConnection.subscription` block really
 *   does reach the subscription machinery and really does push a newer on-disk login to
 *   `POST {apiBase}/secrets/{id}/subscription-login`, over a socket, with the run credential.
 *   It does NOT reach a harness. The acquire is stopped at the Pi permission-extension gate,
 *   which fails closed BEFORE any sandbox infrastructure spins up (environment.ts, the
 *   `localBuiltinGatingUnenforceable` throw), so no daemon process is spawned and nothing leaves
 *   the box. The push it observes is therefore the SESSION-END backstop in `environment.destroy()`,
 *   not a mid-turn refresh.
 *
 *   Case 2 is the mid-turn refresh, one layer below HTTP. It drives the REAL engine
 *   (`runSandboxAgent`) with the shared fake sandbox/session harness from
 *   `tests/utils/sandbox-agent-harness.ts`, and rewrites `auth.json` from inside the fake
 *   prompt — the moment Pi rotates its token. It proves the real publisher, the real push floor
 *   and the real wire body, and it proves exactly-once across the three publishers that all read
 *   the same file (watch, turn end, session end). It does NOT go through the HTTP edge.
 *
 * WHY THEY ARE SPLIT. A single test that is BOTH `/run` over HTTP and a mid-turn harness refresh
 * is not reachable without editing product code. `src/server.ts` builds `runAgent` with a
 * hard-coded `{}` for `SandboxAgentDeps` (src/server.ts:379-409, and `realKeepaliveEngine` at
 * src/server.ts:274-277), so no request field, env var or exported setter can put a fake sandbox
 * behind the HTTP edge. The real path therefore reaches `buildSandboxProvider("local", ...)`
 * (src/engines/sandbox_agent/provider.ts:291), which spawns the real `sandbox-agent server`
 * binary and waits on its HTTP `/health`. `SANDBOX_AGENT_BIN` is the only seam there, and
 * standing in for it means reimplementing that daemon's whole HTTP + ACP control plane, which is
 * not a unit-scale fake. Everything downstream of a harness — the publisher and the
 * materialize-time push — starts only AFTER `SandboxAgent.start` succeeds, so no mid-turn push is
 * reachable over HTTP at all. Rather than fake a pass, case 1 takes the boundary as far as it
 * genuinely goes and case 2 covers the rest honestly.
 *
 * Nothing here touches a network, a provider, or a harness binary: the API is a local
 * `node:http` server, the sandbox is a fake, and the login fixtures come from
 * `tests/utils/subscription-login.ts`.
 *
 * Run: pnpm exec vitest run --project unit tests/unit/subscription-login-run-boundary.test.ts
 */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAgentServer } from "../../src/server.ts";
import { runSandboxAgent } from "../../src/engines/sandbox_agent.ts";
import { resetRunnerConfigCache } from "../../src/config/runner-config.ts";
import type {
  AgentRunRequest,
  ModelConnectionSubscription,
  SubscriptionLogin,
} from "../../src/protocol.ts";
import { fakeHarness } from "../utils/sandbox-agent-harness.ts";
import { makeLogin } from "../utils/subscription-login.ts";

const TOKEN_ENV = "AGENTA_RUNNER_TOKEN";
const TEST_TOKEN = "test-runner-token";
const AUTH = { authorization: `Bearer ${TEST_TOKEN}` };

/** The credential the runner authenticates its pushes with; it rides the run, not the env. */
const RUN_CREDENTIAL = "ApiKey run-credential";

/** The vault row id. It is also the agent-dir name, so it must match the id pattern. */
const CONNECTION_ID = "conn-1";

/** Pi's key for a ChatGPT subscription inside `auth.json`. */
const PI_PROVIDER_KEY = "openai-codex";

/** One recorded call on the fake API. */
interface RecordedCall {
  method: string;
  path: string;
  authorization: string;
  body: Record<string, unknown>;
}

/**
 * A stand-in API: it answers 200 to everything the runner may call (heartbeats, mount signing,
 * record ingest, otel) and records the subscription pushes so a test can count them.
 */
async function fakeApi(): Promise<{
  url: string;
  calls: RecordedCall[];
  pushes: RecordedCall[];
  failures: RecordedCall[];
  close: () => Promise<void>;
}> {
  const calls: RecordedCall[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: Record<string, unknown> = {};
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        body = { unparseable: raw.slice(0, 64) };
      }
      calls.push({
        method: req.method ?? "",
        path: (req.url ?? "").split("?")[0],
        authorization: String(req.headers["authorization"] ?? ""),
        body,
      });
      res.writeHead(200, { "content-type": "application/json" });
      // `updated: true` is what the API answers a push it stored; every other route is happy
      // with an empty object.
      res.end(JSON.stringify({ updated: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const isPush = (call: RecordedCall) =>
    call.method === "POST" &&
    call.path === `/secrets/${CONNECTION_ID}/subscription-login`;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    get pushes() {
      return calls.filter(isPush);
    },
    get failures() {
      return calls.filter(
        (call) =>
          call.path === `/secrets/${CONNECTION_ID}/subscription-login/failure`,
      );
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** The per-connection agent dir this run's plan resolves to, given the state dir. */
function subscriptionHome(stateDir: string): string {
  return join(stateDir, "subscriptions", CONNECTION_ID);
}

/** Write `auth.json` the way Pi writes it: a provider map, mode 0600. */
function writeAuthJson(home: string, login: SubscriptionLogin): void {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(home, "auth.json"),
    JSON.stringify({ [PI_PROVIDER_KEY]: login }),
    { mode: 0o600 },
  );
}

/** Write the lineage sidecar so the materialize keeps the on-disk file rather than replacing it. */
function writeMeta(home: string, version: number, generation: number): void {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(home, "meta.json"),
    JSON.stringify({ version, generation }),
    { mode: 0o600 },
  );
}

const GENERATION = 4;
const VERSION = 7;

/** The login the request delivers. Every "newer" fixture is dated past this one. */
function deliveredLogin(): SubscriptionLogin {
  return makeLogin({
    refresh: "delivered-refresh",
    expires: Date.now() + 3_600_000,
  });
}

/** A login Pi would have written after a background refresh: a new refresh token, later expiry. */
function refreshedLogin(): SubscriptionLogin {
  return makeLogin({
    refresh: "rotated-refresh",
    expires: Date.now() + 7_200_000,
  });
}

function subscriptionBlock(login: SubscriptionLogin): ModelConnectionSubscription {
  return {
    id: CONNECTION_ID,
    slug: "chatgpt",
    provider: "chatgpt",
    version: VERSION,
    generation: GENERATION,
    login,
  };
}

/**
 * A `/run` body that selects a hosted subscription. No `sessionId` and no workflow artifact, so
 * the run makes no ownership claim and signs no mount — this test is about the subscription push,
 * not about session coordination.
 */
function runRequest(login: SubscriptionLogin): AgentRunRequest {
  return {
    harness: "pi_core",
    sandbox: "local",
    messages: [{ role: "user", content: "hello" }],
    model: "gpt-5",
    modelConnection: {
      provider: "openai",
      deployment: "direct",
      credentialMode: "runtime_provided",
      subscription: subscriptionBlock(login),
    },
    telemetry: {
      exporters: { otlp: { headers: { authorization: RUN_CREDENTIAL } } },
    },
  } as unknown as AgentRunRequest;
}

/** Poll until `check` passes or the budget runs out. Filesystem and fetch are not instantaneous. */
async function eventually(
  check: () => boolean,
  what: string,
  budgetMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`never became true: ${what}`);
}

const cleanups: Array<() => void> = [];
const previousEnv: Record<string, string | undefined> = {};

function stubEnv(name: string, value: string): void {
  if (!(name in previousEnv)) previousEnv[name] = process.env[name];
  process.env[name] = value;
}

let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "agenta-run-subscription-"));
  cleanups.push(() => rmSync(stateDir, { recursive: true, force: true }));
  stubEnv("AGENTA_RUNNER_STATE_DIR", stateDir);
  stubEnv(TOKEN_ENV, TEST_TOKEN);
  // The local provider is the only one these need; keep Daytona out of the plan.
  stubEnv("AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS", "local");
  stubEnv("AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER", "local");
  resetRunnerConfigCache();
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    delete previousEnv[name];
  }
  resetRunnerConfigCache();
});

describe("POST /run with a subscription, over HTTP", () => {
  it("pushes a newer on-disk login exactly once, to the real API route", { timeout: 30_000 }, async () => {
    const api = await fakeApi();
    cleanups.push(() => void api.close());
    stubEnv("AGENTA_API_INTERNAL_URL", api.url);
    // Stop the acquire at the Pi permission-extension gate, which fails closed before any
    // sandbox or daemon process starts. That keeps this test a pure in-process HTTP test (no
    // spawned harness, no egress) and is as far as an HTTP-driven subscription run can go here;
    // the session-end push backstop still runs on the acquire-failure path.
    stubEnv("SANDBOX_AGENT_EXTENSION_BUNDLE", join(stateDir, "no-such-bundle.js"));
    resetRunnerConfigCache();

    // A previous run already refreshed this login and its push never landed. That file is what
    // the self-heal exists to get home, and the meta sidecar keeps the materialize from
    // overwriting it with the older delivered copy.
    const home = subscriptionHome(stateDir);
    const onDisk = refreshedLogin();
    writeAuthJson(home, onDisk);
    writeMeta(home, VERSION, GENERATION);

    const server = createAgentServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/run`, {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify(runRequest(deliveredLogin())),
      });
      // The run itself fails (there is no daemon), and that is the point: the push is what is
      // under test, and it must survive a failed acquire.
      assert.equal(res.status, 500);
      const body = (await res.json()) as { ok: boolean; error?: string };
      assert.equal(body.ok, false);

      // The publisher reconciles every 5 s locally, so allow two ticks plus the drain.
      await eventually(() => api.pushes.length >= 1, "a subscription push arrived", 12_000);
      // Give any second publisher a chance to fire before asserting "exactly one".
      await new Promise((resolve) => setTimeout(resolve, 200));

      assert.equal(api.pushes.length, 1, "exactly one push");
      const push = api.pushes[0]!;
      assert.equal(push.method, "POST");
      assert.equal(push.path, `/secrets/${CONNECTION_ID}/subscription-login`);
      assert.equal(push.authorization, RUN_CREDENTIAL);
      assert.equal(push.body.generation, GENERATION);
      assert.equal(push.body.version, VERSION);
      const pushed = push.body.login as Record<string, unknown>;
      assert.equal(
        pushed.refresh,
        onDisk.refresh,
        "the pushed login is the refreshed one on disk, not the one delivered",
      );
      assert.equal(pushed.expires, onDisk.expires);
      assert.equal(api.failures.length, 0, "no failure report");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("pushes nothing when the on-disk login is the one that was delivered", { timeout: 30_000 }, async () => {
    const api = await fakeApi();
    cleanups.push(() => void api.close());
    stubEnv("AGENTA_API_INTERNAL_URL", api.url);
    stubEnv("SANDBOX_AGENT_EXTENSION_BUNDLE", join(stateDir, "no-such-bundle.js"));
    resetRunnerConfigCache();

    const delivered = deliveredLogin();
    const home = subscriptionHome(stateDir);
    writeAuthJson(home, delivered);
    writeMeta(home, VERSION, GENERATION);

    const server = createAgentServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await fetch(`http://127.0.0.1:${port}/run`, {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify(runRequest(delivered)),
      });
      // The floor is what stops an ordinary run from re-sending what the API already has.
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(api.pushes.length, 0, "no push for an unchanged login");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("still gates /run on the runner token", async () => {
    const api = await fakeApi();
    cleanups.push(() => void api.close());
    stubEnv("AGENTA_API_INTERNAL_URL", api.url);
    stubEnv("SANDBOX_AGENT_EXTENSION_BUNDLE", join(stateDir, "no-such-bundle.js"));
    resetRunnerConfigCache();

    const server = createAgentServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(runRequest(deliveredLogin())),
      });
      assert.equal(res.status, 401);
      // A refused run never reached the subscription machinery.
      assert.equal(api.pushes.length, 0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("a subscription run whose harness refreshes auth.json mid-turn", () => {
  it("pushes the rotated login exactly once, with the run's generation", async () => {
    const api = await fakeApi();
    cleanups.push(() => void api.close());
    stubEnv("AGENTA_API_INTERNAL_URL", api.url);
    resetRunnerConfigCache();

    const delivered = deliveredLogin();
    const rotated = refreshedLogin();
    const home = subscriptionHome(stateDir);

    // Pi rotates its OAuth token DURING the turn and writes the new pair into `auth.json`. That
    // file is then the only copy of a live credential: the delivered refresh token has been spent
    // and the provider rotated it away.
    const { deps } = fakeHarness({
      afterPromptEvents: () => {
        writeAuthJson(home, rotated);
      },
    });

    const result = await runSandboxAgent(
      runRequest(delivered),
      undefined,
      undefined,
      deps,
    );
    assert.equal(result.ok, true, result.ok ? "" : String(result.error));

    await eventually(() => api.pushes.length >= 1, "a subscription push arrived", 12_000);
    // The watch, the turn end and the session end all read the same file. Wait past the local
    // watch debounce so a second publisher would have fired if the floor did not hold it back.
    await new Promise((resolve) => setTimeout(resolve, 800));

    assert.equal(api.pushes.length, 1, "exactly one push");
    const push = api.pushes[0]!;
    assert.equal(push.path, `/secrets/${CONNECTION_ID}/subscription-login`);
    assert.equal(push.authorization, RUN_CREDENTIAL);
    assert.equal(push.body.generation, GENERATION);
    assert.equal(push.body.version, VERSION);
    const pushed = push.body.login as Record<string, unknown>;
    assert.equal(
      pushed.refresh,
      rotated.refresh,
      "the pushed identity is the rotated refresh token, not the delivered one",
    );
    assert.notEqual(pushed.refresh, delivered.refresh);
    assert.equal(pushed.expires, rotated.expires);
    assert.equal(api.failures.length, 0, "no failure report");
  });

  it("pushes nothing when the harness never rewrites auth.json", async () => {
    const api = await fakeApi();
    cleanups.push(() => void api.close());
    stubEnv("AGENTA_API_INTERNAL_URL", api.url);
    resetRunnerConfigCache();

    const { deps } = fakeHarness({});
    const result = await runSandboxAgent(
      runRequest(deliveredLogin()),
      undefined,
      undefined,
      deps,
    );
    assert.equal(result.ok, true, result.ok ? "" : String(result.error));

    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.equal(
      api.pushes.length,
      0,
      "an ordinary turn re-sends nothing the API already has",
    );
  });
});
