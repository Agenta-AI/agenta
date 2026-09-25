/**
 * Round 7 (2c): every Pi tool runs in the command sandbox, on its mount of the drive; the runner
 * opens no path the model chose and mounts nothing. Against the local Daytona stand-in, whose
 * "mount" is a link that goes when the sandbox stops (`tests/utils/local-drive.ts`). A real
 * geesefs mount against a real store is pinned in `tests/integration/inprocess/sandbox-drive.test.ts`.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EditDiffs } from "../../../src/engines/inprocess/tools/edit-diffs.ts";
import { buildFileTools } from "../../../src/engines/inprocess/tools/file-tools.ts";
import { DRIVE_UNREACHABLE_MESSAGE, geesefsMounter } from "../../../src/engines/inprocess/sandbox/sandbox-drive.ts";
import { DaytonaCallTimeoutError } from "../../../src/engines/inprocess/sandbox/daytona-api.ts";
import { readFile as sandboxReadFile, writeFile as sandboxWriteFile } from "../../../src/engines/inprocess/sandbox/sandbox-files.ts";
import { Readable } from "node:stream";
import { createTestWorkspace, OPEN_NETWORK, type TestWorkspace } from "../../utils/inprocess-workspace.ts";
import { sandboxSlots } from "../../../src/engines/inprocess/sandbox/sandbox-slots.ts";
import { TEST_CREDENTIALS } from "../../utils/local-drive.ts";

function tools(ws: TestWorkspace, maxFileBytes = 1024 * 1024) {
  const w = ws.workspace;
  const list = buildFileTools(
    ws.cwd,
    {
      read: (signal, step) => w.read(OPEN_NETWORK, signal, step),
      change: (signal, step) => w.change(OPEN_NETWORK, signal, step),
      inSandbox: (path) => w.inSandbox(path),
      tmpDir: w.tmpDir,
      maxFileBytes,
    },
    new EditDiffs(),
  );
  const call = (name: string, params: Record<string, unknown>, signal?: AbortSignal) =>
    list.find((t) => t.name === name)!.execute(`call-${name}`, params, signal, undefined, { cwd: ws.cwd } as never);
  const text = (r: { content: Array<{ type: string; text?: string }> }) => String(r.content[0]?.text ?? "");
  return { call, text };
}

const sandboxOf = (ws: TestWorkspace) => [...ws.daytona.sandboxes.values()][0]!;

describe("every file tool runs in the sandbox", () => {
  it("starts the sandbox on the first tool call, a read included, and answers each read-only call with one sandbox call", async () => {
    const ws = createTestWorkspace();
    writeFileSync(join(ws.cwd, "notes.md"), "hello from the drive\n");
    mkdirSync(join(ws.cwd, "src"));
    writeFileSync(join(ws.cwd, "src", "a.ts"), "export const a = 1;\n");
    const { call, text } = tools(ws);
    expect(ws.daytona.creates).toBe(0);
    expect(text(await call("read", { path: "notes.md" }))).toContain("hello from the drive");
    expect(ws.daytona.creates).toBe(1);
    const sandbox = sandboxOf(ws);
    const count = async (name: string, params: Record<string, unknown>) => {
      const before = sandbox.commands.length;
      const r = text(await call(name, params));
      return { calls: sandbox.commands.length - before, r };
    };
    const read = await count("read", { path: "notes.md" });
    expect(read).toMatchObject({ calls: 1 });
    const ls = await count("ls", { path: "." });
    expect(ls.calls).toBe(1);
    expect(ls.r).toContain("notes.md");
    expect(ls.r).toContain("src/");
    const find = await count("find", { pattern: "*.ts" });
    expect(find.calls).toBe(1);
    expect(find.r).toContain("src/a.ts");
    const grep = await count("grep", { pattern: "const a" });
    expect(grep.calls).toBe(1);
    expect(grep.r).toContain("src/a.ts:1: export const a = 1;");
    await ws.workspace.sandbox.delete();
  });

  it("writes and edits in the sandbox, and a read sees the result at once", async () => {
    const ws = createTestWorkspace();
    const { call, text } = tools(ws);
    await call("write", { path: "notes/today.md", content: "written in the sandbox\n" });
    expect(sandboxOf(ws).commands.some((c) => c.includes("python3 -c") && c.includes(" 'write' "))).toBe(true);
    expect(text(await call("read", { path: "notes/today.md" }))).toContain("written in the sandbox");
    await call("edit", { path: "notes/today.md", edits: [{ oldText: "sandbox", newText: "sandbox, then edited" }] });
    expect(readFileSync(join(ws.cwd, "notes/today.md"), "utf-8")).toBe("written in the sandbox, then edited\n");
    await ws.workspace.sandbox.delete();
  });

  it("moves large files through the sandbox's file transfer, both ways", async () => {
    const ws = createTestWorkspace();
    const { call, text } = tools(ws);
    const big = `${"x".repeat(200 * 1024)}\nend\n`;
    await call("write", { path: "big.txt", content: big });
    expect(readFileSync(join(ws.cwd, "big.txt"), "utf-8")).toBe(big);
    expect(sandboxOf(ws).calls).toContain("upload");
    expect(text(await call("read", { path: "big.txt", offset: 2 }))).toContain("end");
    expect(sandboxOf(ws).calls).toContain("download");
    await ws.workspace.sandbox.delete();
  });

  it("answers Pi's way for what is not there, a folder, and a file over the limit", async () => {
    const ws = createTestWorkspace();
    writeFileSync(join(ws.cwd, "big.txt"), "x".repeat(4096));
    const { call } = tools(ws, 1024);
    await expect(call("read", { path: "missing.md" })).rejects.toThrow(/ENOENT|not found/i);
    await expect(call("ls", { path: "missing" })).rejects.toThrow(/not found/i);
    await expect(call("find", { pattern: "*", path: "missing" })).rejects.toThrow(/not found/i);
    await expect(call("grep", { pattern: "x", path: "missing" })).rejects.toThrow(/not found/i);
    await expect(call("read", { path: "big.txt" })).rejects.toThrow(/too large/);
    await expect(call("edit", { path: "missing.md", edits: [{ oldText: "a", newText: "b" }] })).rejects.toThrow(/ENOENT/);
    await ws.workspace.sandbox.delete();
  });
});

describe("a command's changes", () => {
  it("changes, renames and deletes files, and the file tools see all of it; the supervisor flushes the drive", async () => {
    const ws = createTestWorkspace();
    const { call, text } = tools(ws);
    mkdirSync(join(ws.cwd, "src"));
    for (const n of ["keep", "rename", "remove"]) writeFileSync(join(ws.cwd, "src", `${n}.txt`), `${n}\n`);
    const r = await ws.bash("echo more >> src/keep.txt; mv src/rename.txt src/renamed.txt; rm src/remove.txt; mkdir -p out && echo built > out/a.txt; echo shared > agent-files/shared.md");
    expect(r.outcome).toEqual({ kind: "exited", exitCode: 0 });
    expect(text(await call("read", { path: "src/keep.txt" }))).toContain("keep\nmore");
    const ls = text(await call("ls", { path: "src" }));
    expect(ls).toContain("renamed.txt");
    expect(ls).not.toContain("remove.txt");
    expect(text(await call("read", { path: "out/a.txt" }))).toContain("built");
    expect(readFileSync(join(ws.agent, "shared.md"), "utf-8")).toBe("shared\n");
    expect(sandboxOf(ws).commands.find((c) => c.includes("setsid"))).toContain("sync -f");
    await ws.workspace.sandbox.delete();
  });

  it("flushes the drive after a command that was stopped", async () => {
    const ws = createTestWorkspace();
    const stop = new AbortController();
    const run = ws.bash("echo partial > half.txt; sleep 30", { signal: stop.signal });
    while (!ws.daytona.sandboxes.size || !sandboxOf(ws).commands.some((c) => c.includes("setsid"))) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 300));
    stop.abort();
    expect((await run).outcome).toEqual({ kind: "aborted" });
    expect(sandboxOf(ws).commands.at(-1)).toMatch(/sync -f .*; exit \$f$/);
    expect(existsSync(join(ws.cwd, "half.txt"))).toBe(true);
    await ws.workspace.sandbox.delete();
  });
});

describe("the start of a turn", () => {
  it("refreshes the running sandbox's view of the drive before its next tool call, and starts nothing when none runs", async () => {
    const ws = createTestWorkspace();
    const { call, text } = tools(ws);
    ws.workspace.startTurn();
    await new Promise((r) => setTimeout(r, 50));
    expect(ws.daytona.creates).toBe(0);

    await ws.bash("true");
    const sandbox = sandboxOf(ws);
    // A files-pane write between turns goes straight to the store.
    writeFileSync(join(ws.cwd, "from-pane.md"), "uploaded\n");
    const before = sandbox.commands.length;
    ws.workspace.startTurn();
    expect(text(await call("read", { path: "from-pane.md" }))).toContain("uploaded");
    const since = sandbox.commands.slice(before);
    expect(since[0]).toContain(": refresh-view");
    expect(geesefsMounter(() => {}).refreshCommand(["'/a'", "'/b'"])).toMatch(/^python3 -c .*\.invalidate.* '\/a' '\/b'$/s);
    expect(since[0]).toContain(ws.inSandbox(ws.cwd));
    expect(since[0]).toContain(ws.inSandbox(ws.agent));
    expect(ws.daytona.creates).toBe(1);
    await ws.workspace.sandbox.delete();
  });
});

describe("the sandbox's mounts", () => {
  it("mounts the drive again after the sandbox stopped and started", async () => {
    const ws = createTestWorkspace();
    await ws.bash("echo one > one.txt");
    expect(ws.mounter.mounts).toHaveLength(2);
    await ws.workspace.sandbox.stop("idle");
    expect(sandboxOf(ws).state).toBe("stopped");
    const r = await ws.bash("cat one.txt; echo two > two.txt");
    expect(r.output).toContain("one");
    expect(ws.mounter.mounts).toHaveLength(4);
    expect(ws.daytona.creates).toBe(1);
    expect(readFileSync(join(ws.cwd, "two.txt"), "utf-8")).toBe("two\n");
    await ws.workspace.sandbox.delete();
  });

  it("mounts once when tool calls arrive together", async () => {
    const ws = createTestWorkspace();
    writeFileSync(join(ws.cwd, "a.md"), "a\n");
    const { call } = tools(ws);
    await Promise.all([call("read", { path: "a.md" }), call("ls", { path: "." }), call("grep", { pattern: "a" })]);
    expect(ws.mounter.mounts).toHaveLength(2);
    await ws.workspace.sandbox.delete();
  });

  // A dead mount cannot be replaced in place in a Daytona sandbox (`fusermount -u` fails there),
  // so the sandbox is replaced; the drive is intact, only the sandbox's own disk is lost.
  it("replaces the sandbox when a command launch finds its mount dead, and runs the command once", async () => {
    const ws = createTestWorkspace();
    await ws.bash("true");
    rmSync(ws.inSandbox(ws.cwd));
    const r = await ws.bash("echo once >> ran.txt");
    expect(r.outcome).toEqual({ kind: "exited", exitCode: 0 });
    expect(readFileSync(join(ws.cwd, "ran.txt"), "utf-8")).toBe("once\n");
    expect(ws.daytona.creates).toBe(2);
    expect(ws.logs.some((m) => m.includes("retired: its mount of"))).toBe(true);
    await ws.workspace.sandbox.delete();
  });

  it("replaces the sandbox when a file tool finds its mount dead, and nothing lands on the sandbox's own disk", async () => {
    const ws = createTestWorkspace();
    const { call, text } = tools(ws);
    await call("write", { path: "a.txt", content: "a" });
    rmSync(ws.inSandbox(ws.cwd));
    await call("write", { path: "b.txt", content: "b" });
    expect(readFileSync(join(ws.cwd, "b.txt"), "utf-8")).toBe("b");
    rmSync(ws.inSandbox(ws.cwd));
    expect(text(await call("read", { path: "b.txt" }))).toContain("b");
    expect(ws.daytona.creates).toBe(3);
    await ws.workspace.sandbox.delete();
  });

  it("replaces the sandbox when its mounts' credentials are about to expire and fresher ones are in hand", async () => {
    const ws = createTestWorkspace();
    const expiring = (ms: number) => ws.workspace.drive.rootPaths.map((root) => ({ root, credentials: () => ({ ...TEST_CREDENTIALS, expiresAt: new Date(Date.now() + ms).toISOString() }) }));
    ws.workspace.drive.setRoots(expiring(5 * 60_000));
    await ws.bash("true");
    // Nothing fresher in hand: the sandbox is kept.
    await ws.bash("true");
    expect(ws.daytona.creates).toBe(1);
    // A newer environment's credentials: the sandbox is replaced and mounts with them.
    ws.workspace.drive.setRoots(expiring(12 * 3_600_000));
    await ws.bash("true");
    expect(ws.daytona.creates).toBe(2);
    await ws.workspace.sandbox.delete();
  });

  it("says so when the store cannot be reached from the sandbox", async () => {
    const ws = createTestWorkspace();
    ws.mounter.unreachable = true;
    const { call } = tools(ws);
    await expect(call("read", { path: "x.txt" })).rejects.toThrow(DRIVE_UNREACHABLE_MESSAGE);
    await expect(call("write", { path: "x.txt", content: "x" })).rejects.toThrow(DRIVE_UNREACHABLE_MESSAGE);
    await expect(ws.bash("true")).rejects.toThrow(DRIVE_UNREACHABLE_MESSAGE);
    await ws.workspace.sandbox.delete();
  });
});

describe("a replaced sandbox", () => {
  it("loses only its own disk: the drive's files are all there on the new one", async () => {
    const ws = createTestWorkspace();
    // The stand-in's $HOME is its sandbox folder: its own disk.
    await ws.bash("echo scratch > $HOME/scratch-marker; echo durable > kept.txt");
    expect(existsSync(join(ws.daytona.prefix, "scratch-marker"))).toBe(true);
    // The run's sandbox credentials changed: the sandbox is retired and a new one created.
    const r = await ws.bash("cat kept.txt; cat $HOME/scratch-marker 2>/dev/null || echo no-scratch", { requirements: { network: { networkBlockAll: false }, environment: { NEW_SECRET: "v" } } });
    expect(ws.daytona.creates).toBe(2);
    expect(r.output).toContain("durable");
    expect(r.output).toContain("no-scratch");
    await ws.workspace.sandbox.delete();
  });
});

describe("Stop during a write", () => {
  it("lets the write land whole, reports the Stop, and the next change waits for it", async () => {
    const ws = createTestWorkspace();
    const { call } = tools(ws);
    await ws.bash("true");
    const local = sandboxOf(ws);
    const run = local.run.bind(local);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    local.run = async (command, options) => {
      if (command.includes("python3 -c") && command.includes(" 'write' ")) await gate;
      return run(command, options);
    };
    const stop = new AbortController();
    const content = "whole\n".repeat(1000);
    const writing = call("write", { path: "stopped.txt", content }, stop.signal);
    await new Promise((r) => setTimeout(r, 100));
    stop.abort();
    const next = ws.bash("wc -c < stopped.txt");
    await new Promise((r) => setTimeout(r, 100));
    release();
    await expect(writing).rejects.toThrow(/aborted/i);
    expect(readFileSync(join(ws.cwd, "stopped.txt"), "utf-8")).toBe(content);
    expect((await next).output.trim()).toBe(String(content.length));
    await ws.workspace.sandbox.delete();
  });

  it("writes nothing when the Stop comes while the write waits behind a command", async () => {
    const ws = createTestWorkspace();
    const { call } = tools(ws);
    const long = ws.bash("sleep 1");
    const stop = new AbortController();
    const writing = call("write", { path: "never.txt", content: "x" }, stop.signal);
    stop.abort();
    await expect(writing).rejects.toThrow(/aborted/i);
    await long;
    expect(existsSync(join(ws.cwd, "never.txt"))).toBe(false);
    await ws.workspace.sandbox.delete();
  });
});

describe("skills", () => {
  it("gets the executable bits of the run's skill files back in the sandbox, and runs the script", async () => {
    const script = "agents/skills/digest/check/scripts/check.sh";
    const ws = createTestWorkspace();
    const path = join(ws.cwd, script);
    mkdirSync(join(path, ".."), { recursive: true });
    // What the drive holds: the content, without the mode (geesefs drops it without --enable-perms).
    writeFileSync(path, "#!/bin/sh\necho skill-ran\n", { mode: 0o644 });
    ws.workspace.drive.addModes(new Map([[path, 0o755]]));
    const r = await ws.bash(`./${script}`);
    expect(r.outcome).toEqual({ kind: "exited", exitCode: 0 });
    expect(r.output).toContain("skill-ran");
    expect(statSync(path).mode & 0o777).toBe(0o755);
    await ws.workspace.sandbox.delete();
  });
});

describe("Codex round 7: a change's outcome is never assumed", () => {
  it("retires the sandbox after a change that was not answered in time, and the next change waits until it is deleted", async () => {
    const ws = createTestWorkspace();
    await ws.bash("true");
    const first = sandboxOf(ws);
    let releaseDelete: () => void = () => {};
    const deleteGate = new Promise<void>((r) => (releaseDelete = r));
    const remove = first.remove.bind(first);
    first.remove = async () => {
      await deleteGate;
      return remove();
    };
    const timedOut = ws.workspace.change(OPEN_NETWORK, undefined, async () => {
      throw new DaytonaCallTimeoutError("command x", 1);
    });
    let ran = false;
    const next = ws.workspace.change(OPEN_NETWORK, undefined, async () => {
      ran = true;
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(ran).toBe(false);
    releaseDelete();
    await expect(timedOut).rejects.toBeInstanceOf(DaytonaCallTimeoutError);
    await next;
    expect(ran).toBe(true);
    expect(first.deleted).toBe(true);
    expect(ws.daytona.creates).toBe(2);
    await ws.workspace.sandbox.delete();
  });

  it("leaves the old content whole when a write fails part way (no truncate in place)", async () => {
    const ws = createTestWorkspace();
    await ws.bash("true");
    const target = join(ws.cwd, "kept.txt");
    writeFileSync(target, "old content\n");
    const local = sandboxOf(ws);
    const run = local.run.bind(local);
    // The staged upload vanishes before the helper reads it: the helper fails after it opened its output.
    local.run = async (command, options) => {
      if (command.includes(" 'write' ")) rmSync(command.match(/'(\/[^']*\.agenta-write-[^']*)'/)![1]!, { force: true });
      return run(command, options);
    };
    await expect(sandboxWriteFile(local, ws.inSandbox(target), Buffer.from("x".repeat(100 * 1024)), { tmpDir: ws.inSandbox("/tmp") })).rejects.toThrow();
    expect(readFileSync(target, "utf-8")).toBe("old content\n");
    await ws.workspace.sandbox.delete();
  });

  it("writes through a symlink to its target, as a write in place did (Codex round 8)", async () => {
    const ws = createTestWorkspace();
    const { call } = tools(ws);
    const target = join(ws.cwd, "target.txt");
    writeFileSync(target, "old\n");
    symlinkSync("target.txt", join(ws.cwd, "link.txt"));
    await call("write", { path: "link.txt", content: "new\n" });
    expect(readFileSync(target, "utf-8")).toBe("new\n");
    expect(lstatSync(join(ws.cwd, "link.txt")).isSymbolicLink()).toBe(true);
    await ws.workspace.sandbox.delete();
  });

  it("keeps a file's mode when a write replaces it", async () => {
    const ws = createTestWorkspace();
    const { call } = tools(ws);
    const target = join(ws.cwd, "run.sh");
    writeFileSync(target, "#!/bin/sh\necho a\n", { mode: 0o755 });
    await call("write", { path: "run.sh", content: "#!/bin/sh\necho b\n" });
    expect(readFileSync(target, "utf-8")).toBe("#!/bin/sh\necho b\n");
    expect(statSync(target).mode & 0o777).toBe(0o755);
    await ws.workspace.sandbox.delete();
  });

  it("reports a command whose flush failed as not confirmed saved, not as a success", async () => {
    const ws = createTestWorkspace();
    await ws.bash("true");
    const local = sandboxOf(ws);
    const run = local.run.bind(local);
    local.run = async (command, options) => run(command.includes("setsid") ? command.replaceAll("sync -f", "false") : command, options);
    const r = await ws.bash("echo hi > flushed.txt");
    expect(r.outcome.kind).toBe("unknown");
    expect(r.outcome.kind === "unknown" && r.outcome.reason).toMatch(/could not be confirmed as saved/);
    await ws.workspace.sandbox.delete();
  });

  it("fails a read that returned fewer bytes than the file's size, instead of answering short", async () => {
    const ws = createTestWorkspace();
    await ws.bash("true");
    // A sysfs file reports 4096 bytes and reads far fewer: the shape of a geesefs read that gave up.
    const short = "/sys/kernel/mm/transparent_hugepage/enabled";
    if (!existsSync(short)) return;
    await expect(sandboxReadFile(sandboxOf(ws), short, 1024 * 1024)).rejects.toThrow(/changed in storage while it was read/);
    await ws.workspace.sandbox.delete();
  });

  it("fails a large read whose download ended short", async () => {
    const ws = createTestWorkspace();
    await ws.bash("true");
    const target = join(ws.cwd, "big.bin");
    writeFileSync(target, Buffer.alloc(200 * 1024, 1));
    const local = sandboxOf(ws);
    local.download = async () => Readable.from([Buffer.alloc(1000, 1)]);
    await expect(sandboxReadFile(local, ws.inSandbox(target), 1024 * 1024)).rejects.toThrow(/changed in storage while it was read/);
    await ws.workspace.sandbox.delete();
  });

  it("makes the first read of a turn wait for the turn-start refresh", async () => {
    const ws = createTestWorkspace();
    const { call } = tools(ws);
    await ws.bash("true");
    writeFileSync(join(ws.cwd, "a.md"), "a\n");
    const local = sandboxOf(ws);
    const run = local.run.bind(local);
    let releaseRefresh: () => void = () => {};
    const refreshGate = new Promise<void>((r) => (releaseRefresh = r));
    const order: string[] = [];
    local.run = async (command, options) => {
      if (command.includes(" 'read' ")) order.push("read");
      else if (command.includes(": refresh-view")) {
        await refreshGate;
        order.push("refresh");
      }
      return run(command, options);
    };
    ws.workspace.startTurn();
    const reading = call("read", { path: "a.md" });
    await new Promise((r) => setTimeout(r, 200));
    expect(order).toEqual([]);
    releaseRefresh();
    await reading;
    expect(order).toEqual(["refresh", "read"]);
    await ws.workspace.sandbox.delete();
  });

  it("ends a large read at once on Stop when the download stalls", async () => {
    const ws = createTestWorkspace();
    await ws.bash("true");
    const target = join(ws.cwd, "big.bin");
    writeFileSync(target, Buffer.alloc(200 * 1024, 1));
    const local = sandboxOf(ws);
    local.download = async () => {
      const stalled = new Readable({ read() {} });
      stalled.push(Buffer.alloc(1000, 1));
      return stalled;
    };
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 200);
    const t0 = Date.now();
    await expect(sandboxReadFile(local, ws.inSandbox(target), 1024 * 1024, stop.signal)).rejects.toThrow(/abort/i);
    expect(Date.now() - t0).toBeLessThan(2_000);
    await ws.workspace.sandbox.delete();
  });
});

describe("Codex round 7 P2: a sandbox whose mount failed is not reused", () => {
  it("starts the next attempt on a new sandbox after a mount failed", async () => {
    const ws = createTestWorkspace();
    ws.mounter.unreachable = true;
    await expect(ws.bash("true")).rejects.toThrow(DRIVE_UNREACHABLE_MESSAGE);
    ws.mounter.unreachable = false;
    const r = await ws.bash("echo ok");
    expect(r.outcome).toEqual({ kind: "exited", exitCode: 0 });
    expect(ws.daytona.creates).toBe(2);
    await ws.workspace.sandbox.delete();
  });

  it("prepares a sandbox that replaced one with a dead mount before the command runs on it", async () => {
    const ws = createTestWorkspace();
    await ws.bash("true");
    rmSync(ws.inSandbox(ws.cwd));
    const prepared: string[] = [];
    const r = await ws.workspace.runCommand({
      command: "echo ran",
      cwd: ws.cwd,
      outputPath: "/tmp/agenta-output-prep.log",
      output: { append: () => {}, skip: () => {}, settle: () => {} },
      requirements: OPEN_NETWORK,
      preparations: [
        async () => {
          prepared.push([...ws.daytona.sandboxes.values()].at(-1)!.id);
          return { status: "ok" } as never;
        },
      ],
    });
    expect(r.outcome).toEqual({ kind: "exited", exitCode: 0 });
    expect(ws.daytona.creates).toBe(2);
    expect(prepared.at(-1)).toBe([...ws.daytona.sandboxes.values()].at(-1)!.id);
    expect(new Set(prepared).size).toBe(2);
    await ws.workspace.sandbox.delete();
  });
});

describe("Codex round 8 P1: no change or read goes ahead on a state that may still move", () => {
  it("keeps every later change out while a timed-out change's sandbox is not confirmed deleted, and says so after a bound", async () => {
    const slots = sandboxSlots(4, 4, 300, { reconcileDelaysMs: [50] });
    const ws = createTestWorkspace({ settings: { slots } });
    await ws.bash("true");
    const first = sandboxOf(ws);
    first.faults.fail = new Set(["remove"]);
    const timedOut = ws.workspace.change(OPEN_NETWORK, undefined, async () => {
      throw new DaytonaCallTimeoutError("command x", 1);
    });
    await expect(timedOut).rejects.toBeInstanceOf(DaytonaCallTimeoutError);
    let ran = false;
    const t0 = Date.now();
    await expect(
      ws.workspace.change(OPEN_NETWORK, undefined, async () => {
        ran = true;
      }),
    ).rejects.toThrow(/may still land/);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
    await expect(ws.bash("echo later > later.txt")).rejects.toThrow(/may still land/);
    expect(ran).toBe(false);
    expect(existsSync(join(ws.cwd, "later.txt"))).toBe(false);
    // Reconciliation deletes it once Daytona answers again; changes go on after that.
    first.faults.fail = undefined;
    await ws.workspace.change(OPEN_NETWORK, undefined, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
    expect(first.deleted).toBe(true);
    await ws.workspace.sandbox.delete();
  });

  it("fails a read with a sentence when the turn-start refresh fails, and refreshes again before the next tool call", async () => {
    const ws = createTestWorkspace();
    const { call, text } = tools(ws);
    await ws.bash("true");
    writeFileSync(join(ws.cwd, "a.md"), "fresh\n");
    const local = sandboxOf(ws);
    const run = local.run.bind(local);
    let failRefresh = true;
    let refreshes = 0;
    local.run = async (command, options) => {
      if (command.includes(": refresh-view")) {
        refreshes += 1;
        if (failRefresh) return { exitCode: 1, output: "1\n" };
      }
      return run(command, options);
    };
    ws.workspace.startTurn();
    await expect(call("read", { path: "a.md" })).rejects.toThrow(/could not be refreshed/);
    failRefresh = false;
    expect(text(await call("read", { path: "a.md" }))).toContain("fresh");
    expect(refreshes).toBe(2);
    await call("read", { path: "a.md" });
    expect(refreshes).toBe(2);
    await ws.workspace.sandbox.delete();
  });
});
