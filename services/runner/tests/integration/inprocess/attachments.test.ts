import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
import { startScriptedModel } from "../../utils/scripted-model.ts";
import type { AgentEvent, ChatMessage } from "../../../src/protocol.ts";

const ref = {
  attachmentId: "11111111-1111-4111-8111-111111111111",
  filename: "report.txt",
};
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

async function setup() {
  const model = await startScriptedModel();
  cleanups.push(() => model.close());
  const fixture = createHostFixture(model.baseUrl);
  const drive = join(fixture.base, "store");
  // Production has no mount on the runner. Keep its disk separate from the sandbox's drive.
  vi.spyOn(fixture.mounter, "mount").mockImplementation(
    async (sandbox, path) => {
      const stored = join(
        drive,
        path === fixture.daytona.prefix + fixture.cwd ? "session" : "agent",
      );
      mkdirSync(stored, { recursive: true });
      mkdirSync(dirname(path), { recursive: true });
      symlinkSync(stored, path);
      fixture.daytona.sandboxes
        .get(sandbox.id)!
        .onStop.push(() => rmSync(path, { force: true }));
      return true;
    },
  );
  const runner = fixture.runner();
  const { host } = runner.host();
  const session = await host.createSession({
    agent: "pi",
    cwd: fixture.cwd,
    sessionInit: { cwd: fixture.cwd, mcpServers: [] },
  });
  await session.setModel("mock/mock-1");
  cleanups.push(async () => {
    await host.destroySandbox();
    rmSync(fixture.base, { recursive: true, force: true });
  });
  const plan = {
    workspace: { cwd: fixture.cwd },
    isDaytona: false,
    acpAgent: "pi",
    harness: "pi_core" as const,
  };
  const path = attachmentWorkingPath(fixture.cwd, ref);
  const stored = join(drive, "session", path.relative);
  const fetchAttachment = (
    body: Uint8Array = Buffer.from("attachment proof 7198"),
    mediaType = "text/plain",
    filename = ref.filename,
  ) => {
    const realFetch = globalThis.fetch;
    return vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) =>
        String(input).includes("/content?")
          ? new Response(Buffer.from(body), {
              headers: {
                "content-type": mediaType,
                "content-disposition": `attachment; filename="${filename}"`,
              },
            })
          : realFetch(input, init),
      );
  };
  return {
    fixture,
    runner,
    host,
    session,
    plan,
    path,
    stored,
    model,
    fetchAttachment,
  };
}

describe("inprocess attachments on a separate drive", () => {
  it("delivers a workspace-only document that Pi's read tool can read", async () => {
    const {
      fixture,
      host,
      session,
      plan,
      path,
      stored,
      model,
      fetchAttachment,
    } = await setup();
    fetchAttachment();
    const events: AgentEvent[] = [];
    const resolved = await resolveCurrentTurnAttachments({
      message: { role: "user", content: [{ type: "attachment", ...ref }] },
      sessionId: "test",
      auth: () => "ApiKey test",
      sandbox: host,
      plan,
      capabilities: { images: true },
      emit: (event) => events.push(event),
    });
    expect(events).toMatchObject([
      { outcome: "workspace_only", workingPath: path.relative },
    ]);
    expect(existsSync(path.absolute)).toBe(false);
    expect(readFileSync(stored, "utf8")).toBe("attachment proof 7198");
    model.script([
      { tool: "read", args: { path: path.relative } },
      { text: "read completed" },
    ]);
    await session.prompt(buildPromptBlocks("Read the attachment", resolved));
    const toolReplies = model.requests
      .at(-1)!
      .messages.filter((m: any) => m.role === "tool");
    expect(JSON.stringify(toolReplies)).toContain("attachment proof 7198");
    expect(JSON.stringify(toolReplies)).not.toContain("ENOENT");
    expect(fixture.daytona.creates).toBe(1);
  }, 30_000);

  it("delivers image fallback bytes and transfers large attachments without inline arguments", async () => {
    const { host, runner, plan, path, stored, fetchAttachment, fixture } =
      await setup();
    const bytes = Buffer.alloc(200 * 1024, 42);
    fetchAttachment(bytes, "image/png");
    const resolved = await resolveCurrentTurnAttachments({
      message: { role: "user", content: [{ type: "attachment", ...ref }] },
      sessionId: "test",
      auth: () => "ApiKey test",
      sandbox: host,
      plan,
      capabilities: { images: true },
      emit: () => {},
    });
    expect(resolved[0].gate).toMatchObject({
      outcome: "workspace_only",
      reasonCode: "model_modality_unknown",
    });
    expect(readFileSync(stored)).toEqual(bytes);
    expect(existsSync(path.absolute)).toBe(false);
    expect([...fixture.daytona.sandboxes.values()][0].calls).toContain(
      "upload",
    );
  }, 30_000);

  it("restores missing history, preserves edited copies, and reads them after a sandbox restart", async () => {
    const { host, runner, plan, path, stored, fetchAttachment, fixture } =
      await setup();
    const fetch = fetchAttachment();
    const messages: ChatMessage[] = [
      { role: "user", content: [{ type: "attachment", ...ref }] },
    ];
    // A stale runner copy must not make restoration skip the actual drive.
    mkdirSync(dirname(path.absolute), { recursive: true });
    writeFileSync(path.absolute, "wrong runner disk");
    await restoreReferencedWorkingCopies(
      host,
      plan,
      messages,
      "test",
      () => "ApiKey test",
    );
    expect(readFileSync(stored, "utf8")).toBe("attachment proof 7198");
    writeFileSync(stored, "user edit");
    fetch.mockClear();
    await host.pauseSandbox();
    const resumed = runner.host().host;
    await resumed.createSession({
      agent: "pi",
      cwd: fixture.cwd,
      sessionInit: { cwd: fixture.cwd, mcpServers: [] },
    });
    cleanups.push(() => resumed.destroySandbox());
    await restoreReferencedWorkingCopies(
      resumed,
      plan,
      messages,
      "test",
      () => "ApiKey test",
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(readFileSync(stored, "utf8")).toBe("user edit");
    expect(
      await materializeWorkingCopy(resumed, plan, ref, Buffer.from("original")),
    ).toBe("exists");
    expect(readFileSync(stored, "utf8")).toBe("user edit");
  }, 30_000);

  it.each(["root", "directory", "absolute"] as const)(
    "rejects symbolic links at %s",
    async (component) => {
      const { host, plan, path, fixture } = await setup();
      await host.attachmentFiles.exists(path); // Mount the separate drive.
      const remote = fixture.daytona.prefix + path[component];
      mkdirSync(dirname(remote), { recursive: true });
      symlinkSync(join(fixture.base, "outside"), remote);
      await expect(
        materializeWorkingCopy(host, plan, ref, Buffer.from("no")),
      ).rejects.toThrow("symbolic link");
      expect(existsSync(join(fixture.base, "outside"))).toBe(false);
    },
    30_000,
  );

  it("reports materialization failure when the command sandbox cannot mount its drive", async () => {
    const { host, plan, fixture, fetchAttachment } = await setup();
    fetchAttachment();
    vi.mocked(fixture.mounter.mount).mockRejectedValue(
      new Error("drive unavailable"),
    );
    const events: AgentEvent[] = [];
    await resolveCurrentTurnAttachments({
      message: { role: "user", content: [{ type: "attachment", ...ref }] },
      sessionId: "test",
      auth: () => "ApiKey test",
      sandbox: host,
      plan,
      capabilities: { images: true },
      emit: (event) => events.push(event),
    });
    expect(events).toMatchObject([
      { outcome: "failed", reasonCode: "materialize_failed" },
    ]);
    expect(existsSync(attachmentWorkingPath(fixture.cwd, ref).absolute)).toBe(
      false,
    );
  }, 30_000);
});
