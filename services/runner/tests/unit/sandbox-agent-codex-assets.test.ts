/** Unit tests for the Codex managed-credential asset step. Run: pnpm exec vitest run tests/unit/sandbox-agent-codex-assets.test.ts */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
  isManagedCodexRun,
  isSubscriptionCodexRun,
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

  it("configureCodexHome for a subscription codex run sets CODEX_SQLITE_HOME but leaves CODEX_HOME (the mount) untouched", () => {
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
    assert.equal(env.CODEX_HOME, "/mnt/operator-codex");
    assert.equal(env.CODEX_SQLITE_HOME, codexSqliteHomeDir(cwd));
    assert.equal(existsSync(codexSqliteHomeDir(cwd)), true);
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
});
