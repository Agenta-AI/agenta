/**
 * Model credentials in process. Covers CR14 (no provider key may sit in the runner environment;
 * checked once at boot, R3-19) and R3-12 / Codex 10 (a subscription refresh goes through the same
 * locked, lineage-aware writer as a delivered login, so a refresh can never overwrite a newer
 * sign-in; its caller stops waiting at a deadline while the refresh finishes under its lock).
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRunnerConfig, RunnerConfigError } from "../../../src/config/runner-config.ts";
import { assertInProcessEnvironment } from "../../../src/engines/inprocess/index.ts";
import { providerKeysInEnvironment, SubscriptionCredentialStore } from "../../../src/engines/inprocess/pi/credentials.ts";
import { materializeSubscriptionLoginForRun } from "../../../src/engines/sandbox_agent/subscription-login/files.ts";

const login = (access: string, expires: number) => ({ type: "oauth", access, refresh: `r-${access}`, expires, accountId: "acct" });

describe("provider keys in the runner environment", () => {
  it("finds every variable pi-ai reads, and ambient cloud credentials", () => {
    expect(providerKeysInEnvironment({ OPENAI_API_KEY: "x", AWS_PROFILE: "p", UNRELATED: "y" })).toEqual(["AWS_PROFILE", "OPENAI_API_KEY"]);
  });

  it("refuses to boot with them when the provider is enabled, and only then", () => {
    const env = { AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "local,inprocess", AGENTA_RUNNER_DAYTONA_API_KEY: "k" };
    expect(() => assertInProcessEnvironment(parseRunnerConfig(env), { OPENAI_API_KEY: "sk" })).toThrow(RunnerConfigError);
    expect(() => assertInProcessEnvironment(parseRunnerConfig({}), { OPENAI_API_KEY: "sk" })).not.toThrow();
    const allowed = parseRunnerConfig({ ...env, AGENTA_RUNNER_INPROCESS_ALLOW_ENV_KEYS: "true" });
    expect(() => assertInProcessEnvironment(allowed, { OPENAI_API_KEY: "sk" })).not.toThrow();
  });

  it("removes the keys from the runner environment when no local sandbox can inherit them", () => {
    // A cloud runner gets the whole stage env file, provider keys included, and uses none of
    // them: `daytona` runs carry their own keys. Removing them keeps `inprocess` on with no setting.
    const env = { AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "daytona", AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER: "daytona", AGENTA_RUNNER_DAYTONA_API_KEY: "k" };
    for (const list of ["daytona", "daytona,inprocess"]) {
      const runnerEnv: Record<string, string | undefined> = { OPENAI_API_KEY: "sk-secret-value", AWS_ACCESS_KEY_ID: "a", PATH: "/bin" };
      const warnings: string[] = [];
      const config = assertInProcessEnvironment(
        parseRunnerConfig({ ...env, AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: list }),
        runnerEnv,
        (m) => warnings.push(m),
      );
      expect(config.providers.enabled).toContain("inprocess");
      expect(runnerEnv).toEqual({ PATH: "/bin" });
      expect(warnings.join("\n")).toMatch(/AWS_ACCESS_KEY_ID, OPENAI_API_KEY/);
      expect(warnings.join("\n")).not.toContain("sk-secret-value");
    }
  });

  it("drops an inprocess that daytona implied, with a warning, when a local sandbox may inherit the keys", () => {
    // `local` harness processes inherit the runner environment, so its keys stay; an implied
    // `inprocess` goes instead, and the deployment still boots as it did before.
    const env = { AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "local,daytona", AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER: "daytona", AGENTA_RUNNER_DAYTONA_API_KEY: "k" };
    const warnings: string[] = [];
    const config = assertInProcessEnvironment(parseRunnerConfig(env), { OPENAI_API_KEY: "sk-secret-value" }, (m) => warnings.push(m));
    expect(config.providers.enabled).toEqual(["local", "daytona"]);
    expect(warnings.join("\n")).toMatch(/OPENAI_API_KEY/);
    expect(warnings.join("\n")).not.toContain("sk-secret-value");
    // Without keys it stays.
    const clean = assertInProcessEnvironment(parseRunnerConfig(env), {}, (m) => warnings.push(m));
    expect(clean.providers.enabled).toEqual(["local", "daytona", "inprocess"]);
  });
});

describe("a subscription login", () => {
  it("is refreshed under the shared lock, and a login the API delivered meanwhile is not overwritten", async () => {
    const home = mkdtempSync(join(tmpdir(), "sub-"));
    await materializeSubscriptionLoginForRun({
      home,
      isDaytona: false,
      subscription: { id: "c", login: login("A", 1_000), version: 1, generation: 1 },
    });
    const store = new SubscriptionCredentialStore(home);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const holdsLock = new Promise<void>((r) => (locked = r));
    const refresh = store.modify("openai-codex", async (current) => {
      locked();
      await gate;
      return { ...current!, type: "oauth", access: "A-refreshed", refresh: "r-A2", expires: 2_000 };
    });
    // A new sign-in arrives while the refresh holds the lock: it waits, and wins afterwards.
    await holdsLock;
    const delivery = materializeSubscriptionLoginForRun({
      home,
      isDaytona: false,
      subscription: { id: "c", login: login("B", 1_500), version: 1, generation: 2 },
    });
    release();
    await refresh;
    expect((await delivery).write).toBe(true);
    const onDisk = JSON.parse(readFileSync(join(home, "auth.json"), "utf-8"));
    expect(onDisk["openai-codex"].access).toBe("B");
    expect((await store.read("openai-codex"))).toMatchObject({ access: "B" });
  });

  it("stops waiting at the deadline, and the refresh that finishes later still writes its rotated token", async () => {
    const home = mkdtempSync(join(tmpdir(), "sub-"));
    writeFileSync(join(home, "auth.json"), JSON.stringify({ "openai-codex": login("A", 1_000) }));
    const store = new SubscriptionCredentialStore(home, 100);
    let finish!: () => void;
    const late = new Promise<void>((r) => (finish = r));
    const t0 = Date.now();
    await expect(
      store.modify("openai-codex", async (current) => {
        await late;
        return { ...current!, type: "oauth", access: "A-rotated", refresh: "r-rotated", expires: 3_000 };
      }),
    ).rejects.toThrow(/abort/i);
    expect(Date.now() - t0).toBeLessThan(1_000);
    finish();
    await new Promise((r) => setTimeout(r, 300));
    expect(JSON.parse(readFileSync(join(home, "auth.json"), "utf-8"))["openai-codex"].refresh).toBe("r-rotated");
  });
});

describe("configuration", () => {
  it("needs Daytona", () => {
    const env = { AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: "inprocess", AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER: "inprocess" };
    expect(() => parseRunnerConfig(env)).toThrow(/DAYTONA_API_KEY is required/);
    expect(parseRunnerConfig({ ...env, AGENTA_RUNNER_DAYTONA_API_KEY: "k" }).providers.enabled).toContain("inprocess");
  });
});
