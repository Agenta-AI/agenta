/**
 * The agent tools restore runs while the session opens, and the prompt still waits for it.
 *
 * `runAgentToolsSetup` copies `.tools/bin` from the agent mount and runs the owner's `setup.sh`.
 * Measured on a Pi agent with a `.tools/` folder it takes 9 to 14 s, and it used to block the
 * workspace step, the capability probe and `create_session`. It needs only the agent mount and
 * the cwd, so the acquire now starts it and continues. These tests pin the two halves of that:
 * the session opens before the restore finishes, and nothing reaches the model (the acquire does
 * not report ready, so no prompt is sent) until it has. They also pin what did not change: a Stop
 * during the restore still stops the acquire, and a failed restore still opens the session.
 *
 * Run: pnpm exec vitest run tests/unit/agent-tools-restore-concurrent.test.ts
 */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "vitest";

import type { AgentRunRequest } from "../../src/protocol.ts";
import {
  acquireEnvironment,
  runSandboxAgent,
} from "../../src/engines/sandbox_agent.ts";
import { resetRunnerConfigCache } from "../../src/config/runner-config.ts";
import { USER_STOP_ABORT_REASON } from "../../src/sessions/stop-signal.ts";
import { fakeHarness, flushPromises } from "../utils/sandbox-agent-harness.ts";

beforeEach(() => {
  process.env.AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS = "local,daytona";
  process.env.AGENTA_RUNNER_DAYTONA_API_KEY = "test-key";
  resetRunnerConfigCache();
});

const AGENT_MOUNT_CREDS = {
  endpoint: "http://seaweedfs:8333",
  region: "us-east-1",
  bucket: "agenta-store",
  prefix: "mounts/proj-1/agent-1",
  accessKey: "AK-1",
  secretKey: "SK-1",
};

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`${what} did not happen`)), 4_000),
    ),
  ]);
}

/**
 * A Daytona run with a working agent mount, where the tools restore (the one `runProcess` call
 * that carries `AGENT_TOOLS_DIR` in its env) blocks until the test releases it.
 */
function daytonaRunWithSlowRestore() {
  const harness = fakeHarness();
  const { calls, deps } = harness;
  const order: string[] = [];
  const restoreStarted = deferred();
  const restore = deferred<{ exitCode: number }>();
  const sessionCreated = deferred();

  deps.signAgentMountCredentials = (async () => AGENT_MOUNT_CREDS) as any;
  deps.discoverTunnelEndpoint = (async () => "https://tunnel.example") as any;
  deps.mountStorageRemote = (async () => true) as any;
  const delegateStart = deps.startSandboxAgent!;
  deps.startSandboxAgent = (async (options: any) => {
    const sandbox: any = await delegateStart(options);
    sandbox.runProcess = async (opts: { env?: Record<string, string> }) => {
      if (opts.env?.AGENT_TOOLS_DIR) {
        order.push("restore:start");
        restoreStarted.resolve();
        const result = await restore.promise;
        order.push("restore:end");
        return result;
      }
      return { exitCode: 0 };
    };
    const createSession = sandbox.createSession;
    sandbox.createSession = async (opts: any) => {
      order.push("create_session");
      sessionCreated.resolve();
      return createSession(opts);
    };
    return sandbox;
  }) as any;

  // Claude, because the fake sandbox does not model Pi's in-sandbox install. The restore is the
  // same for every harness.
  const request = {
    harness: "claude",
    sandbox: "daytona",
    sessionId: "sess-tools",
    permissions: { default: "allow" },
    runContext: { workflow: { artifact: { id: "artifact-1" } } },
    telemetry: {
      exporters: { otlp: { headers: { authorization: "ApiKey run" } } },
    },
    messages: [{ role: "user", content: "hello" }],
  } as AgentRunRequest;

  return {
    ...harness,
    calls,
    deps,
    order,
    request,
    restoreStarted,
    restore,
    sessionCreated,
  };
}

describe("agent tools restore during acquire", () => {
  it("opens the session before the restore finishes, and sends the prompt only after it", async () => {
    const run = daytonaRunWithSlowRestore();

    const result = runSandboxAgent(run.request, undefined, undefined, run.deps);
    await withTimeout(run.restoreStarted.promise, "the tools restore start");
    await withTimeout(run.sessionCreated.promise, "create_session");
    // Give the turn every chance to send the prompt early.
    for (let i = 0; i < 10; i++) await flushPromises();

    assert.deepEqual(run.order, ["restore:start", "create_session"]);
    assert.equal(
      run.calls.promptBlocks,
      undefined,
      "no prompt reaches the harness while the tools restore runs",
    );

    run.restore.resolve({ exitCode: 0 });
    const settled = await withTimeout(result, "the turn");
    assert.equal(settled.ok, true);
    assert.deepEqual(run.order, [
      "restore:start",
      "create_session",
      "restore:end",
    ]);
    assert.deepEqual(run.calls.promptBlocks, [{ type: "text", text: "hello" }]);
    assert.ok(
      run.logs.some((line) => line.includes("agent_tools_setup")),
      "the restore keeps its own timing mark",
    );
  });

  it("does not report the environment ready before the restore finishes", async () => {
    const run = daytonaRunWithSlowRestore();
    let acquired = false;

    const acquire = acquireEnvironment(run.request, run.deps).then((value) => {
      acquired = true;
      return value;
    });
    await withTimeout(run.sessionCreated.promise, "create_session");
    for (let i = 0; i < 10; i++) await flushPromises();
    assert.equal(acquired, false, "acquire waits for the tools restore");

    run.restore.resolve({ exitCode: 0 });
    const result = await withTimeout(acquire, "the acquire");
    assert.equal(result.ok, true);
    if (result.ok) await result.env.destroy();
  });

  it("stops the acquire when a Stop lands during the restore", async () => {
    const run = daytonaRunWithSlowRestore();
    const controller = new AbortController();

    const acquire = acquireEnvironment(
      run.request,
      run.deps,
      controller.signal,
    );
    await withTimeout(run.restoreStarted.promise, "the tools restore start");
    controller.abort(USER_STOP_ABORT_REASON);
    run.restore.resolve({ exitCode: 0 });

    const result = await withTimeout(acquire, "the acquire");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /acquisition was aborted/);
    assert.equal(run.calls.promptBlocks, undefined);
  });

  it("still opens the session and runs the turn when the restore fails", async () => {
    const run = daytonaRunWithSlowRestore();

    const result = runSandboxAgent(run.request, undefined, undefined, run.deps);
    await withTimeout(run.restoreStarted.promise, "the tools restore start");
    run.restore.reject(new Error("toolbox unreachable"));

    const settled = await withTimeout(result, "the turn");
    assert.equal(settled.ok, true);
    assert.ok(run.order.includes("create_session"));
    assert.deepEqual(run.calls.promptBlocks, [{ type: "text", text: "hello" }]);
    assert.ok(
      run.logs.some((line) =>
        /agent tools setup error .*toolbox unreachable/.test(line),
      ),
    );
  });

  describe("local runner", () => {
    let cwd: string;
    let setupPid: number | undefined;
    afterEach(() => {
      if (setupPid !== undefined && isAlive(setupPid)) {
        try {
          process.kill(-setupPid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
      setupPid = undefined;
      rmSync(cwd, { recursive: true, force: true });
      rmSync(`${cwd}-agent`, { recursive: true, force: true });
    });

    it("stops a running setup.sh when the acquire fails after the session opened", async () => {
      cwd = mkdtempSync(join(tmpdir(), "agenta-tools-failed-acquire-"));
      const agentDir = `${cwd}-agent`;
      mkdirSync(join(agentDir, ".tools"), { recursive: true });
      // Records its pid, then runs until something kills it.
      writeFileSync(
        join(agentDir, ".tools", "setup.sh"),
        `echo $$ > "$AGENT_FILES/pid"\nwhile true; do sleep 0.05; done\n`,
      );
      const pidFile = join(agentDir, "pid");
      const { deps } = fakeHarness({ cwd });
      deps.signAgentMountCredentials = (async () => AGENT_MOUNT_CREDS) as any;
      deps.mountStorage = (async () => true) as any;
      deps.unmountStorage = (async () => true) as any;
      // Fails the acquire after `create_session`, once the setup script is known to be running.
      deps.applyModel = async () => {
        await withTimeout(
          (async () => {
            while (!existsSync(pidFile) || !readFileSync(pidFile, "utf-8"))
              await new Promise((resolve) => setTimeout(resolve, 20));
          })(),
          "setup.sh start",
        );
        setupPid = Number(readFileSync(pidFile, "utf-8").trim());
        throw new Error("model selection failed");
      };

      const result = await withTimeout(
        acquireEnvironment(
          {
            harness: "pi_core",
            permissions: { default: "allow" },
            runContext: { workflow: { artifact: { id: "artifact-1" } } },
            telemetry: {
              exporters: {
                otlp: { headers: { authorization: "ApiKey run" } },
              },
            },
            messages: [{ role: "user", content: "hello" }],
          } as AgentRunRequest,
          deps,
        ),
        "the acquire",
      );

      assert.equal(result.ok, false);
      assert.ok(setupPid, "setup.sh recorded its pid");
      assert.equal(
        isAlive(setupPid!),
        false,
        "setup.sh does not outlive the failed acquire",
      );
    });

    it("opens the session while the owner's setup.sh is still running", async () => {
      cwd = mkdtempSync(join(tmpdir(), "agenta-tools-concurrent-"));
      const agentDir = `${cwd}-agent`;
      mkdirSync(join(agentDir, ".tools"), { recursive: true });
      // The script waits for a file the test writes once the session has opened.
      writeFileSync(
        join(agentDir, ".tools", "setup.sh"),
        `while [ ! -f "$AGENT_FILES/release" ]; do sleep 0.05; done\n`,
      );
      const { calls, deps, logs } = fakeHarness({ cwd });
      deps.signAgentMountCredentials = (async () => AGENT_MOUNT_CREDS) as any;
      deps.mountStorage = (async () => true) as any;
      deps.unmountStorage = (async () => true) as any;
      const sessionCreated = deferred();
      const delegateStart = deps.startSandboxAgent!;
      deps.startSandboxAgent = (async (options: any) => {
        const sandbox: any = await delegateStart(options);
        const createSession = sandbox.createSession;
        sandbox.createSession = async (opts: any) => {
          sessionCreated.resolve();
          return createSession(opts);
        };
        return sandbox;
      }) as any;

      const result = runSandboxAgent(
        {
          harness: "pi_core",
          permissions: { default: "allow" },
          runContext: { workflow: { artifact: { id: "artifact-1" } } },
          telemetry: {
            exporters: { otlp: { headers: { authorization: "ApiKey run" } } },
          },
          messages: [{ role: "user", content: "hello" }],
        } as AgentRunRequest,
        undefined,
        undefined,
        deps,
      );
      await withTimeout(sessionCreated.promise, "create_session");
      assert.equal(calls.promptBlocks, undefined);
      assert.equal(
        logs.some((line) => line.includes("agent tools setup ok")),
        false,
        "setup.sh is still running when the session opens",
      );

      writeFileSync(join(agentDir, "release"), "");
      const settled = await withTimeout(result, "the turn");
      assert.equal(settled.ok, true);
      assert.ok(logs.some((line) => line.includes("agent tools setup ok")));
      assert.deepEqual(calls.promptBlocks, [{ type: "text", text: "hello" }]);
    });
  });
});
