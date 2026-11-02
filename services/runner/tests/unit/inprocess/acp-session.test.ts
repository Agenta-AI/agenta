/**
 * The in-process session speaks through pi-acp's own `PiAcpSession` (exported by the runner's
 * patch), so its ACP mapping is pi-acp's by construction. These tests pin the three places the
 * two paths could still differ, and the two opt-in behaviors:
 * - the event stream: Pi's in-memory events are converted to the shape Pi's RPC mode writes, and
 *   that conversion must equal Pi's own (`modes/json-event.js`);
 * - the default `PiAcpSession` (the `local` provider's) still reads edit snapshots from disk and
 *   still resolves a failed prompt as "error", so the patch left `local` unchanged;
 * - with the embedding options, event mapping reads no file (R3-2) and a failed prompt rejects
 *   with its message and lets the next queued prompt run (R3-6).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { PiAcpSession, type PiAcpSessionOptions } from "pi-acp/session";
import { describe, expect, it, vi } from "vitest";
import { toRpcEvent } from "../../../src/engines/inprocess/pi/rpc-event.ts";
import { EditDiffs } from "../../../src/engines/inprocess/tools/edit-diffs.ts";

// Pi's own converter, read from the installed package for comparison only (it is not exported).
const piEntry = import.meta.resolve("@earendil-works/pi-coding-agent");
const { toJsonEvent } = (await import(new URL("./modes/json-event.js", piEntry).href)) as {
  toJsonEvent: (event: AgentSessionEvent) => unknown;
};

function session(options: Partial<PiAcpSessionOptions> = {}) {
  let dispatch: (event: Record<string, unknown>) => void = () => {};
  const updates: Array<Record<string, unknown>> = [];
  const prompt = vi.fn(async (_message: string) => {});
  const acp = new PiAcpSession({
    sessionId: "s",
    cwd: "/",
    proc: {
      onEvent: (handler) => {
        dispatch = handler;
        return () => {};
      },
      prompt,
      abort: async () => {},
      sendExtensionUiResponse: async () => {},
    },
    conn: {
      sessionUpdate: async ({ update }) => {
        updates.push(update);
      },
      requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
    },
    ...options,
  });
  return { acp, updates, prompt, emit: (event: Record<string, unknown>) => dispatch(event) };
}

const partial = {
  role: "assistant",
  content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "ls" } }],
  usage: { input: 1, output: 1 },
};

describe("event stream parity with Pi's RPC mode", () => {
  it.each([
    { type: "message_update", message: partial, assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial } },
    { type: "message_update", message: partial, assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: "{", partial } },
    { type: "message_update", message: partial, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hi", partial } },
    { type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: { command: "ls" } },
    { type: "agent_settled" },
  ])("converts $type like Pi does", (event) => {
    const e = event as unknown as AgentSessionEvent;
    expect(toRpcEvent(e)).toEqual(toJsonEvent(e));
  });
});

describe("the default session is the local provider's, unchanged by the patch", () => {
  it("still reads the edited file around an edit to build its diff", async () => {
    const dir = mkdtempSync(join(tmpdir(), "acp-legacy-"));
    writeFileSync(join(dir, "f.txt"), "old\n");
    const { acp, updates, emit } = session({ cwd: dir });
    void acp.prompt("x");
    emit({ type: "tool_execution_start", toolCallId: "e1", toolName: "edit", args: { path: "f.txt", oldText: "old" } });
    writeFileSync(join(dir, "f.txt"), "new\n");
    emit({ type: "tool_execution_end", toolCallId: "e1", result: { content: [{ type: "text", text: "ok" }] }, isError: false });
    await acp.flushEmits();
    const end = updates.find((u) => u.sessionUpdate === "tool_call_update" && u.status === "completed");
    expect(end?.content).toEqual([
      { type: "diff", path: "f.txt", oldText: "old\n", newText: "new\n" },
      { type: "content", content: { type: "text", text: "ok" } },
    ]);
  });

  it("still resolves a prompt that fails before it starts as a plain error stop", async () => {
    const { acp, prompt } = session();
    prompt.mockRejectedValueOnce(new Error("model not found"));
    await expect(acp.prompt("x")).resolves.toBe("error");
  });
});

describe("the embedding options the in-process session uses", () => {
  it("maps an edit without touching the file system, from the diff the edit recorded (R3-2)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "acp-embed-"));
    execFileSync("mkfifo", [join(dir, "pipe")]);
    const diffs = new EditDiffs();
    const { acp, updates, emit } = session({ cwd: dir, editDiffs: diffs });
    void acp.prompt("x");
    const t0 = Date.now();
    // A FIFO would block a synchronous read forever; mapping must not even look.
    emit({ type: "tool_execution_start", toolCallId: "e1", toolName: "edit", args: { path: "pipe", oldText: "a" } });
    expect(Date.now() - t0).toBeLessThan(500);
    diffs.record("e1", { path: "code.py", oldText: "a\n", newText: "b\n" });
    emit({ type: "tool_execution_end", toolCallId: "e1", result: { content: [{ type: "text", text: "ok" }] }, isError: false });
    await acp.flushEmits();
    const end = updates.find((u) => u.sessionUpdate === "tool_call_update" && u.status === "completed");
    expect(end?.content).toEqual([
      { type: "diff", path: "code.py", oldText: "a\n", newText: "b\n" },
      { type: "content", content: { type: "text", text: "ok" } },
    ]);
  });

  it("rejects a failed prompt with its message and starts the next queued prompt (R3-6)", async () => {
    const { acp, prompt, emit } = session({ rejectPromptFailures: true });
    let failFirst!: (err: Error) => void;
    prompt.mockImplementationOnce(() => new Promise((_, reject) => (failFirst = reject)));
    const first = acp.prompt("first");
    const second = acp.prompt("second");
    failFirst(new Error("Model 'x' is not available"));
    await expect(first).rejects.toThrow(/not available/);
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2));
    emit({ type: "agent_settled" });
    await expect(second).resolves.toBe("end_turn");
  });

  it("maps an authentication failure to ACP's auth-required error either way", async () => {
    const { acp, prompt } = session({ rejectPromptFailures: true });
    prompt.mockRejectedValueOnce(new Error("No API key found for provider openai"));
    await expect(acp.prompt("x")).rejects.toMatchObject({ code: -32000 });
  });
});
