import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

// Exercise the installed, pnpm-patched adapter rather than a copy of its event handler.
// The package is a CLI with no class export; isolate its session class from the entrypoint.
const require = createRequire(import.meta.url);
const source = readFileSync(require.resolve("pi-acp"), "utf8");
const start = source.indexOf("var PiAcpSession = class {");
const end = source.indexOf("\nfunction extensionUiToolCall", start);
if (start < 0 || end < 0)
  throw new Error("Recheck Pi adapter test seam after upgrading pi-acp");
const Session = new Function(
  "expandSlashCommand",
  "maybeAuthRequiredError",
  `${source.slice(start, end)}; return PiAcpSession;`,
)(
  (message: string) => message,
  () => undefined,
);

function fixture() {
  let dispatch: (event: any) => void = () => {};
  const updates: any[] = [];
  const proc = {
    onEvent: (handler: typeof dispatch) => {
      dispatch = handler;
    },
    prompt: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
  };
  const session = new Session({
    sessionId: "test",
    cwd: "/tmp",
    mcpServers: [],
    proc,
    conn: {
      sessionUpdate: async ({ update }: any) => {
        updates.push(update);
      },
    },
  });
  const emit = (event: any) => dispatch(event);
  const message = (stopReason: string, errorMessage?: string) =>
    emit({
      type: "message_end",
      message: { role: "assistant", stopReason, errorMessage },
    });
  const drain = () => new Promise<void>((resolve) => setImmediate(resolve));
  return { session, updates, proc, emit, message, drain };
}

describe("Pi adapter retry lifecycle", () => {
  it("keeps one prompt open through retries and emits no retry text", async () => {
    const f = fixture();
    const settled = vi.fn();
    const result = f.session.prompt("work").then(settled);
    f.emit({ type: "agent_start" });
    f.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Partial work." },
    });
    f.message("error", "WebSocket error");
    f.emit({ type: "agent_end", willRetry: true });
    f.emit({
      type: "auto_retry_start",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 2000,
    });
    await f.drain();
    expect(settled).not.toHaveBeenCalled();
    expect(
      f.updates
        .filter((u) => u.sessionUpdate === "agent_message_chunk")
        .map((u) => u.content.text),
    ).toEqual(["Partial work."]);
    f.emit({ type: "agent_start" });
    f.message("stop");
    f.emit({ type: "auto_retry_end", success: true });
    f.emit({ type: "agent_end", willRetry: false });
    await f.drain();
    expect(settled).not.toHaveBeenCalled();
    f.emit({ type: "agent_settled" });
    await result;
    expect(settled).toHaveBeenCalledWith("end_turn");
    expect(f.proc.prompt).toHaveBeenCalledTimes(1);
    expect(
      f.updates.filter((u) => u.sessionUpdate === "agent_message_chunk"),
    ).toHaveLength(1);
  });

  it("rejects exhausted recovery only after settlement", async () => {
    const f = fixture();
    const failed = vi.fn();
    const result = f.session.prompt("work").catch(failed);
    for (let attempt = 1; attempt <= 3; attempt++) {
      f.message("error", "WebSocket error");
      f.emit({ type: "agent_end", willRetry: true });
      f.emit({
        type: "auto_retry_start",
        attempt,
        maxAttempts: 3,
        delayMs: 2000,
      });
    }
    f.message("error", "WebSocket error");
    f.emit({ type: "agent_end", willRetry: false });
    f.emit({
      type: "auto_retry_end",
      success: false,
      finalError: "WebSocket error",
    });
    await f.drain();
    expect(failed).not.toHaveBeenCalled();
    f.emit({ type: "agent_settled" });
    await result;
    expect(failed.mock.calls[0]?.[0].message).toBe("WebSocket error");
    expect(
      f.updates.some((u) => u.sessionUpdate === "agent_message_chunk"),
    ).toBe(false);
  });

  it("cancels during backoff without reporting the preceding error", async () => {
    const f = fixture();
    const result = f.session.prompt("work");
    f.message("error", "WebSocket error");
    f.emit({ type: "agent_end", willRetry: true });
    f.emit({ type: "auto_retry_start" });
    await f.session.cancel();
    f.emit({
      type: "auto_retry_end",
      success: false,
      finalError: "Retry cancelled",
    });
    f.emit({ type: "agent_settled" });
    await expect(result).resolves.toBe("cancelled");
    expect(f.proc.abort).toHaveBeenCalledTimes(1);
  });

  it("does not start queued prompts at a compaction or retry boundary", async () => {
    const f = fixture();
    const first = f.session.prompt("first");
    const second = f.session.prompt("second");
    f.message("error", "context limit");
    f.emit({ type: "agent_end", willRetry: false });
    f.emit({ type: "auto_compaction_start" });
    await f.drain();
    expect(f.proc.prompt).toHaveBeenCalledTimes(1);
    f.emit({ type: "auto_compaction_end" });
    f.emit({ type: "agent_start" });
    f.message("stop");
    f.emit({ type: "agent_end" });
    f.emit({ type: "agent_settled" });
    await expect(first).resolves.toBe("end_turn");
    expect(f.proc.prompt).toHaveBeenCalledTimes(2);
    f.message("stop");
    f.emit({ type: "agent_end" });
    f.emit({ type: "agent_settled" });
    await expect(second).resolves.toBe("end_turn");
  });
});
