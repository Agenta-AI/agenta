/**
 * Per-session mount isolation: the runner's DECISION, and the ENOTCONN consequence of it.
 *
 * ============================================================================================
 * WHAT THESE PIN
 * ============================================================================================
 *
 * On the local provider every session's drive is mounted under one shared root in the runner's
 * mount namespace, so a harness could read, modify and delete drives it did not own (2026-09-10
 * data loss). The fix starts the daemon inside a private mount namespace that holds a bind of its
 * OWN drive only, with the shared root covered by an empty tmpfs.
 *
 * Two classes of failure are worth tests rather than review:
 *
 *  1. A WRONG plan is worse than no plan. Covering the shared root and then binding the wrong path
 *     back hands the session an empty or foreign cwd, which a user reads as lost work. So every
 *     precondition below must refuse the whole plan, not isolate on a guess.
 *  2. Isolation SPLITS the runner's view of the mounts from the daemon's. The pre-existing
 *     ENOTCONN repair remounts in place, in the runner's namespace; with `--propagation private`
 *     that never reaches the daemon, the one-shot remount budget is spent, and the session is
 *     bricked with no retry. So the repair must not be attempted at all when isolation is on.
 *
 * Run: pnpm exec vitest run tests/unit/session-mount-namespace.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { accessSync, constants, statSync } from "node:fs";

import {
  planSessionMountNamespace,
  sharedMountRootOf,
  SESSION_DAEMON_BINARY_ENV_VAR,
  SESSION_MOUNT_ISOLATION_ENV_VAR,
  SESSION_MOUNT_KEEP_PATHS_ENV_VAR,
  SESSION_MOUNT_NAMESPACE_SCRIPT,
  SESSION_MOUNT_ROOT_ENV_VAR,
} from "../../src/engines/sandbox_agent/session-mount-namespace.ts";
import {
  DAYTONA_DURABLE_MOUNT_ROOT,
  LOCAL_DURABLE_MOUNT_ROOT,
} from "../../src/engines/sandbox_agent/run-plan.ts";
import { createAcquireContext } from "../../src/environment/acquire-context-impl.ts";
import { remountLocalCwdAfterRuntimeEnotconn } from "../../src/environment/mount-lifecycle.ts";
import type { MountDeps } from "../../src/environment/mount-lifecycle.ts";
import type { MountCredentials } from "../../src/engines/sandbox_agent/mount.ts";
import type { SessionEnvironment } from "../../src/engines/sandbox_agent/runtime-contracts.ts";

const DAEMON = "/opt/sandbox-agent/bin/sandbox-agent";
const CWD = `${LOCAL_DURABLE_MOUNT_ROOT}/mounts/proj-1/mount-abc`;
const AGENT_CWD = `${CWD}-agent`;
/** A stand-in for the real script, so the decision tests never depend on the file on disk. */
const SCRIPT = "/pkg/scripts/session-mount-namespace.sh";

const plan = (
  overrides: Partial<Parameters<typeof planSessionMountNamespace>[0]> = {},
) =>
  planSessionMountNamespace({
    daemonBinary: DAEMON,
    mountedCwd: CWD,
    agentMountedPath: undefined,
    isDaytona: false,
    scriptPath: SCRIPT,
    scriptExists: () => true,
    // Injected, because the real probe measures the HOST the tests run on: CI and a developer's
    // laptop would answer differently and half this file would flip with it.
    canIsolate: () => true,
    ...overrides,
  });

describe("planSessionMountNamespace: the isolated run", () => {
  it("spawns the script instead of the daemon, and names the daemon in the environment", () => {
    // The sandbox-agent library builds the daemon's argv itself and offers no hook to prepend a
    // command, so the ONLY lever the runner has is which executable gets spawned. If this ever
    // returned the daemon path, isolation would be silently off with every log line unchanged.
    const result = plan();
    assert.ok(result);
    assert.equal(result.binaryPath, SCRIPT);
    assert.equal(result.env[SESSION_DAEMON_BINARY_ENV_VAR], DAEMON);
    assert.equal(result.env[SESSION_MOUNT_ISOLATION_ENV_VAR], "1");
    assert.equal(result.isolates, true);
  });

  it("covers the shared root and keeps only this session's cwd", () => {
    const result = plan();
    assert.ok(result);
    assert.equal(
      result.env[SESSION_MOUNT_ROOT_ENV_VAR],
      `${LOCAL_DURABLE_MOUNT_ROOT}/mounts`,
    );
    assert.equal(result.env[SESSION_MOUNT_KEEP_PATHS_ENV_VAR], CWD);
  });

  it("keeps the agent mount too, space-separated, when the run has one", () => {
    // The script splits this list on whitespace, so the separator is a wire format between the
    // two files rather than a formatting choice.
    const result = plan({ agentMountedPath: AGENT_CWD });
    assert.ok(result);
    assert.equal(
      result.env[SESSION_MOUNT_KEEP_PATHS_ENV_VAR],
      `${CWD} ${AGENT_CWD}`,
    );
  });

  it("writes exactly the four variables the script reads", () => {
    const result = plan({ agentMountedPath: AGENT_CWD });
    assert.ok(result);
    assert.deepEqual(Object.keys(result.env).sort(), [
      SESSION_DAEMON_BINARY_ENV_VAR,
      SESSION_MOUNT_ISOLATION_ENV_VAR,
      SESSION_MOUNT_KEEP_PATHS_ENV_VAR,
      SESSION_MOUNT_ROOT_ENV_VAR,
    ]);
  });
});

describe("sharedMountRootOf: the root is derived from the path actually mounted", () => {
  it("strips <project_id>/<mount_id> from the local cwd shape", () => {
    assert.equal(
      sharedMountRootOf(`${LOCAL_DURABLE_MOUNT_ROOT}/mounts/proj-1/mount-abc`),
      `${LOCAL_DURABLE_MOUNT_ROOT}/mounts`,
    );
  });

  it("strips the same two segments from the Daytona cwd shape", () => {
    // Deriving rather than importing a constant is the point: the two providers put their roots in
    // different places, and a per-deployment storage namespace can sit between root and project.
    assert.equal(
      sharedMountRootOf(
        `${DAYTONA_DURABLE_MOUNT_ROOT}/mounts/proj-1/mount-abc`,
      ),
      `${DAYTONA_DURABLE_MOUNT_ROOT}/mounts`,
    );
  });

  it("survives a deployment storage namespace between the root and the project", () => {
    assert.equal(
      sharedMountRootOf("/var/lib/agenta/mounts/eu-prod/proj-1/mount-abc"),
      "/var/lib/agenta/mounts/eu-prod",
    );
  });
});

/**
 * A run the prelude still wraps, but with nothing to hide: the script strips the runner's
 * capabilities and starts the daemon on the mount view it already had.
 */
function assertWrappedWithoutIsolation(
  result: ReturnType<typeof plan>,
  message: string,
): void {
  assert.ok(result, message);
  assert.equal(result.isolates, false, message);
  assert.equal(result.env[SESSION_MOUNT_ISOLATION_ENV_VAR], "0", message);
  // The script refuses to build a view without both, so leaving either set would be a trap for
  // whoever reads the daemon environment next.
  assert.equal(result.env[SESSION_MOUNT_ROOT_ENV_VAR], undefined, message);
  assert.equal(
    result.env[SESSION_MOUNT_KEEP_PATHS_ENV_VAR],
    undefined,
    message,
  );
}

describe("planSessionMountNamespace: the run this runner does not wrap at all", () => {
  it("leaves a Daytona run alone, sandbox and daemon both remote", () => {
    assert.equal(plan({ isDaytona: true }), null);
  });

  it("leaves the run alone when no daemon binary was resolved", () => {
    // The local provider reports its own, precise error for this. Replacing it with a spawn of a
    // script whose daemon variable is empty would only make the failure harder to read.
    assert.equal(plan({ daemonBinary: undefined }), null);
  });

  it("refuses a local daemon when the privilege-drop script is missing", () => {
    assert.throws(
      () => plan({ scriptExists: () => false }),
      /privilege-drop script/,
    );
  });
});

describe("planSessionMountNamespace: a host that cannot isolate says so", () => {
  it("refuses to isolate, and names the exposure in the reason", () => {
    // The script's own fail-open warning goes to the daemon's stderr, which the sandbox-agent
    // library does not surface. This reason string is the only thing an operator sees, so it has
    // to say what is not being enforced rather than that something was skipped.
    const result = plan({ canIsolate: () => false });
    assertWrappedWithoutIsolation(
      result,
      "an un-isolatable host still needs the capability strip",
    );
    assert.ok(result);
    const reason = result.isolationSkipped ?? "";
    assert.match(reason, /cannot create a mount namespace/);
    assert.match(
      reason,
      /read, modify and delete/,
      "the reason must state the exposure, not just the failure",
    );
    assert.ok(
      reason.includes(`${LOCAL_DURABLE_MOUNT_ROOT}/mounts`),
      "the reason must name the root that stays visible",
    );
  });
});

describe("planSessionMountNamespace: every isolation refusal still strips capabilities", () => {
  // The runner holds CAP_SYS_ADMIN on every local session so that it CAN isolate. An agent that
  // inherited it could unmount the cover, so the capability strip is not optional even when the
  // mount view is left alone — which is why each case below returns a plan rather than null.
  it("refuses to isolate when there is no committed durable cwd", () => {
    // An ephemeral scratch cwd is not under the shared root and is shared with nobody, so there is
    // nothing to hide and nothing to bind back.
    assertWrappedWithoutIsolation(
      plan({ mountedCwd: undefined }),
      "an ephemeral cwd still needs the capability strip",
    );
  });

  it("refuses to isolate on a relative cwd", () => {
    assertWrappedWithoutIsolation(
      plan({ mountedCwd: "mounts/proj-1/mount-abc" }),
      "a relative cwd still needs the capability strip",
    );
  });

  it("refuses a cwd containing a space rather than binding the wrong path", () => {
    // The script splits the keep list on whitespace. `/var/lib/agenta/mounts/p 1/m` would arrive
    // as two paths, and the second bind would target a directory this session does not own.
    assertWrappedWithoutIsolation(
      plan({
        mountedCwd: `${LOCAL_DURABLE_MOUNT_ROOT}/mounts/proj 1/mount-abc`,
      }),
      "a spaced cwd must not be isolated",
    );
  });

  it("refuses when the AGENT path contains whitespace, not just the cwd", () => {
    assertWrappedWithoutIsolation(
      plan({ agentMountedPath: `${AGENT_CWD}\tstray` }),
      "a whitespaced agent mount must not be isolated",
    );
  });

  it("refuses a cwd whose derived root would be `/`", () => {
    // Covering `/` with a tmpfs inside the namespace would take the whole filesystem away from the
    // daemon, including the binary it is about to exec.
    assertWrappedWithoutIsolation(
      plan({ mountedCwd: "/mounts/mount-abc" }),
      "a two-segment cwd must not be isolated",
    );
    assertWrappedWithoutIsolation(
      plan({ mountedCwd: "/mount-abc" }),
      "a one-segment cwd must not be isolated",
    );
  });
});

describe("the script itself ships with the package", () => {
  it("exists at the derived path and is executable", () => {
    // Everything above injects `scriptExists`, so nothing else in this file would notice the
    // script being dropped from the image or losing its exec bit — and the runner's own fallback
    // would then quietly turn isolation off on every host.
    const stats = statSync(SESSION_MOUNT_NAMESPACE_SCRIPT);
    assert.ok(stats.isFile(), "the script must be a regular file");
    assert.doesNotThrow(
      () => accessSync(SESSION_MOUNT_NAMESPACE_SCRIPT, constants.X_OK),
      "the script must be executable: the provider spawns it as the daemon",
    );
  });
});

/**
 * The ENOTCONN consequence.
 *
 * `remountLocalCwdAfterRuntimeEnotconn` repairs a dead geesefs mount IN PLACE, in the runner's
 * namespace. That repair cannot reach an isolated daemon, and the remount budget is one-shot, so
 * attempting it burns the only retry and leaves the harness pointed at the dead bind forever.
 */
describe("ENOTCONN: an isolated daemon is rebuilt, never remounted in place", () => {
  const CREDENTIALS = {
    region: "us-east-1",
    bucket: "b",
    prefix: "p",
    accessKey: "AK",
    secretKey: "SK",
    expiresAt: undefined,
  } as unknown as MountCredentials;

  function makeContext(isolated: boolean) {
    const environment = {
      sessionId: "sess-1",
      mountCreds: CREDENTIALS,
      agentMountCreds: undefined,
      mountedCwd: CWD,
      agentMountedPath: undefined,
      runAgentDir: undefined,
      durableCwdSafeToDelete: false,
      runtimeRemount: undefined,
      daemonMountNamespaceIsolated: isolated,
      daemonMountViewStale: false,
      installedMountExpiries: {},
    } as unknown as SessionEnvironment;

    const logs: string[] = [];
    let signs = 0;
    const deps: MountDeps = {
      // Stubbed, or the non-isolated case below would spawn a real geesefs against a real path.
      mountStorage: (async () => true) as MountDeps["mountStorage"],
      signMount: async () => {
        signs += 1;
        return CREDENTIALS;
      },
      signAgentMount: async () => null,
      daytonaPiDir: "/home/sandbox/.pi",
    };

    const { context } = createAcquireContext({
      environment,
      plan: {
        isDaytona: false,
        harness: "claude",
        workspace: { cwd: CWD },
        prompt: { appendSystemPrompt: undefined, hasSystemPrompt: false },
      } as never,
      env: {},
      piExtEnv: {},
      sessionForMount: "sess-1",
      artifactId: undefined,
      runCred: "ApiKey k",
      log: (message: string) => logs.push(message),
      timingLog: () => {},
      remountLimit: 1,
      combineAppendSystemPrompt: (existing, segment) => existing ?? segment,
      reprepareLocalPiAssets: () => undefined,
    });

    return { context, deps, environment, logs, signCount: () => signs };
  }

  it("marks the daemon's view stale and starts no remount", () => {
    const { context, deps, environment, logs, signCount } = makeContext(true);
    remountLocalCwdAfterRuntimeEnotconn(context, deps, { code: "ENOTCONN" });

    assert.equal(
      environment.daemonMountViewStale,
      true,
      "the stale marker is what routes this session to a cold rebuild",
    );
    assert.equal(
      context.env.runtimeRemount,
      undefined,
      "no remount may be started: it would spend the one-shot budget on a repair the daemon cannot see",
    );
    assert.equal(signCount(), 0, "and no credential may be re-signed");
    assert.ok(
      logs.some((line) => line.includes("isolated mount namespace")),
      "the operator must be told WHY this session rebuilds instead of repairing",
    );
  });

  it("still remounts in place when the daemon shares the runner's namespace", async () => {
    // The guard must be narrow. Without isolation the in-place repair is the correct, cheaper fix
    // and must keep working exactly as it did.
    const { context, deps, environment, signCount } = makeContext(false);
    remountLocalCwdAfterRuntimeEnotconn(context, deps, { code: "ENOTCONN" });

    assert.equal(environment.daemonMountViewStale, false);
    assert.ok(
      context.env.runtimeRemount,
      "the non-isolated path must still start its remount",
    );
    // Awaited, not just observed: the remount is a detached promise, and leaving it in flight
    // would let its failure surface as an unhandled rejection in a later test file.
    await context.env.runtimeRemount;
    assert.equal(
      signCount(),
      1,
      "the cwd credential is re-signed exactly once",
    );
  });
});

describe("required isolation policy", () => {
  it("rejects unavailable isolation", () => {
    assert.throws(
      () => plan({ isolationPolicy: "required", canIsolate: () => false }),
      /Required local mount isolation/,
    );
  });
  it("passes the required policy into the namespace builder", () => {
    assert.equal(
      plan({ isolationPolicy: "required" })?.env.AGENTA_RUNNER_MOUNT_ISOLATION,
      "required",
    );
  });
  it("does not impose local isolation requirements on Daytona", () => {
    assert.equal(
      plan({
        isDaytona: true,
        isolationPolicy: "required",
        canIsolate: () => false,
      }),
      null,
    );
  });
});
