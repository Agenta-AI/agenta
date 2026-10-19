/**
 * What a parked conversation keeps, and the eviction the runner falls back on under heap pressure.
 *
 * A parked conversation used to keep the last environment's closures (the drive's credential
 * functions and the transcript signer), and with them that run's whole scope. A production runner
 * reported 368 parked conversations, no running session and a heap above the admission limit; these
 * tests reproduce that retention, not the production heap.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { ConversationRegistry } from "../../../src/engines/inprocess/conversation-registry.ts";
import { boundedDaytonaApi } from "../../../src/engines/inprocess/sandbox/daytona-api.ts";
import type { MountCredentials } from "../../../src/engines/sandbox_agent/mount.ts";
import { sandboxSettings, TEST_DEADLINES, testConversation, testOwner, testRegistryOptions } from "../../utils/inprocess-workspace.ts";
import { LocalDaytona } from "../../utils/local-daytona.ts";
import { memoryObjects, TEST_CREDENTIALS, TEST_TRANSCRIPT_CREDENTIALS } from "../../utils/local-drive.ts";

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

function registryFor(options: { objects?: ReturnType<typeof memoryObjects>; maxEntries?: number } = {}) {
  const daytona = new LocalDaytona(mkdtempSync(join(tmpdir(), "registry-")));
  const logs: string[] = [];
  const registry = new ConversationRegistry(sandboxSettings(), boundedDaytonaApi(daytona, TEST_DEADLINES), testOwner(), (m) => logs.push(m), {
    ...testRegistryOptions(daytona, options.maxEntries ? { maxEntries: options.maxEntries } : {}),
    ...(options.objects ? { objects: options.objects } : {}),
  });
  return { registry, logs };
}

/** A conversation whose credential closures share a scope with `run`, as the environment's do. */
function conversationWithRunScope(key: string, run: object) {
  const scope = { run, mountCreds: TEST_CREDENTIALS };
  return {
    ...testConversation(key),
    drive: [{ root: "/x", credentials: () => scope.mountCreds }],
    signTranscriptMount: async () => (scope.run ? TEST_TRANSCRIPT_CREDENTIALS : null),
  };
}

/** Hold and park one conversation; only a WeakRef to its run scope leaves this function. */
async function parkWithRunScope(registry: ConversationRegistry, key: string): Promise<WeakRef<object>> {
  const run = { payload: new Array(1_000).fill(0.5) };
  const workspace = registry.hold(conversationWithRunScope(key, run));
  registry.release(workspace, "park");
  await workspace.transcripts.settled();
  return new WeakRef(run);
}

/** A `beforePut` that holds the first put until `blocked` resolves; `started` resolves when it does. */
function blockFirstPut(blocked: Promise<void>) {
  let puts = 0;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => (markStarted = resolve));
  const beforePut = async () => {
    if (puts++ > 0) return;
    markStarted();
    await blocked;
  };
  return { started, beforePut };
}

/** A `deref` keeps its target alive until the job ends, so each collection runs in a later job. */
async function collected(ref: WeakRef<object>): Promise<boolean> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    gc();
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (ref.deref() === undefined) return true;
  }
  return false;
}

describe("a parked conversation", () => {
  it("does not keep the last environment's run scope", async () => {
    const { registry } = registryFor();
    const ref = await parkWithRunScope(registry, "parked");
    expect(registry.counters().conversations).toBe(1);
    expect(await collected(ref)).toBe(true);
    // The registry still holds the conversation after the collection.
    expect(registry.counters().conversations).toBe(1);
  });

  it("keeps the drive's credentials as they were, and takes the next hold's", async () => {
    const { registry } = registryFor();
    const workspace = registry.hold(conversationWithRunScope("c", {}));
    registry.release(workspace, "park");
    expect(workspace.drive.root("/x")!.credentials()).toBe(TEST_CREDENTIALS);
    await workspace.transcripts.settled();
    expect(await workspace.signTranscriptMount()).toBeNull();

    const fresh: MountCredentials = { ...TEST_CREDENTIALS, expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
    const next = registry.hold({ ...testConversation("c"), drive: [{ root: "/x", credentials: () => fresh }] });
    expect(next).toBe(workspace);
    expect(workspace.drive.root("/x")!.credentials()).toBe(fresh);
    expect(await workspace.signTranscriptMount()).toEqual(TEST_TRANSCRIPT_CREDENTIALS);
  });

  it("keeps the signer for a transcript save queued before it parked", async () => {
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => (unblock = resolve));
    const prefixes = new Map<string, Map<string, Buffer>>();
    const { started, beforePut } = blockFirstPut(blocked);
    const objects = memoryObjects(prefixes, { beforePut });
    const { registry } = registryFor({ objects });
    const workspace = registry.hold(testConversation("c", join(mkdtempSync(join(tmpdir(), "registry-cwd-")), "session")));
    mkdirSync(workspace.transcripts.dir, { recursive: true });
    writeFileSync(join(workspace.transcripts.dir, "a.jsonl"), "{}\n");
    writeFileSync(join(workspace.transcripts.dir, "b.jsonl"), "{}\n");

    // The first file's put waits; the second file signs only after the park.
    const save = workspace.transcripts.save();
    await started;
    registry.release(workspace, "park");
    unblock();
    await save;
    expect([...prefixes.get(TEST_TRANSCRIPT_CREDENTIALS.prefix)!.keys()].sort()).toEqual(["a.jsonl", "b.jsonl"]);
    await workspace.transcripts.settled();
    expect(await workspace.signTranscriptMount()).toBeNull();
  });

  it("keeps a signer a new hold set while a save was still in flight", async () => {
    const { registry } = registryFor();
    const workspace = registry.hold(testConversation("c"));
    registry.release(workspace, "park");
    const signer = async () => TEST_TRANSCRIPT_CREDENTIALS;
    registry.hold({ ...testConversation("c"), signTranscriptMount: signer });
    await workspace.transcripts.settled();
    expect(workspace.signTranscriptMount).toBe(signer);
  });
});

describe("a conversation parked twice", () => {
  it("keeps the signer for a save the second hold queued, when both holds share one signer", async () => {
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => (unblock = resolve));
    const prefixes = new Map<string, Map<string, Buffer>>();
    const { started, beforePut } = blockFirstPut(blocked);
    const objects = memoryObjects(prefixes, { beforePut });
    const { registry } = registryFor({ objects });
    const spec = testConversation("c", join(mkdtempSync(join(tmpdir(), "registry-cwd-")), "session"));
    const workspace = registry.hold(spec);
    mkdirSync(workspace.transcripts.dir, { recursive: true });
    writeFileSync(join(workspace.transcripts.dir, "a.jsonl"), "{}\n");

    // The first park's barrier waits behind a blocked save.
    const first = workspace.transcripts.save();
    await started;
    registry.release(workspace, "park");
    // Held again with the same signer, a save queued behind the first barrier, parked again.
    expect(registry.hold(spec)).toBe(workspace);
    writeFileSync(join(workspace.transcripts.dir, "b.jsonl"), "{}\n");
    const second = workspace.transcripts.save();
    registry.release(workspace, "park");
    unblock();
    await Promise.all([first, second]);
    expect([...prefixes.get(TEST_TRANSCRIPT_CREDENTIALS.prefix)!.keys()].sort()).toEqual(["a.jsonl", "b.jsonl"]);
    await workspace.transcripts.settled();
    expect(await workspace.signTranscriptMount()).toBeNull();
  });
});

describe("eviction under heap pressure", () => {
  it("evicts the least recently used half of the parked conversations, never a held one", async () => {
    const { registry, logs } = registryFor();
    const parked = ["a", "b", "c", "d"].map((key, i) => {
      const workspace = registry.hold(testConversation(key));
      registry.release(workspace, "park");
      workspace.sandbox.lastUsedAt = 1_000 + i;
      return workspace;
    });
    const held = registry.hold(testConversation("held"));
    held.sandbox.lastUsedAt = 0;

    expect(registry.evictParkedConversations()).toBe(2);
    expect(registry.hold(testConversation("a"))).not.toBe(parked[0]);
    expect(registry.hold(testConversation("b"))).not.toBe(parked[1]);
    expect(registry.hold(testConversation("c"))).toBe(parked[2]);
    expect(registry.hold(testConversation("held"))).toBe(held);
    expect(logs.some((m) => m.includes("evicted 2 parked conversation(s)"))).toBe(true);
  });

  it("evicts nothing when no conversation is parked", () => {
    const { registry } = registryFor();
    registry.hold(testConversation("held"));
    expect(registry.evictParkedConversations()).toBe(0);
    expect(registry.counters().conversations).toBe(1);
  });
});
