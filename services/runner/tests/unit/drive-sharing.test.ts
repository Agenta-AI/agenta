/**
 * Drive sharing in the runner: which drives a run signs and mounts, how it signs them, and what the
 * model is told. The per-backend mount helpers have their own tests (`mount-lifecycle.test.ts`,
 * `sandbox-agent-mount.test.ts`, `inprocess/sandbox-drive` in the integration suite).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, vi } from "vitest";

import type { AgentRunRequest } from "../../src/protocol.ts";
import { runSandboxAgent, runTurn } from "../../src/engines/sandbox_agent.ts";
import { prepareEnvironmentSetup } from "../../src/engines/sandbox_agent/environment-setup.ts";
import { acquireEnvironment, resolveKeepaliveMount } from "../../src/engines/sandbox_agent/environment.ts";
import {
  linkProjectDrive,
  linkProjectDriveRemote,
  PROJECT_DRIVES_DIR_NAME,
  projectMountPath,
  signProjectMountCredentials,
} from "../../src/engines/sandbox_agent/project-mount.ts";
import {
  drivesListedEmpty,
  selectRunDrives,
} from "../../src/engines/sandbox_agent/run-drives.ts";
import {
  configFieldDigests,
  configFingerprint,
  installedMountLease,
} from "../../src/engines/sandbox_agent/session-identity.ts";
import { normalizeDesiredState } from "../../src/lifecycle/desired-state.ts";
import {
  fileCitationAppendix,
  noDrivesAppendix,
  platformGuidanceAppendix,
  projectDriveAppendix,
} from "../../src/engines/sandbox_agent/platform-guidance.ts";
import { refreshDriveViewsAtTurnStart } from "../../src/engines/sandbox_agent/turn-start-refresh.ts";
import { sandboxVisibleSecretValues } from "../../src/redaction.ts";
import { SESSION_DRIVE_REQUIRED_MESSAGE } from "../../src/engines/sandbox_agent/errors.ts";
import type { MountCredentials } from "../../src/engines/sandbox_agent/mount.ts";
import { fakeHarness } from "../utils/sandbox-agent-harness.ts";
import { resetRunnerConfigCache } from "../../src/config/runner-config.ts";

const SILENT = () => {};
const AUTH = { exporters: { otlp: { headers: { authorization: "ApiKey run" } } } };

function creds(tag: string): MountCredentials {
  return {
    endpoint: "http://seaweedfs:8333",
    region: "us-east-1",
    bucket: "agenta-store",
    prefix: `mounts/proj-1/${tag}`,
    accessKey: `AK-${tag}`,
    secretKey: `SK-${tag}`,
    expiresAt: "2026-12-01T00:00:00Z",
  };
}

function request(extra: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    harness: "pi_core",
    sessionId: "sess-1",
    runContext: { workflow: { artifact: { id: "artifact-1" } } },
    telemetry: AUTH,
    messages: [{ role: "user", content: "hello" }],
    ...extra,
  } as AgentRunRequest;
}

describe("selectRunDrives", () => {
  it("keeps today's rule for a request without drives", () => {
    assert.deepEqual(selectRunDrives(request()), { session: true, agent: true, projects: [] });
    assert.deepEqual(
      selectRunDrives(request({ sessionId: undefined, runContext: undefined })),
      { session: false, agent: false, projects: [] },
    );
  });

  it("mounts the agent drive only when the list names it", () => {
    assert.equal(selectRunDrives(request({ drives: [] })).agent, false);
    assert.equal(selectRunDrives(request({ drives: [{ kind: "agent" }] })).agent, true);
    assert.equal(
      selectRunDrives(request({ drives: [{ kind: "project", slug: "notes", access: "read" }] })).agent,
      false,
    );
  });

  it("reads hasSessionDrive absent as true", () => {
    assert.equal(selectRunDrives(request()).session, true);
    assert.equal(selectRunDrives(request({ hasSessionDrive: true })).session, true);
    assert.equal(selectRunDrives(request({ hasSessionDrive: false })).session, false);
  });

  it("lists each project drive once, with read-write when access is missing, and skips unsafe slugs", () => {
    const logs: string[] = [];
    const selection = selectRunDrives(
      request({
        drives: [
          { kind: "project", slug: "price-lists", access: "read" },
          { kind: "project", slug: "price-lists", access: "read-write" },
          { kind: "project", slug: "notes" } as never,
          { kind: "project", slug: "../escape", access: "read" },
          { kind: "project", slug: "..", access: "read" },
        ],
      }),
      (m) => logs.push(m),
    );
    assert.deepEqual(selection.projects, [
      { slug: "price-lists", access: "read" },
      { slug: "notes", access: "read-write" },
    ]);
    assert.equal(logs.length, 2);
  });

  it("tells an empty list from an absent one", () => {
    assert.equal(drivesListedEmpty(request({ drives: [] })), true);
    assert.equal(drivesListedEmpty(request()), false);
    assert.equal(drivesListedEmpty(request({ drives: [{ kind: "agent" }] })), false);
  });
});

describe("signProjectMountCredentials", () => {
  const SIGNED = {
    mount: { project_id: "proj-1" },
    credentials: {
      endpoint: "http://seaweedfs:8333",
      bucket: "agenta-store",
      prefix: "mounts/proj-1/m-1",
      access_key: "AK",
      secret_key: "SK",
      expires_at: "2026-12-01T00:00:00Z",
    },
  };

  it("posts the slug and access to the project sign route, bounded like the agent sign", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const signed = await signProjectMountCredentials("price lists", "read", {
      apiBase: "http://api",
      authorization: "ApiKey abc",
      fetchImpl: (async (u: string, i: RequestInit) => {
        url = u;
        init = i;
        return { ok: true, status: 200, json: async () => SIGNED } as Response;
      }) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(url, "http://api/mounts/projects/sign?slug=price%20lists&access=read");
    assert.equal(init?.method, "POST");
    assert.equal((init?.headers as Record<string, string>).authorization, "ApiKey abc");
    assert.ok(init?.signal, "the sign carries a time limit");
    assert.equal(signed?.accessKey, "AK");
    assert.equal(signed?.projectId, "proj-1");
  });

  it("answers null for a missing drive or an API without the route (404)", async () => {
    const logs: string[] = [];
    const signed = await signProjectMountCredentials("gone", "read-write", {
      apiBase: "http://api",
      authorization: "ApiKey abc",
      fetchImpl: (async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response) as unknown as typeof fetch,
      log: (m) => logs.push(m),
    });
    assert.equal(signed, null);
    assert.match(logs[0] ?? "", /sign HTTP 404 slug=gone access=read-write/);
  });

  it("answers null when the call fails", async () => {
    const signed = await signProjectMountCredentials("notes", "read", {
      apiBase: "http://api",
      authorization: "ApiKey abc",
      fetchImpl: (async () => {
        throw new Error("connection refused");
      }) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(signed, null);
  });
});

describe("project drive paths and links", () => {
  it("mounts beside the session folder and links under drives/", async () => {
    assert.equal(PROJECT_DRIVES_DIR_NAME, "drives");
    assert.equal(projectMountPath("/var/lib/agenta/run-1", "notes"), "/var/lib/agenta/run-1-project-notes");
    const cwd = join(tmpdir(), `agenta-project-link-${process.pid}-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    try {
      assert.equal(await linkProjectDrive(cwd, "notes", "/target/notes", { log: SILENT }), true);
      assert.equal(readlinkSync(join(cwd, "drives", "notes")), "/target/notes");
      // Renewed each turn: a correct link is kept, a wrong one replaced.
      assert.equal(await linkProjectDrive(cwd, "notes", "/target/other", { log: SILENT }), true);
      assert.equal(readlinkSync(join(cwd, "drives", "notes")), "/target/other");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("never replaces a folder at the link path, locally or in a sandbox, and reports the failure", async () => {
    const cwd = join(tmpdir(), `agenta-project-folder-${process.pid}-${Date.now()}`);
    mkdirSync(join(cwd, "drives", "notes"), { recursive: true });
    writeFileSync(join(cwd, "drives", "notes", "kept.md"), "mine");
    const sh: Parameters<typeof linkProjectDriveRemote>[0] = {
      runProcess: async ({ args }) => {
        try {
          execFileSync("sh", args ?? []);
          return { exitCode: 0 };
        } catch (err) {
          return { exitCode: (err as { status?: number }).status ?? 1 };
        }
      },
    };
    try {
      const logs: string[] = [];
      assert.equal(await linkProjectDrive(cwd, "notes", "/target/notes", { log: (m) => logs.push(m) }), false);
      assert.equal(await linkProjectDriveRemote(sh, cwd, "notes", "/target/notes", { log: (m) => logs.push(m) }), false);
      assert.equal(readFileSync(join(cwd, "drives", "notes", "kept.md"), "utf-8"), "mine");
      assert.equal(logs.filter((m) => m === "mount degraded kind=project_mount cause=link_failed slug=notes").length, 2);
      // The remote script makes a missing link, keeps a correct one, and replaces a wrong one.
      assert.equal(await linkProjectDriveRemote(sh, cwd, "prices", "/target/prices", { log: SILENT }), true);
      assert.equal(readlinkSync(join(cwd, "drives", "prices")), "/target/prices");
      assert.equal(await linkProjectDriveRemote(sh, cwd, "prices", "/target/prices", { log: SILENT }), true);
      assert.equal(await linkProjectDriveRemote(sh, cwd, "prices", "/target/moved", { log: SILENT }), true);
      assert.equal(readlinkSync(join(cwd, "drives", "prices")), "/target/moved");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("never replaces a file with content at the link path, and repairs the empty file geesefs leaves", async () => {
    const cwd = join(tmpdir(), `agenta-project-file-${process.pid}-${Date.now()}`);
    mkdirSync(join(cwd, "drives"), { recursive: true });
    const sh: Parameters<typeof linkProjectDriveRemote>[0] = {
      runProcess: async ({ args }) => {
        try {
          execFileSync("sh", args ?? []);
          return { exitCode: 0 };
        } catch (err) {
          return { exitCode: (err as { status?: number }).status ?? 1 };
        }
      },
    };
    try {
      writeFileSync(join(cwd, "drives", "notes"), "someone's notes");
      const logs: string[] = [];
      assert.equal(await linkProjectDrive(cwd, "notes", "/target/notes", { log: (m) => logs.push(m) }), false);
      assert.equal(await linkProjectDriveRemote(sh, cwd, "notes", "/target/notes", { log: (m) => logs.push(m) }), false);
      assert.equal(readFileSync(join(cwd, "drives", "notes"), "utf-8"), "someone's notes");
      assert.equal(logs.filter((m) => m === "mount degraded kind=project_mount cause=link_failed slug=notes").length, 2);
      writeFileSync(join(cwd, "drives", "local"), "");
      assert.equal(await linkProjectDrive(cwd, "local", "/target/local", { log: SILENT }), true);
      assert.equal(readlinkSync(join(cwd, "drives", "local")), "/target/local");
      writeFileSync(join(cwd, "drives", "remote"), "");
      assert.equal(await linkProjectDriveRemote(sh, cwd, "remote", "/target/remote", { log: SILENT }), true);
      assert.equal(readlinkSync(join(cwd, "drives", "remote")), "/target/remote");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("makes the same link in a remote sandbox", async () => {
    const commands: string[] = [];
    await linkProjectDriveRemote(
      {
        runProcess: async ({ args }) => {
          commands.push(args?.[1] ?? "");
          return { exitCode: 0 };
        },
      },
      "/home/sandbox/agenta/run-1",
      "notes",
      "/home/sandbox/agenta/run-1-project-notes",
      { log: SILENT },
    );
    assert.match(commands[0] ?? "", /mkdir -p '\/home\/sandbox\/agenta\/run-1\/drives'/);
    assert.match(commands[0] ?? "", /ln -s '\/home\/sandbox\/agenta\/run-1-project-notes' '\/home\/sandbox\/agenta\/run-1\/drives\/notes'/);
  });
});

describe("environment fingerprint", () => {
  it("changes with the drive list and the session setting, and keeps the old identity without them", () => {
    const base = request();
    const withAgent = request({ drives: [{ kind: "agent" }] });
    const withProject = request({
      drives: [{ kind: "agent" }, { kind: "project", slug: "notes", access: "read" }],
    });
    const readWrite = request({
      drives: [{ kind: "agent" }, { kind: "project", slug: "notes", access: "read-write" }],
    });
    const noSession = request({ drives: [{ kind: "agent" }], hasSessionDrive: false });
    const prints = [base, withAgent, withProject, readWrite, noSession].map(configFingerprint);
    assert.equal(new Set(prints).size, prints.length);
    assert.equal(configFingerprint(request()), configFingerprint(base));
    assert.ok(!("drives" in configFieldDigests(base)));
    assert.ok("drives" in configFieldDigests(withAgent));
    assert.notEqual(
      normalizeDesiredState(withAgent, "x").digests.sandbox,
      normalizeDesiredState(withProject, "x").digests.sandbox,
    );
  });

  it("bounds the lease by the earliest drive expiry, project drives and transcript folders included", () => {
    assert.equal(installedMountLease({ cwd: 300, agent: 200, projects: { notes: 100, other: undefined } }), 100);
    assert.equal(installedMountLease({ transcripts: 70, projects: { notes: 100 } }), 70);
    assert.equal(installedMountLease({ projects: { notes: 50 } }), 50);
    assert.equal(installedMountLease({ projects: {} }), undefined);
  });
});

describe("prepareEnvironmentSetup signs every drive at the same time", () => {
  it("sends the session, agent and project signs before the first answer", async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const signer = (name: string, value: MountCredentials | null) => async () => {
      started.push(name);
      await gate;
      return value;
    };
    const logs: string[] = [];
    const cwd = join(tmpdir(), `agenta-sign-${process.pid}-${Date.now()}`);
    const pending = prepareEnvironmentSetup(
      request({
        drives: [
          { kind: "agent" },
          { kind: "project", slug: "price-lists", access: "read" },
          { kind: "project", slug: "gone", access: "read-write" },
        ],
      }),
      {
        log: (m) => logs.push(m),
        sandboxProvider: "local",
        createLocalCwd: () => cwd,
        resolveSkillDirs: () => ({ skills: [], dropped: [], cleanup: () => {} }),
        buildDaemonEnv: () => ({ PI_ACP_PI_COMMAND: "/bin/pi" }),
        resolveDaemonBinary: () => "/bin/sandbox-agent",
        signSessionMountCredentials: signer("session", creds("session")) as never,
        signAgentMountCredentials: signer("agent", creds("agent")) as never,
        signProjectMountCredentials: (async (slug: string, access: string) => {
          started.push(`project:${slug}:${access}`);
          await gate;
          return slug === "gone" ? null : creds(slug);
        }) as never,
      },
    );
    for (let i = 0; i < 10 && started.length < 4; i++) await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(started.sort(), ["agent", "project:gone:read-write", "project:price-lists:read", "session"]);
    release();
    const setup = await pending;
    try {
      assert.equal(setup.ok, true);
      if (!setup.ok) return;
      const drives = setup.environment.drives;
      assert.deepEqual(
        drives.map((d) => (d.kind === "project" ? `${d.slug}:${d.access}:${d.credentials ? "signed" : "none"}` : d.kind)),
        ["agent", "price-lists:read:signed", "gone:read-write:none"],
      );
      assert.ok(logs.includes("mount degraded kind=project_mount cause=sign_returned_no_mount slug=gone"));
      assert.ok(!logs.some((m) => m.includes("kind=agent_mount")));
    } finally {
      if (setup.ok) setup.plan.workspace.skillsCleanup();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("signs no agent or project drive for an empty list, and no session drive when it is off", async () => {
    const signed: string[] = [];
    const cwd = join(tmpdir(), `agenta-sign-empty-${process.pid}-${Date.now()}`);
    const setup = await prepareEnvironmentSetup(request({ drives: [], hasSessionDrive: false }), {
      log: SILENT,
      sandboxProvider: "local",
      createLocalCwd: () => cwd,
      resolveSkillDirs: () => ({ skills: [], dropped: [], cleanup: () => {} }),
      buildDaemonEnv: () => ({ PI_ACP_PI_COMMAND: "/bin/pi" }),
      resolveDaemonBinary: () => "/bin/sandbox-agent",
      signSessionMountCredentials: (async () => {
        signed.push("session");
        return creds("session");
      }) as never,
      signAgentMountCredentials: (async () => {
        signed.push("agent");
        return creds("agent");
      }) as never,
    });
    try {
      assert.equal(setup.ok, true);
      if (!setup.ok) return;
      assert.deepEqual(signed, []);
      assert.equal(setup.environment.mountCreds, null);
      assert.equal(setup.environment.agentMountCreds, null);
      assert.deepEqual(setup.environment.drives, []);
    } finally {
      if (setup.ok) setup.plan.workspace.skillsCleanup();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("refuses a run without a session drive on inprocess, before signing anything", async () => {
    let signs = 0;
    const setup = await prepareEnvironmentSetup(
      request({ sandbox: "inprocess", hasSessionDrive: false, drives: [{ kind: "agent" }] }),
      {
        log: SILENT,
        signSessionMountCredentials: (async () => {
          signs += 1;
          return null;
        }) as never,
        signAgentMountCredentials: (async () => {
          signs += 1;
          return null;
        }) as never,
      },
    );
    assert.deepEqual(setup, {
      ok: false,
      error: SESSION_DRIVE_REQUIRED_MESSAGE,
      errorCode: "session_drive_required",
    });
    assert.equal(signs, 0);
  });

  it("does not sign the session drive up front when it is off", async () => {
    let signs = 0;
    const mount = await resolveKeepaliveMount(request({ hasSessionDrive: false }), {
      signSessionMountCredentials: (async () => {
        signs += 1;
        return creds("session");
      }) as never,
    });
    assert.equal(mount, null);
    assert.equal(signs, 0);
  });
});

describe("prompt guidance for drives", () => {
  it("states path, access and the shared-write rules per project drive", () => {
    const rw = projectDriveAppendix({ slug: "notes", access: "read-write", mountedPath: "/w-project-notes" }).text;
    assert.match(rw, /`drives\/notes\/`/);
    assert.match(rw, /\/w-project-notes/);
    assert.match(rw, /last write wins/);
    assert.match(rw, /Prefer adding new files/);
    assert.match(rw, /Never delete a folder you did not create/);
    const ro = projectDriveAppendix({ slug: "prices", access: "read", mountedPath: "/w-project-prices" }).text;
    assert.match(ro, /read-only for you/);
    const gone = projectDriveAppendix({ slug: "gone", access: "read", mountedPath: undefined }).text;
    assert.match(gone, /`drives\/gone\/` is not available/);
  });

  it("says no drive is attached and how long the working folder lasts", () => {
    assert.match(noDrivesAppendix(true).text, /No agent drive and no project drive/);
    assert.match(noDrivesAppendix(true).text, /persists for this session only/);
    assert.match(noDrivesAppendix(false).text, /only until this sandbox is removed/);
  });

  it("names agent-files/ in the file-citation sentence only when the agent drive is listed", () => {
    const base = { acpAgent: "codex", isPi: false, agentMountedPath: undefined, agentMountSkipped: false, toolNames: [] };
    assert.equal(fileCitationAppendix(true).text, fileCitationAppendix().text);
    assert.match(fileCitationAppendix().text, /agent-files\//);
    assert.doesNotMatch(fileCitationAppendix(false).text, /agent-files/);
    assert.match(fileCitationAppendix(false).text, /Link only files in your working directory;/);
    assert.ok(platformGuidanceAppendix(base)?.includes(fileCitationAppendix().text));
    assert.ok(platformGuidanceAppendix({ ...base, hasAgentDrive: true })?.includes(fileCitationAppendix().text));
    assert.doesNotMatch(platformGuidanceAppendix({ ...base, hasAgentDrive: false }) ?? "", /agent-files/);
  });

  it("delivers the drive paragraphs on every harness", () => {
    for (const acpAgent of ["pi", "claude", "codex"]) {
      const text = platformGuidanceAppendix({
        acpAgent,
        isPi: acpAgent === "pi",
        agentMountedPath: undefined,
        agentMountSkipped: false,
        toolNames: [],
        projectDrives: [{ slug: "notes", access: "read", mountedPath: "/x" }],
        noDrives: { sessionDurable: true },
      });
      assert.match(text ?? "", /drives\/notes\//);
    }
  });
});

describe("drive views and secrets", () => {
  it("refreshes each mounted read-write project drive at the start of a turn, never a read-only one", async () => {
    const commands: string[][] = [];
    await refreshDriveViewsAtTurnStart(
      {
        sandbox: {
          runProcess: async ({ args }: { args: string[] }) => {
            commands.push(args);
            return { exitCode: 0 };
          },
        },
        mountedCwd: undefined,
        agentMountedPath: "/w-agent",
        installedMountExpiries: { cwd: 1 },
        drives: [
          { kind: "agent", access: "read-write" },
          { kind: "project", slug: "a", access: "read-write", credentials: creds("a"), mountedPath: "/w-project-a" },
          { kind: "project", slug: "b", access: "read", credentials: null },
          { kind: "project", slug: "c", access: "read", credentials: creds("c"), mountedPath: "/w-project-c" },
        ],
      },
      { isDaytona: true, harnessInRunner: false, workspace: { cwd: "/w" } },
      SILENT,
    );
    assert.deepEqual(commands[0]?.slice(2), ["/w", "/w-agent", "/w-project-a"]);
  });

  it("redacts project drive credentials like the session and agent ones", () => {
    const values = sandboxVisibleSecretValues({
      mountCreds: null,
      drives: [{ kind: "project", credentials: { accessKey: "PAK", secretKey: "PSK", sessionToken: "PTOK" } }, { kind: "agent" }],
    });
    assert.ok(values.includes("PAK") && values.includes("PSK") && values.includes("PTOK"));
  });
});

describe("local runs with drives (engine composition)", () => {
  const signed = (tag: string) => (async () => creds(tag)) as never;

  it("mounts a listed project drive read-only, links it and tells the model", async () => {
    const cwd = join(tmpdir(), `agenta-drives-local-${process.pid}-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    const { calls, deps } = fakeHarness({ cwd });
    const mounts: Array<{ path: string; readOnly?: boolean }> = [];
    const unmounted: string[] = [];
    deps.signSessionMountCredentials = signed("session");
    deps.signAgentMountCredentials = signed("agent");
    deps.signProjectMountCredentials = signed("prices");
    deps.mountStorage = (async (path: string, _c: unknown, opts?: { geesefs?: { readOnly?: boolean } }) => {
      mounts.push({ path, readOnly: opts?.geesefs?.readOnly });
      return true;
    }) as never;
    deps.unmountStorage = (async (path: string) => {
      unmounted.push(path);
      return true;
    }) as never;
    try {
      const result = await runSandboxAgent(
        request({
          sessionId: undefined,
          drives: [{ kind: "agent" }, { kind: "project", slug: "prices", access: "read" }],
        }),
        undefined,
        undefined,
        deps,
      );
      assert.equal(result.ok, true);
      assert.deepEqual(
        mounts.find((m) => m.path === `${cwd}-project-prices`),
        { path: `${cwd}-project-prices`, readOnly: true },
      );
      assert.equal(readlinkSync(join(cwd, "drives", "prices")), `${cwd}-project-prices`);
      assert.match(calls.workspacePlan.prompt.agentsMd, /`drives\/prices\/`[^]*read-only for you/);
      assert.ok(unmounted.includes(`${cwd}-project-prices`), "teardown unmounts the project drive");
      assert.equal(existsSync(`${cwd}-project-prices`), false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(`${cwd}-agent`, { recursive: true, force: true });
      rmSync(`${cwd}-project-prices`, { recursive: true, force: true });
    }
  });

  it("tells the model a drive whose link is blocked by a folder is not available, and still unmounts it", async () => {
    const cwd = join(tmpdir(), `agenta-drives-blocked-${process.pid}-${Date.now()}`);
    mkdirSync(join(cwd, "drives", "prices"), { recursive: true });
    writeFileSync(join(cwd, "drives", "prices", "kept.md"), "mine");
    const { calls, deps, logs } = fakeHarness({ cwd });
    const unmounted: string[] = [];
    deps.signProjectMountCredentials = signed("prices");
    deps.mountStorage = (async () => true) as never;
    deps.unmountStorage = (async (path: string) => {
      unmounted.push(path);
      return true;
    }) as never;
    try {
      const result = await runSandboxAgent(
        request({ sessionId: undefined, drives: [{ kind: "project", slug: "prices", access: "read" }] }),
        undefined,
        undefined,
        deps,
      );
      assert.equal(result.ok, true);
      assert.ok(logs.includes("mount degraded kind=project_mount cause=link_failed slug=prices"));
      assert.match(calls.workspacePlan.prompt.agentsMd, /`drives\/prices\/` is not available/);
      assert.equal(readFileSync(join(cwd, "drives", "prices", "kept.md"), "utf-8"), "mine");
      assert.ok(unmounted.includes(`${cwd}-project-prices`));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(`${cwd}-project-prices`, { recursive: true, force: true });
    }
  });

  it("times project_mounts by the project mounts alone, not the whole mount group", async () => {
    const cwd = join(tmpdir(), `agenta-drives-timing-${process.pid}-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    const { deps, logs } = fakeHarness({ cwd });
    deps.signAgentMountCredentials = signed("agent");
    deps.signProjectMountCredentials = signed("notes");
    deps.mountStorage = (async (path: string) => {
      if (path === `${cwd}-agent`) await new Promise((r) => setTimeout(r, 400));
      return true;
    }) as never;
    deps.unmountStorage = (async () => true) as never;
    try {
      await runSandboxAgent(
        request({ sessionId: undefined, drives: [{ kind: "agent" }, { kind: "project", slug: "notes", access: "read" }] }),
        undefined,
        undefined,
        deps,
      );
      const ms = (stage: string) => Number(logs.find((m) => m.includes(`stage=${stage} `))?.match(/ms=(\d+)/)?.[1]);
      assert.ok(ms("local_mounts") >= 400, `local_mounts ${ms("local_mounts")}`);
      assert.ok(ms("project_mounts") < 400, `project_mounts ${ms("project_mounts")}`);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(`${cwd}-agent`, { recursive: true, force: true });
      rmSync(`${cwd}-project-notes`, { recursive: true, force: true });
    }
  });

  it("tells the model before the turn when a link was replaced by a folder since the last turn", async () => {
    const cwd = join(tmpdir(), `agenta-drives-replaced-${process.pid}-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    const { calls, deps } = fakeHarness({ cwd });
    deps.signProjectMountCredentials = signed("notes");
    deps.mountStorage = (async () => true) as never;
    deps.unmountStorage = (async () => true) as never;
    const req = request({ sessionId: undefined, drives: [{ kind: "project", slug: "notes", access: "read-write" }] });
    const acquired = await acquireEnvironment(req, deps);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    try {
      const notice = projectDriveAppendix({ slug: "notes", access: "read-write", mountedPath: undefined }).text;
      await runTurn(acquired.env, req);
      assert.ok(!JSON.stringify(calls.promptBlocks).includes("is not available"));
      rmSync(join(cwd, "drives", "notes"));
      mkdirSync(join(cwd, "drives", "notes"));
      writeFileSync(join(cwd, "drives", "notes", "kept.md"), "mine");
      await runTurn(acquired.env, req);
      assert.equal(calls.promptBlocks[0]?.text, `${notice}\n\n`);
      assert.equal(readFileSync(join(cwd, "drives", "notes", "kept.md"), "utf-8"), "mine");
    } finally {
      await acquired.env.destroy();
      rmSync(cwd, { recursive: true, force: true });
      rmSync(`${cwd}-project-notes`, { recursive: true, force: true });
    }
  });

  it("goes on without a project drive that could not be signed and says so", async () => {
    const cwd = join(tmpdir(), `agenta-drives-unsigned-${process.pid}-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    const { calls, deps, logs } = fakeHarness({ cwd });
    deps.signAgentMountCredentials = signed("agent");
    deps.signProjectMountCredentials = (async () => null) as never;
    deps.mountStorage = (async () => true) as never;
    deps.unmountStorage = (async () => true) as never;
    try {
      const result = await runSandboxAgent(
        request({ sessionId: undefined, drives: [{ kind: "project", slug: "gone", access: "read-write" }] }),
        undefined,
        undefined,
        deps,
      );
      assert.equal(result.ok, true);
      assert.ok(logs.includes("mount degraded kind=project_mount cause=sign_returned_no_mount slug=gone"));
      assert.match(calls.workspacePlan.prompt.agentsMd, /`drives\/gone\/` is not available/);
      assert.equal(existsSync(join(cwd, "drives")), false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("gives an empty list no agent drive, no agent-files link and no mount variable", async () => {
    const cwd = join(tmpdir(), `agenta-drives-empty-${process.pid}-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    const { calls, deps } = fakeHarness({ cwd });
    let agentSigns = 0;
    deps.signAgentMountCredentials = (async () => {
      agentSigns += 1;
      return creds("agent");
    }) as never;
    deps.mountStorage = (async () => true) as never;
    deps.unmountStorage = (async () => true) as never;
    try {
      const result = await runSandboxAgent(request({ sessionId: undefined, drives: [] }), undefined, undefined, deps);
      assert.equal(result.ok, true);
      assert.equal(agentSigns, 0);
      assert.equal((calls.providerArgs[1] as Record<string, string>).AGENTA_AGENT_MOUNT_DIR, undefined);
      assert.equal(existsSync(join(cwd, "agent-files")), false);
      assert.match(calls.workspacePlan.prompt.agentsMd ?? "", /No agent drive and no project drive/);
      assert.match(calls.workspacePlan.prompt.agentsMd ?? "", /only until this sandbox is removed/);
      assert.ok(calls.workspacePlan.prompt.agentsMd.includes(fileCitationAppendix(false).text));
      assert.ok(!calls.workspacePlan.prompt.agentsMd.includes(fileCitationAppendix().text));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("names agent-files/ in the citation sentence exactly when the resolved list has the agent drive", async () => {
    for (const [extra, named] of [
      [{}, true],
      [{ drives: [{ kind: "agent" }] }, true],
      [{ drives: [{ kind: "project", slug: "notes", access: "read" }] }, false],
      [{ runContext: undefined }, false],
    ] as Array<[Partial<AgentRunRequest>, boolean]>) {
      const cwd = join(tmpdir(), `agenta-drives-cite-${process.pid}-${Date.now()}`);
      mkdirSync(cwd, { recursive: true });
      const { calls, deps } = fakeHarness({ cwd });
      deps.signAgentMountCredentials = signed("agent");
      deps.signProjectMountCredentials = signed("notes");
      deps.mountStorage = (async () => true) as never;
      deps.unmountStorage = (async () => true) as never;
      try {
        await runSandboxAgent(request({ sessionId: undefined, ...extra }), undefined, undefined, deps);
        const md: string = calls.workspacePlan.prompt.agentsMd ?? "";
        assert.equal(md.includes(fileCitationAppendix(true).text), named, JSON.stringify(extra));
        assert.equal(md.includes(fileCitationAppendix(false).text), !named, JSON.stringify(extra));
      } finally {
        rmSync(cwd, { recursive: true, force: true });
        rmSync(`${cwd}-agent`, { recursive: true, force: true });
        rmSync(`${cwd}-project-notes`, { recursive: true, force: true });
      }
    }
  });

  it("keeps today's agent drive for a request without drives", async () => {
    const cwd = join(tmpdir(), `agenta-drives-legacy-${process.pid}-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    const { calls, deps } = fakeHarness({ cwd });
    deps.signAgentMountCredentials = signed("agent");
    deps.mountStorage = (async () => true) as never;
    deps.unmountStorage = (async () => true) as never;
    try {
      const result = await runSandboxAgent(request({ sessionId: undefined }), undefined, undefined, deps);
      assert.equal(result.ok, true);
      assert.equal((calls.providerArgs[1] as Record<string, string>).AGENTA_AGENT_MOUNT_DIR, `${cwd}-agent`);
      assert.doesNotMatch(calls.workspacePlan.prompt.agentsMd ?? "", /No agent drive/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(`${cwd}-agent`, { recursive: true, force: true });
    }
  });
});

describe("daytona runs with drives (engine composition)", () => {
  beforeEach(() => {
    vi.stubEnv("AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS", "local,daytona");
    vi.stubEnv("AGENTA_RUNNER_DAYTONA_API_KEY", "test-key");
    resetRunnerConfigCache();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRunnerConfigCache();
  });

  it("mounts each project drive in the group with the cwd, read drives read-only, and links after the cwd", async () => {
    const { calls, deps } = fakeHarness();
    const remote = (prefix: string): MountCredentials => ({ ...creds(prefix), endpoint: "https://s3.example.com" });
    deps.signSessionMountCredentials = (async (_s: string, _o: unknown, name?: string) => remote(name ?? "cwd")) as never;
    deps.signAgentMountCredentials = (async () => remote("agent")) as never;
    deps.signProjectMountCredentials = (async (slug: string) => remote(slug)) as never;
    deps.mountHarnessSessionDirs = (async () => {}) as never;
    const order: string[] = [];
    const readOnly: Record<string, boolean | undefined> = {};
    let releaseCwd!: () => void;
    const cwdHeld = new Promise<void>((resolve) => {
      releaseCwd = resolve;
    });
    deps.mountStorageRemote = (async (_sb: unknown, path: string, _c: unknown, opts: { geesefs?: { readOnly?: boolean } }) => {
      const kind = path.endsWith("-agent") ? "agent" : path.includes("-project-") ? path.slice(path.indexOf("-project-") + 9) : "cwd";
      readOnly[kind] = opts?.geesefs?.readOnly;
      order.push(`start:${kind}`);
      if (kind === "cwd") await cwdHeld;
      else if (order.filter((o) => o.startsWith("start:")).length === 4) releaseCwd();
      order.push(`done:${kind}`);
      return true;
    }) as never;
    const startSandboxAgent = deps.startSandboxAgent!;
    deps.startSandboxAgent = (async (opts: unknown) => {
      const sandbox = (await (startSandboxAgent as unknown as (o: unknown) => Promise<Record<string, unknown>>)(opts)) as Record<string, unknown>;
      sandbox.runProcess = async (o: { args?: string[] }) => {
        const script = o.args?.[1] ?? "";
        const m = script.match(/\/drives\/([a-z-]+)'/);
        if (m) order.push(`link:${m[1]}`);
        return { exitCode: 0 };
      };
      return sandbox;
    }) as never;

    const result = await runSandboxAgent(
      request({
        harness: "claude",
        sandbox: "daytona",
        drives: [
          { kind: "agent" },
          { kind: "project", slug: "prices", access: "read" },
          { kind: "project", slug: "notes", access: "read-write" },
        ],
      }),
      undefined,
      undefined,
      deps,
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(order.indexOf("start:prices") < order.indexOf("done:cwd"), `${order}`);
    assert.ok(order.indexOf("start:notes") < order.indexOf("done:cwd"), `${order}`);
    assert.ok(order.indexOf("link:prices") > order.indexOf("done:cwd"), `${order}`);
    assert.ok(order.indexOf("link:notes") > order.indexOf("done:cwd"), `${order}`);
    assert.equal(readOnly.prices, true);
    assert.equal(readOnly.notes, false);
    assert.equal(readOnly.agent, undefined, "the agent drive mounts as before");
    assert.match(calls.workspacePlan.prompt.agentsMd, /`drives\/notes\/`[^]*last write wins/);
  });
});

describe("daytona runs without a session drive", () => {
  beforeEach(() => {
    vi.stubEnv("AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS", "local,daytona");
    vi.stubEnv("AGENTA_RUNNER_DAYTONA_API_KEY", "test-key");
    resetRunnerConfigCache();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRunnerConfigCache();
  });

  it("keeps the harness transcript mounts but mounts no working folder", async () => {
    const { deps } = fakeHarness();
    let sessionSigns = 0;
    deps.signSessionMountCredentials = (async () => {
      sessionSigns += 1;
      return creds("cwd");
    }) as never;
    const mounted: string[] = [];
    deps.mountStorageRemote = (async (_sb: unknown, path: string) => {
      mounted.push(path);
      return true;
    }) as never;
    const transcripts: Array<{ session: string; endpoint: string | undefined | null }> = [];
    deps.mountHarnessSessionDirs = (async (_sb: unknown, session: string, dirs: unknown[], _t: unknown, opts: { endpointFor?: (c: MountCredentials) => Promise<string | undefined | null> }) => {
      assert.ok(dirs.length > 0);
      transcripts.push({ session, endpoint: await opts.endpointFor?.({ ...creds("t"), endpoint: "https://s3.example.com" }) });
      return ["2030-01-02T00:00:00Z", "2030-01-01T00:00:00Z"];
    }) as never;
    const acquired = await acquireEnvironment(
      request({ harness: "claude", sandbox: "daytona", drives: [], hasSessionDrive: false }),
      deps,
    );
    assert.equal(acquired.ok, true, JSON.stringify(acquired));
    if (!acquired.ok) return;
    assert.equal(acquired.env.installedMountExpiries.transcripts, Date.parse("2030-01-01T00:00:00Z"), "the transcripts bound the lease");
    await acquired.env.destroy();
    assert.equal(sessionSigns, 0, "the working folder is not signed");
    assert.deepEqual(mounted, []);
    assert.deepEqual(transcripts, [{ session: "sess-1", endpoint: undefined }]);
  });
});

describe("inprocess runs with drives (engine composition)", () => {
  beforeEach(() => {
    vi.stubEnv("AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS", "local,inprocess");
    vi.stubEnv("AGENTA_RUNNER_DAYTONA_API_KEY", "test-key");
    resetRunnerConfigCache();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRunnerConfigCache();
  });

  it("hands the command sandbox one root per signed drive, read drives read-only, each with its link", async () => {
    const { deps } = fakeHarness();
    deps.signSessionMountCredentials = (async () => creds("session")) as never;
    deps.signAgentMountCredentials = (async () => creds("agent")) as never;
    deps.signProjectMountCredentials = (async (slug: string) => (slug === "gone" ? null : creds(slug))) as never;
    let roots: Array<{ root: string; readOnly?: boolean; link?: unknown; credentials: () => MountCredentials | null }> = [];
    const start = deps.startSandboxAgent as unknown as (o: unknown) => Promise<Record<string, unknown>>;
    deps.inRunnerHarness = {
      start: async ({ facts }) => {
        roots = facts.roots;
        const sandbox = await start({});
        sandbox.onFirstCommand = () => {};
        sandbox.startTurn = () => {};
        return sandbox;
      },
    };
    // The run itself fails later on this host (it cannot create the sandbox's home folder); the
    // roots are handed over before that.
    await runSandboxAgent(
      request({
        sandbox: "inprocess",
        drives: [
          { kind: "agent" },
          { kind: "project", slug: "prices", access: "read" },
          { kind: "project", slug: "gone", access: "read" },
        ],
      }),
      undefined,
      undefined,
      deps,
    );
    const cwd = roots[0]!.root;
    assert.deepEqual(
      roots.map((r) => ({ root: r.root, readOnly: !!r.readOnly, link: r.link ?? null, key: r.credentials()?.accessKey })),
      [
        { root: cwd, readOnly: false, link: null, key: "AK-session" },
        { root: `${cwd}-agent`, readOnly: false, link: { kind: "agent" }, key: "AK-agent" },
        { root: `${cwd}-project-prices`, readOnly: true, link: { kind: "project", slug: "prices" }, key: "AK-prices" },
      ],
    );
  });
});
