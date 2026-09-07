import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it } from "vitest";

import {
  AGENT_TOOLS_ENV_ALLOWLIST,
  AGENT_TOOLS_EXIT_OCCUPIED,
  AGENT_TOOLS_SETUP_TIMEOUT_MS,
  agentToolsLinkScript,
  agentToolsLocalDir,
  agentToolsSetupEnv,
  agentToolsSetupScript,
  localAgentToolsExec,
  relinkAgentTools,
  remoteAgentToolsExec,
  removeAgentToolsLocalDir,
  runAgentToolsSetup,
} from "../../src/engines/sandbox_agent/agent-tools-setup.ts";

const SILENT = () => {};

function fixture(opts: { bin?: Record<string, string>; setup?: string }) {
  const root = mkdtempSync(join(tmpdir(), "agent-tools-"));
  const mount = join(root, "agent-files");
  const cwd = join(root, "cwd");
  const localDir = join(root, "local-tools");
  mkdirSync(join(mount, ".tools", "bin"), { recursive: true });
  mkdirSync(cwd, { recursive: true });
  for (const [name, body] of Object.entries(opts.bin ?? {})) {
    writeFileSync(join(mount, ".tools", "bin", name), body);
    chmodSync(join(mount, ".tools", "bin", name), 0o644);
  }
  if (opts.setup !== undefined)
    writeFileSync(join(mount, ".tools", "setup.sh"), opts.setup);
  return { root, mount, cwd, localDir };
}

describe("agentToolsSetupScript", () => {
  it("exits 0 with no shell work when the agent has no .tools folder", () => {
    const script = agentToolsSetupScript("/mnt/agent", "/work/cwd", "/tmp/t");
    assert.ok(script.startsWith("[ -d '/mnt/agent/.tools' ] || exit 0"));
  });

  it("links <cwd>/.tools to local disk, re-stages bin/, then execs setup.sh", () => {
    const script = agentToolsSetupScript("/mnt/agent", "/work/cwd", "/tmp/t");
    assert.ok(script.includes("ln -sfn '/tmp/t' '/work/cwd/.tools'"), script);
    // Fresh staging, so a binary deleted from the durable folder does not linger.
    assert.ok(script.includes("rm -rf '/tmp/t'/bin && mkdir -p '/tmp/t'/bin"));
    assert.ok(script.includes("chmod +x '/tmp/t'/bin/"), script);
    assert.match(script, /exec sh '\/mnt\/agent\/.tools\/setup.sh'$/);
  });

  it("omits the owner's script under an ask/deny posture", () => {
    const script = agentToolsSetupScript("/mnt/agent", "/work/cwd", "/tmp/t", {
      runSetup: false,
    });
    assert.doesNotMatch(script, /setup\.sh/);
    assert.ok(script.includes("ln -sfn '/tmp/t' '/work/cwd/.tools'"));
  });

  it("never rm -rf's the link path: a non-empty directory is refused with the occupied code", () => {
    const script = agentToolsLinkScript("/work/cwd", "/tmp/t");
    assert.doesNotMatch(script, /rm -rf '\/work\/cwd\/.tools'/);
    assert.ok(
      script.includes(
        `rmdir '/work/cwd/.tools' 2>/dev/null || exit ${AGENT_TOOLS_EXIT_OCCUPIED}`,
      ),
    );
  });

  it("passes only the allowlisted host variables plus the two agent paths", () => {
    const env = agentToolsSetupEnv("/mnt/agent", "/tmp/t", {
      PATH: "/usr/bin",
      HOME: "/home/node",
      AGENTA_RUNNER_TOKEN: "secret",
      AGENTA_RUNNER_DAYTONA_API_KEY: "dtn_secret",
      ANTHROPIC_API_KEY: "sk-secret",
    });
    assert.deepEqual(env, {
      PATH: "/usr/bin",
      HOME: "/home/node",
      AGENT_FILES: "/mnt/agent",
      AGENT_TOOLS_DIR: "/tmp/t",
    });
    assert.ok(
      !(AGENT_TOOLS_ENV_ALLOWLIST as readonly string[]).includes(
        "AGENTA_RUNNER_TOKEN",
      ),
    );
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
  const input = {
    mountPath: "/mnt/agent",
    cwd: "/work",
    localDir: "/tmp/t",
    runSetup: true,
  };

  it("reports absent without running anything when the local stat says no .tools", async () => {
    let ran = false;
    const result = await runAgentToolsSetup(
      input,
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

  it("passes the script, cwd, env, timeout, and abort signal to the executor", async () => {
    let seen: unknown;
    const controller = new AbortController();
    const result = await runAgentToolsSetup(
      input,
      {
        run: async (opts) => {
          seen = opts;
          return { exitCode: 0 };
        },
      },
      { log: SILENT, signal: controller.signal, hostEnv: { PATH: "/p" } },
    );
    assert.equal(result.status, "ok");
    const opts = seen as {
      cwd: string;
      timeoutMs: number;
      env: Record<string, string>;
      signal?: AbortSignal;
    };
    assert.equal(opts.cwd, "/work");
    assert.equal(opts.timeoutMs, AGENT_TOOLS_SETUP_TIMEOUT_MS);
    assert.equal(opts.env.AGENT_FILES, "/mnt/agent");
    assert.equal(opts.env.PATH, "/p");
    assert.equal(opts.signal, controller.signal);
  });

  it("never throws: failure, the occupied code, and an executor error are all reported", async () => {
    const failed = await runAgentToolsSetup(
      input,
      { run: async () => ({ exitCode: 3 }) },
      { log: SILENT },
    );
    assert.equal(failed.status, "failed");
    assert.equal((failed as { exitCode?: number }).exitCode, 3);

    const occupied = await runAgentToolsSetup(
      input,
      { run: async () => ({ exitCode: AGENT_TOOLS_EXIT_OCCUPIED }) },
      { log: SILENT },
    );
    assert.equal(occupied.status, "skipped");

    const errored = await runAgentToolsSetup(
      input,
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
    const result = await runAgentToolsSetup(input, exec, { log: SILENT });
    assert.equal(result.status, "ok");
    const call = calls[0] as { command: string; args: string[]; cwd: string };
    assert.equal(call.command, "sh");
    assert.equal(call.args[0], "-c");
    assert.equal(call.cwd, "/work");
  });
});

describe("localAgentToolsExec (real shell)", () => {
  it("links <cwd>/.tools to local disk, copies a binary executable, runs setup.sh with the allowlisted env", async () => {
    const { mount, cwd, localDir } = fixture({
      bin: { hello: "#!/bin/sh\necho hi\n" },
      setup:
        'echo "cwd=$(pwd) tools=$AGENT_TOOLS_DIR files=$AGENT_FILES leak=${AGENTA_RUNNER_TOKEN:-none}" > "$AGENT_TOOLS_DIR/ran"\n',
    });
    const result = await runAgentToolsSetup(
      { mountPath: mount, cwd, localDir, runSetup: true },
      localAgentToolsExec,
      {
        log: SILENT,
        hostEnv: { PATH: process.env.PATH, AGENTA_RUNNER_TOKEN: "secret" },
      },
    );
    assert.equal(result.status, "ok");
    const ran = readFileSync(join(cwd, ".tools", "ran"), "utf8");
    assert.equal(
      ran.trim(),
      `cwd=${cwd} tools=${localDir} files=${mount} leak=none`,
    );
    assert.ok(lstatSync(join(cwd, ".tools")).isSymbolicLink());
    assert.notEqual(statSync(join(localDir, "bin", "hello")).mode & 0o111, 0);
  });

  it("re-stages bin/ so a binary removed from the durable folder disappears", async () => {
    const { mount, cwd, localDir } = fixture({
      bin: { old: "#!/bin/sh\necho old\n" },
    });
    let r = await runAgentToolsSetup(
      { mountPath: mount, cwd, localDir, runSetup: true },
      localAgentToolsExec,
      { log: SILENT },
    );
    assert.equal(r.status, "ok");
    assert.ok(existsSync(join(localDir, "bin", "old")));
    // The owner deletes the binary from agent-files; the next restore must not keep it.
    rmSync(join(mount, ".tools", "bin", "old"));
    r = await runAgentToolsSetup(
      { mountPath: mount, cwd, localDir, runSetup: true },
      localAgentToolsExec,
      { log: SILENT },
    );
    assert.equal(r.status, "ok");
    assert.ok(!existsSync(join(localDir, "bin", "old")));
  });

  it("skips the owner's script under ask/deny but still restores the binaries", async () => {
    const { mount, cwd, localDir } = fixture({
      bin: { hello: "#!/bin/sh\necho hi\n" },
      setup: 'echo ran > "$AGENT_TOOLS_DIR/setup-ran"\n',
    });
    const r = await runAgentToolsSetup(
      { mountPath: mount, cwd, localDir, runSetup: false },
      localAgentToolsExec,
      { log: SILENT },
    );
    assert.equal(r.status, "ok");
    assert.ok(existsSync(join(localDir, "bin", "hello")));
    assert.ok(!existsSync(join(localDir, "setup-ran")));
  });

  it("leaves a non-empty <cwd>/.tools directory alone and reports skipped", async () => {
    const { mount, cwd, localDir } = fixture({ setup: "exit 0\n" });
    mkdirSync(join(cwd, ".tools"));
    writeFileSync(join(cwd, ".tools", "user-data"), "keep me\n");
    const r = await runAgentToolsSetup(
      { mountPath: mount, cwd, localDir, runSetup: true },
      localAgentToolsExec,
      { log: SILENT },
    );
    assert.equal(r.status, "skipped");
    assert.equal(
      readFileSync(join(cwd, ".tools", "user-data"), "utf8"),
      "keep me\n",
    );
    assert.ok(!lstatSync(join(cwd, ".tools")).isSymbolicLink());
  });

  it("replaces a degraded link (an empty file) and an empty directory", async () => {
    const a = fixture({});
    writeFileSync(join(a.cwd, ".tools"), "");
    let r = await runAgentToolsSetup(
      { mountPath: a.mount, cwd: a.cwd, localDir: a.localDir, runSetup: true },
      localAgentToolsExec,
      { log: SILENT },
    );
    assert.equal(r.status, "ok");
    assert.ok(lstatSync(join(a.cwd, ".tools")).isSymbolicLink());

    const b = fixture({});
    mkdirSync(join(b.cwd, ".tools"));
    r = await runAgentToolsSetup(
      { mountPath: b.mount, cwd: b.cwd, localDir: b.localDir, runSetup: true },
      localAgentToolsExec,
      { log: SILENT },
    );
    assert.equal(r.status, "ok");
    assert.ok(lstatSync(join(b.cwd, ".tools")).isSymbolicLink());
  });

  it("a non-zero setup.sh is a failed result, not a throw", async () => {
    const { mount, cwd, localDir } = fixture({ setup: "exit 7\n" });
    const r = await runAgentToolsSetup(
      { mountPath: mount, cwd, localDir, runSetup: true },
      localAgentToolsExec,
      { log: SILENT },
    );
    assert.equal(r.status, "failed");
    assert.equal((r as { exitCode?: number }).exitCode, 7);
  });

  it("a timeout kills the whole process group, including a child the script started", async () => {
    const { mount, cwd, localDir } = fixture({
      // A background child that would write after the timeout if it survived.
      setup: '(sleep 2; echo late > "$AGENT_TOOLS_DIR/late") & sleep 30\n',
    });
    const started = Date.now();
    const r = await runAgentToolsSetup(
      { mountPath: mount, cwd, localDir, runSetup: true },
      localAgentToolsExec,
      { log: SILENT, timeoutMs: 300 },
    );
    assert.equal(r.status, "failed");
    assert.ok(Date.now() - started < 5_000);
    await new Promise((res) => setTimeout(res, 2_600));
    assert.ok(
      !existsSync(join(localDir, "late")),
      "child outlived the timeout",
    );
  });

  it("relink recreates only the link and cleanup removes the local dir", async () => {
    const { mount, cwd, localDir } = fixture({
      bin: { hello: "#!/bin/sh\necho hi\n" },
      setup: 'echo ran >> "$AGENT_TOOLS_DIR/count"\n',
    });
    await runAgentToolsSetup(
      { mountPath: mount, cwd, localDir, runSetup: true },
      localAgentToolsExec,
      { log: SILENT },
    );
    // A remount turned the link into an empty file.
    rmSync(join(cwd, ".tools"));
    writeFileSync(join(cwd, ".tools"), "");
    assert.equal(
      await relinkAgentTools({ cwd, localDir }, localAgentToolsExec, {
        log: SILENT,
      }),
      true,
    );
    assert.ok(lstatSync(join(cwd, ".tools")).isSymbolicLink());
    assert.equal(readFileSync(join(localDir, "count"), "utf8"), "ran\n");
    await removeAgentToolsLocalDir(localDir, { log: SILENT });
    assert.ok(!existsSync(localDir));
  });
});
