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
  codexDaytonaHomeDir,
  codexDaytonaSqliteHomeDir,
  isManagedCodexRun,
  isSubscriptionCodexRun,
  symlinkCodexSubscriptionAuthFile,
  writeCodexDaytonaManagedAuthFile,
  writeCodexManagedAuthFile,
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
      credentialMode: "env",
      isDaytona: false,
      cwd,
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
      credentialMode: "env",
      isDaytona: false,
      cwd,
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
      credentialMode: "runtime_provided",
      isDaytona: false,
      cwd,
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
      credentialMode: "env",
      isDaytona: false,
      cwd,
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
      credentialMode: "env",
      isDaytona: true,
      cwd,
      secrets: { OPENAI_API_KEY: "sk-live" },
      legacyHarnessApiKeyVar: "OPENAI_API_KEY",
    } as any;

    assert.equal(configureCodexHome(plan, env), undefined);
    assert.equal(env.CODEX_HOME, undefined);
    assert.equal(env.CODEX_SQLITE_HOME, undefined);
  });

  it("writeCodexManagedAuthFile writes auth.json 0600 with the OPENAI_API_KEY field and returns the created path", () => {
    const plan = {
      acpAgent: "codex",
      credentialMode: "env",
      isDaytona: false,
      cwd,
      secrets: { OPENAI_API_KEY: "sk-live" },
      legacyHarnessApiKeyVar: "OPENAI_API_KEY",
    } as any;

    const { authFilePath } = writeCodexManagedAuthFile(plan);
    const home = codexHomeDir(cwd);
    const expectedPath = join(home, "auth.json");

    assert.equal(authFilePath, expectedPath);
    assert.equal(existsSync(expectedPath), true);
    assert.deepEqual(JSON.parse(readFileSync(expectedPath, "utf-8")), {
      OPENAI_API_KEY: "sk-live",
    });
    assert.equal(statSync(expectedPath).mode & 0o777, 0o600);
    assert.equal(statSync(home).mode & 0o777, 0o700);
  });

  it("writeCodexManagedAuthFile does not overwrite a pre-existing auth.json and returns undefined (delete-only-if-created)", () => {
    const home = codexHomeDir(cwd);
    const existingPath = join(home, "auth.json");
    const sentinel = '{"sentinel":"keep-me"}';
    mkdirSync(home, { recursive: true });
    writeFileSync(existingPath, sentinel, "utf-8");
    const plan = {
      acpAgent: "codex",
      credentialMode: "env",
      isDaytona: false,
      cwd,
      secrets: { OPENAI_API_KEY: "sk-live" },
      legacyHarnessApiKeyVar: "OPENAI_API_KEY",
    } as any;

    const { authFilePath } = writeCodexManagedAuthFile(plan);

    assert.equal(authFilePath, undefined);
    assert.equal(readFileSync(existingPath, "utf-8"), sentinel);
  });

  it("writeCodexManagedAuthFile is a no-op with no resolved key", () => {
    const plan = {
      acpAgent: "codex",
      credentialMode: "env",
      isDaytona: false,
      cwd,
      secrets: {},
      legacyHarnessApiKeyVar: "OPENAI_API_KEY",
    } as any;

    const { authFilePath } = writeCodexManagedAuthFile(plan);

    assert.equal(authFilePath, undefined);
    assert.equal(existsSync(join(codexHomeDir(cwd), "auth.json")), false);
  });

  it("writeCodexManagedAuthFile is a no-op for a non-codex run and for a Daytona codex run", () => {
    const plans = [
      {
        acpAgent: "claude",
        credentialMode: "env",
        isDaytona: false,
        cwd,
        secrets: { OPENAI_API_KEY: "sk-live" },
        legacyHarnessApiKeyVar: "OPENAI_API_KEY",
      },
      {
        acpAgent: "codex",
        credentialMode: "env",
        isDaytona: true,
        cwd,
        secrets: { OPENAI_API_KEY: "sk-live" },
        legacyHarnessApiKeyVar: "OPENAI_API_KEY",
      },
    ] as any[];

    for (const plan of plans) {
      const { authFilePath } = writeCodexManagedAuthFile(plan);
      assert.equal(authFilePath, undefined);
      assert.equal(existsSync(join(codexHomeDir(cwd), "auth.json")), false);
    }
  });

  it("isManagedCodexRun identifies only managed Codex runs", () => {
    assert.equal(
      isManagedCodexRun({
        acpAgent: "codex",
        credentialMode: "env",
      } as any),
      true,
    );
    assert.equal(
      isManagedCodexRun({
        acpAgent: "codex",
        credentialMode: "none",
      } as any),
      true,
    );
    assert.equal(
      isManagedCodexRun({
        acpAgent: "codex",
        credentialMode: undefined,
      } as any),
      true,
    );
    assert.equal(
      isManagedCodexRun({
        acpAgent: "codex",
        credentialMode: "runtime_provided",
      } as any),
      false,
    );
    assert.equal(
      isManagedCodexRun({
        acpAgent: "claude",
        credentialMode: "env",
      } as any),
      false,
    );
  });

  it("isSubscriptionCodexRun identifies only subscription Codex runs", () => {
    assert.equal(
      isSubscriptionCodexRun({
        acpAgent: "codex",
        credentialMode: "runtime_provided",
      } as any),
      true,
    );
    assert.equal(
      isSubscriptionCodexRun({
        acpAgent: "codex",
        credentialMode: "env",
      } as any),
      false,
    );
    assert.equal(
      isSubscriptionCodexRun({
        acpAgent: "claude",
        credentialMode: "runtime_provided",
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
        credentialMode: "runtime_provided",
        isDaytona: false,
        cwd,
      }) as any;

    it("symlinks <cwd>/.codex/auth.json to the mount's auth.json and links nothing else", () => {
      const { authFilePath } = symlinkCodexSubscriptionAuthFile(subPlan());
      const linkPath = join(codexHomeDir(cwd), "auth.json");

      assert.equal(authFilePath, linkPath);
      assert.equal(lstatSync(linkPath).isSymbolicLink(), true);
      assert.equal(readlinkSync(linkPath), join(mount, "auth.json"));
      // The operator's config.toml is NOT copied/linked into the session home (leak closed).
      assert.equal(existsSync(join(codexHomeDir(cwd), "config.toml")), false);
      // Reading through the link reaches the mount's credential.
      assert.deepEqual(JSON.parse(readFileSync(linkPath, "utf-8")), {
        tokens: { access_token: "x" },
      });
    });

    it("does not clobber a pre-existing auth.json and returns undefined (delete-only-if-created)", () => {
      const home = codexHomeDir(cwd);
      mkdirSync(home, { recursive: true });
      writeFileSync(join(home, "auth.json"), '{"sentinel":true}');

      const { authFilePath } = symlinkCodexSubscriptionAuthFile(subPlan());

      assert.equal(authFilePath, undefined);
      assert.equal(lstatSync(join(home, "auth.json")).isSymbolicLink(), false);
    });

    it("is a no-op when CODEX_HOME (the mount) is unset", () => {
      delete process.env.CODEX_HOME;
      const { authFilePath } = symlinkCodexSubscriptionAuthFile(subPlan());
      assert.equal(authFilePath, undefined);
      assert.equal(existsSync(join(codexHomeDir(cwd), "auth.json")), false);
    });

    it("is a no-op for a managed run, a Daytona subscription run, and a non-codex run", () => {
      const plans = [
        { acpAgent: "codex", credentialMode: "env", isDaytona: false, cwd },
        {
          acpAgent: "codex",
          credentialMode: "runtime_provided",
          isDaytona: true,
          cwd,
        },
        {
          acpAgent: "claude",
          credentialMode: "runtime_provided",
          isDaytona: false,
          cwd,
        },
      ] as any[];
      for (const plan of plans) {
        assert.equal(
          symlinkCodexSubscriptionAuthFile(plan).authFilePath,
          undefined,
        );
      }
      assert.equal(existsSync(join(codexHomeDir(cwd), "auth.json")), false);
    });
  });

  describe("Codex managed Daytona assets", () => {
    it("configureDaytonaCodexEnv sets in-VM CODEX_HOME + CODEX_SQLITE_HOME for a managed Daytona codex run", () => {
      const env: Record<string, string> = {};
      const plan = {
        acpAgent: "codex",
        credentialMode: "env",
        isDaytona: true,
        cwd,
      } as any;

      configureDaytonaCodexEnv(plan, env);

      assert.equal(env.CODEX_HOME, codexDaytonaHomeDir(cwd));
      assert.equal(env.CODEX_SQLITE_HOME, codexDaytonaSqliteHomeDir(cwd));
      // In-VM base, never the durable geesefs cwd.
      assert.ok(env.CODEX_HOME.startsWith("/home/sandbox/agenta/"));
      assert.ok(!env.CODEX_HOME.startsWith(cwd));
      assert.equal(basename(env.CODEX_HOME), basename(cwd));
    });

    it("configureDaytonaCodexEnv is a no-op for local, subscription, and non-codex Daytona runs", () => {
      const plans = [
        { acpAgent: "codex", credentialMode: "env", isDaytona: false, cwd },
        {
          acpAgent: "codex",
          credentialMode: "runtime_provided",
          isDaytona: true,
          cwd,
        },
        { acpAgent: "claude", credentialMode: "env", isDaytona: true, cwd },
        { acpAgent: "pi", credentialMode: "env", isDaytona: true, cwd },
      ] as any[];
      for (const plan of plans) {
        const env: Record<string, string> = {};
        configureDaytonaCodexEnv(plan, env);
        assert.deepEqual(env, {});
      }
    });

    it("writeCodexDaytonaManagedAuthFile writes {OPENAI_API_KEY} into the in-VM home via the sandbox FS API", async () => {
      const writes: Array<{ path: string; contents: string }> = [];
      const mkdirs: string[] = [];
      const sandbox = {
        mkdirFs: async ({ path }: { path: string }) => {
          mkdirs.push(path);
        },
        writeFsFile: async ({ path }: { path: string }, contents: string) => {
          writes.push({ path, contents });
        },
      };
      const plan = {
        acpAgent: "codex",
        credentialMode: "env",
        isDaytona: true,
        cwd,
        secrets: { OPENAI_API_KEY: "sk-placeholder-or-live" },
        legacyHarnessApiKeyVar: "OPENAI_API_KEY",
      } as any;

      await writeCodexDaytonaManagedAuthFile(sandbox, plan);

      const home = codexDaytonaHomeDir(cwd);
      assert.deepEqual(mkdirs, [home]);
      assert.equal(writes.length, 1);
      assert.equal(writes[0].path, join(home, "auth.json"));
      // The key is written opaquely (no parsing/reformatting) — Daytona-Secrets #5277 placeholder compat.
      assert.deepEqual(JSON.parse(writes[0].contents), {
        OPENAI_API_KEY: "sk-placeholder-or-live",
      });
    });

    it("writeCodexDaytonaManagedAuthFile no-ops without a key, and for local / subscription / non-codex runs", async () => {
      const calls: string[] = [];
      const sandbox = {
        mkdirFs: async ({ path }: { path: string }) => {
          calls.push(`mkdir:${path}`);
        },
        writeFsFile: async ({ path }: { path: string }) => {
          calls.push(`write:${path}`);
        },
      };
      const plans = [
        // Managed Daytona codex but NO resolved key.
        {
          acpAgent: "codex",
          credentialMode: "env",
          isDaytona: true,
          cwd,
          secrets: {},
          legacyHarnessApiKeyVar: "OPENAI_API_KEY",
        },
        // Local codex (handled by writeCodexManagedAuthFile, not this Daytona writer).
        {
          acpAgent: "codex",
          credentialMode: "env",
          isDaytona: false,
          cwd,
          secrets: { OPENAI_API_KEY: "sk" },
          legacyHarnessApiKeyVar: "OPENAI_API_KEY",
        },
        // Subscription Daytona (rejected up front in run-plan anyway).
        {
          acpAgent: "codex",
          credentialMode: "runtime_provided",
          isDaytona: true,
          cwd,
          secrets: { OPENAI_API_KEY: "sk" },
          legacyHarnessApiKeyVar: "OPENAI_API_KEY",
        },
        // Non-codex Daytona.
        {
          acpAgent: "claude",
          credentialMode: "env",
          isDaytona: true,
          cwd,
          secrets: { ANTHROPIC_API_KEY: "sk" },
          legacyHarnessApiKeyVar: "ANTHROPIC_API_KEY",
        },
      ] as any[];
      for (const plan of plans) {
        await writeCodexDaytonaManagedAuthFile(sandbox, plan);
      }
      assert.deepEqual(calls, []);
    });
  });
});
