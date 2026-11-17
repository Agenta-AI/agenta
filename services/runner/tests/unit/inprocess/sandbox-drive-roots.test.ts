/**
 * The command sandbox's drive with more than two roots: every signed drive of the run is one root,
 * a read drive is mounted read-only, each root gets its link in the session folder, and a changed
 * set of roots replaces the sandbox (a mount cannot be removed in place).
 */
import { describe, expect, it } from "vitest";

import type { SandboxUse } from "../../../src/engines/inprocess/sandbox/command-sandbox.ts";
import type { DaytonaSandbox } from "../../../src/engines/inprocess/sandbox/daytona-api.ts";
import {
  driveLinkBlockedMessage,
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

function fakeSandbox(commands: string[], failing?: string): DaytonaSandbox {
  return {
    id: "sbx-1",
    run: async (command: string) => {
      commands.push(command);
      return { exitCode: failing && command.includes(failing) ? 1 : 0, output: "" };
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
  { root: "/w-drive-home", credentials: () => CREDS, link: { slug: "home", home: true } },
  { root: "/w-drive-prices", credentials: () => CREDS, link: { slug: "prices" }, readOnly: true },
];

const use = (sandbox: DaytonaSandbox, boot = 1) => ({ sandbox, boot }) as unknown as SandboxUse;

describe("SandboxDrive with drives", () => {
  it("mounts every root at once, the read drive read-only, seeds the home README, and links agent-files and drives/<slug>", async () => {
    const commands: string[] = [];
    const { mounter, mounts } = fakeMounter();
    const drive = new SandboxDrive(roots(), mounter, { cwd: "/w", log: () => {} });
    await drive.ensure(use(fakeSandbox(commands)));
    expect(mounts).toEqual([
      { path: "/w", readOnly: false },
      { path: "/w-drive-home", readOnly: false },
      { path: "/w-drive-prices", readOnly: true },
    ]);
    expect(commands.some((c) => c.includes("'/w/agent-files'") && c.includes("'/w-drive-home'"))).toBe(true);
    expect(commands.some((c) => c.includes("'/w/drives/home'") && c.includes("'/w-drive-home'"))).toBe(true);
    expect(commands.some((c) => c.includes("'/w-drive-home/README.md'"))).toBe(true);
    expect(commands.some((c) => c.includes("'/w-drive-prices/README.md'"))).toBe(false);
    expect(commands.some((c) => c.includes("'/w/drives/prices'") && c.includes("'/w-drive-prices'"))).toBe(true);
    expect(drive.mountChecks.map((m) => m.root)).toEqual(["/w", "/w-drive-home", "/w-drive-prices"]);
  });

  it("cleans stale links at each mount, keeping the listed drives and agent-files for a home", async () => {
    const commands: string[] = [];
    const { mounter } = fakeMounter();
    const drive = new SandboxDrive(roots(), mounter, { cwd: "/w", drivesListed: true, log: () => {} });
    await drive.ensure(use(fakeSandbox(commands)));
    const prune = commands.find((c) => c.includes("for e in"));
    expect(prune).toContain("/w'\"'\"' 2>/dev/null || exit 0");
    expect(prune).toMatch(/'sh' '1' '1' 'home' 'prices'$/);
  });

  it("on the legacy path (a request without drives), prunes nothing under drives/", async () => {
    const commands: string[] = [];
    const { mounter } = fakeMounter();
    const drive = new SandboxDrive(roots(), mounter, { cwd: "/w", log: () => {} });
    await drive.ensure(use(fakeSandbox(commands)));
    const prune = commands.find((c) => c.includes("for e in"));
    expect(prune).toMatch(/'sh' '1' '0'$/);
  });

  it("keeps today's rule: a root that fails to mount fails the file command", async () => {
    const { mounter } = fakeMounter(new Set(["/w-drive-prices"]));
    const drive = new SandboxDrive(roots(), mounter, { cwd: "/w", log: () => {} });
    await expect(drive.ensure(use(fakeSandbox([])))).rejects.toBeInstanceOf(DriveUnreachableError);
  });

  it("skips a drives/<slug> link that a folder blocks, keeps the mount, and names it in a sentence for the agent", async () => {
    const logs: string[] = [];
    const { mounter } = fakeMounter();
    const sandbox = fakeSandbox([], "'/w/drives/prices'");
    const drive = new SandboxDrive(roots(), mounter, { cwd: "/w", log: (m) => logs.push(m) });
    await drive.ensure(use(sandbox));
    expect(drive.mountedOn("sbx-1", 1)).toBe(true);
    expect(drive.blockedLinks).toEqual(["drives/prices"]);
    expect(driveLinkBlockedMessage("drives/prices")).toBe(
      "The drive at drives/prices/ could not be attached in the command sandbox, usually because a folder of that name is already in the working directory. Files under drives/prices/ are in that folder, not on the drive. Ask the user to move or rename that folder in the session's files.",
    );
    // Tried again at the next turn, logged once while it stays blocked.
    await drive.link(sandbox);
    expect(logs.filter((l) => l.includes("drives/prices link failed")).length).toBe(1);
  });

  it("skips the agent-files link of the home drive the same way, and clears it once the link is made", async () => {
    const { mounter } = fakeMounter();
    const drive = new SandboxDrive(roots(), mounter, { cwd: "/w", log: () => {} });
    await drive.ensure(use(fakeSandbox([], "'/w/agent-files'")));
    expect(drive.blockedLinks).toEqual(["agent-files"]);
    await drive.link(fakeSandbox([]));
    expect(drive.blockedLinks).toEqual([]);
  });

  it("repairs every link, agent-files included, when asked at the start of a turn", async () => {
    const commands: string[] = [];
    const { mounter } = fakeMounter();
    const drive = new SandboxDrive(roots(), mounter, { cwd: "/w", log: () => {} });
    await drive.link(fakeSandbox(commands));
    expect(commands.filter((c) => c.includes("ln -s")).length).toBe(3);
    expect(commands.some((c) => c.includes("'/w/agent-files'"))).toBe(true);
  });

  it("refreshes only the writable roots: a read-only mount refuses the refresh attribute", () => {
    const { mounter } = fakeMounter();
    const drive = new SandboxDrive(roots(), mounter, { cwd: "/w", log: () => {} });
    expect(drive.refreshCommand).toBe(": refresh '/w' '/w-drive-home'");
    drive.setRoots(roots().slice(2));
    expect(drive.refreshCommand).toBe(": refresh ");
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
    expect(drive.rootPaths).toEqual(["/w", "/w-drive-home"]);
  });

  it("keeps each root's access and link when the credentials are detached", async () => {
    const { mounter, mounts } = fakeMounter();
    const drive = new SandboxDrive(roots(), mounter, { cwd: "/w", log: () => {} });
    drive.detachCredentials();
    await drive.ensure(use(fakeSandbox([])));
    expect(mounts.find((m) => m.path === "/w-drive-prices")?.readOnly).toBe(true);
  });
});
