/**
 * The command sandbox's drive with more than two roots: every signed drive of the run is one root,
 * a read drive is mounted read-only, each root gets its link in the session folder, and a changed
 * set of roots replaces the sandbox (a mount cannot be removed in place).
 */
import { describe, expect, it } from "vitest";

import type { SandboxUse } from "../../../src/engines/inprocess/sandbox/command-sandbox.ts";
import type { DaytonaSandbox } from "../../../src/engines/inprocess/sandbox/daytona-api.ts";
import {
  DriveUnreachableError,
  MountLostError,
  SandboxDrive,
  type DriveMounter,
  type DriveRoot,
} from "../../../src/engines/inprocess/sandbox/sandbox-drive.ts";
import type { MountCredentials } from "../../../src/engines/sandbox_agent/mount.ts";

const CREDS: MountCredentials = {
  region: "us-east-1",
  bucket: "b",
  prefix: "p",
  accessKey: "AK",
  secretKey: "SK",
};

function fakeSandbox(commands: string[]): DaytonaSandbox {
  return {
    id: "sbx-1",
    run: async (command: string) => {
      commands.push(command);
      return { exitCode: 0, output: "" };
    },
  } as unknown as DaytonaSandbox;
}

function fakeMounter(failing: Set<string> = new Set()) {
  const mounts: Array<{ path: string; readOnly: boolean }> = [];
  const mounter: DriveMounter = {
    mountedCheck: (path) => `test -d ${path}`,
    refreshCommand: (paths) => `: refresh ${paths.join(" ")}`,
    async mount(_sandbox, path, _creds, _signal, options) {
      mounts.push({ path, readOnly: !!options?.readOnly });
      return !failing.has(path);
    },
  };
  return { mounter, mounts };
}

const roots = (): DriveRoot[] => [
  { root: "/w", credentials: () => CREDS },
  { root: "/w-agent", credentials: () => CREDS, link: { kind: "agent" } },
  { root: "/w-project-prices", credentials: () => CREDS, link: { kind: "project", slug: "prices" }, readOnly: true },
];

const use = (sandbox: DaytonaSandbox, boot = 1) => ({ sandbox, boot }) as unknown as SandboxUse;

describe("SandboxDrive with project drives", () => {
  it("mounts every root at once, the read drive read-only, and links agent-files and drives/<slug>", async () => {
    const commands: string[] = [];
    const { mounter, mounts } = fakeMounter();
    const drive = new SandboxDrive(roots(), mounter, { cwd: "/w", log: () => {} });
    await drive.ensure(use(fakeSandbox(commands)));
    expect(mounts).toEqual([
      { path: "/w", readOnly: false },
      { path: "/w-agent", readOnly: false },
      { path: "/w-project-prices", readOnly: true },
    ]);
    expect(commands.some((c) => c.includes("'/w/agent-files'"))).toBe(true);
    expect(commands.some((c) => c.includes("'/w/drives/prices'") && c.includes("'/w-project-prices'"))).toBe(true);
    expect(drive.mountChecks.map((m) => m.root)).toEqual(["/w", "/w-agent", "/w-project-prices"]);
  });

  it("keeps today's rule: a root that fails to mount fails the file command", async () => {
    const { mounter } = fakeMounter(new Set(["/w-project-prices"]));
    const drive = new SandboxDrive(roots(), mounter, { cwd: "/w", log: () => {} });
    await expect(drive.ensure(use(fakeSandbox([])))).rejects.toBeInstanceOf(DriveUnreachableError);
  });

  it("replaces the sandbox when the run's roots change, and not when only credentials do", async () => {
    const { mounter } = fakeMounter();
    const sandbox = fakeSandbox([]);
    const drive = new SandboxDrive(roots(), mounter, { cwd: "/w", log: () => {} });
    await drive.ensure(use(sandbox));
    drive.setRoots(roots().map((r) => ({ ...r, credentials: () => ({ ...CREDS, accessKey: "AK-2" }) })));
    await drive.ensure(use(sandbox));
    drive.setRoots(roots().slice(0, 2));
    await expect(drive.ensure(use(sandbox))).rejects.toBeInstanceOf(MountLostError);
    // The next boot mounts the new set.
    await drive.ensure(use(sandbox, 2));
    expect(drive.rootPaths).toEqual(["/w", "/w-agent"]);
  });

  it("keeps each root's access and link when the credentials are detached", async () => {
    const { mounter, mounts } = fakeMounter();
    const drive = new SandboxDrive(roots(), mounter, { cwd: "/w", log: () => {} });
    drive.detachCredentials();
    await drive.ensure(use(fakeSandbox([])));
    expect(mounts.find((m) => m.path === "/w-project-prices")?.readOnly).toBe(true);
  });
});
