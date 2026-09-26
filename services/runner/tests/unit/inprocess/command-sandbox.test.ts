/**
 * The command sandbox's lifecycle, against the local Daytona stand-in with injected faults:
 * bounded, cancellable calls; a sandbox in an unknown state is retired; a policy change that was
 * not confirmed retires the sandbox, so a stale update never reopens one a command uses; a runner
 * uses only the sandboxes it created; a replacement never runs beside the sandbox it replaces past
 * the cap; credentials never in command text; a park waits for the command; an outside stop is
 * recovered; registry capacity; a running slot goes back only once its sandbox is confirmed
 * stopped or gone.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConversationRegistry } from "../../../src/engines/inprocess/conversation-registry.ts";
import { CommandSandbox, CREDENTIALS_LABEL, NetworkPolicyError } from "../../../src/engines/inprocess/sandbox/command-sandbox.ts";
import { boundedDaytonaApi } from "../../../src/engines/inprocess/sandbox/daytona-api.ts";
import { sandboxSlots, sandboxSlotsUnresolvedMessage } from "../../../src/engines/inprocess/sandbox/sandbox-slots.ts";
import { classifyRunError } from "../../../src/engines/sandbox_agent/errors.ts";
import { OWNER_LABEL, type SandboxOwner } from "../../../src/engines/inprocess/sandbox/sandbox-owner.ts";
import { createTestWorkspace, OPEN_NETWORK, sandboxSettings, TEST_DEADLINES, testConversation, testOwner, testRegistryOptions } from "../../utils/inprocess-workspace.ts";
import { LocalDaytona } from "../../utils/local-daytona.ts";

const BLOCKED = { network: { networkBlockAll: true }, environment: {} };
const KEY = "inprocess:p:conv-1";

function newSandbox(daytona: LocalDaytona, owner: SandboxOwner = testOwner(), settings = sandboxSettings()) {
  const sandbox = new CommandSandbox(KEY, settings, boundedDaytonaApi(daytona, TEST_DEADLINES), owner, { "agenta.conversation": "conv-1" }, () => {});
  return { sandbox, owner };
}

/** A runner process: its own owner and registry, on the shared Daytona. */
function runner(daytona: LocalDaytona, holder: string) {
  const owner = testOwner(holder);
  const registry = new ConversationRegistry(sandboxSettings(), boundedDaytonaApi(daytona, TEST_DEADLINES), owner, () => {}, testRegistryOptions(daytona));
  const workspace = registry.hold({ ...testConversation(KEY), conversationId: "conv-1" });
  return { owner, registry, sandbox: workspace.sandbox };
}

const freshDaytona = () => new LocalDaytona(join(mkdtempSync(join(tmpdir(), "cmdsbx-")), "sandbox"));

describe("network policy fails closed (R3-5, Codex 4, Codex R4 late update)", () => {
  it("applies a stricter policy before a reused sandbox runs anything", async () => {
    const daytona = freshDaytona();
    const { sandbox } = newSandbox(daytona);
    (await sandbox.acquire(OPEN_NETWORK)).release();
    const use = await sandbox.acquire(BLOCKED);
    expect(daytona.sandboxes.get(use.sandbox.id)!.network).toEqual({ networkBlockAll: true });
    use.release();
  });

  it("retires a sandbox whose policy change failed; the next command gets a new one with the policy at create", async () => {
    const daytona = freshDaytona();
    const { sandbox } = newSandbox(daytona);
    const first = await sandbox.acquire(OPEN_NETWORK);
    const local = daytona.sandboxes.get(first.sandbox.id)!;
    first.release();
    local.faults = { fail: new Set(["updateNetwork"]) };
    await expect(sandbox.acquire(BLOCKED)).rejects.toBeInstanceOf(NetworkPolicyError);
    const retried = await sandbox.acquire(BLOCKED);
    expect(retried.sandbox.id).not.toBe(local.id);
    expect(daytona.sandboxes.get(retried.sandbox.id)!.network).toEqual({ networkBlockAll: true });
    retried.release();
    await sandbox.settle(5_000);
    expect(local.deleted).toBe(true);
  });

  it("never lets a late, stale update reopen the sandbox a command uses (Codex R4 repro)", async () => {
    const daytona = freshDaytona();
    const { sandbox } = newSandbox(daytona);
    const first = await sandbox.acquire(BLOCKED);
    const old = daytona.sandboxes.get(first.sandbox.id)!;
    first.release();
    // 1. An "open network" update stalls past its deadline, then lands later.
    old.faults = { delayNetworkMs: TEST_DEADLINES.controlMs + 700 };
    await expect(sandbox.acquire(OPEN_NETWORK)).rejects.toBeInstanceOf(NetworkPolicyError);
    old.faults = {};
    // 2. The next command wants the network blocked.
    const use = await sandbox.acquire(BLOCKED);
    // 3. The stale "open" update lands on the old sandbox.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(old.network).toEqual({ networkBlockAll: false });
    // 4. The command runs on a sandbox that never saw that update, and the old one is never used again.
    expect(use.sandbox.id).not.toBe(old.id);
    expect(daytona.sandboxes.get(use.sandbox.id)!.network).toEqual({ networkBlockAll: true });
    expect(daytona.sandboxes.get(use.sandbox.id)!.networkUpdates).toHaveLength(0);
    use.assertCurrent();
    use.release();
  }, 15_000);

  it("applies the policy at create, so a new sandbox needs no update", async () => {
    const daytona = freshDaytona();
    const use = await newSandbox(daytona).sandbox.acquire(BLOCKED);
    expect(daytona.sandboxes.get(use.sandbox.id)!.networkUpdates).toHaveLength(0);
    expect(daytona.sandboxes.get(use.sandbox.id)!.network).toEqual({ networkBlockAll: true });
    use.release();
  });
});

describe("custom credentials (R3-11, Codex 9)", () => {
  it("delivers them as sandbox environment, never in command text, and replaces the sandbox when they change", async () => {
    const ws = createTestWorkspace();
    const requirements = { network: { networkBlockAll: false }, environment: { MY_API_KEY: "sk-secret-value" } };
    const r = await ws.bash('[ "${MY_API_KEY#sk-secret-}" = value ] && echo usable', { requirements });
    expect(r.output).toContain("usable");
    const [first] = [...ws.daytona.sandboxes.values()];
    expect(first!.commands.join("\n")).not.toContain("sk-secret-value");
    expect(first!.labels[CREDENTIALS_LABEL]).not.toContain("sk-secret");
    const rotated = { network: { networkBlockAll: false }, environment: { MY_API_KEY: "sk-rotated" } };
    const r2 = await ws.bash('echo "len=${#MY_API_KEY}"', { requirements: rotated });
    expect(r2.output).toContain("len=10");
    expect(ws.daytona.creates).toBe(2);
  });
});

describe("a runner uses only the sandboxes it created", () => {
  it("a conversation that moves to another runner gets a new sandbox; the old one is never touched by it", async () => {
    const daytona = freshDaytona();
    const a = runner(daytona, "runner-a");
    const useA = await a.sandbox.acquire(OPEN_NETWORK);
    const old = daytona.sandboxes.get(useA.sandbox.id)!;
    useA.release();
    const callsBefore = old.calls.length;
    const b = runner(daytona, "runner-b");
    const useB = await b.sandbox.acquire(OPEN_NETWORK);
    expect(useB.sandbox.id).not.toBe(old.id);
    expect(useB.sandbox.labels[OWNER_LABEL]).toBe(b.owner.id);
    expect(old.calls.length).toBe(callsBefore);
    useB.release();
  });
});

describe("the running-sandbox cap holds through a replacement (Codex R5 P1-3)", () => {
  it("a credential rotation never has the old and the new sandbox running together past a cap of one", async () => {
    const daytona = freshDaytona();
    const settings = sandboxSettings({ slots: sandboxSlots(4, 1, 5_000) });
    const { sandbox } = newSandbox(daytona, testOwner(), settings);
    const first = await sandbox.acquire({ network: { networkBlockAll: false }, environment: { K: "one" } });
    const old = daytona.sandboxes.get(first.sandbox.id)!;
    first.release();
    // The old sandbox's delete is slow; the replacement must wait for it.
    const remove = old.remove.bind(old);
    let deletedAt = 0;
    old.remove = async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await remove();
      deletedAt = Date.now();
    };
    const second = await sandbox.acquire({ network: { networkBlockAll: false }, environment: { K: "two" } });
    const createdAt = daytona.sandboxes.get(second.sandbox.id)!.createdAt;
    expect(deletedAt).toBeGreaterThan(0);
    expect(createdAt).toBeGreaterThanOrEqual(deletedAt);
    expect(settings.slots!.running.inUse).toBe(1);
    second.release();
  });
});

describe("recovery and retirement (CR7, R3-4, Codex 8)", () => {
  it("recovers a sandbox Daytona stopped behind the runner's back, without failing the command", async () => {
    const ws = createTestWorkspace();
    await ws.bash("echo keep > /tmp/.agenta-test-marker-$$ ; true");
    const [local] = [...ws.daytona.sandboxes.values()];
    local!.state = "stopped";
    const r = await ws.bash("echo after-outside-stop");
    expect(r.output).toContain("after-outside-stop");
    expect(local!.state).toBe("started");
  });

  it("lets Stop end a wait on a Daytona call that never answers", async () => {
    const sandbox = new CommandSandbox("k", sandboxSettings(), { create: () => new Promise(() => {}) }, testOwner(), {}, () => {});
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 100);
    const t0 = Date.now();
    await expect(sandbox.acquire(OPEN_NETWORK, stop.signal)).rejects.toThrow(/aborted/);
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it("waits for a command in flight before a park stops the sandbox (R3-13)", async () => {
    const ws = createTestWorkspace();
    await ws.bash("true");
    const running = ws.bash("sleep 0.5; echo finished");
    await new Promise((r) => setTimeout(r, 150));
    ws.registry.release(ws.workspace, "park");
    const [local] = [...ws.daytona.sandboxes.values()];
    expect(local!.state).toBe("started");
    const r = await running;
    expect(r.output).toContain("finished");
    await ws.registry.settle(5_000);
    expect(local!.state).toBe("stopped");
  });
});

describe("the registry (Codex 11)", () => {
  it("never evicts the entry it is handing out, and keeps one object per conversation", () => {
    const daytona = freshDaytona();
    const registry = new ConversationRegistry(sandboxSettings(), daytona, testOwner(), () => {}, testRegistryOptions(daytona, { maxEntries: 1 }));
    const spec = (id: string) => testConversation(id);
    const one = registry.hold(spec("one"));
    const two = registry.hold(spec("two"));
    expect(registry.hold(spec("one"))).toBe(one);
    expect(registry.hold(spec("two"))).toBe(two);
  });
});

describe("a running slot goes back only once its sandbox is confirmed stopped or gone (Codex R6 P1-2)", () => {
  const FAST_RECONCILE = { reconcileDelaysMs: [50] };

  it("never has two sandboxes started past a cap of one when the old one's delete fails (Codex's reproduction), and refuses with a sentence", async () => {
    const slots = sandboxSlots(1, 1, 1_000, FAST_RECONCILE);
    const w = createTestWorkspace({ settings: { slots } });
    await w.bash("true");
    const old = [...w.daytona.sandboxes.values()][0]!;
    old.faults.fail = new Set(["remove"]);
    const refused = await w.bash("true", { requirements: { ...OPEN_NETWORK, environment: { ROTATED: "yes" } } }).catch((err: Error) => err);
    const started = [...w.daytona.sandboxes.values()].filter((s) => s.state === "started" && !s.deleted);
    expect(started).toHaveLength(1);
    expect(slots.running.inUse).toBe(1);
    expect(refused).toBeInstanceOf(Error);
    expect((refused as Error).message).toBe(sandboxSlotsUnresolvedMessage(1));
    expect(classifyRunError(refused, "pi").code).toBe("sandbox_capacity");
    // The delete works again: reconciliation deletes it, the slot goes back, the command runs.
    old.faults.fail = new Set();
    const r = await w.bash("echo rotated", { requirements: { ...OPEN_NETWORK, environment: { ROTATED: "yes" } } });
    expect(r.output).toContain("rotated");
    expect(old.deleted).toBe(true);
    expect(slots.running.inUse).toBe(1);
    expect(slots.running.unresolved).toBe(0);
  });

  it("keeps the slot of a sandbox whose stop failed until Daytona reports it stopped", async () => {
    const slots = sandboxSlots(4, 1, 2_000, FAST_RECONCILE);
    const a = createTestWorkspace({ settings: { slots }, conversationId: "a" });
    const b = createTestWorkspace({ settings: { slots }, conversationId: "b" });
    await a.bash("true");
    const sandboxA = [...a.daytona.sandboxes.values()][0]!;
    // The stop times out on our side; Daytona still reports the sandbox started for a while.
    sandboxA.stop = async () => {
      throw new Error("Daytona did not answer 'stop' (injected)");
    };
    a.registry.release(a.workspace, "park");
    await a.registry.settle(5_000);
    expect(slots.running.unresolved).toBe(1);
    const pending = b.bash("echo b-ran");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(b.daytona.creates).toBe(0);
    // Now it has stopped: the next check gives the slot back and b's command runs.
    sandboxA.state = "stopped";
    const r = await pending;
    expect(r.output).toContain("b-ran");
    expect(slots.running.unresolved).toBe(0);
  });

  it("keeps the slot of a deleted conversation's sandbox until a retried delete confirms it", async () => {
    const slots = sandboxSlots(4, 1, 2_000, FAST_RECONCILE);
    const a = createTestWorkspace({ settings: { slots }, conversationId: "a" });
    await a.bash("true");
    const sandboxA = [...a.daytona.sandboxes.values()][0]!;
    let failures = 3;
    const remove = sandboxA.remove.bind(sandboxA);
    sandboxA.remove = async () => {
      if (failures-- > 0) throw new Error("Daytona did not answer 'delete' (injected)");
      await remove();
    };
    a.registry.release(a.workspace, "delete");
    await a.registry.settle(5_000);
    expect(slots.running.inUse).toBe(1);
    await expect.poll(() => sandboxA.deleted, { timeout: 3_000 }).toBe(true);
    await expect.poll(() => slots.running.inUse, { timeout: 3_000 }).toBe(0);
  });
});

describe("running seconds are metered for the newest holder", () => {
  function recordingMeters() {
    const started: Array<Record<string, unknown>> = [];
    const events: string[] = [];
    const startMeter = ((options: Record<string, unknown>) => {
      started.push(options);
      return {
        setAuthorization: (authorization: string) => events.push(`auth ${authorization}`),
        stop: async () => {
          events.push(`stop ${String(options.sandboxId)}`);
        },
      };
    }) as unknown as NonNullable<Parameters<typeof newSandbox>[2]>["startMeter"];
    return { started, events, startMeter };
  }

  it("meters from bring-up to stop, with the sandbox's own id and session, and switches to a newer credential", async () => {
    const daytona = freshDaytona();
    const meters = recordingMeters();
    const { sandbox } = newSandbox(daytona, testOwner(), { ...sandboxSettings(), startMeter: meters.startMeter });
    sandbox.useUsage({ authorization: "Secret run-1", sessionId: "conv-1" });

    const use = await sandbox.acquire(OPEN_NETWORK);
    const id = use.sandbox.id;
    sandbox.useUsage({ authorization: "Secret run-2", sessionId: "conv-1" });
    use.release();
    await sandbox.stop("idle");
    await sandbox.settle(5_000);

    expect(meters.started).toHaveLength(1);
    expect(meters.started[0]).toMatchObject({
      provider: "daytona",
      sandboxId: id,
      authorization: "Secret run-1",
      sessionId: "conv-1",
    });
    expect(meters.events).toEqual(["auth Secret run-2", `stop ${id}`]);
  });

  it("meters nothing without a holder's credential", async () => {
    const daytona = freshDaytona();
    const meters = recordingMeters();
    const { sandbox } = newSandbox(daytona, testOwner(), { ...sandboxSettings(), startMeter: meters.startMeter });

    (await sandbox.acquire(OPEN_NETWORK)).release();
    await sandbox.stop("idle");

    expect(meters.started).toEqual([]);
  });
});
