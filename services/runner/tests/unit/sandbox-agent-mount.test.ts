/**
 * Unit tests for the durable-cwd geesefs mount (`engines/sandbox_agent/mount.ts`).
 *
 * Exercised through the modules' injectable deps — no real fetch, geesefs, or fusermount.
 * Covers: bind-and-sign response mapping, graceful null on non-2xx/no-creds, the geesefs
 * command shape (creds in env not argv), idempotency (already-mounted is a no-op), and that
 * a mount failure does not throw (the turn proceeds on the plain cwd).
 *
 * Run: pnpm exec vitest run tests/unit/sandbox-agent-mount.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  signSessionMountCredentials,
  mountStorage,
  unmountStorage,
  discoverTunnelEndpoint,
  mountStorageRemote,
  pollGeesefsMount,
  type MountCredentials,
} from "../../src/engines/sandbox_agent/mount.ts";

const SILENT = () => {};

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function errResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
  } as unknown as Response;
}

const SIGNED_BODY = {
  credentials: {
    endpoint: "http://seaweedfs:8333",
    region: "us-east-1",
    bucket: "agenta-store",
    prefix: "mounts/proj-1/mount-9",
    access_key: "SCOPED-AK",
    secret_key: "SCOPED-SK",
    session_token: "SCOPED-TOK",
    expires_at: "2026-06-30T08:00:00Z",
  },
};

describe("signSessionMountCredentials", () => {
  it("maps the API snake_case response to camelCase credentials", async () => {
    let calledUrl = "";
    let calledAuth = "";
    const creds = await signSessionMountCredentials("sess-1", {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async (url: string, init: RequestInit) => {
        calledUrl = url;
        calledAuth = (init.headers as Record<string, string>).authorization;
        return okResponse(SIGNED_BODY);
      }) as unknown as typeof fetch,
      log: SILENT,
    });

    assert.ok(creds);
    assert.equal(creds.bucket, "agenta-store");
    assert.equal(creds.prefix, "mounts/proj-1/mount-9");
    assert.equal(creds.accessKey, "SCOPED-AK");
    assert.equal(creds.secretKey, "SCOPED-SK");
    assert.equal(creds.sessionToken, "SCOPED-TOK");
    assert.equal(creds.endpoint, "http://seaweedfs:8333");
    // session_id rides the query; auth header is forwarded.
    assert.match(calledUrl, /\/sessions\/mounts\/sign\?session_id=sess-1$/);
    assert.equal(calledAuth, "ApiKey abc");
  });

  it("returns null on 503 (mounts disabled) without throwing", async () => {
    const creds = await signSessionMountCredentials("sess-1", {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async () => errResponse(503)) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(creds, null);
  });

  it("returns null when credentials are incomplete", async () => {
    const creds = await signSessionMountCredentials("sess-1", {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async () =>
        okResponse({
          credentials: { bucket: "b" },
        })) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(creds, null);
  });

  it("returns null when fetch throws (network error)", async () => {
    const creds = await signSessionMountCredentials("sess-1", {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(creds, null);
  });
});

const CREDS: MountCredentials = {
  endpoint: "http://seaweedfs:8333",
  region: "us-east-1",
  bucket: "agenta-store",
  prefix: "mounts/proj-1/mount-9",
  accessKey: "SCOPED-AK",
  secretKey: "SCOPED-SK",
  sessionToken: "SCOPED-TOK",
};

function notMountedThenAlive(): (cwd: string) => Promise<boolean> {
  let calls = 0;
  return async () => {
    calls += 1;
    return calls > 1;
  };
}

describe("mountStorage", () => {
  it("builds the geesefs command with creds in env, not argv", async () => {
    let seenArgs: string[] = [];
    let seenEnv: Record<string, string> = {};
    const ok = await mountStorage("/work/cwd", CREDS, {
      checkMounted: notMountedThenAlive(),
      runGeesefs: async (args, env) => {
        seenArgs = args;
        seenEnv = env;
      },
      log: SILENT,
    });

    assert.equal(ok, true);
    // bucket:prefix and cwd are the positional tail.
    assert.deepEqual(seenArgs.slice(-2), [
      "agenta-store:mounts/proj-1/mount-9",
      "/work/cwd",
    ]);
    assert.ok(seenArgs.includes("--endpoint"));
    assert.ok(seenArgs.includes("http://seaweedfs:8333"));
    assert.ok(seenArgs.includes("allow_other"));
    // -f keeps geesefs foreground (tracked child). Without it the detached daemon dies under
    // write-heavy load (git clone) and the mount goes ENOTCONN.
    assert.ok(seenArgs.includes("-f"));
    // Credentials ride the child env, never the argv (no key leak to the process table).
    assert.equal(seenEnv.AWS_ACCESS_KEY_ID, "SCOPED-AK");
    assert.equal(seenEnv.AWS_SECRET_ACCESS_KEY, "SCOPED-SK");
    assert.equal(seenEnv.AWS_SESSION_TOKEN, "SCOPED-TOK");
    assert.ok(!seenArgs.some((a) => a.includes("SCOPED-AK")));
    assert.ok(!seenArgs.some((a) => a.includes("SCOPED-SK")));
  });

  it("omits --endpoint for AWS S3 (empty endpoint)", async () => {
    let seenArgs: string[] = [];
    await mountStorage(
      "/work/cwd",
      { ...CREDS, endpoint: undefined },
      {
        checkMounted: notMountedThenAlive(),
        runGeesefs: async (args) => {
          seenArgs = args;
        },
        log: SILENT,
      },
    );
    assert.ok(!seenArgs.includes("--endpoint"));
  });

  it("is a no-op when already mounted (idempotent)", async () => {
    let ran = false;
    const ok = await mountStorage("/work/cwd", CREDS, {
      checkMounted: async () => true,
      runGeesefs: async () => {
        ran = true;
      },
      log: SILENT,
    });
    assert.equal(ok, true);
    assert.equal(ran, false);
  });

  it("returns false (does not throw) when geesefs fails", async () => {
    const ok = await mountStorage("/work/cwd", CREDS, {
      checkMounted: async () => false,
      runGeesefs: async () => {
        throw new Error("fuse: device not found");
      },
      log: SILENT,
    });
    assert.equal(ok, false);
  });

  // The dead-mount case: geesefs cannot mount at all (no /dev/fuse in the container) and exits
  // FATAL within ~10ms. Before this fix, mountStorage's poll never noticed the child died and
  // burned the full ~15s ceiling before falling back — measured live as 15.3s of a 24s cold
  // start. These two tests drive the real `pollGeesefsMount` (not a fully-replaced fake) via the
  // `runGeesefs` seam, so they exercise the production exit-race logic.
  it("aborts fast when geesefs exits before the mount comes alive (dead mount)", async () => {
    const fakeChild = new EventEmitter();
    const start = Date.now();
    const ok = await mountStorage("/work/cwd", CREDS, {
      checkMounted: async () => false, // never comes alive
      runGeesefs: async () => {
        // geesefs FATAL-ed almost instantly (e.g. no /dev/fuse) — mirror that with a short delay.
        setTimeout(() => fakeChild.emit("exit", 1, null), 5);
        await pollGeesefsMount("/work/cwd", fakeChild, {
          checkMounted: async () => false,
          intervalMs: 500, // the real per-tick interval; the exit race must preempt it
          maxAttempts: 30, // the real ~15s ceiling (30 x 500ms)
          log: SILENT,
        });
      },
      log: SILENT,
    });
    const elapsedMs = Date.now() - start;
    assert.equal(ok, false);
    // Must abort on the child's exit, nowhere near the 30 x 500ms = 15s poll ceiling.
    assert.ok(
      elapsedMs < 2000,
      `expected an early abort well under the 15s ceiling, took ${elapsedMs}ms`,
    );
  });

  it("returns true once the mount comes alive mid-poll (still-starting case preserved)", async () => {
    let calls = 0;
    const checkMounted = async () => {
      calls += 1;
      return calls >= 3; // not mounted for the first two checks, alive on the third
    };
    const fakeChild = new EventEmitter(); // never exits — mirrors a live -f process
    const ok = await mountStorage("/work/cwd", CREDS, {
      checkMounted,
      runGeesefs: async () => {
        await pollGeesefsMount("/work/cwd", fakeChild, {
          checkMounted,
          intervalMs: 5,
          maxAttempts: 30,
          log: SILENT,
        });
      },
      log: SILENT,
    });
    assert.equal(ok, true);
  });
});

describe("unmountStorage", () => {
  it("runs fusermount -u via the injected runner", async () => {
    let target = "";
    await unmountStorage("/work/cwd", {
      runUnmount: async (cwd) => {
        target = cwd;
      },
      log: SILENT,
    });
    assert.equal(target, "/work/cwd");
  });

  it("swallows unmount errors (data lives in the store) and reports NOT confirmed", async () => {
    const ok = await unmountStorage("/work/cwd", {
      runUnmount: async () => {
        throw new Error("not mounted");
      },
      log: SILENT,
    });
    // No throw == pass, but callers must not treat this as safe to delete the cwd.
    assert.equal(ok, false);
  });
});

describe("unmountStorage confirmation", () => {
  // A caller (workspace cleanup) must gate rmSync on this return value, not merely on
  // fusermount not throwing — a lazy unmount (-uz) can leave the node attached.
  it("returns true only when the mountpoint check confirms it is gone", async () => {
    const gone = await unmountStorage("/work/cwd", {
      runUnmount: async () => {},
      checkMountpoint: async () => "gone",
      log: SILENT,
    });
    assert.equal(gone, true);
  });

  it("returns false when the mountpoint is still mounted after detach", async () => {
    const ok = await unmountStorage("/work/cwd", {
      runUnmount: async () => {},
      checkMountpoint: async () => "mounted",
      log: SILENT,
    });
    assert.equal(ok, false);
  });

  it("returns false when the mountpoint check is inconclusive (never delete on doubt)", async () => {
    const ok = await unmountStorage("/work/cwd", {
      runUnmount: async () => {},
      checkMountpoint: async () => "inconclusive",
      log: SILENT,
    });
    assert.equal(ok, false);
  });
});

describe("discoverTunnelEndpoint (remote)", () => {
  it("prefers the https public_url from the ngrok agent API", async () => {
    const url = await discoverTunnelEndpoint({
      ngrokApi: "http://ngrok:4040",
      fetchImpl: (async () =>
        okResponse({
          tunnels: [
            { proto: "http", public_url: "http://abc.ngrok.io" },
            { proto: "https", public_url: "https://abc.ngrok.io" },
          ],
        })) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(url, "https://abc.ngrok.io");
  });

  it("returns null when no tunnel is up", async () => {
    const url = await discoverTunnelEndpoint({
      fetchImpl: (async () =>
        okResponse({ tunnels: [] })) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(url, null);
  });

  it("returns null when the agent API is unreachable", async () => {
    const url = await discoverTunnelEndpoint({
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(url, null);
  });
});

describe("mountStorageRemote", () => {
  it("execs geesefs IN the sandbox with the tunnel endpoint and creds in env", async () => {
    const calls: Array<{
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }> = [];
    const sandbox = {
      runProcess: async (opts: {
        command: string;
        args?: string[];
        env?: Record<string, string>;
      }) => {
        calls.push(opts);
        return { exitCode: 0 };
      },
    };

    const ok = await mountStorageRemote(sandbox, "/home/sandbox/work", CREDS, {
      endpoint: "https://abc.ngrok.io",
      log: SILENT,
    });

    assert.equal(ok, true);
    const geesefs = calls.find((c) => c.command === "geesefs");
    assert.ok(geesefs);
    // Tunnel endpoint overrides the in-network one.
    const ei = geesefs.args!.indexOf("--endpoint");
    assert.equal(geesefs.args![ei + 1], "https://abc.ngrok.io");
    assert.deepEqual(geesefs.args!.slice(-2), [
      "agenta-store:mounts/proj-1/mount-9",
      "/home/sandbox/work",
    ]);
    // Scoped creds cross into the sandbox via env only.
    assert.equal(geesefs.env!.AWS_ACCESS_KEY_ID, "SCOPED-AK");
    assert.equal(geesefs.env!.AWS_SESSION_TOKEN, "SCOPED-TOK");
  });

  it("returns false on a non-zero geesefs exit (no throw)", async () => {
    const sandbox = {
      runProcess: async (opts: { command: string }) =>
        opts.command === "geesefs"
          ? { exitCode: 1, stderr: "mount error" }
          : { exitCode: 0 },
    };
    const ok = await mountStorageRemote(sandbox, "/home/sandbox/work", CREDS, {
      endpoint: "https://abc.ngrok.io",
      log: SILENT,
    });
    assert.equal(ok, false);
  });
});
