/**
 * Running, stopping and reading back a command in the command sandbox, against the local stand-in
 * (real bash, real supervisor script). Covers Codex R5 P0-3 (Stop never reports a command dead
 * while its start is uncertain: the injected 3 s pause after the claim), Codex R5 P1-1 (output is
 * read back in bounded pieces, never the whole log), R3-4 and Codex 8 (every wait is bounded; a
 * sandbox whose state is unknown afterwards is retired), CR5 (a command that dies without an exit
 * code ends the call), CR6 (cancel and timeout read like Pi's own shell), Codex R6 P0-2 (an
 * attempt is decided only on the sandbox it was sent to) and Codex R6 P1-3 (a lost answer to the
 * final poll loses no output).
 */
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bounded, DaytonaCallTimeoutError } from "../../../src/engines/inprocess/sandbox/daytona-api.ts";
import { commandLifetimeSeconds, launchScript, OUTPUT_CHUNK_BYTES } from "../../../src/engines/inprocess/sandbox/remote-command.ts";
import { createTestWorkspace, type TestWorkspace } from "../../utils/inprocess-workspace.ts";
import type { LocalSandbox } from "../../utils/local-daytona.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const running = (pattern: string) => execSync(`pgrep -f '${pattern}' || true`).toString().trim();

/** The stand-in sandbox after a first command, so later commands reuse it. */
async function warm(): Promise<{ ws: TestWorkspace; local: LocalSandbox }> {
  const ws = createTestWorkspace();
  await ws.bash("true");
  return { ws, local: [...ws.daytona.sandboxes.values()][0]! };
}

/** Wrap the sandbox's `run`: `before` sees every command and may replace it or fail the call. */
function interceptRun(local: LocalSandbox, before: (command: string) => Promise<string | undefined> | string | undefined) {
  const run = local.run.bind(local);
  local.run = async (command, options) => run((await before(command)) ?? command, options);
}

const isLaunch = (command: string) => command.includes("setsid");
const isPoll = (command: string) => command.includes("base64 -w0");
const isKill = (command: string) => command.includes("kill -TERM");

describe("bounded Daytona calls", () => {
  it("gives up on a call that never answers, and says the outcome is unknown", async () => {
    const t0 = Date.now();
    await expect(bounded("probe", 100, undefined, () => new Promise(() => {}))).rejects.toBeInstanceOf(DaytonaCallTimeoutError);
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it("gives up at once on Stop", async () => {
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 50);
    await expect(bounded("probe", 60_000, stop.signal, () => new Promise(() => {}))).rejects.toThrow(/aborted/);
  });
});

describe("Stop", () => {
  it("kills the whole process group and returns within a few seconds", async () => {
    const { ws } = await warm();
    const stop = new AbortController();
    const t0 = Date.now();
    setTimeout(() => stop.abort(), 400);
    const r = await ws.bash("sleep 31.1 & sleep 31.1; echo never", { signal: stop.signal });
    expect(r.outcome).toEqual({ kind: "aborted" });
    expect(Date.now() - t0).toBeLessThan(5_000);
    await sleep(300);
    expect(running("sleep 31[.]1")).toBe("");
  });

  it("never lets a command run after Stop reported it: a 3 s pause right after the claim (Codex R5 P0-3)", async () => {
    const { ws, local } = await warm();
    // Codex's reproduction: the supervisor takes the claim, then stalls before the command starts.
    let injected = false;
    interceptRun(local, (command) => {
      if (!isLaunch(command)) return undefined;
      const paused = command.replace(`exit 0; }\n`, `exit 0; }\nsleep 3\n`);
      injected = paused !== command;
      return paused;
    });
    const stop = new AbortController();
    const pending = ws.bash("echo ran > late-effect.txt", { signal: stop.signal });
    await sleep(800); // claimed, paused
    stop.abort();
    const r = await pending;
    expect(r.outcome).toEqual({ kind: "aborted" });
    await sleep(3_500); // past the pause
    expect(injected).toBe(true);
    expect(existsSync(`${ws.inSandbox(ws.cwd)}/late-effect.txt`)).toBe(false);
  }, 15_000);

  it("never lets a command run after Stop took its claim first (a slow launch)", async () => {
    const { ws, local } = await warm();
    interceptRun(local, async (command) => {
      if (isLaunch(command)) await sleep(1_200);
      return undefined;
    });
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 200);
    const t0 = Date.now();
    const r = await ws.bash("echo late > late.txt", { signal: stop.signal });
    expect(r.outcome).toEqual({ kind: "aborted" });
    expect(Date.now() - t0).toBeLessThan(3_000);
    await sleep(1_500);
    expect(existsSync(`${ws.inSandbox(ws.cwd)}/late.txt`)).toBe(false);
  });

  it("reports the outcome as unknown and retires the sandbox when the kill is not confirmed", async () => {
    const { ws, local } = await warm();
    interceptRun(local, (command) => (isKill(command) ? new Promise<never>(() => {}) : undefined));
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 400);
    const t0 = Date.now();
    const r = await ws.bash("sleep 31.2; echo never", { signal: stop.signal });
    expect(r.outcome.kind).toBe("unknown");
    expect(Date.now() - t0).toBeLessThan(8_000);
    // The next command runs on a new sandbox; the old one is never used again.
    execSync("pkill -f 'sleep 31[.]2' || true");
    await ws.bash("true");
    expect(ws.daytona.creates).toBe(2);
  }, 20_000);

  it("returns within seconds while status polls never answer, and retires the sandbox", async () => {
    const { ws, local } = await warm();
    interceptRun(local, (command) => (isPoll(command) || isKill(command) ? new Promise<never>(() => {}) : undefined));
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 400);
    const t0 = Date.now();
    const r = await ws.bash("sleep 31.3", { signal: stop.signal });
    expect(r.outcome.kind).toBe("unknown");
    expect(Date.now() - t0).toBeLessThan(8_000);
    execSync("pkill -f 'sleep 31[.]3' || true");
    await ws.bash("true");
    expect(ws.daytona.creates).toBe(2);
  }, 20_000);

  it("ends a command's wait in the queue at once on Stop (Codex R4 P1)", async () => {
    const { ws } = await warm();
    const ahead = ws.bash("sleep 1.5; echo ahead");
    const stop = new AbortController();
    const queued = ws.bash("echo queued > queued.txt", { signal: stop.signal });
    setTimeout(() => stop.abort(), 100);
    const t0 = Date.now();
    await expect(queued).rejects.toThrow(/aborted/);
    expect(Date.now() - t0).toBeLessThan(500);
    expect((await ahead).output).toContain("ahead");
    expect(() => readFileSync(`${ws.inSandbox(ws.cwd)}/queued.txt`)).toThrow();
  });

  it("reports a timeout the way Pi's shell does", async () => {
    const ws = createTestWorkspace();
    const r = await ws.bash("sleep 20", { timeoutSeconds: 1 });
    expect(r.outcome).toEqual({ kind: "timed_out", seconds: 1 });
  });

  it("ends a command that died without an exit code instead of waiting forever (CR5)", async () => {
    const { ws } = await warm();
    const pending = ws.bash("sleep 31.4");
    await sleep(700);
    // The whole group dies at once, supervisor included (as when the sandbox restarts): nobody
    // records an exit code.
    const tmp = ws.inSandbox("/tmp");
    const pgid = Number(execSync(`cat ${tmp}/.agenta-cmd-*/pgid`).toString().trim());
    process.kill(-pgid, "SIGKILL");
    const r = await pending;
    expect(r.outcome.kind).toBe("unknown");
  }, 15_000);
});

describe("a command runs at most once (Codex R4 duplicate launch)", () => {
  it("follows a command whose launch answer was lost, instead of launching it again", async () => {
    const { ws, local } = await warm();
    const run = local.run.bind(local);
    let lost = false;
    local.run = async (command, options) => {
      const r = await run(command, options);
      if (isLaunch(command) && !lost) {
        lost = true;
        throw new Error("socket hang up (injected: the command started, the answer was lost)");
      }
      return r;
    };
    const r = await ws.bash("echo side-effect >> effects.txt; echo done");
    expect(r.outcome).toEqual({ kind: "exited", exitCode: 0 });
    expect(r.output).toContain("done");
    expect(readFileSync(`${ws.inSandbox(ws.cwd)}/effects.txt`, "utf-8")).toBe("side-effect\n");
  });

  it("retries a launch that provably never started, exactly once", async () => {
    const { ws, local } = await warm();
    let failures = 1;
    interceptRun(local, (command) => {
      if (isLaunch(command) && failures-- > 0) throw new Error("503 Service Unavailable (injected, before the command started)");
      return undefined;
    });
    const r = await ws.bash("echo ran >> once.txt");
    expect(r.outcome).toEqual({ kind: "exited", exitCode: 0 });
    expect(readFileSync(`${ws.inSandbox(ws.cwd)}/once.txt`, "utf-8")).toBe("ran\n");
  });
});

describe("output is read back in bounded pieces (Codex R5 P1-1)", () => {
  it("never reads more than one chunk per call from a command that prints 8 MiB, and reports exact totals", async () => {
    const { ws, local } = await warm();
    let largest = 0;
    const run = local.run.bind(local);
    local.run = async (command, options) => {
      const r = await run(command, options);
      if (isPoll(command)) largest = Math.max(largest, r.output.length);
      return r;
    };
    // 8 MiB of 64-byte lines, then a marker line.
    const r = await ws.bash("yes 012345678901234567890123456789012345678901234567890123456789012 | head -c 8388608; echo end-marker");
    expect(r.outcome).toEqual({ kind: "exited", exitCode: 0 });
    expect(largest).toBeLessThan(Math.ceil((OUTPUT_CHUNK_BYTES * 4) / 3) + 200);
    expect(r.skipped).toBeGreaterThan(0);
    expect(r.output.length).toBeLessThan(8 * 1024 * 1024);
    expect(r.output.trimEnd().endsWith("end-marker")).toBe(true);
    expect(r.totals).toEqual({ bytes: 8388608 + "end-marker\n".length, lines: 131072 + 1, openLineBytes: 0 });
  }, 60_000);

  it("reports an open last line with its exact length", async () => {
    const { ws } = await warm();
    const r = await ws.bash("printf 'a\\nbb\\nccc'");
    expect(r.totals).toEqual({ bytes: 8, lines: 3, openLineBytes: 3 });
  });
});

describe("a claim decides an attempt only on the sandbox it was sent to (Codex R6 P0-2)", () => {
  it("never runs an ambiguous command again on a replacement sandbox: its outcome is unknown (Codex's reproduction)", async () => {
    const { ws, local } = await warm();
    const effect = join(mkdtempSync(join(tmpdir(), "r6-effect-")), "effects");
    const run = local.run.bind(local);
    let lost = false;
    local.run = async (command, options) => {
      if (isLaunch(command) && !lost) {
        lost = true;
        // The command runs and has its side effect; the answer is lost, and the sandbox is gone.
        await run(command, options);
        await sleep(200);
        local.state = "destroyed";
        throw new Error("lost launch response (injected)");
      }
      return run(command, options);
    };
    const r = await ws.bash(`echo effect >> '${effect}'`);
    expect(ws.daytona.creates).toBe(2);
    expect(r.outcome.kind).toBe("unknown");
    expect(readFileSync(effect, "utf-8")).toBe("effect\n");
  });

  it("still decides the attempt on the same sandbox once it is back, and runs the command once", async () => {
    const { ws, local } = await warm();
    const run = local.run.bind(local);
    let lost = false;
    local.run = async (command, options) => {
      if (isLaunch(command) && !lost) {
        // Daytona stopped the sandbox before the launch reached it: nothing started.
        lost = true;
        local.state = "stopped";
        throw new Error("sandbox is stopped (injected)");
      }
      return run(command, options);
    };
    const r = await ws.bash("echo ran >> once.txt");
    expect(ws.daytona.creates).toBe(1);
    expect(r.outcome).toEqual({ kind: "exited", exitCode: 0 });
    expect(readFileSync(`${ws.inSandbox(ws.cwd)}/once.txt`, "utf-8")).toBe("ran\n");
  });
});

describe("reading a finished command's output is repeatable (Codex R6 P1-3)", () => {
  it("reads the output again when the final poll's answer was lost, and deletes the file only after it was received", async () => {
    const { ws, local } = await warm();
    const outputPath = `/tmp/agenta-output-r6-${Date.now()}.log`;
    const run = local.run.bind(local);
    let dropped = false;
    local.run = async (command, options) => {
      const r = await run(command, options);
      // The first poll that sees the exit code (its first field is no longer "-"): its answer is lost.
      if (isPoll(command) && !dropped && !r.output.startsWith("-")) {
        dropped = true;
        throw new Error("socket hang up (injected: the final poll's answer was lost)");
      }
      return r;
    };
    const r = await ws.bash("echo important-output", { outputPath, discardOutputUpTo: { bytes: 25_000, lines: 1_000 } });
    expect(dropped).toBe(true);
    expect(r.outcome).toEqual({ kind: "exited", exitCode: 0 });
    expect(r.output).toContain("important-output");
    expect(r.totals).toEqual({ bytes: "important-output\n".length, lines: 1, openLineBytes: 0 });
    // Received in full, so the small output file goes afterwards.
    for (let i = 0; i < 50 && existsSync(ws.inSandbox(outputPath)); i += 1) await sleep(20);
    expect(existsSync(ws.inSandbox(outputPath))).toBe(false);
  });

  it("keeps an output file the model did not see in full", async () => {
    const { ws } = await warm();
    const outputPath = `/tmp/agenta-output-r6-big-${Date.now()}.log`;
    await ws.bash("seq 1 5000", { outputPath, discardOutputUpTo: { bytes: 1_000, lines: 100 } });
    await sleep(200);
    expect(existsSync(ws.inSandbox(outputPath))).toBe(true);
  });
});

describe("a command whose runner died (Codex R9-1, accepted with this guard)", () => {
  it("is killed in the sandbox at its lifetime, with everything it started, though nobody polls it", async () => {
    const base = mkdtempSync(join(tmpdir(), "orphan-command-"));
    const late = join(base, "late.txt");
    // Launched as the runner does, then never polled or stopped: the runner is gone.
    execSync(launchScript(join(base, "attempt"), `sleep 31.7 & sleep 2.5; echo old > ${late}`, base, join(base, "out.log"), [], 1));
    await sleep(3_500);
    expect(existsSync(late)).toBe(false);
    expect(running("sleep 31[.]7")).toBe("");
  }, 10_000);

  it("lives at most its own timeout, or the tool-call limit, plus a grace the runner's own timeout comes before", () => {
    expect(commandLifetimeSeconds(10, 1_800_000)).toBe(70);
    expect(commandLifetimeSeconds(undefined, 1_800_000)).toBe(1_860);
    expect(commandLifetimeSeconds(7_200, 1_800_000)).toBe(1_860);
  });
});
