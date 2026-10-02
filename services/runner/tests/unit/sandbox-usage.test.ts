import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  admitSandboxTurn,
  beginMeteredTurn,
  DEFAULT_SANDBOX_RESOURCES,
  holdTurnSlot,
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
const TURN_KEY = "proj-1:session-1";

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
  const deps = { baseUrl: BASE, log: () => {} };

  it("refuses only on an explicit no, with the platform's own code and message", async () => {
    expect(
      await admitSandboxTurn("ApiKey k", "t-1", {
        ...deps,
        fetch: answer(200, {
          allowed: false,
          code: "concurrent_turns_limit",
          message: "Your organization already has 2 agents running.",
        }),
      }),
    ).toEqual({
      admitted: false,
      code: "concurrent_turns_limit",
      message: "Your organization already has 2 agents running.",
    });
    expect(await admitSandboxTurn("ApiKey k", "t-1", { ...deps, fetch: answer(200, { allowed: false }) })).toEqual({
      admitted: false,
      code: "wallet_balance_exhausted",
      message: "Your Agenta credits are used up, so this turn did not start. Add credits to keep going.",
    });
    expect(await admitSandboxTurn("ApiKey k", "t-1", { ...deps, fetch: answer(200, { allowed: true }) })).toEqual({
      admitted: true,
    });
  });

  it("an unknown refusal code is still a refusal, never a raw code in the chat", async () => {
    const admission = await admitSandboxTurn("ApiKey k", "t-1", {
      ...deps,
      fetch: answer(200, { allowed: false, code: "something_new", message: "Not now." }),
    });
    expect(admission).toEqual({ admitted: false, code: "wallet_balance_exhausted", message: "Not now." });
  });

  it("reads the plan's turn limit and whether the platform counts the turn", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const fetch = (async (_url: string, init?: RequestInit) => {
      seen.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({ allowed: true, turn_limit: { seconds: 1800, message: "Stopped at 30 minutes." }, slot_held: true }),
        { status: 200 },
      );
    }) as unknown as typeof globalThis.fetch;

    expect(await admitSandboxTurn("ApiKey k", "t-1", { ...deps, fetch })).toEqual({
      admitted: true,
      turnLimit: { ms: 1_800_000, message: "Stopped at 30 minutes." },
      slotHeld: true,
    });
    expect(seen).toEqual([{ turn_id: "t-1" }]);
  });

  it("admits when the platform does not meter sandboxes, fails, or cannot be asked", async () => {
    expect(await admitSandboxTurn("ApiKey k", "t-1", { ...deps, fetch: answer(404) })).toEqual({ admitted: true });
    expect(await admitSandboxTurn("ApiKey k", "t-1", { ...deps, fetch: answer(500) })).toEqual({ admitted: true });
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await admitSandboxTurn("ApiKey k", "t-1", { ...deps, fetch: down })).toEqual({ admitted: true });
    const never = vi.fn();
    expect(await admitSandboxTurn("", "t-1", { ...deps, fetch: never as unknown as typeof fetch })).toEqual({
      admitted: true,
    });
    expect(never).not.toHaveBeenCalled();
  });
});

describe("holdTurnSlot", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("beats every interval with the fresh credential and releases once at the end", async () => {
    const { calls, fetch } = platform();
    let credential = "Secret run-1";
    const released = vi.fn();
    const slot = holdTurnSlot("Secret run-1", "t-1", {
      fetch,
      baseUrl: BASE,
      log: () => {},
      intervalMs: 60_000,
      startLease: () => ({ credential: () => credential, release: released }),
    });

    await vi.advanceTimersByTimeAsync(60_000);
    credential = "Secret run-2";
    await vi.advanceTimersByTimeAsync(60_000);
    slot.release();
    slot.release();
    await vi.waitFor(() => expect(released).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(180_000);

    expect(calls.map((c) => [c.url.replace(BASE, ""), c.authorization, c.body.turn_id])).toEqual([
      ["/wallets/sandboxes/turns/heartbeat", "Secret run-1", "t-1"],
      ["/wallets/sandboxes/turns/heartbeat", "Secret run-2", "t-1"],
      ["/wallets/sandboxes/turns/release", "Secret run-2", "t-1"],
    ]);
  });

  it("a release waits for a beat still in flight, so the beat never lands after it", async () => {
    const order: string[] = [];
    let finishBeat: () => void = () => {};
    const fetch = (async (url: string) => {
      const action = String(url).split("/").pop()!;
      order.push(`${action}:sent`);
      if (action === "heartbeat") await new Promise<void>((resolve) => (finishBeat = resolve));
      order.push(`${action}:done`);
      return new Response(null, { status: 204 });
    }) as unknown as typeof globalThis.fetch;
    const slot = holdTurnSlot("Secret run-1", "t-1", {
      fetch,
      baseUrl: BASE,
      log: () => {},
      intervalMs: 60_000,
      startLease: () => ({ credential: () => "Secret run-1", release: () => {} }),
    });

    await vi.advanceTimersByTimeAsync(60_000);
    slot.release();
    await Promise.resolve();
    expect(order).toEqual(["heartbeat:sent"]);
    finishBeat();
    await vi.waitFor(() => expect(order).toHaveLength(4));
    expect(order).toEqual(["heartbeat:sent", "heartbeat:done", "release:sent", "release:done"]);
  });

  it("a failed beat is logged and never thrown", async () => {
    const lines: string[] = [];
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const slot = holdTurnSlot("Secret run-1", "t-1", {
      fetch: down,
      baseUrl: BASE,
      log: (line) => lines.push(line),
      intervalMs: 60_000,
      startLease: () => ({ credential: () => "Secret run-1", release: () => {} }),
    });
    await vi.advanceTimersByTimeAsync(60_000);
    slot.release();
    await vi.waitFor(() => expect(lines).toHaveLength(2));
    expect(lines[0]).toContain("turn heartbeat failed");
  });
});

describe("startSandboxMeter", () => {
  let clock = START_MS;
  let endTurn: () => void = () => {};

  beforeEach(() => {
    clock = START_MS;
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    // The meters below belong to "session-1", whose turn runs for the whole test unless it ends.
    endTurn = beginMeteredTurn(TURN_KEY);
  });
  afterEach(() => {
    endTurn();
    vi.useRealTimers();
  });

  const meter = (overrides: Partial<SandboxMeterOptions> = {}) =>
    startSandboxMeter({
      provider: "daytona",
      sandboxId: "sb-1",
      resources: () => ({ vcpu: 2, memoryGib: 4 }),
      credential: () => "Secret run-1",
      sessionId: "session-1",
      turnKey: TURN_KEY,
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

  it("bills only while a turn of its session runs, not the warm time between turns", async () => {
    const { calls, fetch } = platform();
    const m = meter({ fetch });

    await advance(30_000);
    endTurn(); // the turn ends; the sandbox stays warm
    await advance(120_000);
    endTurn = beginMeteredTurn(TURN_KEY); // the next turn reuses it
    await advance(20_000);
    await m.stop();

    expect(calls.map((c) => [c.body.start_time, c.body.end_time])).toEqual([
      [iso(START_S), iso(START_S + 30)],
      [iso(START_S + 150), iso(START_S + 170)],
    ]);
  });

  it("a sandbox stopped while its session is between turns reports nothing more", async () => {
    const { calls, fetch } = platform();
    const m = meter({ fetch });

    await advance(10_000);
    endTurn();
    await advance(600_000);
    await m.stop();

    expect(calls.map((c) => [c.body.start_time, c.body.end_time])).toEqual([[iso(START_S), iso(START_S + 10)]]);
  });

  it("a meter whose key no turn has ended yet bills until one does: the cold path never pauses", async () => {
    endTurn();
    const { calls, fetch } = platform();
    const m = meter({ fetch });

    await advance(60_000);
    await advance(5_000);
    await m.stop();

    expect(calls.map((c) => [c.body.start_time, c.body.end_time])).toEqual([
      [iso(START_S), iso(START_S + 60)],
      [iso(START_S + 60), iso(START_S + 65)],
    ]);
  });

  it("another project's turn of a session with the same id does not bill this sandbox", async () => {
    const { calls, fetch } = platform();
    const m = meter({ fetch });

    await advance(10_000);
    endTurn();
    const other = beginMeteredTurn("proj-2:session-1");
    await advance(60_000);
    other();
    await m.stop();

    expect(calls.map((c) => [c.body.start_time, c.body.end_time])).toEqual([[iso(START_S), iso(START_S + 10)]]);
  });

  it("a run without a session has no warm window: it is billed until its sandbox stops", async () => {
    endTurn();
    const { calls, fetch } = platform();
    const m = meter({ fetch, sessionId: undefined, turnKey: undefined });

    await advance(60_000);
    await advance(5_000);
    await m.stop();

    expect(calls.map((c) => [c.body.start_time, c.body.end_time])).toEqual([
      [iso(START_S), iso(START_S + 60)],
      [iso(START_S + 60), iso(START_S + 65)],
    ]);
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
    const admission = await admitSandboxTurn(meteringCredentialForRequest(RUN), "t-1", {
      fetch: fetch as unknown as typeof globalThis.fetch,
      baseUrl: BASE,
      log: () => {},
    });
    const usage = sandboxUsageContext(RUN, "conv-1");

    expect(admission).toEqual({ admitted: true });
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
    expect(sandboxUsageContext(RUN, "conv-1", "proj-1")?.turnKey).toBe("proj-1:conv-1");
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

    await admitSandboxTurn("Access run-token", "t-1", { fetch, baseUrl: BASE, log: () => {} });
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
