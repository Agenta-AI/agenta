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

/** A Pi `auth.json`: provider id -> login. Same shape Pi writes, with invented credentials. */
const piAuth = (entries: Record<string, unknown>) => JSON.stringify(entries);

const FAKE_OAUTH_LOGIN = {
  type: "oauth",
  access: "fake-access",
  refresh: "fake-refresh",
  expires: 1,
};

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
    // Pi is not tied to one provider, so it reports no provider at all.
    assert.deepEqual(await harnessSubscriptionStatus("pi_core", {}), {
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
    const piMount = mount("PI_CODING_AGENT_DIR", "auth.json");
    assert.deepEqual(await harnessSubscriptionStatus("pi_core", piMount), {
      state: "ready",
    });
  });

  it("names the provider families a Pi login holds", async () => {
    // One mount, two plans: this is the only way the card can say WHICH plan a ready Pi runs.
    const env = mount(
      "PI_CODING_AGENT_DIR",
      "auth.json",
      piAuth({
        "openai-codex": { ...FAKE_OAUTH_LOGIN, accountId: "fake-account" },
        anthropic: FAKE_OAUTH_LOGIN,
      }),
    );

    assert.deepEqual(await harnessSubscriptionStatus("pi_core", env), {
      state: "ready",
      providers: ["anthropic", "openai"],
    });
  });

  it("ignores a login id it has no provider family for", async () => {
    // A real Pi login (GitHub Copilot) and an invented one: both are logins we cannot name a plan
    // for, so the harness stays ready and says nothing about them.
    const env = mount(
      "PI_CODING_AGENT_DIR",
      "auth.json",
      piAuth({
        "github-copilot": FAKE_OAUTH_LOGIN,
        "some-future-provider": FAKE_OAUTH_LOGIN,
      }),
    );

    assert.deepEqual(await harnessSubscriptionStatus("pi_core", env), {
      state: "ready",
    });
  });

  it("counts subscription logins only, never a pasted API key", async () => {
    const env = mount(
      "PI_CODING_AGENT_DIR",
      "auth.json",
      piAuth({
        anthropic: { type: "api_key", key: "fake-key" },
        "openai-codex": FAKE_OAUTH_LOGIN,
      }),
    );

    assert.deepEqual(await harnessSubscriptionStatus("pi_core", env), {
      state: "ready",
      providers: ["openai"],
    });
  });

  it("reads a login Pi wrote before it tagged the type", async () => {
    const env = mount(
      "PI_CODING_AGENT_DIR",
      "auth.json",
      piAuth({ anthropic: { access: "fake-access", refresh: "fake-refresh" } }),
    );

    assert.deepEqual(await harnessSubscriptionStatus("pi_core", env), {
      state: "ready",
      providers: ["anthropic"],
    });
  });

  it("keeps the state ladder when the Pi login file is malformed", async () => {
    // Unparseable: the ladder already calls this unusable, and no provider list is attempted.
    assert.deepEqual(
      await harnessSubscriptionStatus(
        "pi_core",
        mount("PI_CODING_AGENT_DIR", "auth.json", "{ not json"),
      ),
      { state: "login_unusable" },
    );

    // Parses, but the entries are not logins: still a login file the harness can open, so the
    // state stands and only the naming is lost.
    assert.deepEqual(
      await harnessSubscriptionStatus(
        "pi_core",
        mount(
          "PI_CODING_AGENT_DIR",
          "auth.json",
          piAuth({ anthropic: "not-an-object", "openai-codex": null }),
        ),
      ),
      { state: "ready" },
    );
  });

  it("names no providers for a harness tied to one", async () => {
    // Codex reads a login file of its own shape; its provider is the harness constant, and a
    // `providers` list would be a second answer to the same question.
    const status = await harnessSubscriptionStatus(
      "codex",
      mount("CODEX_HOME", "auth.json", piAuth({ anthropic: FAKE_OAUTH_LOGIN })),
    );

    assert.deepEqual(status, { state: "ready", provider: "openai" });
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
  });

  it("reports the Pi states from the one Pi mount", async () => {
    const piDir = join(root, "pi-agent");
    mkdirSync(piDir, { recursive: true });
    const env = { PI_CODING_AGENT_DIR: piDir } as NodeJS.ProcessEnv;

    // No login file yet.
    let response = await subscriptionStatusResponse(env);
    assert.equal(response.harnesses.pi_core.state, "login_missing");

    writeFileSync(join(piDir, "auth.json"), FAKE_LOGIN);

    response = await subscriptionStatusResponse(env);
    assert.deepEqual(response.harnesses.pi_core, { state: "ready" });
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
    // A Pi login is the one file this module reads INTO, so its values are the ones most at risk.
    const piDir = join(root, "pi-agent");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(
      join(piDir, "auth.json"),
      JSON.stringify({
        "openai-codex": {
          type: "oauth",
          access: "fake-pi-access-token",
          refresh: "fake-pi-refresh-token",
          expires: 1,
          accountId: "fake-pi-account-id",
        },
      }),
    );
    const env = {
      CODEX_HOME: codexDir,
      CLAUDE_CONFIG_DIR: join(root, "never-mounted"),
      PI_CODING_AGENT_DIR: piDir,
    } as NodeJS.ProcessEnv;

    const response = await subscriptionStatusResponse(env);
    assert.equal(response.harnesses.codex.state, "ready");
    assert.deepEqual(response.harnesses.pi_core.providers, ["openai"]);

    const serialized = JSON.stringify(response);
    for (const secret of [
      codexDir,
      piDir,
      root,
      tmpdir(),
      "auth.json",
      ".credentials.json",
      "fake-token-value",
      "someone@example.com",
      "fake-plan-name",
      "fake-pi-access-token",
      "fake-pi-refresh-token",
      "fake-pi-account-id",
      "openai-codex",
      "oauth",
      "CODEX_HOME",
      "CLAUDE_CONFIG_DIR",
      "PI_CODING_AGENT_DIR",
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
      for (const family of status.providers ?? []) {
        assert.ok(["openai", "anthropic"].includes(family), family);
      }
    }
  });
});
