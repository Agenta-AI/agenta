import assert from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it } from "vitest";

import {
  AGENT_TOOLS_SETUP_TIMEOUT_MS,
  agentToolsLocalDir,
  agentToolsSetupEnv,
  agentToolsSetupScript,
  localAgentToolsExec,
  remoteAgentToolsExec,
  runAgentToolsSetup,
} from "../../src/engines/sandbox_agent/agent-tools-setup.ts";

const SILENT = () => {};

describe("agentToolsSetupScript", () => {
  it("exits 0 with no shell work when the agent has no .tools folder", () => {
    const script = agentToolsSetupScript("/mnt/agent", "/work/cwd", "/tmp/t");
    assert.ok(script.startsWith("[ -d '/mnt/agent/.tools' ] || exit 0"));
  });

  it("links <cwd>/.tools to local disk, copies binaries there, then execs setup.sh", () => {
    const script = agentToolsSetupScript("/mnt/agent", "/work/cwd", "/tmp/t");
    // The cwd is a geesefs mount where the exec bit does not survive, so the bytes live on
    // local disk and the cwd only carries a link (recreated every session).
    assert.ok(script.includes("ln -sfn '/tmp/t' '/work/cwd/.tools'"), script);
    assert.ok(
      script.includes("cp -f '/mnt/agent/.tools'/bin/* '/tmp/t'/bin/"),
      script,
    );
    assert.ok(script.includes("chmod +x '/tmp/t'/bin/*"), script);
    assert.match(script, /exec sh '\/mnt\/agent\/.tools\/setup.sh'$/);
  });

  it("tells the script where the durable folder and the local tools dir are", () => {
    assert.deepEqual(agentToolsSetupEnv("/mnt/agent", "/tmp/t"), {
      AGENT_FILES: "/mnt/agent",
      AGENT_TOOLS_DIR: "/tmp/t",
    });
  });

  it("keys the local dir by the session cwd, under /tmp on a remote sandbox", () => {
    assert.equal(
      agentToolsLocalDir("/home/sandbox/mounts/sess-1", true),
      "/tmp/agenta-tools/sess-1",
    );
    assert.ok(
      agentToolsLocalDir("/x/y/sess-2", false).endsWith("/agenta-tools/sess-2"),
    );
  });
});

describe("runAgentToolsSetup", () => {
  it("reports absent without running anything when the local stat says no .tools", async () => {
    let ran = false;
    const result = await runAgentToolsSetup(
      { mountPath: "/mnt/agent", cwd: "/work", localDir: "/tmp/t" },
      {
        run: async () => {
          ran = true;
          return { exitCode: 0 };
        },
      },
      { log: SILENT, hasToolsDir: async () => false },
    );
    assert.deepEqual(result, { status: "absent" });
    assert.equal(ran, false);
  });

  it("passes the script, cwd, env, and the timeout to the executor", async () => {
    let seen: unknown;
    const result = await runAgentToolsSetup(
      { mountPath: "/mnt/agent", cwd: "/work", localDir: "/tmp/t" },
      {
        run: async (opts) => {
          seen = opts;
          return { exitCode: 0 };
        },
      },
      { log: SILENT },
    );
    assert.equal(result.status, "ok");
    const opts = seen as {
      cwd: string;
      timeoutMs: number;
      env: Record<string, string>;
    };
    assert.equal(opts.cwd, "/work");
    assert.equal(opts.timeoutMs, AGENT_TOOLS_SETUP_TIMEOUT_MS);
    assert.equal(opts.env.AGENT_FILES, "/mnt/agent");
  });

  it("never throws: a failing script is reported, an executor error is reported", async () => {
    const failed = await runAgentToolsSetup(
      { mountPath: "/m", cwd: "/w", localDir: "/tmp/t" },
      { run: async () => ({ exitCode: 3 }) },
      { log: SILENT },
    );
    assert.equal(failed.status, "failed");
    assert.equal((failed as { exitCode?: number }).exitCode, 3);

    const errored = await runAgentToolsSetup(
      { mountPath: "/m", cwd: "/w", localDir: "/tmp/t" },
      {
        run: async () => {
          throw new Error("sandbox gone");
        },
      },
      { log: SILENT },
    );
    assert.equal(errored.status, "error");
    assert.match((errored as { message: string }).message, /sandbox gone/);
  });

  it("remote executor runs `sh -c` in the sandbox with the session cwd", async () => {
    const calls: unknown[] = [];
    const exec = remoteAgentToolsExec({
      runProcess: async (opts) => {
        calls.push(opts);
        return { exitCode: 0 };
      },
    });
    const result = await runAgentToolsSetup(
      { mountPath: "/mnt/agent", cwd: "/work", localDir: "/tmp/t" },
      exec,
      { log: SILENT },
    );
    assert.equal(result.status, "ok");
    const call = calls[0] as { command: string; args: string[]; cwd: string };
    assert.equal(call.command, "sh");
    assert.equal(call.args[0], "-c");
    assert.equal(call.cwd, "/work");
  });

  it("local executor: links <cwd>/.tools to local disk, copies a binary, runs setup.sh", async () => {
    const root = mkdtempSync(join(tmpdir(), "agent-tools-"));
    const mount = join(root, "agent-files");
    const cwd = join(root, "cwd");
    const localDir = join(root, "local-tools");
    mkdirSync(join(mount, ".tools", "bin"), { recursive: true });
    mkdirSync(cwd, { recursive: true });
    writeFileSync(
      join(mount, ".tools", "bin", "hello"),
      "#!/bin/sh\necho hi\n",
    );
    chmodSync(join(mount, ".tools", "bin", "hello"), 0o755);
    writeFileSync(
      join(mount, ".tools", "setup.sh"),
      'echo "cwd=$(pwd) tools=$AGENT_TOOLS_DIR files=$AGENT_FILES" > "$AGENT_TOOLS_DIR/ran"\n',
    );

    const result = await runAgentToolsSetup(
      { mountPath: mount, cwd, localDir },
      localAgentToolsExec,
      { log: SILENT },
    );
    assert.equal(result.status, "ok");
    const ran = readFileSync(join(cwd, ".tools", "ran"), "utf8");
    assert.equal(ran.trim(), `cwd=${cwd} tools=${localDir} files=${mount}`);
    // <cwd>/.tools is a link to the local dir, and the binary there is executable.
    assert.ok(lstatSync(join(cwd, ".tools")).isSymbolicLink());
    assert.notEqual(statSync(join(localDir, "bin", "hello")).mode & 0o111, 0);
    const copied = readFileSync(join(cwd, ".tools", "bin", "hello"), "utf8");
    assert.match(copied, /echo hi/);
  });

  it("local executor: a non-zero setup.sh is a failed result, not a throw", async () => {
    const root = mkdtempSync(join(tmpdir(), "agent-tools-"));
    const mount = join(root, "agent-files");
    const cwd = join(root, "cwd");
    mkdirSync(join(mount, ".tools"), { recursive: true });
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(mount, ".tools", "setup.sh"), "exit 7\n");
    const result = await runAgentToolsSetup(
      { mountPath: mount, cwd, localDir: join(root, "local-tools") },
      localAgentToolsExec,
      { log: SILENT },
    );
    assert.equal(result.status, "failed");
    assert.equal((result as { exitCode?: number }).exitCode, 7);
  });
});
