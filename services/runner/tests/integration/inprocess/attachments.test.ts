/**
 * Inprocess attachment copies go to the session folder's prefix of the drive through the store,
 * not to the runner's disk. The sandbox's drive is kept apart from the runner's folder here (as in
 * production, where the runner mounts nothing), so a copy left on the runner's disk cannot pass.
 * That the sandbox's geesefs view shows a direct store write after the turn-start refresh is
 * pinned against a real store by `sandbox-drive.test.ts`; here the view is filled from the store.
 */
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachmentWorkingPath,
  buildPromptBlocks,
  materializeWorkingCopy,
  resolveCurrentTurnAttachments,
  restoreReferencedWorkingCopies,
} from "../../../src/engines/sandbox_agent/attachments.ts";
import { createHostFixture } from "../../utils/inprocess-host.ts";
import { TEST_CREDENTIALS } from "../../utils/local-drive.ts";
import { startScriptedModel } from "../../utils/scripted-model.ts";
import type { AgentEvent, ChatMessage } from "../../../src/protocol.ts";

const ref = {
  attachmentId: "11111111-1111-4111-8111-111111111111",
  filename: "report.txt",
};
const auth = () => "ApiKey test";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

async function setup() {
  const model = await startScriptedModel();
  cleanups.push(() => model.close());
  const fixture = createHostFixture(model.baseUrl);
  const drive = join(fixture.base, "drive");
  vi.spyOn(fixture.mounter, "mount").mockImplementation(async (sandbox, path) => {
    const view = join(drive, path.endsWith("-agent") ? "agent" : "session");
    mkdirSync(view, { recursive: true });
    mkdirSync(dirname(path), { recursive: true });
    symlinkSync(view, path);
    fixture.daytona.sandboxes.get(sandbox.id)!.onStop.push(() => rmSync(path, { force: true }));
    return true;
  });
  const runner = fixture.runner();
  const { host } = runner.host();
  const session = await host.createSession({ agent: "pi", cwd: fixture.cwd, sessionInit: { cwd: fixture.cwd, mcpServers: [] } });
  await session.setModel("mock/mock-1");
  cleanups.push(async () => {
    await host.destroySandbox();
    rmSync(fixture.base, { recursive: true, force: true });
  });
  const plan = { workspace: { cwd: fixture.cwd }, isDaytona: false, acpAgent: "pi", harness: "pi_core" as const };
  const path = attachmentWorkingPath(fixture.cwd, ref);
  const store = () => {
    if (!fixture.objects.has(TEST_CREDENTIALS.prefix)) fixture.objects.set(TEST_CREDENTIALS.prefix, new Map());
    return fixture.objects.get(TEST_CREDENTIALS.prefix)!;
  };
  /** What the sandbox's mount shows after its refresh: the store's objects. */
  const refreshView = () => {
    for (const [rel, body] of store()) {
      const file = join(drive, "session", rel);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, body);
    }
  };
  const fetchAttachment = (body = "attachment proof 7198") => {
    const realFetch = globalThis.fetch;
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) =>
      String(input).includes("/content?")
        ? new Response(body, { headers: { "content-type": "text/plain", "content-disposition": `attachment; filename="${ref.filename}"` } })
        : realFetch(input, init),
    );
  };
  return { fixture, runner, host, session, plan, path, store, refreshView, model, fetchAttachment };
}

describe("inprocess attachments on the drive", () => {
  it("puts a workspace-only document in the store, where Pi's read tool finds it", async () => {
    const { host, session, plan, path, store, refreshView, model, fetchAttachment } = await setup();
    fetchAttachment();
    const events: AgentEvent[] = [];
    const resolved = await resolveCurrentTurnAttachments({
      message: { role: "user", content: [{ type: "attachment", ...ref }] },
      sessionId: "test",
      auth,
      sandbox: host,
      plan,
      capabilities: { images: true },
      emit: (event) => events.push(event),
    });
    expect(events).toMatchObject([{ outcome: "workspace_only", workingPath: path.relative }]);
    expect(store().get(path.relative)?.toString()).toBe("attachment proof 7198");
    expect(existsSync(path.absolute)).toBe(false);

    refreshView();
    model.script([{ tool: "read", args: { path: path.relative } }, { text: "read completed" }]);
    await session.prompt(buildPromptBlocks("Read the attachment", resolved));
    const toolReplies = JSON.stringify(model.requests.at(-1)!.messages.filter((m: any) => m.role === "tool"));
    expect(toolReplies).toContain("attachment proof 7198");
    expect(toolReplies).not.toContain("ENOENT");
  }, 30_000);

  it("restores a missing copy from history and keeps an edited one", async () => {
    const { host, plan, path, store, fetchAttachment } = await setup();
    const fetch = fetchAttachment();
    const messages: ChatMessage[] = [{ role: "user", content: [{ type: "attachment", ...ref }] }];
    // A stale copy on the runner's disk must not make restoration skip the drive.
    mkdirSync(dirname(path.absolute), { recursive: true });
    writeFileSync(path.absolute, "wrong runner disk");

    await restoreReferencedWorkingCopies(host, plan, messages, "test", auth);
    expect(store().get(path.relative)?.toString()).toBe("attachment proof 7198");

    store().set(path.relative, Buffer.from("user edit"));
    fetch.mockClear();
    await restoreReferencedWorkingCopies(host, plan, messages, "test", auth);
    expect(fetch).not.toHaveBeenCalled();
    expect(await materializeWorkingCopy(host, plan, ref, Buffer.from("original"))).toBe("exists");
    expect(store().get(path.relative)?.toString()).toBe("user edit");
  }, 30_000);

  it("does not mistake a sibling file for the copy", async () => {
    const { host, plan, path, store } = await setup();
    store().set(`${path.relative}.bak`, Buffer.from("other"));
    expect(await materializeWorkingCopy(host, plan, ref, Buffer.from("new"))).toBe("written");
    expect(store().get(path.relative)?.toString()).toBe("new");
  }, 30_000);

  it("reports materialize_failed when the store refuses the write", async () => {
    const { host, plan, fixture, fetchAttachment } = await setup();
    fetchAttachment();
    fixture.faults.beforePut = async () => {
      throw new Error("store unavailable");
    };
    const events: AgentEvent[] = [];
    await resolveCurrentTurnAttachments({
      message: { role: "user", content: [{ type: "attachment", ...ref }] },
      sessionId: "test",
      auth,
      sandbox: host,
      plan,
      capabilities: { images: true },
      emit: (event) => events.push(event),
    });
    expect(events).toMatchObject([{ outcome: "failed", reasonCode: "materialize_failed" }]);
  }, 30_000);
});
