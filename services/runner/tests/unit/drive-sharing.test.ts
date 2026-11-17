/**
 * Drives in the runner: which drives a run signs and mounts, how it signs them, the links and the
 * README in the working folder, and what the model is told. The per-backend mount helpers have their own tests (`mount-lifecycle.test.ts`,
 * `sandbox-agent-mount.test.ts`, `inprocess/sandbox-drive` in the integration suite).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, vi } from "vitest";

import type { AgentRunRequest } from "../../src/protocol.ts";
import { runSandboxAgent, runTurn } from "../../src/engines/sandbox_agent.ts";
import { prepareEnvironmentSetup } from "../../src/engines/sandbox_agent/environment-setup.ts";
import { acquireEnvironment, resolveKeepaliveMount } from "../../src/engines/sandbox_agent/environment.ts";
import {
  DRIVES_DIR_NAME,
  driveMountPath,
  drivesListedEmpty,
  drivesReadme,
  HOME_DRIVE_LINK_NAME,
  keptLinks,
  linkRunDrive,
  linkRunDriveRemote,
  pruneDriveLinks,
  pruneDriveLinksRemote,
  runDriveMountPath,
  selectRunDrives,
  signAgentMountCredentials,
  signMountCredentialsBySlug,
  type RunDrive,
} from "../../src/engines/sandbox_agent/run-drives.ts";
import {
  configFieldDigests,
  configFingerprint,
  installedMountLease,
} from "../../src/engines/sandbox_agent/session-identity.ts";
import { normalizeDesiredState } from "../../src/lifecycle/desired-state.ts";
import {
  fileCitationAppendix,
  driveAppendix,
  noDrivesAppendix,
  platformGuidanceAppendix,
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
  it("keeps today's rule for a request without drives: the agent's drive by the artifact id", () => {
    assert.deepEqual(selectRunDrives(request()), { session: true, legacyAgentDrive: true, drives: [] });
    assert.deepEqual(
      selectRunDrives(request({ sessionId: undefined, runContext: undefined })),
      { session: false, legacyAgentDrive: false, drives: [] },
    );
  });

  it("uses no legacy route once the request lists drives, even an empty list", () => {
    assert.equal(selectRunDrives(request({ drives: [] })).legacyAgentDrive, false);
    assert.equal(
      selectRunDrives(request({ drives: [{ slug: "notes", access: "read" }] })).legacyAgentDrive,
      false,
    );
  });

  it("marks the entry homeDrive names as home, only when it is read-write", () => {
    const drives = [
      { slug: "quote-files", access: "read-write" as const },
      { slug: "prices", access: "read" as const },
    ];
    assert.deepEqual(selectRunDrives(request({ drives, homeDrive: "quote-files" })).drives, [
      { slug: "quote-files", access: "read-write", isHome: true },
      { slug: "prices", access: "read", isHome: false },
    ]);
    const logs: string[] = [];
    const readHome = selectRunDrives(request({ drives, homeDrive: "prices" }), (m) => logs.push(m));
    assert.ok(readHome.drives.every((d) => !d.isHome));
    assert.ok(logs.some((m) => m.includes("home drive skipped: slug=prices")));
    assert.ok(selectRunDrives(request({ drives, homeDrive: null })).drives.every((d) => !d.isHome));
    assert.ok(selectRunDrives(request({ drives })).drives.every((d) => !d.isHome));
  });

  it("reads hasSessionDrive absent as true", () => {
    assert.equal(selectRunDrives(request()).session, true);
    assert.equal(selectRunDrives(request({ hasSessionDrive: true })).session, true);
    assert.equal(selectRunDrives(request({ hasSessionDrive: false })).session, false);
  });

  it("lists each drive once, with read-write when access is missing, and skips unsafe slugs", () => {
    const logs: string[] = [];
    const selection = selectRunDrives(
      request({
        drives: [
          { slug: "price-lists", access: "read" },
          { slug: "price-lists", access: "read-write" },
          { slug: "notes" } as never,
          { slug: "../escape", access: "read" },
          { slug: "..", access: "read" },
        ],
      }),
      (m) => logs.push(m),
    );
    assert.deepEqual(selection.drives, [
      { slug: "price-lists", access: "read", isHome: false },
      { slug: "notes", access: "read-write", isHome: false },
    ]);
    assert.equal(logs.length, 2);
  });

  it("tells an empty list from an absent one", () => {
    assert.equal(drivesListedEmpty(request({ drives: [] })), true);
    assert.equal(drivesListedEmpty(request()), false);
    assert.equal(drivesListedEmpty(request({ drives: [{ slug: "notes", access: "read" }] })), false);
  });
});

describe("signing drives", () => {
  const SIGNED = {
    mount: { id: "m-1", project_id: "proj-1" },
    credentials: {
      endpoint: "http://seaweedfs:8333",
      bucket: "agenta-store",
      prefix: "mounts/proj-1/m-1",
      access_key: "AK",
      secret_key: "SK",
      expires_at: "2026-12-01T00:00:00Z",
    },
  };
  const capture = () => {
    const seen: { url: string; init?: RequestInit } = { url: "" };
    const fetchImpl = (async (u: string, i: RequestInit) => {
      seen.url = u;
      seen.init = i;
      return { ok: true, status: 200, json: async () => SIGNED } as Response;
    }) as unknown as typeof fetch;
    return { seen, fetchImpl };
  };

  it("posts the slug and access to POST /mounts/sign, bounded in time", async () => {
    const { seen, fetchImpl } = capture();
    const signed = await signMountCredentialsBySlug("price lists", "read", false, {
      apiBase: "http://api",
      authorization: "ApiKey abc",
      fetchImpl,
      log: SILENT,
    });
    assert.equal(seen.url, "http://api/mounts/sign?slug=price%20lists&access=read");
    assert.equal(seen.init?.method, "POST");
    assert.equal((seen.init?.headers as Record<string, string>).authorization, "ApiKey abc");
    assert.ok(seen.init?.signal, "the sign carries a time limit");
    assert.equal(signed?.accessKey, "AK");
    assert.equal(signed?.projectId, "proj-1");
    assert.equal(signed?.mountId, "m-1");
  });

  it("asks for the home rule with is_home=true on the home drive only", async () => {
    const { seen, fetchImpl } = capture();
    await signMountCredentialsBySlug("quote-files", "read-write", true, {
      apiBase: "http://api",
      authorization: "ApiKey abc",
      fetchImpl,
      log: SILENT,
    });
    assert.equal(seen.url, "http://api/mounts/sign?slug=quote-files&access=read-write&is_home=true");
  });

  it("answers null for a refused home (403), a missing drive (404) or a failed call", async () => {
    for (const status of [403, 404]) {
      const logs: string[] = [];
      const signed = await signMountCredentialsBySlug("gone", "read-write", status === 403, {
        apiBase: "http://api",
        authorization: "ApiKey abc",
        fetchImpl: (async () => ({ ok: false, status, json: async () => ({}) }) as Response) as unknown as typeof fetch,
        log: (m) => logs.push(m),
      });
      assert.equal(signed, null);
      assert.match(logs[0] ?? "", new RegExp(`sign HTTP ${status} slug=gone access=read-write`));
    }
    const signed = await signMountCredentialsBySlug("notes", "read", false, {
      apiBase: "http://api",
      authorization: "ApiKey abc",
      fetchImpl: (async () => {
        throw new Error("connection refused");
      }) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(signed, null);
  });

  it("keeps the legacy agent route for a request without drives", async () => {
    const { seen, fetchImpl } = capture();
    await signAgentMountCredentials("artifact-1", { apiBase: "http://api", authorization: "ApiKey abc", fetchImpl, log: SILENT });
    assert.equal(seen.url, "http://api/mounts/agents/sign?artifact_id=artifact-1&name=default");
    assert.equal(seen.init?.method, "POST");
  });
});

/** Runs a remote sandbox's `sh -c` script on this host. */
const sh: Parameters<typeof linkRunDriveRemote>[0] = {
  runProcess: async ({ args }) => {
    try {
      return { exitCode: 0, result: execFileSync("sh", args ?? []).toString() };
    } catch (err) {
      return { exitCode: (err as { status?: number }).status ?? 1 };
    }
  },
};

function drive(slug: string | undefined, extra: Partial<RunDrive> = {}): RunDrive {
  return {
    ...(slug ? { slug } : { artifactId: "artifact-1" }),
    access: "read-write",
    isHome: false,
    credentials: creds(slug ?? "agent"),
    ...extra,
  };
}

describe("drive paths and links", () => {
  it("mounts every drive beside the session folder at <cwd>-drive-<slug>; the legacy drive keeps <cwd>-agent", () => {
    assert.equal(DRIVES_DIR_NAME, "drives");
    assert.equal(HOME_DRIVE_LINK_NAME, "agent-files");
    assert.equal(driveMountPath("/var/lib/agenta/run-1", "notes"), "/var/lib/agenta/run-1-drive-notes");
    assert.equal(runDriveMountPath("/w", drive("notes")), "/w-drive-notes");
    assert.equal(runDriveMountPath("/w", drive(undefined, { isHome: true })), "/w-agent");
  });

  it("links a drive at drives/<slug>, the home drive also at agent-files, and the legacy drive only at agent-files", async () => {
    const cwd = join(tmpdir(), `agenta-drive-link-${process.pid}-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    try {
      assert.equal(await linkRunDrive(cwd, drive("notes"), "/t/notes", { log: SILENT }), true);
      assert.equal(readlinkSync(join(cwd, "drives", "notes")), "/t/notes");
      assert.equal(existsSync(join(cwd, "agent-files")), false);
      assert.equal(await linkRunDrive(cwd, drive("home", { isHome: true }), "/t/home", { log: SILENT }), true);
      assert.equal(readlinkSync(join(cwd, "drives", "home")), "/t/home");
      assert.equal(readlinkSync(join(cwd, "agent-files")), "/t/home");
      // Renewed each turn: a correct link is kept, a wrong one replaced.
      assert.equal(await linkRunDrive(cwd, drive(undefined, { isHome: true }), "/t/legacy", { log: SILENT }), true);
      assert.equal(readlinkSync(join(cwd, "agent-files")), "/t/legacy");
      assert.equal(await linkRunDriveRemote(sh, cwd, drive("prices"), "/t/prices", { log: SILENT }), true);
      assert.equal(readlinkSync(join(cwd, "drives", "prices")), "/t/prices");
      assert.equal(await linkRunDriveRemote(sh, cwd, drive("prices", { isHome: true }), "/t/moved", { log: SILENT }), true);
      assert.equal(readlinkSync(join(cwd, "drives", "prices")), "/t/moved");
      assert.equal(readlinkSync(join(cwd, "agent-files")), "/t/moved");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("never replaces a folder or a file with content at any link path, locally or in a sandbox", async () => {
    const cwd = join(tmpdir(), `agenta-drive-folder-${process.pid}-${Date.now()}`);
    mkdirSync(join(cwd, "drives", "notes"), { recursive: true });
    writeFileSync(join(cwd, "drives", "notes", "kept.md"), "mine");
    mkdirSync(join(cwd, "agent-files"), { recursive: true });
    writeFileSync(join(cwd, "agent-files", "memory.md"), "remember");
    writeFileSync(join(cwd, "drives", "prices"), "someone's prices");
    try {
      const logs: string[] = [];
      const log = (m: string) => logs.push(m);
      assert.equal(await linkRunDrive(cwd, drive("notes"), "/t/notes", { log }), false);
      assert.equal(await linkRunDriveRemote(sh, cwd, drive("notes"), "/t/notes", { log }), false);
      assert.equal(await linkRunDrive(cwd, drive("prices"), "/t/prices", { log }), false);
      assert.equal(await linkRunDriveRemote(sh, cwd, drive("prices"), "/t/prices", { log }), false);
      // The home link blocked by a real folder: the files stay where they are, nothing is moved.
      assert.equal(await linkRunDrive(cwd, drive(undefined, { isHome: true }), "/t/home", { log }), false);
      assert.equal(await linkRunDriveRemote(sh, cwd, drive(undefined, { isHome: true }), "/t/home", { log }), false);
      assert.equal(readFileSync(join(cwd, "drives", "notes", "kept.md"), "utf-8"), "mine");
      assert.equal(readFileSync(join(cwd, "drives", "prices"), "utf-8"), "someone's prices");
      assert.equal(readFileSync(join(cwd, "agent-files", "memory.md"), "utf-8"), "remember");
      assert.equal(logs.filter((m) => m === "mount degraded kind=drive_mount cause=link_failed slug=notes").length, 2);
      assert.equal(logs.filter((m) => m === "mount degraded kind=agent_mount cause=link_failed artifact=artifact-1").length, 2);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("repairs the empty file geesefs leaves of a link, at drives/<slug> and at agent-files", async () => {
    const cwd = join(tmpdir(), `agenta-drive-empty-${process.pid}-${Date.now()}`);
    mkdirSync(join(cwd, "drives"), { recursive: true });
    try {
      writeFileSync(join(cwd, "drives", "local"), "");
      writeFileSync(join(cwd, "agent-files"), "");
      assert.equal(await linkRunDrive(cwd, drive("local", { isHome: true }), "/t/local", { log: SILENT }), true);
      assert.equal(readlinkSync(join(cwd, "drives", "local")), "/t/local");
      assert.equal(readlinkSync(join(cwd, "agent-files")), "/t/local");
      writeFileSync(join(cwd, "drives", "remote"), "");
      rmSync(join(cwd, "agent-files"));
      writeFileSync(join(cwd, "agent-files"), "");
      assert.equal(await linkRunDriveRemote(sh, cwd, drive("remote", { isHome: true }), "/t/remote", { log: SILENT }), true);
      assert.equal(readlinkSync(join(cwd, "drives", "remote")), "/t/remote");
      assert.equal(readlinkSync(join(cwd, "agent-files")), "/t/remote");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("removes leftover links of drives no longer listed and a leftover agent-files without a home, never a folder or a file with content", async () => {
    for (const [name, prune] of [
      ["local", (cwd: string, keep: { slugs: string[]; home: boolean }, log: (m: string) => void) => pruneDriveLinks(cwd, keep, { log })],
      ["remote", (cwd: string, keep: { slugs: string[]; home: boolean }, log: (m: string) => void) => pruneDriveLinksRemote(sh, cwd, keep, { log })],
    ] as const) {
      const cwd = join(tmpdir(), `agenta-drive-prune-${name}-${process.pid}-${Date.now()}`);
      const drives = join(cwd, "drives");
      mkdirSync(join(drives, "folder"), { recursive: true });
      writeFileSync(join(drives, "folder", "kept.md"), "mine");
      writeFileSync(join(drives, "notes-file"), "someone's notes");
      writeFileSync(join(drives, "README.md"), "# Drives");
      writeFileSync(join(drives, "empty"), "");
      symlinkSync("/nowhere/old", join(drives, "dangling"));
      symlinkSync(join(drives, "folder"), join(drives, "to-folder"));
      symlinkSync("/nowhere/kept", join(drives, "kept"));
      symlinkSync("/nowhere/home", join(cwd, "agent-files"));
      const logs: string[] = [];
      try {
        await prune(cwd, { slugs: ["kept"], home: true }, (m) => logs.push(m));
        assert.deepEqual(readdirSync(drives).sort(), ["README.md", "folder", "kept", "notes-file"], name);
        assert.equal(readlinkSync(join(cwd, "agent-files")), "/nowhere/home", `${name}: a home keeps agent-files`);
        assert.deepEqual(
          logs.filter((m) => m.startsWith("removed stale")).sort(),
          ["removed stale drives/dangling", "removed stale drives/empty", "removed stale drives/to-folder"],
          name,
        );
        await prune(cwd, { slugs: ["kept"], home: false }, (m) => logs.push(m));
        assert.equal(existsSync(join(cwd, "agent-files")), false, `${name}: no home, no agent-files link`);
        assert.ok(logs.includes("removed stale agent-files"), name);
        // A real folder at agent-files is someone's files: never removed.
        mkdirSync(join(cwd, "agent-files"));
        writeFileSync(join(cwd, "agent-files", "memory.md"), "remember");
        await prune(cwd, { slugs: [], home: false }, SILENT);
        assert.equal(readFileSync(join(cwd, "agent-files", "memory.md"), "utf-8"), "remember", name);
        assert.equal(readFileSync(join(drives, "README.md"), "utf-8"), "# Drives", name);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    }
    // No drives/ folder at all: nothing to do, no error.
    await pruneDriveLinks(join(tmpdir(), `agenta-no-such-${process.pid}`), { slugs: [], home: false }, { log: SILENT });
  });

  it("keeps every listed slug, and agent-files only for a signed home", () => {
    assert.deepEqual(keptLinks([drive("a", { isHome: true }), drive("b", { credentials: null })]), { slugs: ["a", "b"], home: true });
    assert.deepEqual(keptLinks([drive("a", { isHome: true, credentials: null })]), { slugs: ["a"], home: false });
    assert.deepEqual(keptLinks([drive(undefined, { isHome: true })]), { slugs: [], home: true });
  });
});

describe("drives/README.md", () => {
  it("lists the mounted drives with their access and the home note, in the design's words", () => {
    const text = drivesReadme([
      drive("quote-agent-files", { isHome: true, mountedPath: "/w-drive-quote-agent-files", linked: true }),
      drive("price-lists", { access: "read", mountedPath: "/w-drive-price-lists", linked: true }),
      drive("gone", { credentials: null }),
      drive("blocked", { mountedPath: "/w-drive-blocked", linked: false }),
    ]);
    assert.equal(
      text,
      `# Drives

Each folder here is a drive: a folder of files that Agenta keeps after this
conversation ends. This list comes from the agent's configuration.

| Folder | Access | Note |
| --- | --- | --- |
| drives/quote-agent-files/ | read and write | Home drive. Also at agent-files/. |
| drives/price-lists/ | read only |  |

Other agents with access to a drive may also write files in it. If two
agents write the same file, the last write wins.

Agenta writes this file again at the start of every conversation. Changes to
it are not kept.
`,
    );
  });

  it("says no drive is attached when none is mounted", () => {
    const text = drivesReadme([drive("gone", { credentials: null })]);
    assert.match(text, /\n\nNo drives are attached to this agent\.\n\n/);
    assert.doesNotMatch(text, /\| Folder/);
  });
});

describe("environment fingerprint", () => {
  it("changes with the drive list, the home drive and the session setting, and keeps the old identity without them", () => {
    const base = request();
    const one = request({ drives: [{ slug: "notes", access: "read-write" }] });
    const home = request({ drives: [{ slug: "notes", access: "read-write" }], homeDrive: "notes" });
    const readOnly = request({ drives: [{ slug: "notes", access: "read" }] });
    const noSession = request({ drives: [{ slug: "notes", access: "read-write" }], hasSessionDrive: false });
    const prints = [base, one, home, readOnly, noSession].map(configFingerprint);
    assert.equal(new Set(prints).size, prints.length);
    assert.equal(configFingerprint(request()), configFingerprint(base));
    assert.ok(!("drives" in configFieldDigests(base)));
    assert.ok("drives" in configFieldDigests(one));
    assert.notEqual(
      normalizeDesiredState(one, "x").digests.sandbox,
      normalizeDesiredState(home, "x").digests.sandbox,
    );
  });

  it("bounds the lease by the earliest drive expiry, transcript folders included", () => {
    assert.equal(installedMountLease({ cwd: 300, drives: { "/w-drive-a": 100, "/w-drive-b": undefined } }), 100);
    assert.equal(installedMountLease({ transcripts: 70, drives: { "/w-agent": 100 } }), 70);
    assert.equal(installedMountLease({ drives: { "/w-drive-a": 50 } }), 50);
    assert.equal(installedMountLease({ drives: {} }), undefined);
  });
});

describe("prepareEnvironmentSetup signs every drive at the same time", () => {
  const setupDeps = (cwd: string, logs: string[]) => ({
    log: (m: string) => logs.push(m),
    sandboxProvider: "local" as const,
    createLocalCwd: () => cwd,
    resolveSkillDirs: () => ({ skills: [], dropped: [], cleanup: () => {} }),
    buildDaemonEnv: () => ({ PI_ACP_PI_COMMAND: "/bin/pi" }),
    resolveDaemonBinary: () => "/bin/sandbox-agent",
  });

  it("sends the session sign and one sign per drive, the home with is_home, before the first answer", async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const logs: string[] = [];
    const cwd = join(tmpdir(), `agenta-sign-${process.pid}-${Date.now()}`);
    let agentSigns = 0;
    const pending = prepareEnvironmentSetup(
      request({
        drives: [
          { slug: "quote-files", access: "read-write" },
          { slug: "price-lists", access: "read" },
          { slug: "gone", access: "read-write" },
        ],
        homeDrive: "quote-files",
      }),
      {
        ...setupDeps(cwd, logs),
        signSessionMountCredentials: (async () => {
          started.push("session");
          await gate;
          return creds("session");
        }) as never,
        signAgentMountCredentials: (async () => {
          agentSigns += 1;
          return creds("agent");
        }) as never,
        signMountCredentialsBySlug: (async (slug: string, access: string, isHome: boolean) => {
          started.push(`${slug}:${access}${isHome ? ":home" : ""}`);
          await gate;
          return slug === "gone" ? null : creds(slug);
        }) as never,
      },
    );
    for (let i = 0; i < 10 && started.length < 4; i++) await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(started.sort(), ["gone:read-write", "price-lists:read", "quote-files:read-write:home", "session"]);
    release();
    const setup = await pending;
    try {
      assert.equal(setup.ok, true);
      if (!setup.ok) return;
      assert.equal(agentSigns, 0, "no legacy sign once the request lists drives");
      assert.deepEqual(
        setup.environment.drives.map((d) => `${d.slug}:${d.access}:${d.isHome ? "home" : "-"}:${d.credentials ? "signed" : "none"}`),
        ["quote-files:read-write:home:signed", "price-lists:read:-:signed", "gone:read-write:-:none"],
      );
      assert.ok(logs.includes("mount degraded kind=drive_mount cause=sign_returned_no_mount slug=gone"));
      assert.ok(!logs.some((m) => m.includes("kind=agent_mount")));
    } finally {
      if (setup.ok) setup.plan.workspace.skillsCleanup();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("signs the legacy agent route for a request without drives, and logs it as the agent mount", async () => {
    const logs: string[] = [];
    const cwd = join(tmpdir(), `agenta-sign-legacy-${process.pid}-${Date.now()}`);
    let bySlug = 0;
    const setup = await prepareEnvironmentSetup(request(), {
      ...setupDeps(cwd, logs),
      signSessionMountCredentials: (async () => creds("session")) as never,
      signAgentMountCredentials: (async () => null) as never,
      signMountCredentialsBySlug: (async () => {
        bySlug += 1;
        return null;
      }) as never,
    });
    try {
      assert.equal(setup.ok, true);
      if (!setup.ok) return;
      assert.equal(bySlug, 0);
      assert.deepEqual(setup.environment.drives, [
        { artifactId: "artifact-1", access: "read-write", isHome: true, credentials: null },
      ]);
      assert.ok(logs.includes("mount degraded kind=agent_mount cause=sign_returned_no_mount artifact=artifact-1"));
    } finally {
      if (setup.ok) setup.plan.workspace.skillsCleanup();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("signs no drive for an empty list, and no session drive when it is off", async () => {
    const signed: string[] = [];
    const cwd = join(tmpdir(), `agenta-sign-empty-${process.pid}-${Date.now()}`);
    const setup = await prepareEnvironmentSetup(request({ drives: [], hasSessionDrive: false }), {
      ...setupDeps(cwd, []),
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
      assert.deepEqual(setup.environment.drives, []);
    } finally {
      if (setup.ok) setup.plan.workspace.skillsCleanup();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("refuses a run without a session drive on inprocess, before signing anything", async () => {
    let signs = 0;
    const setup = await prepareEnvironmentSetup(
      request({ sandbox: "inprocess", hasSessionDrive: false, drives: [{ slug: "notes", access: "read" }] }),
      {
        log: SILENT,
        signSessionMountCredentials: (async () => {
          signs += 1;
          return null;
        }) as never,
        signMountCredentialsBySlug: (async () => {
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
    assert.equal(
      SESSION_DRIVE_REQUIRED_MESSAGE,
      "The inprocess sandbox needs the session drive, and this agent has it turned off. Turn the session drive on, or run the agent on the 'local' sandbox.",
    );
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
  it("states path, access and the write rule per drive, in the design's words, and never calls a drive shared", () => {
    const rw = driveAppendix({ slug: "notes", access: "read-write", mountedPath: "/w-drive-notes" }).text;
    assert.equal(
      rw,
      "`drives/notes/` is a drive you can read and write. It is a drive in your working directory, at the absolute path `/w-drive-notes`. " +
        "Other agents with access to this drive may also write files here. If two agents write the same file, the last write wins. " +
        "Prefer adding new files to editing existing ones. Never delete a folder you did not create.",
    );
    const ro = driveAppendix({ slug: "prices", access: "read", mountedPath: "/w-drive-prices" }).text;
    assert.equal(ro, "`drives/prices/` is read-only for you. It is a drive in your working directory, at the absolute path `/w-drive-prices`.");
    const gone = driveAppendix({ slug: "gone", access: "read", mountedPath: undefined }).text;
    assert.equal(gone, "`drives/gone/` is not available in this conversation.");
    for (const text of [rw, ro, gone]) assert.doesNotMatch(text, /shared/);
  });

  it("says no drive is attached and how long the working folder lasts", () => {
    assert.match(noDrivesAppendix(true).text, /^No drives are attached to you, so you have no `agent-files\/` folder\./);
    assert.match(noDrivesAppendix(true).text, /persists for this session only/);
    assert.match(noDrivesAppendix(false).text, /only until this sandbox is removed/);
  });

  it("names agent-files/ in the file-citation sentence only when the run has a home drive", () => {
    const base = { acpAgent: "codex", isPi: false, homeDrive: undefined, toolNames: [] };
    assert.equal(fileCitationAppendix(true).text, fileCitationAppendix().text);
    assert.match(fileCitationAppendix().text, /agent-files\//);
    assert.doesNotMatch(fileCitationAppendix(false).text, /agent-files/);
    assert.match(fileCitationAppendix(false).text, /Link only files in your working directory;/);
    assert.doesNotMatch(platformGuidanceAppendix(base) ?? "", /agent-files/);
    assert.ok(platformGuidanceAppendix({ ...base, homeDrive: { path: "/w-drive-h" } })?.includes(fileCitationAppendix().text));
    assert.ok(platformGuidanceAppendix({ ...base, homeDrive: "unavailable" })?.includes(fileCitationAppendix().text));
  });

  it("delivers the drive paragraphs on every harness", () => {
    for (const acpAgent of ["pi", "claude", "codex"]) {
      const text = platformGuidanceAppendix({
        acpAgent,
        isPi: acpAgent === "pi",
        homeDrive: undefined,
        toolNames: [],
        drives: [{ slug: "notes", access: "read", mountedPath: "/x" }],
        noDrives: { sessionDurable: true },
      });
      assert.match(text ?? "", /drives\/notes\//);
    }
  });
});

describe("drive views and secrets", () => {
  it("refreshes each mounted read-write drive at the start of a turn, never a read-only one", async () => {
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
        installedMountExpiries: { cwd: 1 },
        drives: [
          drive("h", { isHome: true, mountedPath: "/w-drive-h" }),
          drive("a", { mountedPath: "/w-drive-a" }),
          drive("b", { access: "read", credentials: null }),
          drive("c", { access: "read", mountedPath: "/w-drive-c" }),
        ],
      },
      { isDaytona: true, harnessInRunner: false, workspace: { cwd: "/w" } },
      SILENT,
    );
    assert.deepEqual(commands[0]?.slice(2), ["/w", "/w-drive-h", "/w-drive-a"]);
  });

  it("redacts every drive's credentials like the session ones", () => {
    const values = sandboxVisibleSecretValues({
      mountCreds: null,
      drives: [{ credentials: { accessKey: "PAK", secretKey: "PSK", sessionToken: "PTOK" } }, { credentials: null }],
    });
    assert.ok(values.includes("PAK") && values.includes("PSK") && values.includes("PTOK"));
  });
});

describe("local runs with drives (engine composition)", () => {
  const signed = (tag: string) => (async () => creds(tag)) as never;
  const bySlug = (refuse: string[] = []) =>
    (async (slug: string) => (refuse.includes(slug) ? null : creds(slug))) as never;
  const cleanup = (cwd: string, slugs: string[]) => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(`${cwd}-agent`, { recursive: true, force: true });
    for (const slug of slugs) rmSync(`${cwd}-drive-${slug}`, { recursive: true, force: true });
  };

  it("mounts every drive at <cwd>-drive-<slug>, the read one read-only, links them, the home also at agent-files, and writes the README", async () => {
    const cwd = join(tmpdir(), `agenta-drives-local-${process.pid}-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    const { calls, deps } = fakeHarness({ cwd });
    const mounts: Array<{ path: string; readOnly?: boolean }> = [];
    const unmounted: string[] = [];
    let agentSigns = 0;
    deps.signAgentMountCredentials = (async () => {
      agentSigns += 1;
      return creds("agent");
    }) as never;
    deps.signMountCredentialsBySlug = bySlug();
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
          harness: "claude",
          drives: [
            { slug: "home", access: "read-write" },
            { slug: "prices", access: "read" },
          ],
          homeDrive: "home",
        }),
        undefined,
        undefined,
        deps,
      );
      assert.equal(result.ok, true);
      assert.equal(agentSigns, 0);
      assert.deepEqual(mounts.sort((a, b) => a.path.localeCompare(b.path)), [
        { path: `${cwd}-drive-home`, readOnly: false },
        { path: `${cwd}-drive-prices`, readOnly: true },
      ]);
      assert.equal(readlinkSync(join(cwd, "drives", "prices")), `${cwd}-drive-prices`);
      assert.equal(readlinkSync(join(cwd, "drives", "home")), `${cwd}-drive-home`);
      assert.equal(readlinkSync(join(cwd, "agent-files")), `${cwd}-drive-home`);
      const readme = readFileSync(join(cwd, "drives", "README.md"), "utf-8");
      assert.match(readme, /\| drives\/home\/ \| read and write \| Home drive\. Also at agent-files\/\. \|/);
      assert.match(readme, /\| drives\/prices\/ \| read only \|/);
      assert.equal(readFileSync(join(`${cwd}-drive-home`, "README.md"), "utf-8").startsWith("This folder belongs to your agent."), true);
      assert.equal(existsSync(join(`${cwd}-drive-prices`, "README.md")), false, "only the home drive gets the README seed");
      assert.match(calls.workspacePlan.prompt.agentsMd, /`drives\/prices\/` is read-only for you/);
      assert.match(calls.createSessionOptions.sessionInit._meta.systemPrompt.append, new RegExp(`${cwd}-drive-home`));
      assert.equal((calls.providerArgs[1] as Record<string, string>).AGENTA_AGENT_MOUNT_DIR, undefined);
      assert.ok(unmounted.includes(`${cwd}-drive-prices`) && unmounted.includes(`${cwd}-drive-home`), "teardown unmounts every drive");
      assert.equal(existsSync(`${cwd}-drive-prices`), false);
    } finally {
      cleanup(cwd, ["home", "prices"]);
    }
  });

  it("runs without a home when the home sign is refused: no agent-files, no tool restore, and the agent is told", async () => {
    const cwd = join(tmpdir(), `agenta-drives-nohome-${process.pid}-${Date.now()}`);
    mkdirSync(join(cwd, "drives"), { recursive: true });
    symlinkSync(`${cwd}-drive-home`, join(cwd, "agent-files"));
    const { calls, deps, logs } = fakeHarness({ cwd });
    deps.signSessionMountCredentials = signed("session");
    deps.signMountCredentialsBySlug = bySlug(["home"]);
    deps.mountStorage = (async () => true) as never;
    deps.unmountStorage = (async () => true) as never;
    deps.createLocalCwd = () => cwd;
    try {
      const result = await runSandboxAgent(
        request({ drives: [{ slug: "home", access: "read-write" }], homeDrive: "home" }),
        undefined,
        undefined,
        deps,
      );
      assert.equal(result.ok, true);
      assert.ok(logs.includes("mount degraded kind=drive_mount cause=sign_returned_no_mount slug=home"));
      assert.equal(existsSync(join(cwd, "agent-files")), false, "the leftover agent-files link is removed");
      assert.ok(logs.includes("removed stale agent-files"));
      assert.ok(!logs.some((m) => m.includes("stage=agent_tools_setup")), "no tool restore");
      assert.match(calls.workspacePlan.prompt.appendSystemPrompt ?? "", /durable agent folder is not available/);
      assert.match(calls.workspacePlan.prompt.agentsMd, /`drives\/home\/` is not available in this conversation\./);
      assert.match(readFileSync(join(cwd, "drives", "README.md"), "utf-8"), /No drives are attached to this agent\./);
    } finally {
      cleanup(cwd, ["home"]);
    }
  });

  it("tells the agent the home drive is not available when a real folder holds agent-files, and moves nothing", async () => {
    const cwd = join(tmpdir(), `agenta-drives-homefolder-${process.pid}-${Date.now()}`);
    mkdirSync(join(cwd, "agent-files"), { recursive: true });
    writeFileSync(join(cwd, "agent-files", "memory.md"), "remember");
    const { calls, deps, logs } = fakeHarness({ cwd });
    deps.signMountCredentialsBySlug = bySlug();
    deps.mountStorage = (async () => true) as never;
    deps.unmountStorage = (async () => true) as never;
    try {
      const result = await runSandboxAgent(
        request({ sessionId: undefined, drives: [{ slug: "home", access: "read-write" }], homeDrive: "home" }),
        undefined,
        undefined,
        deps,
      );
      assert.equal(result.ok, true);
      assert.ok(logs.includes("mount degraded kind=drive_mount cause=link_failed slug=home"));
      assert.equal(readFileSync(join(cwd, "agent-files", "memory.md"), "utf-8"), "remember");
      assert.equal(existsSync(join(`${cwd}-drive-home`, "memory.md")), false);
      assert.match(calls.workspacePlan.prompt.appendSystemPrompt ?? "", /durable agent folder is not available/);
      assert.ok(!logs.some((m) => m.includes("stage=agent_tools_setup")), "no tool restore without the home");
    } finally {
      cleanup(cwd, ["home"]);
    }
  });

  it("tells the model a drive whose link is blocked by a folder is not available, and still unmounts it", async () => {
    const cwd = join(tmpdir(), `agenta-drives-blocked-${process.pid}-${Date.now()}`);
    mkdirSync(join(cwd, "drives", "prices"), { recursive: true });
    writeFileSync(join(cwd, "drives", "prices", "kept.md"), "mine");
    const { calls, deps, logs } = fakeHarness({ cwd });
    const unmounted: string[] = [];
    deps.signMountCredentialsBySlug = bySlug();
    deps.mountStorage = (async () => true) as never;
    deps.unmountStorage = (async (path: string) => {
      unmounted.push(path);
      return true;
    }) as never;
    try {
      const result = await runSandboxAgent(
        request({ sessionId: undefined, drives: [{ slug: "prices", access: "read" }] }),
        undefined,
        undefined,
        deps,
      );
      assert.equal(result.ok, true);
      assert.ok(logs.includes("mount degraded kind=drive_mount cause=link_failed slug=prices"));
      assert.match(calls.workspacePlan.prompt.agentsMd, /`drives\/prices\/` is not available/);
      assert.equal(readFileSync(join(cwd, "drives", "prices", "kept.md"), "utf-8"), "mine");
      assert.doesNotMatch(readFileSync(join(cwd, "drives", "README.md"), "utf-8"), /drives\/prices\//);
      assert.ok(unmounted.includes(`${cwd}-drive-prices`));
    } finally {
      cleanup(cwd, ["prices"]);
    }
  });

  it("logs one drive_mounts stage for every drive, and no per-kind stages", async () => {
    const cwd = join(tmpdir(), `agenta-drives-timing-${process.pid}-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    const { deps, logs } = fakeHarness({ cwd });
    deps.signMountCredentialsBySlug = bySlug();
    deps.mountStorage = (async () => true) as never;
    deps.unmountStorage = (async () => true) as never;
    try {
      await runSandboxAgent(
        request({ sessionId: undefined, drives: [{ slug: "notes", access: "read" }, { slug: "home", access: "read-write" }], homeDrive: "home" }),
        undefined,
        undefined,
        deps,
      );
      assert.equal(logs.filter((m) => m.includes("stage=drive_mounts ")).length, 1);
      assert.ok(!logs.some((m) => /stage=(project_mounts|agent_mount) /.test(m)));
    } finally {
      cleanup(cwd, ["notes", "home"]);
    }
  });

  it("repairs every link each turn and tells the model when a drive or the home is lost or back", async () => {
    const cwd = join(tmpdir(), `agenta-drives-replaced-${process.pid}-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    const { calls, deps } = fakeHarness({ cwd });
    deps.signMountCredentialsBySlug = bySlug();
    deps.mountStorage = (async () => true) as never;
    deps.unmountStorage = (async () => true) as never;
    const req = request({
      sessionId: undefined,
      drives: [
        { slug: "notes", access: "read-write" },
        { slug: "home", access: "read-write" },
      ],
      homeDrive: "home",
    });
    const acquired = await acquireEnvironment(req, deps);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    try {
      const notice = driveAppendix({ slug: "notes", access: "read-write", mountedPath: undefined }).text;
      await runTurn(acquired.env, req);
      assert.ok(!JSON.stringify(calls.promptBlocks).includes("is not available"));
      rmSync(join(cwd, "drives", "notes"));
      mkdirSync(join(cwd, "drives", "notes"));
      writeFileSync(join(cwd, "drives", "notes", "kept.md"), "mine");
      await runTurn(acquired.env, req);
      assert.equal(calls.promptBlocks[0]?.text, `${notice}\n\n`);
      assert.equal(readFileSync(join(cwd, "drives", "notes", "kept.md"), "utf-8"), "mine");
      // The person moves the folder away: the next turn repairs the link and says so.
      rmSync(join(cwd, "drives", "notes"), { recursive: true, force: true });
      await runTurn(acquired.env, req);
      const back = driveAppendix({ slug: "notes", access: "read-write", mountedPath: `${cwd}-drive-notes` }).text;
      assert.equal(calls.promptBlocks[0]?.text, `${back}\n\n`);
      await runTurn(acquired.env, req);
      assert.ok(!JSON.stringify(calls.promptBlocks).includes("drives/notes/"), "said once");
      // A lost agent-files link (geesefs leaves an empty file) is repaired silently.
      rmSync(join(cwd, "agent-files"));
      writeFileSync(join(cwd, "agent-files"), "");
      await runTurn(acquired.env, req);
      assert.equal(readlinkSync(join(cwd, "agent-files")), `${cwd}-drive-home`);
      assert.ok(!JSON.stringify(calls.promptBlocks).includes("not available"));
      // A folder at agent-files: the home is not available, and the model is told this turn.
      rmSync(join(cwd, "agent-files"));
      mkdirSync(join(cwd, "agent-files"));
      writeFileSync(join(cwd, "agent-files", "memory.md"), "remember");
      await runTurn(acquired.env, req);
      assert.ok(JSON.stringify(calls.promptBlocks).includes("durable agent folder is not available"));
      assert.equal(readFileSync(join(cwd, "agent-files", "memory.md"), "utf-8"), "remember");
    } finally {
      await acquired.env.destroy();
      cleanup(cwd, ["notes", "home"]);
    }
  });

  it("removes the stale link of a drive the list dropped at setup, and keeps the listed one", async () => {
    const cwd = join(tmpdir(), `agenta-drives-stale-${process.pid}-${Date.now()}`);
    mkdirSync(join(cwd, "drives"), { recursive: true });
    symlinkSync(`${cwd}-drive-old`, join(cwd, "drives", "old"));
    const { deps, logs } = fakeHarness({ cwd });
    deps.signSessionMountCredentials = signed("session");
    deps.signMountCredentialsBySlug = bySlug();
    deps.mountStorage = (async () => true) as never;
    deps.unmountStorage = (async () => true) as never;
    deps.createLocalCwd = () => cwd;
    try {
      const result = await runSandboxAgent(
        request({ drives: [{ slug: "notes", access: "read" }] }),
        undefined,
        undefined,
        deps,
      );
      assert.equal(result.ok, true);
      assert.deepEqual(readdirSync(join(cwd, "drives")).sort(), ["README.md", "notes"]);
      assert.ok(logs.includes("removed stale drives/old"));
    } finally {
      cleanup(cwd, ["notes"]);
    }
  });

  it("gives an empty list no drive, no agent-files link and no mount variable", async () => {
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
      assert.match(calls.workspacePlan.prompt.agentsMd ?? "", /No drives are attached to you/);
      assert.match(calls.workspacePlan.prompt.agentsMd ?? "", /only until this sandbox is removed/);
      assert.ok(calls.workspacePlan.prompt.agentsMd.includes(fileCitationAppendix(false).text));
      assert.ok(!calls.workspacePlan.prompt.agentsMd.includes(fileCitationAppendix().text));
      assert.match(readFileSync(join(cwd, "drives", "README.md"), "utf-8"), /No drives are attached to this agent\./);
    } finally {
      cleanup(cwd, []);
    }
  });

  it("names agent-files/ in the citation sentence exactly when the run has a home drive", async () => {
    for (const [extra, named] of [
      [{}, true],
      [{ drives: [{ slug: "notes", access: "read-write" }], homeDrive: "notes" }, true],
      [{ drives: [{ slug: "notes", access: "read" }] }, false],
      [{ runContext: undefined }, false],
    ] as Array<[Partial<AgentRunRequest>, boolean]>) {
      const cwd = join(tmpdir(), `agenta-drives-cite-${process.pid}-${Date.now()}`);
      mkdirSync(cwd, { recursive: true });
      const { calls, deps } = fakeHarness({ cwd });
      deps.signAgentMountCredentials = signed("agent");
      deps.signMountCredentialsBySlug = bySlug();
      deps.mountStorage = (async () => true) as never;
      deps.unmountStorage = (async () => true) as never;
      try {
        await runSandboxAgent(request({ sessionId: undefined, ...extra }), undefined, undefined, deps);
        const md: string = calls.workspacePlan.prompt.agentsMd ?? "";
        assert.equal(md.includes(fileCitationAppendix(true).text), named, JSON.stringify(extra));
        assert.equal(md.includes(fileCitationAppendix(false).text), !named, JSON.stringify(extra));
      } finally {
        cleanup(cwd, ["notes"]);
      }
    }
  });

  it("keeps today's agent drive for a request without drives: legacy route, <cwd>-agent, agent-files only, no README", async () => {
    const cwd = join(tmpdir(), `agenta-drives-legacy-${process.pid}-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    const { calls, deps } = fakeHarness({ cwd });
    let bySlugSigns = 0;
    deps.signAgentMountCredentials = signed("agent");
    deps.signMountCredentialsBySlug = (async () => {
      bySlugSigns += 1;
      return null;
    }) as never;
    deps.mountStorage = (async () => true) as never;
    deps.unmountStorage = (async () => true) as never;
    try {
      const result = await runSandboxAgent(request({ sessionId: undefined }), undefined, undefined, deps);
      assert.equal(result.ok, true);
      assert.equal(bySlugSigns, 0);
      assert.equal(readlinkSync(join(cwd, "agent-files")), `${cwd}-agent`);
      assert.equal(existsSync(join(cwd, "drives")), false);
      assert.equal((calls.providerArgs[1] as Record<string, string>).AGENTA_AGENT_MOUNT_DIR, undefined);
      assert.match(calls.workspacePlan.prompt.appendSystemPrompt ?? "", new RegExp(`${cwd}-agent`));
      assert.doesNotMatch(calls.workspacePlan.prompt.agentsMd ?? "", /No drives are attached/);
    } finally {
      cleanup(cwd, []);
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

  it("mounts each drive in the group with the cwd, read drives read-only, and links after the cwd, agent-files included", async () => {
    const { calls, deps } = fakeHarness();
    const remote = (prefix: string): MountCredentials => ({ ...creds(prefix), endpoint: "https://s3.example.com" });
    deps.signSessionMountCredentials = (async (_s: string, _o: unknown, name?: string) => remote(name ?? "cwd")) as never;
    deps.signMountCredentialsBySlug = (async (slug: string) => remote(slug)) as never;
    deps.mountHarnessSessionDirs = (async () => {}) as never;
    const order: string[] = [];
    const readOnly: Record<string, boolean | undefined> = {};
    let releaseCwd!: () => void;
    const cwdHeld = new Promise<void>((resolve) => {
      releaseCwd = resolve;
    });
    deps.mountStorageRemote = (async (_sb: unknown, path: string, _c: unknown, opts: { geesefs?: { readOnly?: boolean } }) => {
      const kind = path.includes("-drive-") ? path.slice(path.indexOf("-drive-") + 7) : "cwd";
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
        const m = script.match(/ln -s '[^']*' '[^']*\/(drives\/[a-z-]+|agent-files)'/);
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
          { slug: "home", access: "read-write" },
          { slug: "prices", access: "read" },
          { slug: "notes", access: "read-write" },
        ],
        homeDrive: "home",
      }),
      undefined,
      undefined,
      deps,
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(order.indexOf("start:prices") < order.indexOf("done:cwd"), `${order}`);
    assert.ok(order.indexOf("start:notes") < order.indexOf("done:cwd"), `${order}`);
    for (const link of ["link:drives/prices", "link:drives/notes", "link:drives/home", "link:agent-files"]) {
      assert.ok(order.indexOf(link) > order.indexOf("done:cwd"), `${link}: ${order}`);
    }
    assert.equal(readOnly.prices, true);
    assert.equal(readOnly.notes, false);
    assert.equal(readOnly.home, false);
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
    deps.signMountCredentialsBySlug = (async (slug: string) => (slug === "gone" ? null : creds(slug))) as never;
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
          { slug: "home", access: "read-write" },
          { slug: "prices", access: "read" },
          { slug: "gone", access: "read" },
        ],
        homeDrive: "home",
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
        { root: `${cwd}-drive-home`, readOnly: false, link: { slug: "home", home: true }, key: "AK-home" },
        { root: `${cwd}-drive-prices`, readOnly: true, link: { slug: "prices", home: false }, key: "AK-prices" },
      ],
    );
  });
});
