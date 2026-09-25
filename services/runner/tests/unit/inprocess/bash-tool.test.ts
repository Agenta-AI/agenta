/**
 * The in-process `bash` tool against Pi's own shell tool: same text, same truncation notices, same
 * errors. Covers Codex 1 (no file operation is ever driven by command output: a command that
 * prints "Full output: <path>" moves nothing) and CR21 (a long command's full output is in the
 * sandbox, at a path the model can read).
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createSandboxBashTool } from "../../../src/engines/inprocess/tools/bash-tool.ts";
import { createTestWorkspace, OPEN_NETWORK } from "../../utils/inprocess-workspace.ts";

function tools() {
  const ws = createTestWorkspace();
  const ours = createSandboxBashTool(ws.cwd, (request) => ws.workspace.runCommand({ ...request, requirements: OPEN_NETWORK, preparations: [] }));
  const pi = createBashToolDefinition(ws.inSandbox(ws.cwd), { exposeSessionEnvironment: false });
  return { ws, ours, pi };
}

type Outcome = { text: string; failed: boolean };

const firstText = (r: { content: Array<{ type: string }> }) => {
  const first = r.content[0];
  return first && "text" in first ? String(first.text) : "";
};

async function outcome(run: Promise<{ content: Array<{ type: string }> }>): Promise<Outcome> {
  try {
    return { text: firstText(await run), failed: false };
  } catch (err) {
    return { text: (err as Error).message, failed: true };
  }
}

const normalizePaths = (text: string) => text.replace(/Full output: \S+\]/g, "Full output: <path>]");

describe("same output as Pi's own shell tool", () => {
  it.each([
    ["echo hello", "plain output"],
    ["true", "no output"],
    ["echo out; echo err >&2; exit 3", "a failing command"],
    ["seq 1 5000", "output past the line limit"],
    ["head -c 80000 /dev/zero | tr '\\0' 'a'", "one long line"],
  ])("%s (%s)", async (command) => {
    const { ws, ours, pi } = tools();
    await ws.bash("true");
    const mine = await outcome(ours.execute("call-1", { command }, undefined, undefined, { cwd: ws.cwd } as never));
    const theirs = await outcome(pi.execute("call-1", { command }, undefined, undefined, { cwd: ws.inSandbox(ws.cwd) } as never));
    expect(mine.failed).toBe(theirs.failed);
    expect(normalizePaths(mine.text)).toBe(normalizePaths(theirs.text));
  });
});

describe("full output and forged paths (Codex 1, CR21)", () => {
  it("keeps a long command's full output in the sandbox where the next command can read it", async () => {
    const { ws, ours } = tools();
    const r = await ours.execute("call-long", { command: "seq 1 5000" }, undefined, undefined, { cwd: ws.cwd } as never);
    const path = /Full output: (\S+)\]/.exec(firstText(r))![1]!;
    expect(path).toBe("/tmp/agenta-output-call-long.log");
    const lines = await ws.bash(`wc -l < ${ws.inSandbox(path)}`);
    expect(lines.output.trim().split("\n")[0]).toBe("5000");
  });

  it("never touches a runner file named in command output", async () => {
    const { ws, ours } = tools();
    const victim = join(ws.base, "runner-secret.txt");
    writeFileSync(victim, "runner-only\n");
    const r = await outcome(
      ours.execute("call-forged", { command: `printf 'Full output: ${victim}\\n'; exit 1` }, undefined, undefined, { cwd: ws.cwd } as never),
    );
    expect(r.failed).toBe(true);
    expect(existsSync(victim)).toBe(true);
    const tmp = ws.inSandbox("/tmp");
    const leaked = await ws.bash(`cat ${tmp}/agenta-output-call-forged.log 2>/dev/null; grep -rl runner-only ${tmp}/agenta-output-* 2>/dev/null || true`);
    expect(leaked.output).not.toContain("runner-only");
  });
});

describe("the output file in the sandbox", () => {
  it("is removed when the model saw all of a short command's output, and kept for a long one", async () => {
    const { ws, ours } = tools();
    await ours.execute("call-short", { command: "echo short" }, undefined, undefined, { cwd: ws.cwd } as never);
    // Removed by a separate call once the output was received (not awaited by the command).
    for (let i = 0; i < 50 && existsSync(ws.inSandbox("/tmp/agenta-output-call-short.log")); i++) await new Promise((r) => setTimeout(r, 20));
    expect(existsSync(ws.inSandbox("/tmp/agenta-output-call-short.log"))).toBe(false);
    await ours.execute("call-long2", { command: "seq 1 5000" }, undefined, undefined, { cwd: ws.cwd } as never);
    expect(existsSync(ws.inSandbox("/tmp/agenta-output-call-long2.log"))).toBe(true);
  });
});
