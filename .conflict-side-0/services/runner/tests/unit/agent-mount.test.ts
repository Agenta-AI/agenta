import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  AGENT_FILES_LINK_NAME,
  AGENT_MOUNT_ENV_VAR,
  AGENT_README_CONTENT,
  agentMountPath,
  linkAgentFiles,
  linkAgentFilesRemote,
  seedAgentReadme,
  seedAgentReadmeRemote,
  signAgentMountCredentials,
} from "../../src/engines/sandbox_agent/agent-mount.ts";

const SILENT = () => {};

function response(ok: boolean, body: unknown, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const SIGNED_BODY = {
  mount: { project_id: "project-1" },
  credentials: {
    endpoint: "http://seaweedfs:8333",
    region: "eu-central-1",
    bucket: "agenta-store",
    prefix: "mounts/project-1/mount-1",
    access_key: "AK",
    secret_key: "SK",
    session_token: "TOKEN",
    expires_at: "2026-07-11T12:00:00Z",
  },
};

describe("agent mount constants", () => {
  it("derives a sibling mount path", () => {
    assert.equal(agentMountPath("/tmp/agenta/run-1"), "/tmp/agenta/run-1-agent");
    assert.equal(AGENT_MOUNT_ENV_VAR, "AGENTA_AGENT_MOUNT_DIR");
    assert.equal(AGENT_FILES_LINK_NAME, "agent-files");
  });
});

describe("signAgentMountCredentials", () => {
  it("posts the artifact id and default name and maps credentials", async () => {
    let calledUrl = "";
    let calledInit: RequestInit | undefined;
    const credentials = await signAgentMountCredentials("artifact/id", {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async (url: string, init: RequestInit) => {
        calledUrl = url;
        calledInit = init;
        return response(true, SIGNED_BODY);
      }) as unknown as typeof fetch,
      log: SILENT,
    });

    assert.equal(
      calledUrl,
      "http://api:8000/mounts/agents/sign?artifact_id=artifact%2Fid&name=default",
    );
    assert.equal(calledInit?.method, "POST");
    assert.deepEqual(calledInit?.headers, {
      "content-type": "application/json",
      authorization: "ApiKey abc",
    });
    assert.deepEqual(credentials, {
      endpoint: "http://seaweedfs:8333",
      region: "eu-central-1",
      bucket: "agenta-store",
      prefix: "mounts/project-1/mount-1",
      accessKey: "AK",
      secretKey: "SK",
      sessionToken: "TOKEN",
      expiresAt: "2026-07-11T12:00:00Z",
      projectId: "project-1",
    });
  });

  it("passes a custom name", async () => {
    let calledUrl = "";
    await signAgentMountCredentials(
      "artifact-1",
      {
        apiBase: "http://api:8000",
        authorization: "ApiKey abc",
        fetchImpl: (async (url: string) => {
          calledUrl = url;
          return response(true, SIGNED_BODY);
        }) as unknown as typeof fetch,
        log: SILENT,
      },
      "skills and notes",
    );
    assert.match(calledUrl, /artifact_id=artifact-1&name=skills%20and%20notes$/);
  });

  it("returns null on non-2xx, network errors, and missing fields", async () => {
    const base = { apiBase: "http://api:8000", authorization: "ApiKey abc", log: SILENT };
    assert.equal(
      await signAgentMountCredentials("artifact-1", {
        ...base,
        fetchImpl: (async () => response(false, {}, 503)) as unknown as typeof fetch,
      }),
      null,
    );
    assert.equal(
      await signAgentMountCredentials("artifact-1", {
        ...base,
        fetchImpl: (async () => {
          throw new Error("network down");
        }) as unknown as typeof fetch,
      }),
      null,
    );
    assert.equal(
      await signAgentMountCredentials("artifact-1", {
        ...base,
        fetchImpl: (async () =>
          response(true, { credentials: { bucket: "only-one-field" } })) as unknown as typeof fetch,
      }),
      null,
    );
  });
});

describe("seedAgentReadme", () => {
  it("writes the README with an atomic absent-only guard", async () => {
    const calls: unknown[][] = [];
    await seedAgentReadme("/tmp/run-agent", {
      writeFile: (async (...args: unknown[]) => {
        calls.push(args);
      }) as unknown as typeof import("node:fs/promises").writeFile,
      log: SILENT,
    });
    assert.deepEqual(calls, [
      ["/tmp/run-agent/README.md", AGENT_README_CONTENT, { flag: "wx" }],
    ]);
  });

  it("leaves an existing README untouched", async () => {
    const logs: string[] = [];
    await seedAgentReadme("/tmp/run-agent", {
      writeFile: (async () => {
        throw Object.assign(new Error("exists"), { code: "EEXIST" });
      }) as unknown as typeof import("node:fs/promises").writeFile,
      log: (message) => logs.push(message),
    });
    assert.deepEqual(logs, []);
  });
});

describe("linkAgentFiles", () => {
  it("creates the link when the path is missing", async () => {
    const links: string[][] = [];
    await linkAgentFiles("/tmp/run", "/tmp/run-agent", {
      lstat: (async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }) as unknown as typeof import("node:fs/promises").lstat,
      readlink: (async () => {
        throw new Error("should not read a missing path");
      }) as unknown as typeof import("node:fs/promises").readlink,
      unlink: (async () => {
        throw new Error("should not unlink a missing path");
      }) as unknown as typeof import("node:fs/promises").unlink,
      symlink: (async (target: string, path: string) => {
        links.push([target, path]);
      }) as unknown as typeof import("node:fs/promises").symlink,
      log: SILENT,
    });
    assert.deepEqual(links, [["/tmp/run-agent", "/tmp/run/agent-files"]]);
  });

  it("keeps a valid symlink to the mount path", async () => {
    let linked = false;
    let unlinked = false;
    await linkAgentFiles("/tmp/run", "/tmp/run-agent", {
      lstat: (async () => ({
        isSymbolicLink: () => true,
      })) as unknown as typeof import("node:fs/promises").lstat,
      readlink: (async () =>
        "/tmp/run-agent") as unknown as typeof import("node:fs/promises").readlink,
      unlink: (async () => {
        unlinked = true;
      }) as unknown as typeof import("node:fs/promises").unlink,
      symlink: (async () => {
        linked = true;
      }) as unknown as typeof import("node:fs/promises").symlink,
      log: SILENT,
    });
    assert.equal(unlinked, false);
    assert.equal(linked, false);
  });

  it("replaces a degraded regular file with the mount symlink", async () => {
    const calls: string[][] = [];
    await linkAgentFiles("/tmp/run", "/tmp/run-agent", {
      lstat: (async () => ({
        isSymbolicLink: () => false,
      })) as unknown as typeof import("node:fs/promises").lstat,
      readlink: (async () => {
        throw new Error("should not read a regular file");
      }) as unknown as typeof import("node:fs/promises").readlink,
      unlink: (async (path: string) => {
        calls.push(["unlink", path]);
      }) as unknown as typeof import("node:fs/promises").unlink,
      symlink: (async (target: string, path: string) => {
        calls.push(["symlink", target, path]);
      }) as unknown as typeof import("node:fs/promises").symlink,
      log: SILENT,
    });
    assert.deepEqual(calls, [
      ["unlink", "/tmp/run/agent-files"],
      ["symlink", "/tmp/run-agent", "/tmp/run/agent-files"],
    ]);
  });

  it("replaces a symlink to the wrong target", async () => {
    const calls: string[][] = [];
    await linkAgentFiles("/tmp/run", "/tmp/run-agent", {
      lstat: (async () => ({
        isSymbolicLink: () => true,
      })) as unknown as typeof import("node:fs/promises").lstat,
      readlink: (async () =>
        "/tmp/old-agent") as unknown as typeof import("node:fs/promises").readlink,
      unlink: (async (path: string) => {
        calls.push(["unlink", path]);
      }) as unknown as typeof import("node:fs/promises").unlink,
      symlink: (async (target: string, path: string) => {
        calls.push(["symlink", target, path]);
      }) as unknown as typeof import("node:fs/promises").symlink,
      log: SILENT,
    });
    assert.deepEqual(calls, [
      ["unlink", "/tmp/run/agent-files"],
      ["symlink", "/tmp/run-agent", "/tmp/run/agent-files"],
    ]);
  });

  it("logs a non-ENOENT lstat failure without throwing", async () => {
    const logs: string[] = [];
    let linked = false;
    await linkAgentFiles("/tmp/run", "/tmp/run-agent", {
      lstat: (async () => {
        throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      }) as unknown as typeof import("node:fs/promises").lstat,
      readlink: (async () => {
        throw new Error("should not read after lstat fails");
      }) as unknown as typeof import("node:fs/promises").readlink,
      unlink: (async () => {
        throw new Error("should not unlink after lstat fails");
      }) as unknown as typeof import("node:fs/promises").unlink,
      symlink: (async () => {
        linked = true;
      }) as unknown as typeof import("node:fs/promises").symlink,
      log: (message) => logs.push(message),
    });
    assert.equal(linked, false);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /permission denied/);
  });

  it("treats a concurrent symlink EEXIST as success", async () => {
    const logs: string[] = [];
    await linkAgentFiles("/tmp/run", "/tmp/run-agent", {
      lstat: (async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }) as unknown as typeof import("node:fs/promises").lstat,
      symlink: (async () => {
        throw Object.assign(new Error("exists"), { code: "EEXIST" });
      }) as unknown as typeof import("node:fs/promises").symlink,
      log: (message) => logs.push(message),
    });
    assert.deepEqual(logs, []);
  });

  it("logs a symlink failure without throwing", async () => {
    const logs: string[] = [];
    await linkAgentFiles("/tmp/run", "/tmp/run-agent", {
      lstat: (async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }) as unknown as typeof import("node:fs/promises").lstat,
      symlink: (async () => {
        throw new Error("not supported");
      }) as unknown as typeof import("node:fs/promises").symlink,
      log: (message) => logs.push(message),
    });
    assert.equal(logs.length, 1);
    assert.match(logs[0], /not supported/);
  });
});

describe("remote discovery helpers", () => {
  it("emits one guarded README command", async () => {
    const calls: unknown[] = [];
    await seedAgentReadmeRemote(
      { runProcess: async (options) => (calls.push(options), { exitCode: 0 }) },
      "/home/sandbox/run-agent",
    );
    assert.deepEqual(calls, [
      {
        command: "sh",
        args: [
          "-c",
          `[ -e '/home/sandbox/run-agent/README.md' ] || printf %s '${AGENT_README_CONTENT}' > '/home/sandbox/run-agent/README.md'`,
        ],
        timeoutMs: 30_000,
      },
    ]);
  });

  it("emits one self-healing symlink command", async () => {
    const calls: unknown[] = [];
    await linkAgentFilesRemote(
      { runProcess: async (options) => (calls.push(options), { exitCode: 0 }) },
      "/home/sandbox/run",
      "/home/sandbox/run-agent",
    );
    assert.deepEqual(calls, [
      {
        command: "sh",
        args: [
          "-c",
          `[ "$(readlink '/home/sandbox/run/agent-files' 2>/dev/null)" = '/home/sandbox/run-agent' ] || { rm -f '/home/sandbox/run/agent-files' && ln -s '/home/sandbox/run-agent' '/home/sandbox/run/agent-files'; }`,
        ],
        timeoutMs: 30_000,
      },
    ]);
  });

  it("swallows a thrown remote process error and logs it", async () => {
    const logs: string[] = [];
    await seedAgentReadmeRemote(
      {
        runProcess: async () => {
          throw new Error("exec timed out");
        },
      },
      "/home/sandbox/run-agent",
      { log: (message) => logs.push(message) },
    );
    assert.equal(logs.length, 1);
    assert.match(logs[0], /exec timed out/);
  });

  it("logs a non-zero remote process exit", async () => {
    const logs: string[] = [];
    await linkAgentFilesRemote(
      { runProcess: async () => ({ exitCode: 17 }) },
      "/home/sandbox/run",
      "/home/sandbox/run-agent",
      { log: (message) => logs.push(message) },
    );
    assert.equal(logs.length, 1);
    assert.match(logs[0], /exit 17/);
  });
});
