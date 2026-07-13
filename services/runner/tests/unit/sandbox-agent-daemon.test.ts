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
  inheritableProviderEnvVars,
  KNOWN_SANDBOX_ENV_VARS,
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
  "AGENTA_RUNNER_INHERIT_ALL_PROVIDER_KEYS",
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

describe("inheritableProviderEnvVars", () => {
  it("maps a provider family to just its own keys", () => {
    assert.deepEqual(inheritableProviderEnvVars("openai"), ["OPENAI_API_KEY"]);
    assert.deepEqual(inheritableProviderEnvVars("groq"), ["GROQ_API_KEY"]);
    // Pi reads TOGETHER_API_KEY; litellm reads TOGETHERAI_API_KEY. Both belong to the family.
    assert.deepEqual(inheritableProviderEnvVars("together_ai"), [
      "TOGETHER_API_KEY",
      "TOGETHERAI_API_KEY",
    ]);
  });

  it("is case-insensitive on the provider family", () => {
    assert.deepEqual(inheritableProviderEnvVars("OpenAI"), ["OPENAI_API_KEY"]);
  });

  it("openai-codex authenticates via its own OAuth file, so it inherits no key", () => {
    assert.deepEqual(inheritableProviderEnvVars("openai-codex"), []);
  });

  it("an unknown or absent provider falls back to the full inventory (never narrower)", () => {
    assert.deepEqual(
      inheritableProviderEnvVars(undefined),
      KNOWN_PROVIDER_ENV_VARS,
    );
    assert.deepEqual(
      inheritableProviderEnvVars("some-custom-slug"),
      KNOWN_PROVIDER_ENV_VARS,
    );
  });

  it("a deployment adds its cloud group on top of the provider group", () => {
    const vertex = inheritableProviderEnvVars("anthropic", "vertex_ai");
    assert.ok(vertex.includes("ANTHROPIC_API_KEY"));
    assert.ok(vertex.includes("GOOGLE_APPLICATION_CREDENTIALS"));
    assert.ok(vertex.includes("CLAUDE_CODE_USE_VERTEX"));
    assert.ok(!vertex.includes("AWS_ACCESS_KEY_ID"));

    const azure = inheritableProviderEnvVars("openai", "azure");
    assert.deepEqual(azure, ["OPENAI_API_KEY", "AZURE_OPENAI_API_KEY"]);
  });
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
    // Force-blanked (not merely absent) — see the F-INFRA-ENV test below for why.
    assert.equal(env.DAYTONA_API_KEY, "");
  });

  it("clears the COMPLETE provider env inventory on a managed run (clear-then-apply, rule 5)", () => {
    // The sidecar inherits keys for several providers, INCLUDING a cloud group (AWS for Bedrock).
    process.env.OPENAI_API_KEY = "sidecar-openai";
    process.env.ANTHROPIC_API_KEY = "sidecar-anthropic";
    process.env.GEMINI_API_KEY = "sidecar-gemini";
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "sidecar-oauth";
    process.env.AWS_ACCESS_KEY_ID = "sidecar-aws-key";
    process.env.AWS_SECRET_ACCESS_KEY = "sidecar-aws-secret";
    process.env.AWS_REGION = "sidecar-region";
    process.env.ANTHROPIC_MODEL = "sidecar-model";
    process.env.ANTHROPIC_BASE_URL = "https://sidecar.example";
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/sidecar/adc.json";
    process.env.AZURE_OPENAI_API_KEY = "sidecar-azure";
    process.env.HOME = "/home/runner";

    // ...but a managed run (credentialMode "env") must inherit NONE of them; the caller applies
    // only the resolved secrets afterwards. The clear set is the COMPLETE inventory, not just the
    // direct *_API_KEY vars, so an inherited cloud credential cannot leak either.
    const env = buildDaemonEnv("pi", { clearProviderEnv: true });

    for (const key of KNOWN_PROVIDER_ENV_VARS) {
      assert.equal(
        env[key],
        undefined,
        `${key} must not be inherited on a managed run`,
      );
    }
    // The cloud groups are part of the inventory, so they are cleared too.
    assert.equal(env.AWS_ACCESS_KEY_ID, undefined);
    assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
    assert.equal(env.AWS_REGION, undefined);
    assert.equal(env.ANTHROPIC_MODEL, undefined);
    assert.equal(env.ANTHROPIC_BASE_URL, undefined);
    assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
    assert.equal(env.AZURE_OPENAI_API_KEY, undefined);
    // Non-credential launch vars are still present.
    assert.equal(env.HOME, "/home/runner");
    assert.ok(env.PATH);
  });

  it("narrows the inherited keys to the run's DECLARED provider (RUN-SEC-1)", () => {
    // The sidecar has keys for several providers configured, as a zero-config self-host does.
    process.env.OPENAI_API_KEY = "sidecar-openai";
    process.env.ANTHROPIC_API_KEY = "sidecar-anthropic";
    process.env.GEMINI_API_KEY = "sidecar-gemini";
    process.env.GROQ_API_KEY = "sidecar-groq";

    // A non-managed run that DECLARED openai gets the OpenAI key and nothing else: passing the
    // Anthropic key to an OpenAI run does not make it work, it just widens the blast radius.
    const env = buildDaemonEnv("pi", { provider: "openai" });

    assert.equal(env.OPENAI_API_KEY, "sidecar-openai");
    assert.equal(env.ANTHROPIC_API_KEY, undefined);
    assert.equal(env.GEMINI_API_KEY, undefined);
    assert.equal(env.GROQ_API_KEY, undefined);
  });

  it("keeps the Claude harness's own auth-token/OAuth vars for an anthropic run", () => {
    process.env.ANTHROPIC_API_KEY = "sidecar-anthropic";
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "sidecar-oauth";
    process.env.ANTHROPIC_BASE_URL = "https://gateway.example";
    process.env.OPENAI_API_KEY = "sidecar-openai";

    const env = buildDaemonEnv("claude", { provider: "anthropic" });

    assert.equal(env.ANTHROPIC_API_KEY, "sidecar-anthropic");
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "sidecar-oauth");
    assert.equal(env.ANTHROPIC_BASE_URL, "https://gateway.example");
    assert.equal(env.OPENAI_API_KEY, undefined, "openai is a different family");
  });

  it("adds the deployment's cloud credential group (anthropic on bedrock)", () => {
    process.env.ANTHROPIC_API_KEY = "sidecar-anthropic";
    process.env.AWS_BEARER_TOKEN_BEDROCK = "sidecar-bedrock";
    process.env.AWS_ACCESS_KEY_ID = "sidecar-aws-key";
    process.env.AWS_REGION = "us-east-1";
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/sidecar/adc.json";

    const env = buildDaemonEnv("claude", {
      provider: "anthropic",
      deployment: "bedrock",
    });

    assert.equal(env.AWS_BEARER_TOKEN_BEDROCK, "sidecar-bedrock");
    assert.equal(env.AWS_ACCESS_KEY_ID, "sidecar-aws-key");
    assert.equal(env.AWS_REGION, "us-east-1");
    // Vertex is a different deployment surface: its ADC must not ride along.
    assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
  });

  it("an un-migrated run that declares no provider keeps today's full inheritance", () => {
    process.env.OPENAI_API_KEY = "sidecar-openai";
    process.env.ANTHROPIC_API_KEY = "sidecar-anthropic";

    // No provider on the wire: narrowing it would break the run, so the full set is kept.
    const env = buildDaemonEnv("pi");

    assert.equal(env.OPENAI_API_KEY, "sidecar-openai");
    assert.equal(env.ANTHROPIC_API_KEY, "sidecar-anthropic");
  });

  it("AGENTA_RUNNER_INHERIT_ALL_PROVIDER_KEYS is the explicit opt-out from narrowing", () => {
    process.env.OPENAI_API_KEY = "sidecar-openai";
    process.env.ANTHROPIC_API_KEY = "sidecar-anthropic";

    const narrowed = buildDaemonEnv("pi", { provider: "openai" });
    assert.equal(narrowed.ANTHROPIC_API_KEY, undefined);

    const widened = buildDaemonEnv("pi", {
      provider: "openai",
      inheritAllProviderEnv: true,
    });
    assert.equal(widened.ANTHROPIC_API_KEY, "sidecar-anthropic");
    assert.equal(widened.OPENAI_API_KEY, "sidecar-openai");
  });

  it("force-blanks infra creds (DAYTONA_API_KEY) on every run, managed or not (F-INFRA-ENV)", () => {
    process.env.DAYTONA_API_KEY = "org-key-should-not-leak";

    // The underlying sandbox-agent local() provider spawns with
    // {...process.env, ...options.env} (inherit-then-apply), so an ABSENT key here would not
    // stop the leak — only a forced override does. Assert both run shapes.
    for (const opts of [{}, { clearProviderEnv: true }]) {
      const env = buildDaemonEnv("pi", opts);
      for (const key of KNOWN_SANDBOX_ENV_VARS) {
        assert.equal(
          env[key],
          "",
          `${key} must be force-blanked, not merely absent`,
        );
      }
    }
  });
});
