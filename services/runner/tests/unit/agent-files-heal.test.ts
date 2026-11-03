/**
 * Healing `<cwd>/agent-files` when it is no longer a symlink.
 *
 * The link points the agent at its durable drive. Delete it mid-turn and the harness's next write
 * recreates it as an ORDINARY DIRECTORY, because that is what writing `agent-files/notes.md` does
 * to a missing parent. `unlink(2)` cannot remove a directory, so the repair failed on every later
 * turn and everything the agent believed it was saving to its drive piled up on the session
 * workspace under the same name.
 *
 * These tests run against a real filesystem rather than stubs, because the interesting parts are
 * filesystem behavior: what `rmdir` refuses, what a collision looks like, and that the files are
 * MOVED rather than dropped.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/agent-files-heal.test.ts)
 */
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
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  AGENT_FILES_LINK_NAME,
  linkAgentFiles,
} from "../../src/engines/sandbox_agent/agent-mount.ts";
import { runSandboxAgent } from "../../src/engines/sandbox_agent/engine.ts";
import { fakeHarness } from "../utils/sandbox-agent-harness.ts";

let root: string;
let cwd: string;
let mountPath: string;
let linkPath: string;
let logged: string[];

const log = (message: string): void => {
  logged.push(message);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agenta-agent-files-heal-"));
  cwd = join(root, "session");
  mountPath = `${cwd}-agent`;
  linkPath = join(cwd, AGENT_FILES_LINK_NAME);
  mkdirSync(cwd, { recursive: true });
  mkdirSync(mountPath, { recursive: true });
  logged = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("linkAgentFiles: the ordinary lifecycle", () => {
  it("creates the link when nothing is there", async () => {
    await linkAgentFiles(cwd, mountPath, { log });

    assert.equal(readlinkSync(linkPath), mountPath);
  });

  it("keeps a link that already points at the mount", async () => {
    symlinkSync(mountPath, linkPath);

    await linkAgentFiles(cwd, mountPath, { log });

    assert.equal(readlinkSync(linkPath), mountPath);
  });

  it("replaces the empty file geesefs degrades a symlink into", async () => {
    // Object storage has no symlinks, so a flush and remount round trip turns the link into a
    // zero-byte file. This is the case the helper was originally written for.
    writeFileSync(linkPath, "");

    await linkAgentFiles(cwd, mountPath, { log });

    assert.equal(readlinkSync(linkPath), mountPath);
  });
});

describe("linkAgentFiles: a real directory on the link path", () => {
  it("moves what the agent wrote onto the drive and restores the link", async () => {
    mkdirSync(join(linkPath, "reports"), { recursive: true });
    writeFileSync(
      join(linkPath, "notes.md"),
      "written while the link was gone",
    );
    writeFileSync(join(linkPath, "reports", "q3.txt"), "nested");

    await linkAgentFiles(cwd, mountPath, { log });

    assert.equal(
      readlinkSync(linkPath),
      mountPath,
      "the link must be back afterwards",
    );
    assert.equal(
      readFileSync(join(mountPath, "notes.md"), "utf8"),
      "written while the link was gone",
    );
    assert.equal(
      readFileSync(join(mountPath, "reports", "q3.txt"), "utf8"),
      "nested",
      "a whole subtree moves, not just top-level files",
    );
    // Reading through the restored link is the property the agent actually depends on.
    assert.equal(
      readFileSync(join(linkPath, "notes.md"), "utf8"),
      "written while the link was gone",
    );
  });

  it("says what it moved", async () => {
    // A file that changes drives without a word in the log is indistinguishable from a file that
    // was lost, the next time someone goes looking for it.
    mkdirSync(linkPath, { recursive: true });
    writeFileSync(join(linkPath, "notes.md"), "content");

    await linkAgentFiles(cwd, mountPath, { log });

    assert.ok(
      logged.some(
        (line) => line.includes("recovered") && line.includes("notes.md"),
      ),
      `expected a recovery line, got: ${JSON.stringify(logged)}`,
    );
  });

  it("keeps both copies when the same name already exists on the drive", async () => {
    // The agent wrote this name to both places, so neither copy is ours to discard.
    mkdirSync(linkPath, { recursive: true });
    writeFileSync(join(mountPath, "notes.md"), "the drive's copy");
    writeFileSync(join(linkPath, "notes.md"), "the stray copy");

    await linkAgentFiles(cwd, mountPath, { log });

    assert.equal(
      readFileSync(join(mountPath, "notes.md"), "utf8"),
      "the drive's copy",
    );
    assert.equal(
      readFileSync(join(mountPath, "notes.md.recovered"), "utf8"),
      "the stray copy",
    );
    assert.equal(readlinkSync(linkPath), mountPath);
  });

  it("numbers further collisions instead of overwriting the first rescue", async () => {
    mkdirSync(linkPath, { recursive: true });
    writeFileSync(join(mountPath, "notes.md"), "the drive's copy");
    writeFileSync(join(mountPath, "notes.md.recovered"), "an earlier rescue");
    writeFileSync(join(linkPath, "notes.md"), "the newest stray copy");

    await linkAgentFiles(cwd, mountPath, { log });

    assert.equal(
      readFileSync(join(mountPath, "notes.md.recovered"), "utf8"),
      "an earlier rescue",
    );
    assert.equal(
      readFileSync(join(mountPath, "notes.md.recovered-2"), "utf8"),
      "the newest stray copy",
    );
  });

  it("removes the directory once it is empty", async () => {
    mkdirSync(linkPath, { recursive: true });

    await linkAgentFiles(cwd, mountPath, { log });

    assert.ok(
      lstatSync(linkPath).isSymbolicLink(),
      "an empty stray directory must not survive as a directory",
    );
  });

  it("leaves the files alone when the drive cannot take them", async () => {
    // The destination is unavailable — a dead or unmounted agent drive. Deleting the directory to
    // restore a link would destroy the only copy of the agent's work, so the repair fails instead
    // and the next turn tries again.
    mkdirSync(linkPath, { recursive: true });
    writeFileSync(join(linkPath, "notes.md"), "the only copy");
    rmSync(mountPath, { recursive: true, force: true });
    writeFileSync(mountPath, "not a directory at all");

    await linkAgentFiles(cwd, mountPath, { log });

    assert.ok(
      lstatSync(linkPath).isDirectory(),
      "the directory must still be there",
    );
    assert.equal(
      readFileSync(join(linkPath, "notes.md"), "utf8"),
      "the only copy",
    );
    assert.ok(
      logged.some((line) => line.includes("directory replace failed")),
      `expected a failure line, got: ${JSON.stringify(logged)}`,
    );
  });

  it("does not delete a directory it could not empty", async () => {
    // Belt and braces on the ordering: if a rescue ever returned without moving everything, the
    // rmdir has to refuse rather than take the rest with it.
    mkdirSync(linkPath, { recursive: true });
    writeFileSync(join(linkPath, "notes.md"), "the only copy");

    await linkAgentFiles(cwd, mountPath, {
      log,
      recoverDirectory: async () => {},
    });

    assert.ok(existsSync(join(linkPath, "notes.md")));
    assert.ok(lstatSync(linkPath).isDirectory());
  });
});

describe("runTurn heals on every turn, warm or cold", () => {
  // The seam matters as much as the repair. A warm reuse never re-acquires, so the link call in
  // `mountLocalAgentCwd` does not run on a second turn — a session that lost `agent-files` stayed
  // broken for the life of its environment, which is exactly the reported bug. `runTurn` is the
  // one function on both paths, so the repair lives there.
  it("restores a stray directory around a real turn, and moves what was in it", async () => {
    const cwd = join(root, "turn-cwd");
    mkdirSync(cwd, { recursive: true });
    const agentMount = `${cwd}-agent`;
    mkdirSync(agentMount, { recursive: true });

    // The state a lost link leaves behind: a real directory holding the agent's writes.
    const strayLink = join(cwd, AGENT_FILES_LINK_NAME);
    mkdirSync(strayLink, { recursive: true });
    writeFileSync(
      join(strayLink, "notes.md"),
      "written while the link was gone",
    );

    // Snapshot DURING the turn: teardown removes the stubbed mountpoint afterwards, so the
    // post-run filesystem cannot answer whether the harness saw a working link.
    const seen: { link?: string; onDrive?: string } = {};
    const { deps, logs } = fakeHarness({
      cwd,
      afterPromptGates: () => {
        try {
          seen.link = readlinkSync(strayLink);
        } catch (err) {
          seen.link = `not a symlink: ${String(err)}`;
        }
        try {
          seen.onDrive = readFileSync(join(agentMount, "notes.md"), "utf8");
        } catch (err) {
          seen.onDrive = `missing: ${String(err)}`;
        }
      },
    });
    deps.signAgentMountCredentials = (async () => ({
      endpoint: "http://seaweedfs:8333",
      region: "us-east-1",
      bucket: "agenta-store",
      prefix: "mounts/proj-1/agent-1",
      accessKey: "AK-1",
      secretKey: "SK-1",
    })) as never;
    deps.mountStorage = (async () => true) as never;
    deps.unmountStorage = (async () => true) as never;

    const result = await runSandboxAgent(
      {
        harness: "claude",
        runContext: { workflow: { artifact: { id: "artifact-1" } } },
        telemetry: {
          exporters: { otlp: { headers: { authorization: "ApiKey run" } } },
        },
        messages: [{ role: "user", content: "hello" }],
      } as never,
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    assert.equal(
      seen.link,
      agentMount,
      "while the turn ran, agent-files must be a symlink to the agent mount",
    );
    assert.equal(
      seen.onDrive,
      "written while the link was gone",
      "and the file the agent wrote into the stray directory must be on the drive",
    );
    assert.ok(
      logs.some(
        (message) =>
          message.includes("recovered") && message.includes("notes.md"),
      ),
      `the move must be logged, got: ${JSON.stringify(logs.slice(-8))}`,
    );
  });
});
