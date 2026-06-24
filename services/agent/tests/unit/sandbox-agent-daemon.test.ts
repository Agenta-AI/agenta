/**
 * Unit tests for sandbox-agent daemon launch env.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-daemon.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  ADAPTER_BIN_DIR,
  buildDaemonEnv,
  KNOWN_PROVIDER_ENV_VARS,
} from "../../src/engines/sandbox_agent/daemon.ts";

const touched = [
  "PATH",
  "HOME",
  "SANDBOX_AGENT_ADAPTER_PATH",
  "SANDBOX_AGENT_PI_COMMAND",
  "PI_CODING_AGENT_DIR",
  "CLAUDE_CONFIG_DIR",
  "COMPOSIO_API_KEY",
  "DAYTONA_API_KEY",
  // Every var the clear-inventory test touches is the full known provider inventory plus the
  // cloud groups, so the afterEach restores them all.
  ...KNOWN_PROVIDER_ENV_VARS,
];
const previous = new Map<string, string | undefined>();
for (const key of touched) previous.set(key, process.env[key]);

afterEach(() => {
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("buildDaemonEnv", () => {
  it("builds the adapter path and Pi command", () => {
    process.env.PATH = "/usr/bin";
    process.env.SANDBOX_AGENT_ADAPTER_PATH = "/opt/adapters";
    process.env.SANDBOX_AGENT_PI_COMMAND = "/opt/pi";
    process.env.PI_CODING_AGENT_DIR = "/tmp/pi-agent";
    process.env.HOME = "/home/runner";

    const env = buildDaemonEnv("pi");

    assert.equal(env.PATH, `${ADAPTER_BIN_DIR}:/opt/adapters:/usr/bin`);
    assert.equal(env.PI_ACP_PI_COMMAND, "/opt/pi");
    assert.equal(env.PI_CODING_AGENT_DIR, "/tmp/pi-agent");
    assert.equal(env.HOME, "/home/runner");
  });

  it("copies only known provider/auth variables, not unrelated secret-bearing env (non-managed run)", () => {
    process.env.OPENAI_API_KEY = "openai";
    process.env.ANTHROPIC_API_KEY = "anthropic";
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "claude-oauth";
    process.env.COMPOSIO_API_KEY = "composio";
    process.env.DAYTONA_API_KEY = "daytona";

    // Default (clearProviderEnv: false) = a runtime_provided / un-migrated run: keep the
    // sidecar's own provider/auth keys so the harness login still works.
    const env = buildDaemonEnv("claude");

    assert.equal(env.OPENAI_API_KEY, "openai");
    assert.equal(env.ANTHROPIC_API_KEY, "anthropic");
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "claude-oauth");
    assert.equal(env.COMPOSIO_API_KEY, undefined);
    assert.equal(env.DAYTONA_API_KEY, undefined);
  });

  it("clears the COMPLETE provider env inventory on a managed run (clear-then-apply, rule 5)", () => {
    // The sidecar inherits keys for several providers, INCLUDING a cloud group (AWS for Bedrock).
    process.env.OPENAI_API_KEY = "sidecar-openai";
    process.env.ANTHROPIC_API_KEY = "sidecar-anthropic";
    process.env.GEMINI_API_KEY = "sidecar-gemini";
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "sidecar-oauth";
    process.env.AWS_ACCESS_KEY_ID = "sidecar-aws-key";
    process.env.AWS_SECRET_ACCESS_KEY = "sidecar-aws-secret";
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/sidecar/adc.json";
    process.env.AZURE_OPENAI_API_KEY = "sidecar-azure";
    process.env.HOME = "/home/runner";

    // ...but a managed run (credentialMode "env") must inherit NONE of them; the caller applies
    // only the resolved secrets afterwards. The clear set is the COMPLETE inventory, not just the
    // direct *_API_KEY vars, so an inherited cloud credential cannot leak either.
    const env = buildDaemonEnv("pi", { clearProviderEnv: true });

    for (const key of KNOWN_PROVIDER_ENV_VARS) {
      assert.equal(env[key], undefined, `${key} must not be inherited on a managed run`);
    }
    // The cloud groups are part of the inventory, so they are cleared too.
    assert.equal(env.AWS_ACCESS_KEY_ID, undefined);
    assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
    assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
    assert.equal(env.AZURE_OPENAI_API_KEY, undefined);
    // Non-credential launch vars are still present.
    assert.equal(env.HOME, "/home/runner");
    assert.ok(env.PATH);
  });
});
