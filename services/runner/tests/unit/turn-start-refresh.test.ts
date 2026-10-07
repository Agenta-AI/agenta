/**
 * The turn-start refresh of the drive views, for every provider (round 7 of the in-process spike):
 * a harness in the runner refreshes its own views, `daytona` refreshes in its sandbox, `local` on
 * the runner, and a failure never ends the turn.
 */
import { describe, expect, it } from "vitest";
import { refreshDriveViewsAtTurnStart, REFRESH_ROOTS_SCRIPT } from "../../src/engines/sandbox_agent/turn-start-refresh.ts";

const plan = (isDaytona: boolean, harnessInRunner = false) => ({ isDaytona, harnessInRunner, workspace: { cwd: "/drive/conv" } });

describe("the drive views at the start of a turn", () => {
  it("lets a harness in the runner refresh its own views, and does nothing else", async () => {
    let started = 0;
    const logs: string[] = [];
    await refreshDriveViewsAtTurnStart({ sandbox: { startTurn: () => (started += 1) }, mountedCwd: "/drive/conv", installedMountExpiries: {} }, plan(false, true), (m) => logs.push(m));
    expect(started).toBe(1);
    expect(logs).toEqual([]);
  });

  it("refreshes the cwd and agent mounts inside a daytona sandbox with one call", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const sandbox = { runProcess: async (opts: { command: string; args: string[] }) => void calls.push(opts) };
    await refreshDriveViewsAtTurnStart({ sandbox, mountedCwd: undefined, agentMountedPath: "/drive/conv-agent", installedMountExpiries: { cwd: 1 } }, plan(true), () => {});
    expect(calls).toEqual([{ command: "python3", args: ["-c", REFRESH_ROOTS_SCRIPT, "/drive/conv", "/drive/conv-agent"], timeoutMs: 10_000 }]);
  });

  it("does nothing on daytona when no durable mount is in the sandbox", async () => {
    const calls: unknown[] = [];
    await refreshDriveViewsAtTurnStart({ sandbox: { runProcess: async (o: unknown) => void calls.push(o) }, mountedCwd: undefined, installedMountExpiries: {} }, plan(true), () => {});
    expect(calls).toEqual([]);
  });

  it("never throws: a failed or hung refresh is logged and the turn goes on", async () => {
    const logs: string[] = [];
    const sandbox = { runProcess: async () => Promise.reject(new Error("sandbox gone")) };
    await refreshDriveViewsAtTurnStart({ sandbox, mountedCwd: undefined, installedMountExpiries: { cwd: 1 } }, plan(true), (m) => logs.push(m));
    expect(logs.join("\n")).toMatch(/refresh failed.*sandbox gone/);
    await refreshDriveViewsAtTurnStart({ sandbox: {}, mountedCwd: "/definitely/not/a/mount", installedMountExpiries: {} }, plan(false), (m) => logs.push(m));
    expect(logs.at(-1)).toMatch(/drive views refreshed|refresh failed/);
  });

  it("logs a refresh whose roots all failed as failed, not as refreshed (Codex round 7 P2)", async () => {
    const logs: string[] = [];
    const sandbox = { runProcess: async () => ({ exitCode: 1, stdout: "2\n" }) };
    await refreshDriveViewsAtTurnStart({ sandbox, mountedCwd: undefined, agentMountedPath: "/a", installedMountExpiries: { cwd: 1 } }, plan(true), (m) => logs.push(m));
    expect(logs.join("\n")).toMatch(/refresh failed/);
    expect(logs.join("\n")).not.toMatch(/drive views refreshed/);
  });

  it("exits non-zero when a root could not be refreshed", async () => {
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync("python3", ["-c", REFRESH_ROOTS_SCRIPT, "/definitely/not/here"]);
    expect(r.status).toBe(1);
    expect(String(r.stdout).trim()).toBe("1");
  });
});
