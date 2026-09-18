/**
 * Unit tests for the boot-time Codex adapter seed (real filesystem, temp dirs).
 *
 * The bug being pinned: with `HOME=/tmp` (the documented subscription self-host scheme) the
 * daemon's data dir is not where the image baked the pinned adapter, so the daemon cold-installs
 * a floating one and wedges the handshake. These cases assert the seed puts the pin where the
 * daemon looks, rewrites the launcher so it runs the COPY, and refuses to touch an install that
 * is already there.
 *
 * Run: pnpm exec vitest run tests/unit/adapter-seed.test.ts
 */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BAKED_AGENT_DATA_DIR_ENV,
  bakedAgentDataDir,
  daemonDataDir,
  seedPinnedAgentProcesses,
} from "../../src/engines/sandbox_agent/adapter-seed.ts";

let root: string;
let baked: string;
let home: string;
let logs: string[];

/** Build a baked pin that looks like the image's: launcher, adapter tree, native binary. */
function bakePin(dir: string): void {
  const processes = join(dir, "bin", "agent_processes");
  const modules = join(processes, "codex", "node_modules");
  mkdirSync(join(modules, "@agentclientprotocol", "codex-acp", "dist"), {
    recursive: true,
  });
  mkdirSync(join(modules, ".bin"), { recursive: true });
  writeFileSync(
    join(modules, "@agentclientprotocol", "codex-acp", "package.json"),
    JSON.stringify({
      name: "@agentclientprotocol/codex-acp",
      version: "1.1.7",
    }),
  );
  writeFileSync(
    join(modules, "@agentclientprotocol", "codex-acp", "dist", "index.js"),
    "// pinned adapter\n",
  );
  symlinkSync(
    "../@agentclientprotocol/codex-acp/dist/index.js",
    join(modules, ".bin", "codex-acp"),
  );
  writeFileSync(
    join(processes, "codex-acp"),
    `#!/usr/bin/env sh\nset -e\nexec '${join(modules, ".bin", "codex-acp")}' "$@"\n`,
    { mode: 0o755 },
  );
  writeFileSync(join(dir, "bin", "codex"), "native codex binary", {
    mode: 0o755,
  });
}

const capture = (message: string): void => void logs.push(message);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "adapter-seed-"));
  baked = join(root, "baked", "sandbox-agent");
  home = join(root, "home");
  mkdirSync(home, { recursive: true });
  bakePin(baked);
  logs = [];
});

afterEach(() => {
  // Restore anything a case made unreadable, or the cleanup fails as this uid.
  try {
    chmodSync(join(baked, "bin", "agent_processes"), 0o755);
  } catch {
    // already removed or already readable
  }
  rmSync(root, { recursive: true, force: true });
});

describe("daemonDataDir: computed the way the daemon computes it", () => {
  it("prefers XDG_DATA_HOME", () => {
    assert.equal(
      daemonDataDir({ XDG_DATA_HOME: "/xdg", HOME: "/home/node" }),
      "/xdg/sandbox-agent",
    );
  });

  it("falls back to HOME/.local/share — the case the bug lives in", () => {
    assert.equal(
      daemonDataDir({ HOME: "/tmp" }),
      "/tmp/.local/share/sandbox-agent",
    );
  });

  it("ignores an empty override rather than resolving to a bare 'sandbox-agent'", () => {
    assert.equal(
      daemonDataDir({ XDG_DATA_HOME: "  ", HOME: "/tmp" }),
      "/tmp/.local/share/sandbox-agent",
    );
  });
});

describe("bakedAgentDataDir", () => {
  it("honors the explicit override", () => {
    assert.equal(
      bakedAgentDataDir({ [BAKED_AGENT_DATA_DIR_ENV]: baked }),
      baked,
    );
  });

  it("returns undefined off an image, where no default location exists", () => {
    // The defaults are absolute image paths; on a developer box neither is present.
    const found = bakedAgentDataDir({});
    assert.ok(
      found === undefined || found.startsWith("/"),
      "either nothing is baked here, or it is one of the image paths",
    );
  });
});

describe("seedPinnedAgentProcesses under a HOME override", () => {
  it("copies the pin into the daemon's data dir and points the launcher at the copy", () => {
    const outcome = seedPinnedAgentProcesses({
      env: { HOME: home, [BAKED_AGENT_DATA_DIR_ENV]: baked },
      log: capture,
    });
    assert.equal(outcome.kind, "seeded");

    const data = join(home, ".local", "share", "sandbox-agent");
    const launcher = join(data, "bin", "agent_processes", "codex-acp");
    assert.ok(existsSync(join(data, "bin", "agent_processes", "codex")));
    assert.ok(
      existsSync(join(data, "bin", "codex")),
      "native binary is seeded too",
    );

    const script = readFileSync(launcher, "utf8");
    assert.ok(
      script.includes(join(data, "bin", "agent_processes")),
      `launcher should exec out of the copy, got: ${script}`,
    );
    assert.ok(
      !script.includes(baked),
      "no path under the baked pin may survive the rewrite",
    );
    // The baked launcher must be untouched: a shared inode would make the rewrite edit the image.
    assert.ok(
      readFileSync(
        join(baked, "bin", "agent_processes", "codex-acp"),
        "utf8",
      ).includes(baked),
    );
    // The adapter version is what the pin is for.
    const pkg = JSON.parse(
      readFileSync(
        join(
          data,
          "bin/agent_processes/codex/node_modules/@agentclientprotocol/codex-acp/package.json",
        ),
        "utf8",
      ),
    ) as { version: string };
    assert.equal(pkg.version, "1.1.7");
    assert.equal(logs.length, 1, "exactly one line on seed");
    assert.match(logs[0], /seeded the pinned Codex adapter/);
  });

  it("keeps the relative node_modules symlinks as links, not as resolved copies", () => {
    seedPinnedAgentProcesses({
      env: { HOME: home, [BAKED_AGENT_DATA_DIR_ENV]: baked },
      log: capture,
    });
    const link = join(
      home,
      ".local/share/sandbox-agent/bin/agent_processes/codex/node_modules/.bin/codex-acp",
    );
    assert.equal(
      readlinkSync(link),
      "../@agentclientprotocol/codex-acp/dist/index.js",
    );
  });

  it("follows XDG_DATA_HOME when the operator sets it", () => {
    const xdg = join(root, "xdg");
    const outcome = seedPinnedAgentProcesses({
      env: {
        HOME: home,
        XDG_DATA_HOME: xdg,
        [BAKED_AGENT_DATA_DIR_ENV]: baked,
      },
      log: capture,
    });
    assert.equal(outcome.kind, "seeded");
    assert.ok(existsSync(join(xdg, "sandbox-agent/bin/agent_processes/codex")));
    assert.ok(!existsSync(join(home, ".local")), "HOME is not touched");
  });
});

describe("seedPinnedAgentProcesses declines to act", () => {
  it("never seeds on top of an existing install", () => {
    const processes = join(
      home,
      ".local/share/sandbox-agent/bin/agent_processes",
    );
    mkdirSync(join(processes, "codex"), { recursive: true });
    writeFileSync(join(processes, "codex-acp"), "operator's own launcher");

    const outcome = seedPinnedAgentProcesses({
      env: { HOME: home, [BAKED_AGENT_DATA_DIR_ENV]: baked },
      log: capture,
    });
    assert.equal(outcome.kind, "already-installed");
    assert.equal(
      readFileSync(join(processes, "codex-acp"), "utf8"),
      "operator's own launcher",
    );
    assert.equal(logs.length, 1, "exactly one line on skip");
  });

  it("skips when the data dir IS the baked pin (the ordinary, un-overridden HOME)", () => {
    const outcome = seedPinnedAgentProcesses({
      env: {
        XDG_DATA_HOME: join(root, "baked"),
        [BAKED_AGENT_DATA_DIR_ENV]: baked,
      },
      log: capture,
    });
    assert.equal(outcome.kind, "already-baked");
    // The pin survives: copying a tree onto itself is the one failure that loses the adapter.
    assert.ok(existsSync(join(baked, "bin/agent_processes/codex")));
  });

  it("skips when there is no baked pin at all", () => {
    const outcome = seedPinnedAgentProcesses({
      env: { HOME: home, [BAKED_AGENT_DATA_DIR_ENV]: join(root, "nowhere") },
      log: capture,
    });
    assert.equal(outcome.kind, "unreadable");
    assert.match(logs[0], /WARNING/);
  });

  it("warns and returns instead of throwing when the baked pin is unreadable", function () {
    if (process.getuid?.() === 0) {
      // root ignores the mode bits, so the case cannot be staged.
      return;
    }
    chmodSync(join(baked, "bin", "agent_processes"), 0o000);
    const outcome = seedPinnedAgentProcesses({
      env: { HOME: home, [BAKED_AGENT_DATA_DIR_ENV]: baked },
      log: capture,
    });
    assert.equal(outcome.kind, "unreadable");
    assert.match(logs[0], /WARNING: cannot read the baked Codex pin/);
    assert.ok(
      !existsSync(join(home, ".local/share/sandbox-agent/bin/agent_processes")),
      "a failed seed leaves nothing half-written behind",
    );
  });
});

describe("seedPinnedAgentProcesses is idempotent", () => {
  it("seeds once, then skips every later boot", () => {
    const env = { HOME: home, [BAKED_AGENT_DATA_DIR_ENV]: baked };
    assert.equal(
      seedPinnedAgentProcesses({ env, log: capture }).kind,
      "seeded",
    );
    assert.equal(
      seedPinnedAgentProcesses({ env, log: capture }).kind,
      "already-installed",
    );
    assert.equal(
      seedPinnedAgentProcesses({ env, log: capture }).kind,
      "already-installed",
    );
  });

  it("leaves no staging directory behind", () => {
    seedPinnedAgentProcesses({
      env: { HOME: home, [BAKED_AGENT_DATA_DIR_ENV]: baked },
      log: capture,
    });
    const stray = readdirSync(
      join(home, ".local/share/sandbox-agent/bin"),
    ).filter((name) => name.startsWith("."));
    assert.deepEqual(stray, [], `staging left behind: ${stray.join(", ")}`);
  });
});
