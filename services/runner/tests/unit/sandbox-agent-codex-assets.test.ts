/** Unit tests for the Codex managed-credential asset step. Run: pnpm exec vitest run tests/unit/sandbox-agent-codex-assets.test.ts */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  CODEX_HOME_DIRNAME,
  codexHomeDir,
  codexSqliteHomeDir,
  configureCodexHome,
  configureDaytonaCodexEnv,
  codexDaytonaSqliteHomeDir,
  isManagedCodexRun,
  isSubscriptionCodexRun,
  symlinkCodexSubscriptionAuthFile,
} from "../../src/engines/sandbox_agent/codex-assets.ts";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "codex-assets-"));
});

afterEach(() => {
  rmSync(codexSqliteHomeDir(cwd), { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe("Codex managed-credential assets", () => {
  it("configureCodexHome sets CODEX_HOME and local CODEX_SQLITE_HOME for a managed codex run", () => {
    const env: Record<string, string> = {};
    const plan = {
      acpAgent: "codex",
      credentials: { credentialMode: "env" },
      isDaytona: false,
      workspace: { cwd },
      secrets: { OPENAI_API_KEY: "sk-live" },
      legacyHarnessApiKeyVar: "OPENAI_API_KEY",
    } as any;

    const sqliteHome = configureCodexHome(plan, env);

    assert.equal(sqliteHome, codexSqliteHomeDir(cwd));
    assert.equal(codexHomeDir(cwd), join(cwd, CODEX_HOME_DIRNAME));
    assert.equal(codexHomeDir(cwd), join(cwd, ".codex"));
    assert.equal(env.CODEX_HOME, codexHomeDir(cwd));
    assert.equal(env.CODEX_SQLITE_HOME, codexSqliteHomeDir(cwd));
    assert.equal(existsSync(codexSqliteHomeDir(cwd)), true);
    assert.ok(!codexSqliteHomeDir(cwd).startsWith(cwd));
  });

  it("codexSqliteHomeDir is a per-session-stable sibling under tmpdir, not the cwd", () => {
    const first = codexSqliteHomeDir(cwd);
    const second = codexSqliteHomeDir(cwd);

    assert.ok(first.startsWith(join(tmpdir(), "agenta", "codex-sqlite")));
    assert.ok(first.endsWith(basename(cwd)));
    assert.equal(first, second);
    assert.ok(!first.startsWith(cwd));
  });

  it("configureCodexHome is a no-op for a non-codex run", () => {
    const env: Record<string, string> = {};
    const plan = {
      acpAgent: "claude",
      credentials: { credentialMode: "env" },
      isDaytona: false,
      workspace: { cwd },
      secrets: { OPENAI_API_KEY: "sk-live" },
      legacyHarnessApiKeyVar: "OPENAI_API_KEY",
    } as any;

    assert.equal(configureCodexHome(plan, env), undefined);
    assert.equal(env.CODEX_HOME, undefined);
    assert.equal(env.CODEX_SQLITE_HOME, undefined);
  });

  it("configureCodexHome for a subscription codex run points CODEX_HOME at the runner-owned home (NOT the mount), redirects SQLite, and pins the store to file", () => {
    // The daemon env arrives carrying the operator's inherited mount path; a subscription run must
    // OVERRIDE it to <cwd>/.codex so the operator's config/plugins/apps never load.
    const env: Record<string, string> = {
      CODEX_HOME: "/mnt/operator-codex",
    };
    const plan = {
      acpAgent: "codex",
      credentials: { credentialMode: "runtime_provided" },
      isDaytona: false,
      workspace: { cwd },
      secrets: { OPENAI_API_KEY: "sk-live" },
      legacyHarnessApiKeyVar: "OPENAI_API_KEY",
    } as any;

    assert.equal(configureCodexHome(plan, env), codexSqliteHomeDir(cwd));
    assert.equal(env.CODEX_HOME, codexHomeDir(cwd));
    assert.notEqual(env.CODEX_HOME, "/mnt/operator-codex");
    assert.equal(env.CODEX_SQLITE_HOME, codexSqliteHomeDir(cwd));
    assert.equal(existsSync(codexSqliteHomeDir(cwd)), true);
    // Store-mode pin: exactly one key, and never sandbox_mode (D-008 poison combo).
    assert.equal(
      env.CODEX_CONFIG,
      JSON.stringify({ cli_auth_credentials_store: "file" }),
    );
    assert.equal(env.CODEX_CONFIG.includes("sandbox_mode"), false);
  });

  it("configureCodexHome for a MANAGED codex run emits no CODEX_CONFIG", () => {
    const env: Record<string, string> = {};
    const plan = {
      acpAgent: "codex",
      credentials: { credentialMode: "env" },
      isDaytona: false,
      workspace: { cwd },
      secrets: { OPENAI_API_KEY: "sk-live" },
      legacyHarnessApiKeyVar: "OPENAI_API_KEY",
    } as any;

    configureCodexHome(plan, env);
    assert.equal(env.CODEX_HOME, codexHomeDir(cwd));
    assert.equal(env.CODEX_CONFIG, undefined);
  });

  it("configureCodexHome is a no-op for a Daytona codex run", () => {
    const env: Record<string, string> = {};
    const plan = {
      acpAgent: "codex",
      credentials: { credentialMode: "env" },
      isDaytona: true,
      workspace: { cwd },
      secrets: { OPENAI_API_KEY: "sk-live" },
      legacyHarnessApiKeyVar: "OPENAI_API_KEY",
    } as any;

    assert.equal(configureCodexHome(plan, env), undefined);
    assert.equal(env.CODEX_HOME, undefined);
    assert.equal(env.CODEX_SQLITE_HOME, undefined);
  });

  it("managed codex is FILE-FREE: no auth.json is written under the home for a managed run", () => {
    // The managed-auth writers were removed (D-002 final ruling): managed auth is delivered by the
    // SDK-rendered custom provider (env_key OPENAI_API_KEY) in config.toml, read from the daemon env
    // at request time. configureCodexHome sets the home + SQLite redirect but writes no credential.
    const env: Record<string, string> = {};
    const plan = {
      acpAgent: "codex",
      credentials: { credentialMode: "env" },
      isDaytona: false,
      workspace: { cwd },
      secrets: { OPENAI_API_KEY: "sk-live" },
      legacyHarnessApiKeyVar: "OPENAI_API_KEY",
    } as any;

    configureCodexHome(plan, env);

    assert.equal(env.CODEX_HOME, codexHomeDir(cwd));
    assert.equal(existsSync(join(codexHomeDir(cwd), "auth.json")), false);
  });

  it("isManagedCodexRun identifies only managed Codex runs", () => {
    assert.equal(
      isManagedCodexRun({
        acpAgent: "codex",
        credentials: { credentialMode: "env" },
      } as any),
      true,
    );
    assert.equal(
      isManagedCodexRun({
        acpAgent: "codex",
        credentials: { credentialMode: "none" },
      } as any),
      true,
    );
    assert.equal(
      isManagedCodexRun({
        acpAgent: "codex",
        credentials: { credentialMode: undefined },
      } as any),
      true,
    );
    assert.equal(
      isManagedCodexRun({
        acpAgent: "codex",
        credentials: { credentialMode: "runtime_provided" },
      } as any),
      false,
    );
    assert.equal(
      isManagedCodexRun({
        acpAgent: "claude",
        credentials: { credentialMode: "env" },
      } as any),
      false,
    );
  });

  it("isSubscriptionCodexRun identifies only subscription Codex runs", () => {
    assert.equal(
      isSubscriptionCodexRun({
        acpAgent: "codex",
        credentials: { credentialMode: "runtime_provided" },
      } as any),
      true,
    );
    assert.equal(
      isSubscriptionCodexRun({
        acpAgent: "codex",
        credentials: { credentialMode: "env" },
      } as any),
      false,
    );
    assert.equal(
      isSubscriptionCodexRun({
        acpAgent: "claude",
        credentials: { credentialMode: "runtime_provided" },
      } as any),
      false,
    );
  });

  describe("symlinkCodexSubscriptionAuthFile", () => {
    let mount: string;
    let savedCodexHome: string | undefined;

    beforeEach(() => {
      mount = mkdtempSync(join(tmpdir(), "codex-mount-"));
      writeFileSync(join(mount, "auth.json"), '{"tokens":{"access_token":"x"}}');
      // Also plant a config.toml in the mount: it must NOT be linked into the session home.
      writeFileSync(join(mount, "config.toml"), '[mcp_servers.leak]\nurl="http://x"\n');
      savedCodexHome = process.env.CODEX_HOME;
      process.env.CODEX_HOME = mount;
    });

    afterEach(() => {
      if (savedCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = savedCodexHome;
      rmSync(mount, { recursive: true, force: true });
    });

    const subPlan = () =>
      ({
        acpAgent: "codex",
        credentials: { credentialMode: "runtime_provided" },
        isDaytona: false,
        workspace: { cwd },
      }) as any;

    it("symlinks <cwd>/.codex/auth.json to the mount's auth.json and links nothing else", () => {
      symlinkCodexSubscriptionAuthFile(subPlan());
      const linkPath = join(codexHomeDir(cwd), "auth.json");

      assert.equal(lstatSync(linkPath).isSymbolicLink(), true);
      assert.equal(readlinkSync(linkPath), join(mount, "auth.json"));
      // The operator's config.toml is NOT copied/linked into the session home (leak closed).
      assert.equal(existsSync(join(codexHomeDir(cwd), "config.toml")), false);
      // Reading through the link reaches the mount's credential.
      assert.deepEqual(JSON.parse(readFileSync(linkPath, "utf-8")), {
        tokens: { access_token: "x" },
      });
    });

    it("does not clobber a pre-existing auth.json (idempotent across resume)", () => {
      const home = codexHomeDir(cwd);
      mkdirSync(home, { recursive: true });
      writeFileSync(join(home, "auth.json"), '{"sentinel":true}');

      symlinkCodexSubscriptionAuthFile(subPlan());

      assert.equal(lstatSync(join(home, "auth.json")).isSymbolicLink(), false);
    });

    it("is a no-op when CODEX_HOME (the mount) is unset", () => {
      delete process.env.CODEX_HOME;
      symlinkCodexSubscriptionAuthFile(subPlan());
      assert.equal(existsSync(join(codexHomeDir(cwd), "auth.json")), false);
    });

    it("is a no-op for a managed run, a Daytona subscription run, and a non-codex run", () => {
      const plans = [
        {
          acpAgent: "codex",
          credentials: { credentialMode: "env" },
          isDaytona: false,
          workspace: { cwd },
        },
        {
          acpAgent: "codex",
          credentials: { credentialMode: "runtime_provided" },
          isDaytona: true,
          workspace: { cwd },
        },
        {
          acpAgent: "claude",
          credentials: { credentialMode: "runtime_provided" },
          isDaytona: false,
          workspace: { cwd },
        },
      ] as any[];
      for (const plan of plans) {
        symlinkCodexSubscriptionAuthFile(plan);
      }
      assert.equal(existsSync(join(codexHomeDir(cwd), "auth.json")), false);
    });
  });

  describe("Codex managed Daytona assets", () => {
    it("configureDaytonaCodexEnv sets DURABLE <cwd>/.codex CODEX_HOME + in-VM CODEX_SQLITE_HOME for a managed Daytona codex run", () => {
      const env: Record<string, string> = {};
      const plan = {
        acpAgent: "codex",
        credentials: { credentialMode: "env" },
        isDaytona: true,
        workspace: { cwd },
      } as any;

      configureDaytonaCodexEnv(plan, env);

      // CODEX_HOME on the durable cwd (native rollouts persist; D-002 final ruling).
      assert.equal(env.CODEX_HOME, codexHomeDir(cwd));
      assert.equal(env.CODEX_HOME, join(cwd, ".codex"));
      // SQLite redirected off the mount to in-VM disk (geesefs WAL constraint).
      assert.equal(env.CODEX_SQLITE_HOME, codexDaytonaSqliteHomeDir(cwd));
      assert.ok(env.CODEX_SQLITE_HOME.startsWith("/home/sandbox/agenta/"));
      assert.ok(!env.CODEX_SQLITE_HOME.startsWith(cwd));
    });

    it("configureDaytonaCodexEnv is a no-op for local, subscription, and non-codex Daytona runs", () => {
      const plans = [
        {
          acpAgent: "codex",
          credentials: { credentialMode: "env" },
          isDaytona: false,
          workspace: { cwd },
        },
        {
          acpAgent: "codex",
          credentials: { credentialMode: "runtime_provided" },
          isDaytona: true,
          workspace: { cwd },
        },
        {
          acpAgent: "claude",
          credentials: { credentialMode: "env" },
          isDaytona: true,
          workspace: { cwd },
        },
        {
          acpAgent: "pi",
          credentials: { credentialMode: "env" },
          isDaytona: true,
          workspace: { cwd },
        },
      ] as any[];
      for (const plan of plans) {
        const env: Record<string, string> = {};
        configureDaytonaCodexEnv(plan, env);
        assert.deepEqual(env, {});
      }
    });

    it("managed Daytona codex writes NO auth.json (file-free) — the SDK renders the custom provider instead", () => {
      // The Daytona managed-auth writer was removed. Nothing in this module writes a credential for
      // a managed Daytona run; auth rides OPENAI_API_KEY in the daemon env (daytonaEnvVars spreads
      // plan.secrets) read at request time by the SDK-rendered custom provider.
      const env: Record<string, string> = {};
      configureDaytonaCodexEnv(
        {
          acpAgent: "codex",
          credentials: { credentialMode: "env" },
          isDaytona: true,
          workspace: { cwd },
        } as any,
        env,
      );
      assert.equal(existsSync(join(codexHomeDir(cwd), "auth.json")), false);
    });
  });
});
