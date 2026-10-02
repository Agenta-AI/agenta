import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveRunLimits } from "../../src/engines/sandbox_agent/run-limits.ts";
import type { SandboxTurnAdmission } from "../../src/metering/sandbox-usage.ts";
import { endAbandonedTurn, runAdmittedTurn } from "../../src/metering/turn-admission.ts";
import type { AgentEvent, AgentRunRequest } from "../../src/protocol.ts";

const RUN = {
  sessionId: "conv-1",
  runContext: { project: { id: "proj-1" } },
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
    expect(admit).toHaveBeenCalledWith("Access run-token", "t-1");
    expect(holdSlot).toHaveBeenCalledWith("Access run-token", "t-1");
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
    await runAdmittedTurn(RUN, "t-1", undefined, async () => ({ ok: true }) as never, {
      admit: admitting({ admitted: true }),
      holdSlot,
    });
    expect(holdSlot).not.toHaveBeenCalled();
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
});
