/**
 * The Daytona acquire times every step, and uploads the in-sandbox MCP shim while the mounts run.
 *
 * Run: pnpm exec vitest run tests/unit/daytona-acquire-timing.test.ts
 */
import { beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import { runSandboxAgent } from "../../src/engines/sandbox_agent/engine.ts";
import type { AgentRunRequest } from "../../src/protocol.ts";
import { resetRunnerConfigCache } from "../../src/config/runner-config.ts";
import { ACQUIRE_STAGES } from "../../src/environment/timing.ts";
import { fakeHarness } from "../utils/sandbox-agent-harness.ts";
import { RUN_TOOL_SPEC, TOOL_CALLBACK } from "../utils/gateway.ts";

beforeEach(() => {
  process.env.AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS = "local,daytona";
  process.env.AGENTA_RUNNER_DAYTONA_API_KEY = "test-key";
  resetRunnerConfigCache();
});

const CREDS = {
  endpoint: "https://s3.example.com",
  region: "us-east-1",
  bucket: "agenta-store",
  prefix: "mounts/proj-1/x",
  accessKey: "AK-1",
  secretKey: "SK-1",
};

const daytonaClaudeRequest = (): AgentRunRequest =>
  ({
    harness: "claude",
    sandbox: "daytona",
    sessionId: "sess-1",
    runContext: { workflow: { artifact: { id: "artifact-1" } } },
    customTools: [RUN_TOOL_SPEC],
    toolCallback: TOOL_CALLBACK,
    telemetry: {
      exporters: { otlp: { headers: { authorization: "ApiKey run" } } },
    },
    messages: [{ role: "user", content: "hello" }],
  }) as AgentRunRequest;

function harnessWithMounts(opts: {
  onMountStart?: (path: string) => void;
  mountGate?: Promise<void>;
  upload: (order: string[]) => Promise<unknown>;
}) {
  const { deps, logs } = fakeHarness();
  const order: string[] = [];
  deps.signSessionMountCredentials = (async () => CREDS) as any;
  deps.signAgentMountCredentials = (async () => CREDS) as any;
  deps.mountHarnessSessionDirs = (async () => {}) as any;
  deps.mountStorageRemote = (async (_sb: unknown, path: string) => {
    const kind = path.endsWith("-agent") ? "agent" : "cwd";
    order.push(`mount-start:${kind}`);
    opts.onMountStart?.(path);
    await opts.mountGate;
    order.push(`mount-done:${kind}`);
    return true;
  }) as any;
  deps.uploadToolMcpAssets = (async () => opts.upload(order)) as any;
  return { deps, logs, order };
}

describe("Daytona acquire timing and the MCP shim upload", () => {
  it("uploads the shim while the mounts run, and still hands it to the session", async () => {
    let releaseMounts!: () => void;
    const mountGate = new Promise<void>((resolve) => {
      releaseMounts = resolve;
    });
    let mountStarted!: () => void;
    const aMountStarted = new Promise<void>((resolve) => {
      mountStarted = resolve;
    });
    const { deps, logs, order } = harnessWithMounts({
      mountGate,
      onMountStart: () => mountStarted(),
      upload: async (o) => {
        o.push("upload-start");
        // The upload waits for a mount to start, and the mounts wait for the upload: only an
        // acquire that runs them at the same time gets past this point.
        await Promise.race([
          aMountStarted,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("the upload ran before the mounts, not with them")), 2_000),
          ),
        ]);
        releaseMounts();
        o.push("upload-done");
        return { command: "node", args: ["/home/sandbox/agenta/tool-mcp/x/tool-mcp-stdio.js"] };
      },
    });
    const result = await runSandboxAgent(daytonaClaudeRequest(), undefined, undefined, deps);
    assert.equal(result.ok, true, JSON.stringify(!result.ok && result.error));
    assert.ok(
      order.indexOf("upload-start") < order.indexOf("mount-done:cwd"),
      `the upload runs during the mounts: ${order}`,
    );

    // Every Daytona step this run takes has its own stage line, each declared in ACQUIRE_STAGES.
    const stages = new Set(
      logs
        .map((line) => /\[timing\] stage=([a-z_]+)/.exec(line)?.[1])
        .filter((s): s is string => !!s),
    );
    for (const stage of [
      "environment_setup",
      "sandbox_pointer",
      "sandbox_start",
      "harness_assets",
      "tool_mcp_upload",
      "mounts",
      "agent_mount",
      "prepare_workspace",
      "probe_capabilities",
      "session_mcp",
      "mcp_handshake",
      "continuity_seed",
      "create_session",
      "apply_model",
      "acquire_total",
    ]) {
      assert.ok(stages.has(stage), `stage '${stage}' is logged: ${[...stages]}`);
    }
    for (const stage of stages) {
      assert.ok((ACQUIRE_STAGES as readonly string[]).includes(stage), `'${stage}' is declared`);
    }
  });

  it("fails the run when the shim upload fails, after the mounts settle", async () => {
    let mountsDone = 0;
    const { deps } = harnessWithMounts({
      upload: async (o) => {
        o.push("upload-failed");
        throw new Error("the in-sandbox tool MCP shim could not be delivered");
      },
      onMountStart: () => {},
    });
    const mountStorageRemote = deps.mountStorageRemote!;
    deps.mountStorageRemote = (async (...args: Parameters<typeof mountStorageRemote>) => {
      await new Promise((r) => setTimeout(r, 10));
      const ok = await mountStorageRemote(...args);
      mountsDone += 1;
      return ok;
    }) as any;
    const result = await runSandboxAgent(daytonaClaudeRequest(), undefined, undefined, deps);
    assert.equal(result.ok, false);
    assert.match(String(!result.ok && result.error), /shim could not be delivered/);
    assert.equal(mountsDone, 2, "both mounts settled before the failure surfaced");
  });
});
