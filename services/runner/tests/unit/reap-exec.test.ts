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
  findSandboxAgentServerPid,
  parseProcessTable,
  reapLeakedExecChildren,
  reapResultAllowsParking,
  selectLeakedExecPids,
} from "../../src/engines/sandbox_agent/reap-exec.ts";
import {
  DAYTONA_SANDBOX_AGENT_PORT,
  sandboxAgentServerPort,
} from "../../src/engines/sandbox_agent/provider.ts";

const LIVE_PORT = 43_123;

describe("reapResultAllowsParking", () => {
  it("accepts only a successful reap or a clean inspection", () => {
    expect(reapResultAllowsParking({ killed: 1 })).toBe(true);
    expect(
      reapResultAllowsParking({ killed: 0, skipped: "nothing-to-reap" }),
    ).toBe(true);
    expect(reapResultAllowsParking({ killed: 0, skipped: "ps-failed" })).toBe(
      false,
    );
    expect(reapResultAllowsParking(undefined)).toBe(false);
  });
});

/** The real tree, copied from the live probe on the integration stack (2026-09-03). */
const LIVE_PS = [
  "    1     0  50000 /sbin/docker-init -- docker-entrypoint.sh sh -c node scripts/build-extension.mjs",
  "    7     1  49999 node node_modules/.bin/../tsx/dist/cli.mjs watch src/server.ts",
  "   58     7  49998 /usr/local/bin/node --require /app/node_modules/.pnpm/tsx@4.19.2/preflight.cjs src/server.ts",
  `67965    58    120 /app/node_modules/.pnpm/@sandbox-agent+cli-linux-x64@0.4.2/bin/sandbox-agent server --host 127.0.0.1 --port ${LIVE_PORT}`,
  "68015 67965    118 node /root/.local/share/sandbox-agent/bin/agent_processes/codex/node_modules/.bin/codex-acp",
  "68022 68015    117 /usr/local/bin/node /root/.local/share/sandbox-agent/bin/agent_processes/codex/node_modules/@openai/codex/bin/codex.js app-server",
  "68029 68022    116 /root/.local/share/sandbox-agent/bin/agent_processes/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex app-server",
  "68164 68029     12 python3 -c import time; time.sleep(300.925793)",
].join("\n");

describe("sandboxAgentServerPort", () => {
  it("reads the allocated port from a local sandbox handle id", () => {
    expect(sandboxAgentServerPort(`local/127.0.0.1:${LIVE_PORT}`)).toBe(
      LIVE_PORT,
    );
  });

  it("returns the explicit port configured for Daytona", () => {
    expect(sandboxAgentServerPort("daytona/sandbox-1")).toBe(
      DAYTONA_SANDBOX_AGENT_PORT,
    );
  });
});

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

describe("findSandboxAgentServerPid", () => {
  it("matches the exact --port value, not another port with the same prefix", () => {
    const rows = parseProcessTable(
      [
        "   10     1   5 /x/bin/sandbox-agent server --port 4312",
        "   11     1   5 /x/bin/sandbox-agent server --port 43123",
      ].join("\n"),
    );
    expect(findSandboxAgentServerPid(rows, 4312)).toBe(10);
  });
});

describe("findAppServerPid", () => {
  it("finds the Rust core and not the JavaScript launcher that shares its subcommand", () => {
    expect(findAppServerPid(parseProcessTable(LIVE_PS), 67965)).toBe(68029);
  });

  it("answers undefined when nothing matches", () => {
    const rows = parseProcessTable("   10     1   5 node server.js");
    expect(findAppServerPid(rows, 1)).toBeUndefined();
  });

  it("answers undefined when TWO descendants match, rather than picking one", () => {
    const rows = parseProcessTable(
      [
        "   10     1   5 /x/bin/sandbox-agent server --port 4312",
        "   11    10   5 /a/bin/codex app-server",
        "   12    10   5 /b/bin/codex app-server",
      ].join("\n"),
    );
    expect(findAppServerPid(rows, 10)).toBeUndefined();
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

  it("rounds the turn's age DOWN, so a session helper a hair older survives", async () => {
    // The `git fetch` Codex runs to sync its plugins starts about a second before the prompt on
    // a cold turn. At 28.9 s of turn, a 29 s-old helper must not be a candidate.
    const { sandbox, calls } = sandboxWith(
      [
        `67965 58 120 /x/bin/sandbox-agent server --port ${LIVE_PORT}`,
        "68029 67965 116 /x/bin/codex app-server",
        "68100 68029  29 git -C /w/.codex/.tmp/plugins-clone fetch --depth 1",
        "68164 68029  22 sleep 300",
      ].join("\n"),
    );
    const result = await reapLeakedExecChildren({
      sandbox,
      sandboxAgentPort: LIVE_PORT,
      turnElapsedMs: 28_900,
      log: vi.fn(),
    });
    expect(result).toEqual({ killed: 1 });
    expect(calls[1]).toMatchObject({ command: "kill", args: ["-9", "68164"] });
  });

  it("lists, then kills exactly the leaked pid", async () => {
    const { sandbox, calls } = sandboxWith(LIVE_PS);
    const log = vi.fn();
    const result = await reapLeakedExecChildren({
      sandbox,
      sandboxAgentPort: LIVE_PORT,
      turnElapsedMs: 20_000,
      log,
    });
    expect(result).toEqual({ killed: 1 });
    expect(calls[0].command).toBe("ps");
    expect(calls[1]).toMatchObject({ command: "kill", args: ["-9", "68164"] });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("killed=1"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("pids=68164"));
  });

  it("reaps only the stopped turn beneath the daemon on this sandbox's port", async () => {
    const rows = [
      "100 1 120 /x/bin/sandbox-agent server --host 127.0.0.1 --port 41001",
      "110 100 119 node /x/codex-acp",
      "120 110 118 /x/bin/codex app-server",
      "130 120 10 sleep 300",
      "200 1 120 /x/bin/sandbox-agent server --host 127.0.0.1 --port 41002",
      "210 200 119 node /x/codex-acp",
      "220 210 118 /x/bin/codex app-server",
      "230 220 10 sleep 300",
    ].join("\n");
    const { sandbox, calls } = sandboxWith(rows);
    const result = await reapLeakedExecChildren({
      sandbox,
      sandboxAgentPort: 41002,
      turnElapsedMs: 20_000,
      log: vi.fn(),
    });
    expect(result).toEqual({ killed: 1 });
    expect(calls[1]).toMatchObject({ command: "kill", args: ["-9", "230"] });
  });

  it("kills nothing, and says why, when the sandbox has no one-off process API", async () => {
    const log = vi.fn();
    expect(
      await reapLeakedExecChildren({
        sandbox: {},
        sandboxAgentPort: LIVE_PORT,
        turnElapsedMs: 1,
        log,
      }),
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
      await reapLeakedExecChildren({
        sandbox,
        sandboxAgentPort: LIVE_PORT,
        turnElapsedMs: 1,
        log,
      }),
    ).toEqual({ killed: 0, skipped: "ps-failed" });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("skipped=ps-failed"),
    );
  });

  it("kills nothing when the app-server cannot be identified", async () => {
    const { sandbox } = sandboxWith("   10     1   5 node other.js");
    expect(
      await reapLeakedExecChildren({
        sandbox,
        sandboxAgentPort: LIVE_PORT,
        turnElapsedMs: 1,
        log: vi.fn(),
      }),
    ).toEqual({ killed: 0, skipped: "no-app-server" });
  });

  it("kills nothing when the harness already cleaned up after itself", async () => {
    const { sandbox, calls } = sandboxWith(
      [
        `67965 58 120 /x/bin/sandbox-agent server --port ${LIVE_PORT}`,
        "68029 67965 116 /x/bin/codex app-server",
      ].join("\n"),
    );
    expect(
      await reapLeakedExecChildren({
        sandbox,
        sandboxAgentPort: LIVE_PORT,
        turnElapsedMs: 1,
        log: vi.fn(),
      }),
    ).toEqual({ killed: 0, skipped: "nothing-to-reap" });
    expect(calls).toHaveLength(1);
  });

  it("refuses to fire when the candidate set is implausibly large", async () => {
    const rows = [
      `67965 58 120 /x/bin/sandbox-agent server --port ${LIVE_PORT}`,
      "68029 67965 116 /x/bin/codex app-server",
    ];
    for (let i = 0; i <= MAX_REAPED; i += 1) {
      rows.push(`${70000 + i} 68029 1 worker-${i}`);
    }
    const { sandbox, calls } = sandboxWith(rows.join("\n"));
    expect(
      await reapLeakedExecChildren({
        sandbox,
        sandboxAgentPort: LIVE_PORT,
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
        sandboxAgentPort: LIVE_PORT,
        turnElapsedMs: 20_000,
        log: vi.fn(),
      }),
    ).toEqual({ killed: 0, skipped: "kill-failed" });
  });

  it("reports a non-zero kill exit instead of claiming the leak is gone", async () => {
    let seen = 0;
    const log = vi.fn();
    const sandbox = {
      runProcess: vi.fn(async () => {
        seen += 1;
        return seen === 1
          ? { stdout: LIVE_PS, exitCode: 0 }
          : { stdout: "", exitCode: 1 };
      }),
    };
    expect(
      await reapLeakedExecChildren({
        sandbox,
        sandboxAgentPort: LIVE_PORT,
        turnElapsedMs: 20_000,
        log,
      }),
    ).toEqual({ killed: 0, skipped: "kill-failed" });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("kill exited with status 1"),
    );
  });
});
