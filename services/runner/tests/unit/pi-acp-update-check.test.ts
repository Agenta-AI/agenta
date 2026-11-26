import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { withRunnerPiSettings } from "../../src/engines/sandbox_agent/pi-assets.ts";

// Runs the installed, pnpm-patched pi-acp on a real `session/new`, the way the `local` provider
// does. pi-acp's update check and startup banner shell out to `pi --version` and `npm view` from
// PATH, so a fake `pi` and `npm` ahead of the real ones record every call. The session itself
// still talks to the real `pi` through PI_ACP_PI_COMMAND.
const BIN = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../node_modules/.bin",
);
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

async function probeCalls(env: Record<string, string>): Promise<string[]> {
  const root = mkdtempSync(join(tmpdir(), "pi-acp-update-check-"));
  dirs.push(root);
  const fakeBin = join(root, "bin");
  const agentDir = join(root, "agent");
  const log = join(root, "calls.log");
  mkdirSync(fakeBin);
  mkdirSync(agentDir);
  writeFileSync(log, "");
  for (const [name, version] of [
    ["pi", "0.0.1"],
    ["npm", "99.0.0"],
  ]) {
    const file = join(fakeBin, name);
    writeFileSync(
      file,
      `#!/bin/sh\necho "${name} $*" >> "${log}"\necho ${version}\n`,
    );
    chmodSync(file, 0o755);
  }
  // The settings the runner writes into a local run's agent dir.
  writeFileSync(
    join(agentDir, "settings.json"),
    withRunnerPiSettings(undefined, false),
  );

  const child = spawn(join(BIN, "pi-acp"), [], {
    env: {
      PATH: `${fakeBin}:${process.env.PATH}`,
      HOME: root,
      PI_ACP_PI_COMMAND: join(BIN, "pi"),
      PI_CODING_AGENT_DIR: agentDir,
      ANTHROPIC_API_KEY: "test-key-not-used",
      ...env,
    },
    stdio: ["pipe", "pipe", "ignore"],
  });
  try {
    const lines = createInterface({ input: child.stdout! })[
      Symbol.asyncIterator
    ]();
    const call = async (id: number, method: string, params: object) => {
      child.stdin!.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
      for (;;) {
        const { value, done } = await lines.next();
        if (done) throw new Error(`pi-acp exited before answering ${method}`);
        const message = JSON.parse(value);
        if (message.id === id) return message;
      }
    };
    await call(1, "initialize", { protocolVersion: 1, clientCapabilities: {} });
    const created = await call(2, "session/new", { cwd: root, mcpServers: [] });
    expect(created.error).toBeUndefined();
  } finally {
    child.kill();
  }
  return readFileSync(log, "utf-8").split("\n").filter(Boolean);
}

describe("pi-acp update check", () => {
  it("runs no version probe on session/new with the runner's settings", async () => {
    expect(await probeCalls({})).toEqual([]);
  }, 30_000);

  it("checks npm only when PI_ACP_CHECK_FOR_UPDATES is true", async () => {
    expect(await probeCalls({ PI_ACP_CHECK_FOR_UPDATES: "true" })).toEqual([
      "pi --version",
      "npm view @earendil-works/pi-coding-agent version",
    ]);
  }, 30_000);
});
