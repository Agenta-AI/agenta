/**
 * The Codex Stop leaves its shell child running; this pins the reap that kills it.
 *
 * The rules that matter are the two that keep a warm session warm: the `codex app-server` process
 * itself is never a candidate, and neither is anything OLDER than the turn that was stopped (an
 * stdio MCP server starts with the session, so it always is). Everything else is bookkeeping.
 */
import { describe, expect, it, vi } from "vitest";

import {
  MAX_REAPED,
  findAppServerPid,
  parseProcessTable,
  reapLeakedExecChildren,
  selectLeakedExecPids,
} from "../../src/engines/sandbox_agent/reap-exec.ts";

/** The real tree, copied from the live probe on the integration stack (2026-09-03). */
const LIVE_PS = [
  "    1     0  50000 /sbin/docker-init -- docker-entrypoint.sh sh -c node scripts/build-extension.mjs",
  "    7     1  49999 node node_modules/.bin/../tsx/dist/cli.mjs watch src/server.ts",
  "   58     7  49998 /usr/local/bin/node --require /app/node_modules/.pnpm/tsx@4.19.2/preflight.cjs src/server.ts",
  "67965    58    120 /app/node_modules/.pnpm/@sandbox-agent+cli-linux-x64@0.4.2/bin/sandbox-agent server",
  "68015 67965    118 node /root/.local/share/sandbox-agent/bin/agent_processes/codex/node_modules/.bin/codex-acp",
  "68022 68015    117 /usr/local/bin/node /root/.local/share/sandbox-agent/bin/agent_processes/codex/node_modules/@openai/codex/bin/codex.js app-server",
  "68029 68022    116 /root/.local/share/sandbox-agent/bin/agent_processes/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex app-server",
  "68164 68029     12 python3 -c import time; time.sleep(300.925793)",
].join("\n");

describe("parseProcessTable", () => {
  it("reads pid, ppid, elapsed seconds and the full argv", () => {
    const rows = parseProcessTable(LIVE_PS);
    expect(rows).toHaveLength(8);
    expect(rows.at(-1)).toEqual({
      pid: 68164,
      ppid: 68029,
      etimes: 12,
      args: "python3 -c import time; time.sleep(300.925793)",
    });
  });

  it("drops a line it cannot read rather than guessing at it", () => {
    expect(parseProcessTable("PID PPID ELAPSED COMMAND\nnonsense\n")).toEqual(
      [],
    );
  });
});

describe("findAppServerPid", () => {
  it("finds the Rust core and not the JavaScript launcher that shares its subcommand", () => {
    expect(findAppServerPid(parseProcessTable(LIVE_PS))).toBe(68029);
  });

  it("answers undefined when nothing matches", () => {
    const rows = parseProcessTable("   10     1   5 node server.js");
    expect(findAppServerPid(rows)).toBeUndefined();
  });

  it("answers undefined when TWO processes match, rather than picking one", () => {
    const rows = parseProcessTable(
      [
        "   10     1   5 /a/bin/codex app-server",
        "   11     1   5 /b/bin/codex app-server",
      ].join("\n"),
    );
    expect(findAppServerPid(rows)).toBeUndefined();
  });
});

describe("selectLeakedExecPids", () => {
  const rows = parseProcessTable(LIVE_PS);

  it("selects the leaked shell child", () => {
    expect(
      selectLeakedExecPids(rows, {
        appServerPid: 68029,
        turnElapsedSeconds: 20,
      }),
    ).toEqual([68164]);
  });

  it("never selects the app-server itself, nor any of its ancestors", () => {
    const selected = selectLeakedExecPids(rows, {
      appServerPid: 68029,
      turnElapsedSeconds: 100000,
    });
    for (const pid of [1, 7, 58, 67965, 68015, 68022, 68029]) {
      expect(selected).not.toContain(pid);
    }
  });

  it("leaves a process the SESSION started alone: an stdio MCP server outlives the turn", () => {
    const withMcp = parseProcessTable(
      [LIVE_PS, "68100 68029     90 node /app/mcp/stdio-server.js"].join("\n"),
    );
    const selected = selectLeakedExecPids(withMcp, {
      appServerPid: 68029,
      turnElapsedSeconds: 20,
    });
    expect(selected).toEqual([68164]);
    expect(selected).not.toContain(68100);
  });

  it("keeps a child born in the same whole second as the prompt", () => {
    const rows2 = parseProcessTable(
      [
        "68029 68022 116 /x/bin/codex app-server",
        "68164 68029  20 sleep 300",
      ].join("\n"),
    );
    expect(
      selectLeakedExecPids(rows2, {
        appServerPid: 68029,
        turnElapsedSeconds: 20,
      }),
    ).toEqual([68164]);
  });

  it("follows the tree, so a shell that forked its own child loses both", () => {
    const rows2 = parseProcessTable(
      [
        "68029 68022 116 /x/bin/codex app-server",
        "68164 68029  12 /bin/bash -c sleep 300",
        "68165 68164  12 sleep 300",
      ].join("\n"),
    );
    expect(
      selectLeakedExecPids(rows2, {
        appServerPid: 68029,
        turnElapsedSeconds: 20,
      }),
    ).toEqual([68164, 68165]);
  });
});

describe("reapLeakedExecChildren", () => {
  function sandboxWith(stdout: string) {
    const calls: Array<{ command: string; args?: string[] }> = [];
    return {
      calls,
      sandbox: {
        runProcess: vi.fn(
          async (request: { command: string; args?: string[] }) => {
            calls.push(request);
            return {
              stdout: request.command === "ps" ? stdout : "",
              exitCode: 0,
            };
          },
        ),
      },
    };
  }

  it("lists, then kills exactly the leaked pid", async () => {
    const { sandbox, calls } = sandboxWith(LIVE_PS);
    const log = vi.fn();
    const result = await reapLeakedExecChildren({
      sandbox,
      turnElapsedMs: 20_000,
      log,
    });
    expect(result).toEqual({ killed: 1 });
    expect(calls[0].command).toBe("ps");
    expect(calls[1]).toMatchObject({ command: "kill", args: ["-9", "68164"] });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("killed=1"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("pids=68164"));
  });

  it("kills nothing, and says why, when the sandbox has no one-off process API", async () => {
    const log = vi.fn();
    expect(
      await reapLeakedExecChildren({ sandbox: {}, turnElapsedMs: 1, log }),
    ).toEqual({
      killed: 0,
      skipped: "no-run-process",
    });
  });

  it("gives up quietly when `ps` is missing or speaks a different dialect", async () => {
    const log = vi.fn();
    const sandbox = {
      runProcess: vi.fn(async () => {
        throw new Error("ps: unrecognized option -eo");
      }),
    };
    expect(
      await reapLeakedExecChildren({ sandbox, turnElapsedMs: 1, log }),
    ).toEqual({ killed: 0, skipped: "ps-failed" });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("skipped=ps-failed"),
    );
  });

  it("kills nothing when the app-server cannot be identified", async () => {
    const { sandbox } = sandboxWith("   10     1   5 node other.js");
    expect(
      await reapLeakedExecChildren({ sandbox, turnElapsedMs: 1, log: vi.fn() }),
    ).toEqual({ killed: 0, skipped: "no-app-server" });
  });

  it("kills nothing when the harness already cleaned up after itself", async () => {
    const { sandbox, calls } = sandboxWith(
      "68029 68022 116 /x/bin/codex app-server",
    );
    expect(
      await reapLeakedExecChildren({ sandbox, turnElapsedMs: 1, log: vi.fn() }),
    ).toEqual({ killed: 0, skipped: "nothing-to-reap" });
    expect(calls).toHaveLength(1);
  });

  it("refuses to fire when the candidate set is implausibly large", async () => {
    const rows = ["68029 68022 116 /x/bin/codex app-server"];
    for (let i = 0; i <= MAX_REAPED; i += 1) {
      rows.push(`${70000 + i} 68029 1 worker-${i}`);
    }
    const { sandbox, calls } = sandboxWith(rows.join("\n"));
    expect(
      await reapLeakedExecChildren({
        sandbox,
        turnElapsedMs: 5_000,
        log: vi.fn(),
      }),
    ).toEqual({ killed: 0, skipped: "too-many" });
    expect(calls).toHaveLength(1);
  });

  it("reports a failed kill instead of claiming the leak is gone", async () => {
    let seen = 0;
    const sandbox = {
      runProcess: vi.fn(async () => {
        seen += 1;
        if (seen === 1) return { stdout: LIVE_PS, exitCode: 0 };
        throw new Error("kill: permission denied");
      }),
    };
    expect(
      await reapLeakedExecChildren({
        sandbox,
        turnElapsedMs: 20_000,
        log: vi.fn(),
      }),
    ).toEqual({ killed: 0, skipped: "kill-failed" });
  });
});
