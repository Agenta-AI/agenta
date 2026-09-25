/**
 * `inprocess` is one provider among the others, answered by traits (review S2): it has its own
 * keep-alive pool so every server path that walks the pools covers it (CR4, CR17), its command
 * sandbox parks on every ending except a kill, and the plan asks traits instead of ids.
 */
import { describe, expect, it } from "vitest";
import type { AgentRunRequest } from "../../../src/protocol.ts";
import { sandboxProviderTraits } from "../../../src/config/runner-config.ts";
import { teardown } from "../../../src/environment/sandbox-lifecycle.ts";
import { buildRunPlan } from "../../../src/engines/sandbox_agent/run-plan.ts";
import { readKeepaliveConfig } from "../../../src/engines/sandbox_agent/session-identity.ts";
import { resolveKeepaliveDispatch } from "../../../src/lifecycle/session-coordinator.ts";

const request = (extra: Partial<AgentRunRequest> = {}) =>
  ({ harness: "pi_core", sandbox: "inprocess", messages: [{ role: "user", content: "hi" }], ...extra }) as AgentRunRequest;

describe("provider traits", () => {
  it("describes inprocess as files on the runner and commands in a remote sandbox", () => {
    expect(sandboxProviderTraits("inprocess")).toMatchObject({ filesOnRunner: true, driveOnRunner: false, commandsInRemoteSandbox: true });
    expect(sandboxProviderTraits("local")).toMatchObject({ filesOnRunner: true, driveOnRunner: true, commandsInRemoteSandbox: false });
    expect(sandboxProviderTraits("daytona")).toMatchObject({ filesOnRunner: false, driveOnRunner: false, commandsInRemoteSandbox: true });
    expect(sandboxProviderTraits("e2b")).toEqual({ filesOnRunner: false, driveOnRunner: false, commandsInRemoteSandbox: false, harnessInRunner: false });
  });
});

describe("keep-alive pools include inprocess (CR4, CR17)", () => {
  it("dispatches an inprocess run to its own pool", () => {
    const configs = {
      local: readKeepaliveConfig("local"),
      daytona: readKeepaliveConfig("daytona"),
      inprocess: readKeepaliveConfig("inprocess"),
    };
    expect(resolveKeepaliveDispatch(request(), configs)).toBe("inprocess");
    expect(resolveKeepaliveDispatch(request({ sandbox: "local" }), configs)).toBe("local");
    expect(configs.inprocess.poolMax).toBeGreaterThan(configs.local.poolMax);
  });

  it("stays cold when a caller's config map has no inprocess entry", () => {
    expect(
      resolveKeepaliveDispatch(request(), { local: readKeepaliveConfig("local"), daytona: readKeepaliveConfig("daytona") }),
    ).toBeUndefined();
  });
});

describe("teardown of a command sandbox", () => {
  const handle = () => {
    const calls: string[] = [];
    return {
      calls,
      sandbox: {
        sandboxId: "0e9d1a52-5d2f-4a3e-9d7b-2f1d3c4b5a69",
        pauseSandbox: async () => void calls.push("pause"),
        destroySandbox: async () => void calls.push("destroy"),
        dispose: async () => void calls.push("dispose"),
      },
    };
  };

  it("parks on a failed turn when the provider says so, and still deletes on the shared policy otherwise", async () => {
    const parked = handle();
    const r = await teardown({ sandbox: parked.sandbox, plannedSandboxId: "inprocess", isDaytona: true, harness: "pi_core", reason: "failed-turn", disposition: "stop", log: () => {} });
    expect(r.parked).toBe(true);
    expect(parked.calls).toEqual(["pause", "dispose"]);
    const shared = handle();
    await teardown({ sandbox: shared.sandbox, plannedSandboxId: "daytona", isDaytona: true, harness: "pi_core", reason: "failed-turn", log: () => {} });
    expect(shared.calls).toEqual(["destroy", "dispose"]);
  });
});

describe("run plan", () => {
  it("refuses a non-Pi harness on inprocess before anything starts", () => {
    const r = buildRunPlan(request({ harness: "claude" }), { sandboxProvider: "inprocess", enabledProviders: ["inprocess"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/pi_core/);
  });

  it("accepts a network policy on inprocess (applied to its command sandbox) and still refuses it on local", () => {
    const blocked = { sandboxPermission: { network: { mode: "off" }, enforcement: "best_effort" } } as any;
    const inproc = buildRunPlan(request(blocked), { sandboxProvider: "inprocess", enabledProviders: ["inprocess"] });
    expect(inproc.ok).toBe(true);
    const local = buildRunPlan(request({ ...blocked, sandbox: "local" }), { sandboxProvider: "local", enabledProviders: ["local"] });
    expect(local.ok).toBe(false);
  });

});

describe("local and daytona answer exactly as the id checks the traits replaced", () => {
  // Each pair is the shared code's old expression and the trait that replaced it.
  it.each(["local", "daytona", "e2b", undefined])("%s", (id) => {
    const traits = sandboxProviderTraits(id);
    expect(!traits.filesOnRunner).toBe(id !== "local"); // run-plan: isRemoteSandbox
    expect(traits.commandsInRemoteSandbox).toBe(id === "daytona"); // run-plan network gate, environment-setup root, teardown isDaytona
    expect(traits.harnessInRunner).toBe(false); // server: active turns, readable abandonment; no daemon skip
    expect(traits.harnesses).toBeUndefined(); // run-plan: no harness restriction
    expect(traits.filesOnRunner && traits.commandsInRemoteSandbox).toBe(false); // environment: no provider-owned disposition
  });

  it("keeps each provider's keep-alive pool", () => {
    const configs = {
      local: readKeepaliveConfig("local"),
      daytona: readKeepaliveConfig("daytona"),
      inprocess: readKeepaliveConfig("inprocess"),
    };
    expect(resolveKeepaliveDispatch(request({ sandbox: "daytona" }), configs)).toBe("daytona");
    expect(configs.local).toEqual(readKeepaliveConfig("local"));
  });
});
