import { afterEach, describe, expect, it, vi } from "vitest";

vi.unmock("../../src/metering/sandbox-usage.ts");

import { resolveRunLimits } from "../../src/engines/sandbox_agent/run-limits.ts";
import { startSandboxMeter, type SandboxTurnAdmission } from "../../src/metering/sandbox-usage.ts";
import { endAbandonedTurn, noteTurnScope, runAdmittedTurn } from "../../src/metering/turn-admission.ts";
import type { AgentEvent, AgentRunRequest } from "../../src/protocol.ts";

const RUN = {
  sessionId: "conv-1",
  telemetry: { exporters: { otlp: { headers: { authorization: "Access run-token" } } } },
} as unknown as AgentRunRequest;

const admitting = (answer: SandboxTurnAdmission) => vi.fn(async () => answer);

describe("runAdmittedTurn", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("a refused turn never runs: the person reads the platform's sentence and its class", async () => {
    vi.stubEnv("AGENTA_WALLETS_ENABLED", "true");
    const events: AgentEvent[] = [];
    const run = vi.fn();
    const holdSlot = vi.fn();
    const message = "Your organization already has 2 agents running, the most the Hobby plan allows at once.";

    const result = await runAdmittedTurn(RUN, "t-1", (event) => events.push(event), run, {
      admit: admitting({ admitted: false, code: "concurrent_turns_limit", message }),
      holdSlot,
    });

    expect(result).toEqual({ ok: false, error: message });
    expect(events).toEqual([{ type: "error", message, code: "concurrent_turns_limit" }]);
    expect(run).not.toHaveBeenCalled();
    expect(holdSlot).not.toHaveBeenCalled();
  });

  it("an admitted turn runs under the plan's turn limit and holds its slot until it ends", async () => {
    vi.stubEnv("AGENTA_WALLETS_ENABLED", "true");
    const release = vi.fn();
    const holdSlot = vi.fn(() => ({ release }));
    let totalMs = 0;
    const admit = admitting({
      admitted: true,
      turnLimit: { ms: 1_800_000, message: "Stopped at 30 minutes." },
      slotHeld: true,
    });

    const result = await runAdmittedTurn(
      RUN,
      "t-1",
      undefined,
      async () => {
        totalMs = resolveRunLimits().totalMs;
        expect(release).not.toHaveBeenCalled();
        return { ok: true, output: "done" } as never;
      },
      { admit, holdSlot },
    );

    expect(result).toMatchObject({ ok: true });
    expect(totalMs).toBe(1_800_000);
    expect(admit).toHaveBeenCalledWith("Access run-token", "t-1", "conv-1");
    expect(holdSlot).toHaveBeenCalledWith("Access run-token", "t-1", "conv-1", { heartbeat: true });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("a turn that throws still gives its slot back", async () => {
    const release = vi.fn();
    await expect(
      runAdmittedTurn(
        RUN,
        "t-1",
        undefined,
        async () => {
          throw new Error("boom");
        },
        { admit: admitting({ admitted: true, slotHeld: true }), holdSlot: () => ({ release }) },
      ),
    ).rejects.toThrow("boom");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("no slot is held when the platform does not count the turn", async () => {
    const holdSlot = vi.fn();
    const noSession = { ...RUN, sessionId: undefined } as unknown as AgentRunRequest;
    await runAdmittedTurn(noSession, "t-1", undefined, async () => ({ ok: true }) as never, {
      admit: admitting({ admitted: true }),
      holdSlot,
    });
    expect(holdSlot).not.toHaveBeenCalled();
  });

  it("a session turn the platform does not count still releases at its end, without beats", async () => {
    // Codex review r2: an uncapped turn's session hold outlived the turn because only a held slot
    // was ever released.
    vi.stubEnv("AGENTA_WALLETS_ENABLED", "true");
    const release = vi.fn();
    const holdSlot = vi.fn(() => ({ release }));
    await runAdmittedTurn(RUN, "t-1", undefined, async () => ({ ok: true }) as never, {
      admit: admitting({ admitted: true }),
      holdSlot,
    });
    expect(holdSlot).toHaveBeenCalledWith("Access run-token", "t-1", "conv-1", { heartbeat: false });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("a turn the runner abandons gives its slot back although its run never settles", async () => {
    const release = vi.fn();
    const holdSlot = vi.fn(() => ({ release }));
    void runAdmittedTurn(RUN, "t-stuck", undefined, () => new Promise(() => {}), {
      admit: admitting({ admitted: true, slotHeld: true }),
      holdSlot,
    });
    await vi.waitFor(() => expect(holdSlot).toHaveBeenCalled());
    expect(release).not.toHaveBeenCalled();

    endAbandonedTurn("t-stuck");
    endAbandonedTurn("t-stuck");

    expect(release).toHaveBeenCalledTimes(1);
  });

  it("the pool's resolved scope opens the billing window, and the turn's end pauses the warm sandbox", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      let clock = Date.UTC(2026, 9, 2, 12, 0, 0);
      const bounds: Array<[string, string]> = [];
      const fetch = (async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        bounds.push([body.start_time, body.end_time]);
        return new Response("{}", { status: 200 });
      }) as unknown as typeof globalThis.fetch;
      let meter: ReturnType<typeof startSandboxMeter> | undefined;

      await runAdmittedTurn(RUN, "t-1", undefined, async () => {
        // The coordinator resolves the scope (here from the signed mount), then acquires.
        noteTurnScope("proj-from-mount");
        meter = startSandboxMeter({
          provider: "daytona",
          sandboxId: "sb-1",
          resources: () => ({ vcpu: 2, memoryGib: 4 }),
          credential: () => "Secret run-1",
          turnKey: "proj-from-mount:conv-1",
          now: () => clock,
          intervalMs: 60_000,
          fetch,
          baseUrl: "http://api.test",
          log: () => {},
        });
        clock += 20_000;
        return { ok: true } as never;
      }, { admit: admitting({ admitted: true }) });

      clock += 120_000; // warm, between turns
      await vi.advanceTimersByTimeAsync(120_000);
      await meter!.stop();

      const start = Math.floor(Date.UTC(2026, 9, 2, 12, 0, 0) / 1000);
      expect(bounds).toEqual([
        [new Date(start * 1000).toISOString(), new Date((start + 20) * 1000).toISOString()],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
