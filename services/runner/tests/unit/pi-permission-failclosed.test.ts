/**
 * Session-setup fail-closed behavior (Decision 2 of the permission-failopen plan).
 *
 * `acquireEnvironment` must STOP a local Pi run whose permission policy could gate a built-in tool
 * when the Agenta permission extension did not install — rather than running those tools with no
 * enforcement (the fail-open the plan fixes). When the policy is allow-everything the extension is
 * not needed, so a failed install is harmless and the run continues.
 *
 * Covered for BOTH sandboxes: the local path forces a failed install by pointing
 * SANDBOX_AGENT_EXTENSION_BUNDLE at a path that does not exist (the shared hermetic setup otherwise
 * points it at a real stub); the Daytona path injects a `prepareDaytonaPiAssets` that reports a
 * failed upload. No live Pi/sandbox is started: each gating-active case fails at the guard, and
 * each allow-everything case is stopped with an injected sentinel at the next acquire stage,
 * proving it got past the guard.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/pi-permission-failclosed.test.ts)
 */
import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentRunRequest } from "../../src/protocol.ts";
import type { SandboxAgentDeps } from "../../src/engines/sandbox_agent.ts";
import { acquireEnvironment } from "../../src/engines/sandbox_agent.ts";
import { PI_PERMISSION_EXTENSION_UNAVAILABLE_MESSAGE } from "../../src/engines/sandbox_agent/pi-assets.ts";
import { resetRunnerConfigCache } from "../../src/config/runner-config.ts";

const MISSING_BUNDLE = join(tmpdir(), "agenta-missing-extension-bundle.js");

function forceFailedInstall(): void {
  process.env.SANDBOX_AGENT_EXTENSION_BUNDLE = MISSING_BUNDLE;
}

afterEach(() => {
  // The hermetic setup's beforeEach restores the stub bundle, but keep this explicit too.
  delete process.env.SANDBOX_AGENT_EXTENSION_BUNDLE;
});

describe("acquireEnvironment fail-closed on a missing Pi permission extension", () => {
  it("stops a local Pi run with ok:false and the named message when gating is active and the install failed", async () => {
    forceFailedInstall();

    const request: AgentRunRequest = {
      harness: "pi_core",
      messages: [{ role: "user", content: "run a shell command" }],
      // default "deny" makes builtinGatingActive true, so the extension is required.
      permissions: { default: "deny" },
    } as AgentRunRequest;

    const result = await acquireEnvironment(request, {});

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, PI_PERMISSION_EXTENSION_UNAVAILABLE_MESSAGE);
  });

  it("continues an allow-everything local Pi run even when the install failed (extension not needed)", async () => {
    forceFailedInstall();

    const SENTINEL = "pi-failclosed-test-reached-sandbox-start";

    const request: AgentRunRequest = {
      harness: "pi_core",
      messages: [{ role: "user", content: "hello" }],
      // default "allow" with no built-in rules => builtinGatingActive false => no enforcement need.
      permissions: { default: "allow" },
    } as AgentRunRequest;

    const result = await acquireEnvironment(request, {
      // The run must get PAST the fail-closed guard; stop it the instant it reaches sandbox startup
      // so we neither hit real infra nor mistake an early abort for the guard firing.
      startSandboxAgent: (async () => {
        throw new Error(SENTINEL);
      }) as typeof import("sandbox-agent").SandboxAgent.start,
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    // Reaching the sandbox-start sentinel proves the guard did NOT stop the run — the failed
    // install was correctly treated as harmless under an allow-everything policy.
    assert.match(result.error, new RegExp(SENTINEL));
    assert.notEqual(result.error, PI_PERMISSION_EXTENSION_UNAVAILABLE_MESSAGE);
  });
});

// --- Daytona path: the same guarantee for the remote-sandbox extension upload ------------- //

/** Minimal fake Daytona sandbox that records teardown calls; no live Daytona is touched. */
function fakeDaytonaSandbox() {
  const teardown = { destroyed: 0, disposed: 0 };
  const sandbox: any = {
    sandboxId: "sbx-failclosed-test",
    async destroySession() {},
    async destroySandbox() {
      teardown.destroyed += 1;
    },
    async dispose() {
      teardown.disposed += 1;
    },
  };
  return { sandbox, teardown };
}

/**
 * Deps that carry a Daytona Pi run exactly up to the extension-upload seam with fakes: the
 * provider/daemon/cwd shims never touch infra, `startSandboxAgent` returns the fake sandbox, and
 * `prepareDaytonaPiAssets` reports the upload outcome under test.
 */
function daytonaDeps(
  sandbox: any,
  extensionInstalled: boolean,
  extra: Partial<SandboxAgentDeps> = {},
): SandboxAgentDeps {
  return {
    createDaytonaCwd: () => "/home/sandbox/agenta-failclosed-test",
    resolveSkillDirs: () => ({ skills: [], cleanup: () => {} }),
    buildDaemonEnv: () => ({}),
    resolveDaemonBinary: () => "/bin/sandbox-agent",
    buildSandboxProvider: (() => ({}) as any) as any,
    startSandboxAgent: (async () => sandbox) as any,
    prepareDaytonaPiAssets: (async () => extensionInstalled) as any,
    ...extra,
  };
}

describe("acquireEnvironment fail-closed on a failed Daytona extension upload", () => {
  // The hermetic setup scrubs the Daytona env before every test; enable the provider (with a
  // provisioning credential) per test and drop the memoized config so the run plan accepts it.
  function enableDaytona(): void {
    process.env.AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS = "local,daytona";
    process.env.AGENTA_RUNNER_DAYTONA_API_KEY = "test-key";
    resetRunnerConfigCache();
  }

  it("stops a Daytona Pi run with ok:false, the named message, and sandbox teardown when gating is active and the upload failed", async () => {
    enableDaytona();
    const { sandbox, teardown } = fakeDaytonaSandbox();

    const request: AgentRunRequest = {
      harness: "pi_core",
      sandbox: "daytona",
      messages: [{ role: "user", content: "run a shell command" }],
      permissions: { default: "deny" },
    } as AgentRunRequest;

    const result = await acquireEnvironment(
      request,
      daytonaDeps(sandbox, false),
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, PI_PERMISSION_EXTENSION_UNAVAILABLE_MESSAGE);
    // The half-built environment must not leak: the engine's catch tears the sandbox down.
    assert.equal(teardown.destroyed, 1);
    assert.equal(teardown.disposed, 1);
  });

  it("continues an allow-everything Daytona Pi run even when the upload failed (extension not needed)", async () => {
    enableDaytona();
    const { sandbox } = fakeDaytonaSandbox();

    const SENTINEL = "pi-failclosed-test-reached-prepare-workspace";

    const request: AgentRunRequest = {
      harness: "pi_core",
      sandbox: "daytona",
      messages: [{ role: "user", content: "hello" }],
      permissions: { default: "allow" },
    } as AgentRunRequest;

    const result = await acquireEnvironment(
      request,
      daytonaDeps(sandbox, false, {
        // The run must get PAST the fail-closed check (which sits right after the upload); stop
        // it at the next acquire stage, workspace preparation, so no further infra is touched.
        prepareWorkspace: (async () => {
          throw new Error(SENTINEL);
        }) as any,
      }),
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    // Reaching the workspace sentinel proves the check did NOT stop the run — the failed upload
    // was correctly treated as harmless under an allow-everything policy.
    assert.match(result.error, new RegExp(SENTINEL));
    assert.notEqual(result.error, PI_PERMISSION_EXTENSION_UNAVAILABLE_MESSAGE);
  });
});
