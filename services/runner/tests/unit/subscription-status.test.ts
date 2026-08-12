/**
 * Unit tests for the per-harness subscription login detector.
 *
 * Every case runs against a temp folder and a fake login file, with the mount variables passed in
 * as an explicit env object — a developer's real `CODEX_HOME` / `CLAUDE_CONFIG_DIR` /
 * `PI_CODING_AGENT_DIR` is never read, so the suite cannot pass or fail on whoever ran it.
 *
 * Run: pnpm exec vitest run --project unit tests/unit/subscription-status.test.ts
 */
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  harnessSubscriptionStatus,
  subscriptionStatusResponse,
  SUBSCRIPTION_HARNESSES,
  type SubscriptionState,
} from "../../src/subscription-status.ts";

/** A login file that passes the shape check without resembling a real credential. */
const FAKE_LOGIN = JSON.stringify({ fake: "not-a-real-token" });

describe("harnessSubscriptionStatus", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "subscription-status-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  /** A mount folder holding `file` (when given), plus the env that points the harness at it. */
  function mount(
    dirEnv: string,
    file?: string,
    contents = FAKE_LOGIN,
  ): NodeJS.ProcessEnv {
    const dir = join(root, dirEnv.toLowerCase());
    mkdirSync(dir, { recursive: true });
    if (file) writeFileSync(join(dir, file), contents);
    return { [dirEnv]: dir };
  }

  it("reports not_configured when the mount variable is not set", async () => {
    assert.deepEqual(await harnessSubscriptionStatus("codex", {}), {
      state: "not_configured",
      provider: "openai",
    });
    assert.deepEqual(await harnessSubscriptionStatus("claude", {}), {
      state: "not_configured",
      provider: "anthropic",
    });
    // Pi is not tied to one provider, so it reports no provider at all — and both Pi harnesses
    // answer alike, because they read the same login.
    assert.deepEqual(await harnessSubscriptionStatus("pi_core", {}), {
      state: "not_configured",
    });
    assert.deepEqual(await harnessSubscriptionStatus("pi_agenta", {}), {
      state: "not_configured",
    });
  });

  it("treats a whitespace-only mount variable as not configured", async () => {
    assert.equal(
      (await harnessSubscriptionStatus("codex", { CODEX_HOME: "   " })).state,
      "not_configured",
    );
  });

  it("reports login_missing when the folder exists but the login file does not", async () => {
    assert.equal(
      (await harnessSubscriptionStatus("codex", mount("CODEX_HOME"))).state,
      "login_missing",
    );
  });

  it("reports login_missing when the mount folder itself does not exist", async () => {
    assert.equal(
      (
        await harnessSubscriptionStatus("codex", {
          CODEX_HOME: join(root, "never-mounted"),
        })
      ).state,
      "login_missing",
    );
  });

  it("reports login_unusable for an empty login file", async () => {
    assert.equal(
      (
        await harnessSubscriptionStatus(
          "codex",
          mount("CODEX_HOME", "auth.json", ""),
        )
      ).state,
      "login_unusable",
    );
  });

  it("reports login_unusable when the login file is not JSON", async () => {
    assert.equal(
      (
        await harnessSubscriptionStatus(
          "codex",
          mount("CODEX_HOME", "auth.json", "not json at all"),
        )
      ).state,
      "login_unusable",
    );
  });

  it("reports login_unusable for JSON that is not a non-empty object", async () => {
    for (const contents of ["{}", "[]", '"a string"', "null"]) {
      assert.equal(
        (
          await harnessSubscriptionStatus(
            "codex",
            mount("CODEX_HOME", "auth.json", contents),
          )
        ).state,
        "login_unusable",
        `expected login_unusable for ${contents}`,
      );
    }
  });

  it("reports login_unusable when the login path is unreadable as a file", async () => {
    // A directory where the login file should be: it stats fine (so it is not "missing") but
    // cannot be read — the same answer as a permission-denied mount, without needing root.
    const dir = join(root, "codex-home");
    mkdirSync(join(dir, "auth.json"), { recursive: true });
    assert.equal(
      (await harnessSubscriptionStatus("codex", { CODEX_HOME: dir })).state,
      "login_unusable",
    );
  });

  it("reports ready with the provider when the login file has the minimum shape", async () => {
    assert.deepEqual(
      await harnessSubscriptionStatus(
        "codex",
        mount("CODEX_HOME", "auth.json"),
      ),
      { state: "ready", provider: "openai" },
    );
    assert.deepEqual(
      await harnessSubscriptionStatus(
        "claude",
        mount("CLAUDE_CONFIG_DIR", ".credentials.json"),
      ),
      { state: "ready", provider: "anthropic" },
    );
    // One Pi mount, one login file: `pi_core` and `pi_agenta` both read it.
    const piMount = mount("PI_CODING_AGENT_DIR", "auth.json");
    assert.deepEqual(await harnessSubscriptionStatus("pi_core", piMount), {
      state: "ready",
    });
    assert.deepEqual(await harnessSubscriptionStatus("pi_agenta", piMount), {
      state: "ready",
    });
  });

  it("looks for Claude's OAuth credentials file, not a Codex-style auth.json", async () => {
    assert.equal(
      (
        await harnessSubscriptionStatus(
          "claude",
          mount("CLAUDE_CONFIG_DIR", "auth.json"),
        )
      ).state,
      "login_missing",
    );
  });

  it("reports unsupported for a harness this runner cannot check", async () => {
    assert.deepEqual(await harnessSubscriptionStatus("cursor", {}), {
      state: "unsupported",
    });
  });

  it("reads process.env by default", async () => {
    const dir = join(root, "codex-home");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "auth.json"), FAKE_LOGIN);
    vi.stubEnv("CODEX_HOME", dir);

    assert.equal((await harnessSubscriptionStatus("codex")).state, "ready");
  });
});

describe("subscriptionStatusResponse", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "subscription-status-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reports every known harness with a v1 envelope", async () => {
    const response = await subscriptionStatusResponse({});

    assert.equal(response.version, 1);
    assert.deepEqual(
      Object.keys(response.harnesses).sort(),
      [...SUBSCRIPTION_HARNESSES].sort(),
    );
  });

  it("keeps one harness's failure from stopping the others", async () => {
    // A mount variable whose read itself throws: nothing a single check can do may take the
    // response down or change another harness's answer.
    const claudeDir = join(root, "claude-config");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, ".credentials.json"), FAKE_LOGIN);
    const env = {
      get CODEX_HOME(): string {
        throw new Error("mount lookup exploded");
      },
      CLAUDE_CONFIG_DIR: claudeDir,
    } as unknown as NodeJS.ProcessEnv;

    const response = await subscriptionStatusResponse(env);

    assert.equal(response.harnesses.codex.state, "login_unusable");
    assert.equal(response.harnesses.claude.state, "ready");
    assert.equal(response.harnesses.pi_core.state, "not_configured");
    assert.equal(response.harnesses.pi_agenta.state, "not_configured");
  });

  it("gives both Pi harnesses the same answer from the one Pi mount", async () => {
    const piDir = join(root, "pi-agent");
    mkdirSync(piDir, { recursive: true });
    const env = { PI_CODING_AGENT_DIR: piDir } as NodeJS.ProcessEnv;

    // No login file yet: both Pi harnesses say so.
    let response = await subscriptionStatusResponse(env);
    assert.equal(response.harnesses.pi_core.state, "login_missing");
    assert.equal(response.harnesses.pi_agenta.state, "login_missing");

    writeFileSync(join(piDir, "auth.json"), FAKE_LOGIN);

    response = await subscriptionStatusResponse(env);
    assert.deepEqual(response.harnesses.pi_core, { state: "ready" });
    assert.deepEqual(response.harnesses.pi_agenta, { state: "ready" });
  });

  it("serializes nothing but state words and provider names", async () => {
    const codexDir = join(root, "codex-home");
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(
      join(codexDir, "auth.json"),
      JSON.stringify({
        access_token: "fake-token-value",
        account: { email: "someone@example.com", plan: "fake-plan-name" },
      }),
    );
    const env = {
      CODEX_HOME: codexDir,
      CLAUDE_CONFIG_DIR: join(root, "never-mounted"),
    } as NodeJS.ProcessEnv;

    const response = await subscriptionStatusResponse(env);
    assert.equal(response.harnesses.codex.state, "ready");

    const serialized = JSON.stringify(response);
    for (const secret of [
      codexDir,
      root,
      tmpdir(),
      "auth.json",
      ".credentials.json",
      "fake-token-value",
      "someone@example.com",
      "fake-plan-name",
      "CODEX_HOME",
      "CLAUDE_CONFIG_DIR",
    ]) {
      assert.ok(
        !serialized.includes(secret),
        `response leaked ${secret}: ${serialized}`,
      );
    }

    // Positively: every value in the body is an allowed state or a provider constant.
    const allowedStates: SubscriptionState[] = [
      "ready",
      "not_configured",
      "login_missing",
      "login_unusable",
      "unsupported",
    ];
    for (const status of Object.values(response.harnesses)) {
      assert.ok(allowedStates.includes(status.state), status.state);
      if (status.provider !== undefined) {
        assert.ok(["openai", "anthropic"].includes(status.provider));
      }
    }
  });
});
