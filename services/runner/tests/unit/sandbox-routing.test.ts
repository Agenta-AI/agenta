/**
 * Harness routing between `daytona` and `inprocess` (`sandbox-routing.ts`): one choice, and the
 * harness picks the provider. Pi runs in-process; Claude Code and Codex run on Daytona.
 *
 * Run: pnpm exec vitest run tests/unit/sandbox-routing.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import {
  parseRunnerConfig,
  resetRunnerConfigCache,
  RunnerConfigError,
} from "../../src/config/runner-config.ts";
import type { AgentRunRequest } from "../../src/protocol.ts";
import { createAgentServer, type RunAgent } from "../../src/server.ts";
import { routeSandboxForHarness } from "../../src/engines/sandbox_agent/sandbox-routing.ts";

const DAYTONA = {
  AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "local,daytona",
  AGENTA_RUNNER_DAYTONA_API_KEY: "k",
};

/** A request in a session with a run credential: what in-process needs for its drive. */
function inSession(fields: Partial<AgentRunRequest>): AgentRunRequest {
  return {
    sessionId: "conversation-1",
    telemetry: { exporters: { otlp: { headers: { authorization: "ApiKey run" } } } },
    ...fields,
  } as AgentRunRequest;
}

const route = (request: AgentRunRequest, env: Record<string, string> = DAYTONA) =>
  routeSandboxForHarness(request, parseRunnerConfig(env));

describe("routing on (the default)", () => {
  for (const chosen of ["daytona", "inprocess"]) {
    it(`runs pi_core chosen as ${chosen} in-process`, () => {
      assert.equal(route(inSession({ sandbox: chosen, harness: "pi_core" })), "inprocess");
    });

    it(`runs a request without a harness (Pi) chosen as ${chosen} in-process`, () => {
      assert.equal(route(inSession({ sandbox: chosen })), "inprocess");
    });

    for (const harness of ["claude_code", "codex"]) {
      it(`runs ${harness} chosen as ${chosen} on Daytona`, () => {
        assert.equal(route(inSession({ sandbox: chosen, harness })), "daytona");
      });
    }
  }

  it("routes the deployment default when the request names no sandbox", () => {
    const env = { ...DAYTONA, AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER: "daytona" };
    assert.equal(route(inSession({ harness: "pi_core" }), env), "inprocess");
    assert.equal(route(inSession({ harness: "claude_code" }), env), "daytona");
  });

  it("runs Pi on Daytona without a session: in-process keeps its files on the session drive", () => {
    assert.equal(route(inSession({ sandbox: "daytona", sessionId: undefined })), "daytona");
    assert.equal(route(inSession({ sandbox: "inprocess", sessionId: "  " })), "daytona");
  });

  it("runs Pi on Daytona without a run credential to sign the drive with", () => {
    assert.equal(route(inSession({ sandbox: "daytona", telemetry: undefined })), "daytona");
  });

  it("runs the legacy pi_agenta spelling on Daytona: in-process runs only pi_core", () => {
    assert.equal(route(inSession({ sandbox: "inprocess", harness: "pi_agenta" })), "daytona");
  });

  it("never routes local", () => {
    assert.equal(route(inSession({ sandbox: "local", harness: "pi_core" })), "local");
    assert.equal(route(inSession({ sandbox: "local", harness: "codex" })), "local");
  });

  it("leaves a malformed harness for the run plan to refuse", () => {
    const request = inSession({ sandbox: "daytona", harness: 0 as unknown as string });
    assert.equal(route(request), "daytona");
  });
});

describe("routing does not apply", () => {
  it("with AGENTA_RUNNER_INPROCESS_FOR_PI=false: each run uses the provider it names", () => {
    const env = { ...DAYTONA, AGENTA_RUNNER_INPROCESS_FOR_PI: "false" };
    assert.equal(route(inSession({ sandbox: "daytona", harness: "pi_core" }), env), "daytona");
    assert.equal(route(inSession({ sandbox: "inprocess", harness: "pi_core" }), env), "inprocess");
    assert.equal(route(inSession({ sandbox: "inprocess", harness: "codex" }), env), "inprocess");
  });

  it("on a runner with only local", () => {
    assert.equal(route(inSession({ sandbox: "local" }), {}), "local");
  });

  it("on a runner without daytona, even when inprocess is listed", () => {
    const env = { AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "local,inprocess", AGENTA_RUNNER_DAYTONA_API_KEY: "k" };
    assert.equal(route(inSession({ sandbox: "inprocess", harness: "codex" }), env), "inprocess");
  });
});

describe("AGENTA_RUNNER_INPROCESS_FOR_PI", () => {
  it("is on when unset or blank", () => {
    assert.equal(parseRunnerConfig(DAYTONA).inprocess.forPi, true);
    assert.equal(parseRunnerConfig({ ...DAYTONA, AGENTA_RUNNER_INPROCESS_FOR_PI: " " }).inprocess.forPi, true);
  });

  it("reads true and false in any case", () => {
    assert.equal(parseRunnerConfig({ ...DAYTONA, AGENTA_RUNNER_INPROCESS_FOR_PI: "FALSE" }).inprocess.forPi, false);
    assert.equal(parseRunnerConfig({ ...DAYTONA, AGENTA_RUNNER_INPROCESS_FOR_PI: "True" }).inprocess.forPi, true);
  });

  it("refuses any other value", () => {
    assert.throws(
      () => parseRunnerConfig({ ...DAYTONA, AGENTA_RUNNER_INPROCESS_FOR_PI: "0" }),
      RunnerConfigError,
    );
  });
});

describe("the runner's ingress", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetRunnerConfigCache();
  });

  async function postOneShot(body: AgentRunRequest): Promise<AgentRunRequest> {
    process.env = { ...saved, ...DAYTONA, AGENTA_RUNNER_TOKEN: "t" };
    resetRunnerConfigCache();
    let seen: AgentRunRequest | undefined;
    const run: RunAgent = async (request) => {
      seen = request;
      return { ok: true, output: "", events: [] };
    };
    const server = createAgentServer(run);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      // The one-shot path: no NDJSON, so no session watchdog starts for the session id.
      const res = await fetch(`http://127.0.0.1:${port}/run`, {
        method: "POST",
        headers: { authorization: "Bearer t" },
        body: JSON.stringify(body),
      });
      await res.text();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    assert.ok(seen, "the run was not called");
    return seen;
  }

  it("hands the engine a Pi request chosen as daytona as inprocess", async () => {
    const seen = await postOneShot(inSession({ sandbox: "daytona", harness: "pi_core" }));
    assert.equal(seen.sandbox, "inprocess");
  });

  it("hands the engine a Codex request chosen as inprocess as daytona", async () => {
    const seen = await postOneShot(inSession({ sandbox: "inprocess", harness: "codex" }));
    assert.equal(seen.sandbox, "daytona");
  });
});
