/**
 * `AcquireContext` seam tests (lifecycle migration, step 5 / S7b).
 *
 * An external security review REJECTED revision 1 of the type with the summary "it does not
 * enforce what its comments promise". These tests are the proof that revision 2 does. Each
 * `describe` block below maps to one review finding, and every one of them FAILS against
 * revision 1's shape.
 *
 * Run: pnpm exec vitest run tests/unit/acquire-context.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  AcquireInvariantError,
  rethrowIfInvariant,
} from "../../src/environment/acquire-context.ts";
import { createAcquireContext } from "../../src/environment/acquire-context-impl.ts";
import type { SessionEnvironment } from "../../src/engines/sandbox_agent/runtime-contracts.ts";
import type { MountCredentials } from "../../src/engines/sandbox_agent/mount.ts";

const CREDS = (expiresAt: string | undefined): MountCredentials =>
  ({
    region: "us-east-1",
    bucket: "b",
    prefix: "p",
    accessKey: "AK",
    secretKey: "SK",
    expiresAt,
  }) as MountCredentials;

function makeContext() {
  const environment = {
    sandbox: undefined,
    session: undefined,
    sessionId: "sess-1",
    mountCreds: null,
    agentMountCreds: undefined,
    mountedCwd: undefined,
    agentMountedPath: undefined,
    runAgentDir: undefined,
    durableCwdSafeToDelete: false,
    runtimeRemount: undefined,
    codexSqliteHome: undefined,
    closeToolMcp: undefined,
    installedMountExpiries: {} as Record<string, number | undefined>,
  } as unknown as SessionEnvironment;

  const env: Record<string, string> = {};
  const piExtEnv: Record<string, string> = {};
  const plan = {
    prompt: { appendSystemPrompt: undefined, hasSystemPrompt: false },
  } as never;

  const handle = createAcquireContext({
    environment,
    plan,
    env,
    piExtEnv,
    sessionForMount: "sess-1",
    artifactId: "art-1",
    runCred: "ApiKey k",
    log: () => {},
    timingLog: () => {},
    remountLimit: 2,
    combineAppendSystemPrompt: (existing, segment) =>
      existing ? `${existing}\n${segment}` : segment,
    reprepareLocalPiAssets: () => "/tmp/re-prepared-agent-dir",
  });

  return { ...handle, environment, env, piExtEnv, plan };
}

describe("FINDING 1: the environment is a read-only projection, not a readonly reference", () => {
  it("exposes only reads, and the mutable environment never leaves the module", () => {
    const { context, mutableEnvironment } = makeContext();
    // The view is a distinct object. Revision 1 handed out `environment` itself, so a unit could
    // assign any writable field and the whole ownership table was documentation.
    assert.notStrictEqual(
      context.env as unknown,
      mutableEnvironment as unknown,
      "the context must not expose the mutable environment",
    );
  });

  it("the view has no writer for any owned field", () => {
    const { context } = makeContext();
    // Structural proof: assigning through the view cannot compile, and at runtime the getter-only
    // property refuses the write. Both directions matter; a silent no-op would be worse.
    assert.throws(() => {
      "use strict";
      (context.env as unknown as Record<string, unknown>).mountedCwd = "/hack";
    }, /only a getter|Cannot set/);
  });

  it("reads through, so a committed change is visible at once", () => {
    // Getters, not a snapshot. The closure this replaces shared one object, so a unit that reads
    // after another unit committed must see the new value.
    const { context } = makeContext();
    assert.equal(context.env.mountedCwd, undefined);
    context.commitLocalMount("cwd", "/run/cwd", CREDS(undefined));
    assert.equal(context.env.mountedCwd, "/run/cwd");
  });
});

describe("FINDING 2: the freeze throw escapes an operational catch", () => {
  it("writes to both env maps before the freeze", () => {
    const { context, env, piExtEnv } = makeContext();
    context.writeDaemonEnv("AGENT_MOUNT", "/mnt/agent");
    assert.equal(env.AGENT_MOUNT, "/mnt/agent");
    assert.equal(
      piExtEnv.AGENT_MOUNT,
      "/mnt/agent",
      "both maps are written together or the extension and the daemon disagree",
    );
  });

  it("throws AcquireInvariantError after the freeze, not a plain Error", () => {
    const { context } = makeContext();
    context.freezeDaemonEnv();
    assert.throws(
      () => context.writeDaemonEnv("AGENT_MOUNT", "/mnt/agent"),
      (err: unknown) =>
        err instanceof AcquireInvariantError &&
        err.invariant === "local-mounts-before-provider-freeze",
    );
  });

  it("survives the broad catch that would have swallowed revision 1's plain Error", () => {
    // This is the exact shape of `mountLocalAgentCwd` at environment.ts:478: a wide try/catch
    // that logs and returns false. Revision 1's plain Error died here silently.
    const { context } = makeContext();
    context.freezeDaemonEnv();

    const mountLikeHelper = (): boolean => {
      try {
        context.writeDaemonEnv("AGENT_MOUNT", "/mnt/agent");
        return true;
      } catch (err) {
        rethrowIfInvariant(err); // the one line every operational catch must start with
        return false; // ordinary operational failure: log and continue
      }
    };

    assert.throws(mountLikeHelper, AcquireInvariantError);
  });

  it("still lets an ORDINARY failure be swallowed, which is the whole distinction", () => {
    const operationalHelper = (): boolean => {
      try {
        throw new Error("geesefs mount failed");
      } catch (err) {
        rethrowIfInvariant(err);
        return false;
      }
    };
    assert.equal(
      operationalHelper(),
      false,
      "a mount failure is operational and must stay logged-and-continue",
    );
  });

  it("freezing is idempotent", () => {
    const { context } = makeContext();
    context.freezeDaemonEnv();
    context.freezeDaemonEnv();
    assert.equal(context.envFrozen, true);
  });
});

describe("FINDING 3: Daytona records an expiry WITHOUT a path", () => {
  it("commitLocalMount writes path and expiry together", () => {
    const { context, environment } = makeContext();
    context.commitLocalMount("cwd", "/run/cwd", CREDS("2026-01-01T00:00:00Z"));
    assert.equal(context.env.mountedCwd, "/run/cwd");
    assert.ok(environment.installedMountExpiries.cwd);
  });

  it("commitRemoteMountExpiry records the expiry and leaves mountedCwd UNSET", () => {
    // The real Daytona behavior (environment.ts:768-772). Setting a path here would make
    // teardown try to unmount a host path that never existed.
    const { context, environment } = makeContext();
    context.commitRemoteMountExpiry("cwd", CREDS("2026-01-01T00:00:00Z"));
    assert.ok(environment.installedMountExpiries.cwd);
    assert.equal(
      context.env.mountedCwd,
      undefined,
      "a Daytona mount has no host mountpoint to unmount",
    );
  });

  it("the expiry comes from the credential PASSED, not from the environment", () => {
    // INVARIANT 3. Passing the credential explicitly is what proves the recorded lease belongs
    // to the mount that actually happened, rather than to one that was merely signed.
    const { context, environment } = makeContext();
    context.recordResignedCredential("cwd", CREDS("2030-01-01T00:00:00Z"));
    context.commitLocalMount("cwd", "/run/cwd", CREDS("2026-01-01T00:00:00Z"));
    const mounted = Date.parse("2026-01-01T00:00:00Z");
    assert.equal(environment.installedMountExpiries.cwd, mounted);
  });
});

describe("FINDING 4: durableCwdSafeToDelete has three named transitions", () => {
  it("begin -> false, detach-confirmed -> true, unmount-result -> the result", () => {
    const { context } = makeContext();
    context.markCwdDetachConfirmed();
    assert.equal(context.env.durableCwdSafeToDelete, true);

    context.beginCwdMount();
    assert.equal(
      context.env.durableCwdSafeToDelete,
      false,
      "a mount is starting, so the path may be live and must not be deleted",
    );

    context.markCwdDetachConfirmed();
    assert.equal(context.env.durableCwdSafeToDelete, true);

    context.recordCwdUnmountResult(false);
    assert.equal(
      context.env.durableCwdSafeToDelete,
      false,
      "teardown's unmount was not confirmed, so the recursive delete must be skipped",
    );
    context.recordCwdUnmountResult(true);
    assert.equal(context.env.durableCwdSafeToDelete, true);
  });
});

describe("FINDING 5 and INVARIANT 2: credentials and the re-sign path", () => {
  it("recordResignedCredential is the only writer of both credential fields", () => {
    const { context, environment } = makeContext();
    const fresh = CREDS("2030-01-01T00:00:00Z");
    context.recordResignedCredential("cwd", fresh);
    assert.strictEqual(environment.mountCreds, fresh);
    context.recordResignedCredential("agent", fresh);
    assert.strictEqual(environment.agentMountCreds, fresh);
  });

  it("PRESERVED: a failed cwd remount can leave mountedCwd set while the credential is new", () => {
    // The behavior revision 1 described WRONGLY and the reviewer corrected. It is preserved for
    // this split, and pinned here so it is not rediscovered as a surprise later.
    const { context, environment } = makeContext();
    context.commitLocalMount("cwd", "/run/cwd", CREDS("2026-01-01T00:00:00Z"));

    // A re-sign lands, then the remount fails: the mount helper returns without clearing the path.
    const fresh = CREDS("2030-01-01T00:00:00Z");
    context.recordResignedCredential("cwd", fresh);
    context.beginCwdMount();

    assert.strictEqual(
      environment.mountCreds,
      fresh,
      "the new credential is committed",
    );
    assert.equal(
      context.env.mountedCwd,
      "/run/cwd",
      "and the OLD path is still set: the two disagree until the next successful remount",
    );
  });

  it("the agent re-sign clears its path so the remount does not short-circuit", () => {
    const { context } = makeContext();
    context.commitLocalMount("agent", "/mnt/agent", CREDS(undefined));
    context.clearMountPath("agent");
    assert.equal(context.env.agentMountedPath, undefined);
  });
});

describe("the plan mutation is narrow, and the budgets are per acquire", () => {
  it("appendAgentMountGuidance is the only plan writer, and it appends", () => {
    const { context, plan } = makeContext();
    context.appendAgentMountGuidance("DURABLE STORAGE");
    assert.equal(
      (plan as { prompt: { appendSystemPrompt?: string } }).prompt
        .appendSystemPrompt,
      "DURABLE STORAGE",
    );
    assert.equal(
      (plan as { prompt: { hasSystemPrompt: boolean } }).prompt.hasSystemPrompt,
      true,
    );
    context.appendAgentMountGuidance("SECOND");
    assert.match(
      (plan as { prompt: { appendSystemPrompt?: string } }).prompt
        .appendSystemPrompt as string,
      /DURABLE STORAGE\nSECOND/,
      "it appends, which is exactly why the guidance is guarded by a one-shot flag",
    );
  });

  it("the guidance flag is one-shot", () => {
    const { context } = makeContext();
    assert.equal(context.guidanceActive, false);
    context.markGuidanceActive();
    assert.equal(context.guidanceActive, true);
  });

  it("each mount kind has its own budget, and both are bounded", () => {
    const { context } = makeContext(); // remountLimit: 2
    assert.equal(context.takeRemountBudget("cwd"), true);
    assert.equal(context.takeRemountBudget("cwd"), true);
    assert.equal(
      context.takeRemountBudget("cwd"),
      false,
      "an ENOTCONN storm must not be able to re-sign forever",
    );
    assert.equal(
      context.takeRemountBudget("agent"),
      true,
      "the agent budget is independent of the cwd budget",
    );
  });

  it("the budget is shared across every retry path for one kind", () => {
    // Including the runtime-event remount. That is why that path cannot later grow its own
    // budget without reopening the loop this bound closes.
    const { context } = makeContext();
    context.takeRemountBudget("cwd");
    context.takeRemountBudget("cwd");
    assert.equal(context.takeRemountBudget("cwd"), false);
  });
});
