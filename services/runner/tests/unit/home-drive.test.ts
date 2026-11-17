import assert from "node:assert/strict";
import { describe, it } from "vitest";

/** The legacy agent route and the home drive's README seed (`run-drives.ts`). */
import {
  HOME_README_CONTENT,
  seedHomeReadme,
  seedHomeReadmeRemote,
  signAgentMountCredentials,
} from "../../src/engines/sandbox_agent/run-drives.ts";

const SILENT = () => {};

function response(ok: boolean, body: unknown, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const SIGNED_BODY = {
  mount: { id: "mount-1", project_id: "project-1" },
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
      mountId: "mount-1",
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
    assert.match(
      calledUrl,
      /artifact_id=artifact-1&name=skills%20and%20notes$/,
    );
  });

  it("returns null on non-2xx, network errors, and missing fields", async () => {
    const base = {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      log: SILENT,
    };
    assert.equal(
      await signAgentMountCredentials("artifact-1", {
        ...base,
        fetchImpl: (async () =>
          response(false, {}, 503)) as unknown as typeof fetch,
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
          response(true, {
            credentials: { bucket: "only-one-field" },
          })) as unknown as typeof fetch,
      }),
      null,
    );
  });
});

describe("seedHomeReadme", () => {
  it("writes the README with an atomic absent-only guard", async () => {
    const calls: unknown[][] = [];
    await seedHomeReadme("/tmp/run-drive-home", {
      writeFile: (async (...args: unknown[]) => {
        calls.push(args);
      }) as unknown as typeof import("node:fs/promises").writeFile,
      log: SILENT,
    });
    assert.deepEqual(calls, [
      ["/tmp/run-drive-home/README.md", HOME_README_CONTENT, { flag: "wx" }],
    ]);
  });

  it("leaves an existing README untouched", async () => {
    const logs: string[] = [];
    await seedHomeReadme("/tmp/run-drive-home", {
      writeFile: (async () => {
        throw Object.assign(new Error("exists"), { code: "EEXIST" });
      }) as unknown as typeof import("node:fs/promises").writeFile,
      log: (message) => logs.push(message),
    });
    assert.deepEqual(logs, []);
  });
});

describe("remote discovery helpers", () => {
  it("emits one guarded README command", async () => {
    const calls: unknown[] = [];
    await seedHomeReadmeRemote(
      { runProcess: async (options) => (calls.push(options), { exitCode: 0 }) },
      "/home/sandbox/run-drive-home",
    );
    assert.deepEqual(calls, [
      {
        command: "sh",
        args: [
          "-c",
          `[ -e '/home/sandbox/run-drive-home/README.md' ] || [ -L '/home/sandbox/run-drive-home/README.md' ] || printf %s '${HOME_README_CONTENT}' > '/home/sandbox/run-drive-home/README.md'`,
        ],
        timeoutMs: 30_000,
      },
    ]);
  });

  it("swallows a thrown remote process error and logs it", async () => {
    const logs: string[] = [];
    await seedHomeReadmeRemote(
      {
        runProcess: async () => {
          throw new Error("exec timed out");
        },
      },
      "/home/sandbox/run-drive-home",
      { log: (message) => logs.push(message) },
    );
    assert.equal(logs.length, 1);
    assert.match(logs[0], /exec timed out/);
  });

  it("logs a non-zero remote process exit", async () => {
    const logs: string[] = [];
    await seedHomeReadmeRemote(
      { runProcess: async () => ({ exitCode: 17 }) },
      "/home/sandbox/run-drive-home",
      { log: (message) => logs.push(message) },
    );
    assert.equal(logs.length, 1);
    assert.match(logs[0], /exit 17/);
  });
});
