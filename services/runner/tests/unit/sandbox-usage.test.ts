import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  admitSandboxTurn,
  DEFAULT_SANDBOX_RESOURCES,
  meteringCredentialForRequest,
  sandboxMeteringEnabled,
  sandboxUsageContext,
  startLeasedSandboxMeter,
  startSandboxMeter,
  type SandboxMeterOptions,
} from "../../src/metering/sandbox-usage.ts";
import type { AgentRunRequest } from "../../src/protocol.ts";

vi.unmock("../../src/metering/sandbox-usage.ts");

const BASE = "http://api.test/api";
const AGENT = "0198f4e2-6a1b-7c3d-9e8f-0a1b2c3d4e5f";
const START_MS = Date.UTC(2026, 8, 26, 12, 0, 0, 400);
const START_S = Math.floor(START_MS / 1000);

interface Call {
  url: string;
  authorization: string;
  body: Record<string, unknown>;
}

/** A platform that answers each report with the next status in `statuses` (then 200). */
function platform(statuses: number[] = []) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    calls.push({
      url: String(url),
      authorization: headers.authorization!,
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });
    const status = statuses.shift() ?? 200;
    return new Response(JSON.stringify({ measurement_id: "m" }), { status });
  });
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

describe("admitSandboxTurn", () => {
  const answer = (status: number, body: unknown = {}) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("refuses only on an explicit no from the wallet", async () => {
    const deps = { baseUrl: BASE, log: () => {} };
    expect(await admitSandboxTurn("ApiKey k", { ...deps, fetch: answer(200, { allowed: false }) })).toBe("refused");
    expect(await admitSandboxTurn("ApiKey k", { ...deps, fetch: answer(200, { allowed: true }) })).toBe("admitted");
  });

  it("admits when the platform does not meter sandboxes, fails, or cannot be asked", async () => {
    const deps = { baseUrl: BASE, log: () => {} };
    expect(await admitSandboxTurn("ApiKey k", { ...deps, fetch: answer(404) })).toBe("admitted");
    expect(await admitSandboxTurn("ApiKey k", { ...deps, fetch: answer(500) })).toBe("admitted");
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await admitSandboxTurn("ApiKey k", { ...deps, fetch: down })).toBe("admitted");
    const never = vi.fn();
    expect(await admitSandboxTurn("", { ...deps, fetch: never as unknown as typeof fetch })).toBe("admitted");
    expect(never).not.toHaveBeenCalled();
  });
});

describe("startSandboxMeter", () => {
  let clock = START_MS;

  beforeEach(() => {
    clock = START_MS;
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const meter = (overrides: Partial<SandboxMeterOptions> = {}) =>
    startSandboxMeter({
      provider: "daytona",
      sandboxId: "sb-1",
      resources: () => ({ vcpu: 2, memoryGib: 4 }),
      credential: () => "Secret run-1",
      sessionId: "session-1",
      agentId: AGENT,
      startedAtMs: START_MS,
      intervalMs: 60_000,
      now: () => clock,
      baseUrl: BASE,
      log: () => {},
      ...overrides,
    });

  /** Let the clock and the interval timer move together. */
  const advance = async (ms: number) => {
    clock += ms;
    await vi.advanceTimersByTimeAsync(ms);
  };

  it("reports each minute and the final partial interval in whole seconds", async () => {
    const { calls, fetch } = platform();
    const m = meter({ fetch });

    await advance(60_000);
    await advance(60_000);
    await advance(17_300);
    await m.stop();

    expect(calls.map((c) => c.url)).toEqual(Array(3).fill(`${BASE}/wallets/sandboxes/usage`));
    expect(calls.map((c) => [c.body.start_time, c.body.end_time])).toEqual([
      [iso(START_S), iso(START_S + 60)],
      [iso(START_S + 60), iso(START_S + 120)],
      [iso(START_S + 120), iso(START_S + 137)],
    ]);
    expect(calls[0]!.body).toEqual({
      provider: "daytona",
      sandbox_id: "sb-1",
      start_time: iso(START_S),
      end_time: iso(START_S + 60),
      vcpu: 2,
      memory_gib: 4,
      session_id: "session-1",
      agent_id: AGENT,
    });
    expect(calls[0]!.authorization).toBe("Secret run-1");
  });

  it("keeps an interval the platform did not take and sends the same one again", async () => {
    const { calls, fetch } = platform([503]);
    const m = meter({ fetch });

    await advance(60_000);
    await advance(60_000);
    await m.stop();

    const bounds = calls.map((c) => [c.body.start_time, c.body.end_time]);
    expect(bounds).toEqual([
      [iso(START_S), iso(START_S + 60)], // refused: 503
      [iso(START_S), iso(START_S + 60)], // the same interval, again
      [iso(START_S + 60), iso(START_S + 120)],
    ]);
  });

  it("goes quiet when the platform does not meter sandboxes", async () => {
    const { calls, fetch } = platform([404]);
    const m = meter({ fetch });

    await advance(60_000);
    await advance(60_000);
    await advance(60_000);
    await m.stop();

    expect(calls).toHaveLength(1);
  });

  it("drops an interval the platform refused as invalid and keeps going", async () => {
    const { calls, fetch } = platform([422]);
    const m = meter({ fetch });

    await advance(60_000);
    await advance(60_000);
    await m.stop();

    expect(calls.map((c) => c.body.start_time)).toEqual([iso(START_S), iso(START_S + 60)]);
  });

  it("reads the owner's current credential for every report", async () => {
    const { calls, fetch } = platform();
    let credential = "Secret run-1";
    const m = meter({ fetch, credential: () => credential });

    await advance(60_000);
    credential = "Secret run-2";
    await advance(60_000);
    await m.stop();

    expect(calls.map((c) => c.authorization)).toEqual(["Secret run-1", "Secret run-2"]);
  });

  it("ends the last interval at the stop, not when a slow report in flight finishes", async () => {
    const calls: Array<Record<string, unknown>> = [];
    let release: () => void = () => {};
    const slow = vi.fn(async (_url: unknown, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      if (calls.length === 1) await new Promise<void>((resolve) => (release = resolve));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const m = meter({ fetch: slow });

    await advance(60_000); // the first report hangs
    await advance(1_000);
    const stopping = m.stop(); // stopped at second 61
    await advance(4_000); // the hung report answers four seconds later
    release();
    await stopping;

    expect(calls.map((c) => c.end_time)).toEqual([iso(START_S + 60), iso(START_S + 61)]);
  });

  it("meters the default size when the provider never answers", async () => {
    const { calls, fetch } = platform();
    const m = meter({ fetch, resources: () => new Promise(() => {}) });

    await advance(60_000);
    await advance(10_000);
    await m.stop();

    expect([calls[0]!.body.vcpu, calls[0]!.body.memory_gib]).toEqual([
      DEFAULT_SANDBOX_RESOURCES.vcpu,
      DEFAULT_SANDBOX_RESOURCES.memoryGib,
    ]);
  });

  it("stops retrying at teardown after its budget and says what it lost", async () => {
    const lines: string[] = [];
    const { calls, fetch } = platform(Array(1000).fill(503));
    const m = meter({ fetch, log: (line) => lines.push(line) });

    await advance(30_000);
    const stopping = m.stop();
    for (let i = 0; i < 20; i++) await advance(500);
    await stopping;

    expect(calls.length).toBeGreaterThan(1);
    expect(new Set(calls.map((c) => c.body.start_time))).toEqual(new Set([iso(START_S)]));
    expect(lines.some((line) => line.includes("30s of running time not reported"))).toBe(true);
  });

  it("meters the default size when the provider does not report one", async () => {
    const { calls, fetch } = platform();
    const m = meter({ fetch, resources: () => Promise.reject(new Error("get failed")) });

    await advance(60_000);
    await m.stop();

    expect([calls[0]!.body.vcpu, calls[0]!.body.memory_gib]).toEqual([
      DEFAULT_SANDBOX_RESOURCES.vcpu,
      DEFAULT_SANDBOX_RESOURCES.memoryGib,
    ]);
  });

  it("leaves out an agent id the platform could not read", async () => {
    const { calls, fetch } = platform();
    const m = meter({ fetch, agentId: "not-a-uuid" });

    await advance(60_000);
    await m.stop();

    expect(calls[0]!.body).not.toHaveProperty("agent_id");
  });

  it("reports nothing for a sandbox that ran under a second", async () => {
    const { calls, fetch } = platform();
    const m = meter({ fetch });

    await advance(500);
    await m.stop();

    expect(calls).toHaveLength(0);
  });
});

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/** A run carrying a platform credential, as the API dispatches one. */
const RUN = {
  telemetry: { exporters: { otlp: { headers: { authorization: "Access run-token" } } } },
  runContext: { workflow: { artifact: { id: AGENT } } },
} as unknown as AgentRunRequest;

describe("the wallet switch", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads AGENTA_WALLETS_ENABLED the way the API does, off by default", () => {
    expect(sandboxMeteringEnabled({})).toBe(false);
    expect(sandboxMeteringEnabled({ AGENTA_WALLETS_ENABLED: "false" })).toBe(false);
    expect(sandboxMeteringEnabled({ AGENTA_WALLETS_ENABLED: " True " })).toBe(true);
    expect(sandboxMeteringEnabled({ AGENTA_WALLETS_ENABLED: "1" })).toBe(true);
  });

  it("off, a run with a platform credential makes no admission call and holds no meter or lease", async () => {
    vi.stubEnv("AGENTA_WALLETS_ENABLED", "false");
    const fetch = vi.fn();

    // The same calls server.ts and environment.ts make.
    const admission = await admitSandboxTurn(meteringCredentialForRequest(RUN), {
      fetch: fetch as unknown as typeof globalThis.fetch,
      baseUrl: BASE,
      log: () => {},
    });
    const usage = sandboxUsageContext(RUN, "conv-1");

    expect(admission).toBe("admitted");
    expect(fetch).not.toHaveBeenCalled();
    // No usage context: environment.ts starts no leased meter, and a command sandbox is never
    // handed one, so it starts no lease or meter either.
    expect(usage).toBeUndefined();
  });

  it("on, the run's credential names the payer of its sandbox", () => {
    vi.stubEnv("AGENTA_WALLETS_ENABLED", "true");

    expect(sandboxUsageContext(RUN, "conv-1")).toEqual({
      authorization: "Access run-token",
      sessionId: "conv-1",
      agentId: AGENT,
    });
  });
});

describe("the runner proves it is the runner", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends the runner token beside the run's credential on both calls", async () => {
    vi.stubEnv("AGENTA_RUNNER_TOKEN", "runner-secret");
    const seen: Array<Record<string, string>> = [];
    const fetch = (async (_url: string, init?: RequestInit) => {
      seen.push(init?.headers as Record<string, string>);
      return new Response(JSON.stringify({ allowed: true }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    let t = START_MS;

    await admitSandboxTurn("Access run-token", { fetch, baseUrl: BASE, log: () => {} });
    const meter = startSandboxMeter({
      provider: "daytona",
      sandboxId: "sb-1",
      resources: () => DEFAULT_SANDBOX_RESOURCES,
      credential: () => "Access run-token",
      now: () => t,
      fetch,
      baseUrl: BASE,
      log: () => {},
    });
    t += 5_000;
    await meter.stop();

    expect(seen).toHaveLength(2);
    for (const headers of seen) {
      expect(headers.authorization).toBe("Access run-token");
      expect(headers["x-agenta-runner-token"]).toBe("runner-secret");
    }
  });
});

describe("startLeasedSandboxMeter", () => {
  it("gives back its credential lease as soon as the platform says it does not meter", async () => {
    const events: string[] = [];
    let t = START_MS;
    const meter = startLeasedSandboxMeter({
      authorization: "Access run-token",
      startLease: (authorization) => {
        events.push(`lease ${authorization}`);
        return { credential: () => authorization, release: () => events.push("release") };
      },
      provider: "daytona",
      sandboxId: "sb-1",
      resources: () => DEFAULT_SANDBOX_RESOURCES,
      intervalMs: 1_000,
      now: () => t,
      fetch: platform([404]).fetch,
      baseUrl: BASE,
      log: () => {},
    });
    t += 2_000;

    await vi.waitFor(() => expect(events).toEqual(["lease Access run-token", "release"]), { timeout: 3_000 });
    await meter.stop();
  });
});
