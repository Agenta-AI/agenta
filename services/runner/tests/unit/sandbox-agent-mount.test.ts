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

import {
  signSessionMountCredentials,
  mountStorage,
  unmountStorage,
  discoverTunnelEndpoint,
  mountStorageRemote,
  harnessSessionMounts,
  mountHarnessSessionDirs,
  storeReachableFromSandbox,
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
    // session_id rides the query; name defaults to "cwd" (S4); auth header is forwarded.
    assert.match(
      calledUrl,
      /\/sessions\/mounts\/sign\?session_id=sess-1&name=cwd$/,
    );
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

  it("passes a non-default name through to the sign URL (S4 per-harness mounts)", async () => {
    let calledUrl = "";
    await signSessionMountCredentials(
      "sess-1",
      {
        apiBase: "http://api:8000",
        authorization: "ApiKey abc",
        fetchImpl: (async (url: string) => {
          calledUrl = url;
          return okResponse(SIGNED_BODY);
        }) as unknown as typeof fetch,
        log: SILENT,
      },
      "claude-projects",
    );
    assert.match(
      calledUrl,
      /\/sessions\/mounts\/sign\?session_id=sess-1&name=claude-projects$/,
    );
  });
});

describe("harnessSessionMounts (S4)", () => {
  it("claude mounts ~/.claude/projects only, never the credentials file", () => {
    const dirs = harnessSessionMounts("claude", "/home/agent");
    assert.deepEqual(dirs, [
      { name: "claude-projects", path: "/home/agent/.claude/projects" },
    ]);
    assert.ok(
      !dirs.some((d) => d.path.includes(".credentials.json")),
      "credentials file must never appear in the mount list",
    );
  });

  it("pi mounts <homeDir>/.pi/agent/sessions by default", () => {
    const dirs = harnessSessionMounts("pi", "/home/agent");
    assert.deepEqual(dirs, [
      { name: "pi-sessions", path: "/home/agent/.pi/agent/sessions" },
    ]);
  });

  it("pi honors PI_CODING_AGENT_DIR override for its base dir", () => {
    const dirs = harnessSessionMounts("pi", "/home/agent", "/custom/pi-dir");
    assert.deepEqual(dirs, [
      { name: "pi-sessions", path: "/custom/pi-dir/sessions" },
    ]);
  });

  it("an unknown/unlisted harness mounts nothing (callers fall back to cwd only)", () => {
    assert.deepEqual(harnessSessionMounts("unknown-harness", "/home/agent"), []);
  });
});

describe("mountHarnessSessionDirs (S4, remote-only)", () => {
  it("signs and mounts each dir independently; a failed sign for one does not block another", async () => {
    const signedNames: string[] = [];
    const mountedPaths: string[] = [];
    const dirs = [
      { name: "claude-projects", path: "/home/agent/.claude/projects" },
      { name: "pi-sessions", path: "/home/agent/.pi/agent/sessions" },
    ];
    const sandbox = { runProcess: async () => ({ exitCode: 0 }) };

    await mountHarnessSessionDirs(sandbox, "sess-1", dirs, "https://tunnel.example", {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      log: SILENT,
      signSessionMountCredentials: async (_sessionId, _deps, name) => {
        signedNames.push(name ?? "cwd");
        if (name === "pi-sessions") return null; // simulate one failed sign
        return {
          region: "us-east-1",
          bucket: "agenta-store",
          prefix: `mounts/proj-1/${name}`,
          accessKey: "AK",
          secretKey: "SK",
        };
      },
      mountStorageRemote: async (_sandbox, path) => {
        mountedPaths.push(path);
        return true;
      },
    });

    assert.deepEqual(signedNames, ["claude-projects", "pi-sessions"]);
    // Only the successfully-signed dir got mounted; the failed one was skipped, not fatal.
    assert.deepEqual(mountedPaths, ["/home/agent/.claude/projects"]);
  });

  it("is a no-op for an empty dir list", async () => {
    let called = false;
    const sandbox = { runProcess: async () => ({ exitCode: 0 }) };
    await mountHarnessSessionDirs(sandbox, "sess-1", [], "https://tunnel.example", {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      log: SILENT,
      signSessionMountCredentials: async () => {
        called = true;
        return null;
      },
    });
    assert.equal(called, false);
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
  it("detaches an existing mount before starting geesefs", async () => {
    const commands: string[] = [];
    const sandbox = {
      runProcess: async (opts: { args?: string[] }) => {
        const command = opts.args?.[1] ?? "";
        commands.push(command);
        return { exitCode: 0 };
      },
    };

    const ok = await mountStorageRemote(sandbox, "/home/sandbox/work", CREDS, {
      endpoint: "https://abc.ngrok.io",
      aliveAttempts: 1,
      log: SILENT,
    });

    assert.equal(ok, true);
    const unmountIndex = commands.findIndex((command) => command.includes("fusermount -u"));
    const mountIndex = commands.findIndex((command) => command.includes("geesefs --log-file"));
    assert.ok(unmountIndex >= 0);
    assert.ok(mountIndex > unmountIndex, "unmount attempt precedes the geesefs mount");
  });

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
    // geesefs runs through `sh -c "geesefs ... &"` so it backgrounds and the RPC returns.
    const geesefs = calls.find(
      (c) => c.command === "sh" && (c.args?.[1] ?? "").includes("geesefs"),
    );
    assert.ok(geesefs);
    const shellCmd = geesefs.args![1];
    // Tunnel endpoint overrides the in-network one.
    assert.ok(shellCmd.includes("--endpoint https://abc.ngrok.io"));
    assert.ok(shellCmd.includes("agenta-store:mounts/proj-1/mount-9"));
    assert.ok(shellCmd.includes("/home/sandbox/work"));
    // Backgrounded so the RPC returns instead of blocking on a foreground mount.
    assert.ok(shellCmd.trimEnd().endsWith("&"));
    // Scoped creds cross into the sandbox via env only, never the shell string.
    assert.equal(geesefs.env!.AWS_ACCESS_KEY_ID, "SCOPED-AK");
    assert.equal(geesefs.env!.AWS_SESSION_TOKEN, "SCOPED-TOK");
    assert.ok(!shellCmd.includes("SCOPED-AK"));
  });

  it("returns false on a non-zero geesefs exit (no throw)", async () => {
    const sandbox = {
      runProcess: async (opts: { command: string; args?: string[] }) =>
        opts.command === "sh" && (opts.args?.[1] ?? "").includes("geesefs")
          ? { exitCode: 1, stderr: "mount error" }
          : { exitCode: 0 },
    };
    const ok = await mountStorageRemote(sandbox, "/home/sandbox/work", CREDS, {
      endpoint: "https://abc.ngrok.io",
      log: SILENT,
    });
    assert.equal(ok, false);
  });

  it("backgrounds geesefs (no -f) so the runProcess RPC returns", async () => {
    let shellCmd = "";
    const sandbox = {
      runProcess: async (opts: { command: string; args?: string[] }) => {
        if (opts.command === "sh" && (opts.args?.[1] ?? "").includes("geesefs"))
          shellCmd = opts.args![1];
        return { exitCode: 0 };
      },
    };

    await mountStorageRemote(sandbox, "/home/sandbox/work", CREDS, {
      endpoint: "https://abc.ngrok.io",
      log: SILENT,
    });

    // A foreground geesefs (-f) never returns, so `runProcess` blocks until its timeout kills
    // the mount it just made; the trailing `&` backgrounds it instead.
    assert.ok(!/\s-f(\s|$)/.test(shellCmd), "remote geesefs must not run foreground");
    assert.ok(shellCmd.trimEnd().endsWith("&"), "geesefs must be backgrounded");
  });

  it("returns false when the mount never comes alive", async () => {
    // geesefs backgrounds cleanly (exit 0) but the FUSE channel never serves I/O. Without the
    // liveness poll this returned true and the next mkdir hit a dead mount ("Stream Error").
    const sandbox = {
      runProcess: async (opts: { args?: string[] }) => ({
        exitCode: opts.args?.some((a) => a.includes("mountpoint")) ? 1 : 0,
      }),
    };

    const ok = await mountStorageRemote(sandbox, "/home/sandbox/work", CREDS, {
      endpoint: "https://abc.ngrok.io",
      aliveAttempts: 2,
      log: SILENT,
    });
    assert.equal(ok, false);
  });

  it("returns true once the mountpoint probe succeeds", async () => {
    let probes = 0;
    const sandbox = {
      runProcess: async (opts: { args?: string[] }) => {
        if (opts.args?.some((a) => a.includes("mountpoint"))) {
          probes += 1;
          return { exitCode: probes >= 2 ? 0 : 1 }; // alive on the second poll
        }
        return { exitCode: 0 };
      },
    };

    const ok = await mountStorageRemote(sandbox, "/home/sandbox/work", CREDS, {
      endpoint: "https://abc.ngrok.io",
      log: SILENT,
    });
    assert.equal(ok, true);
    assert.equal(probes, 2, "polls until the mount serves I/O");
  });

  it("unmounts the dead FUSE node before giving up when the alive poll never succeeds", async () => {
    // geesefs may register the mountpoint without ever serving I/O. If nothing detaches it, it
    // shadows cwd and every later file op on the sandbox hangs until the run limit kills the turn.
    const unmountCalls: string[] = [];
    const sandbox = {
      runProcess: async (opts: { command: string; args?: string[] }) => {
        const shellCmd = opts.args?.[1] ?? "";
        if (opts.command === "sh" && /mountpoint -q/.test(shellCmd)) {
          return { exitCode: 1 }; // never alive
        }
        if (
          opts.command === "sh" &&
          (shellCmd.includes("fusermount") || shellCmd.includes("umount"))
        ) {
          unmountCalls.push(shellCmd);
          return { exitCode: 0 };
        }
        return { exitCode: 0 };
      },
    };

    const ok = await mountStorageRemote(sandbox, "/home/sandbox/work", CREDS, {
      endpoint: "https://abc.ngrok.io",
      aliveAttempts: 2,
      log: SILENT,
    });

    assert.equal(ok, false);
    assert.equal(
      unmountCalls.length,
      2,
      "cleans before mounting and again after the alive check fails",
    );
    assert.ok(unmountCalls[1].includes("fusermount -u /home/sandbox/work"));
    assert.ok(unmountCalls[1].includes("umount -l /home/sandbox/work"));
  });

  it("uses the store's own endpoint when no tunnel is passed", async () => {
    let shellCmd = "";
    const sandbox = {
      runProcess: async (opts: { command: string; args?: string[] }) => {
        if (opts.command === "sh" && (opts.args?.[1] ?? "").includes("geesefs"))
          shellCmd = opts.args![1];
        return { exitCode: 0 };
      },
    };
    // CREDS.endpoint is the real store URL; with no override geesefs must use it, not the tunnel.
    await mountStorageRemote(sandbox, "/home/sandbox/work", CREDS, {
      log: SILENT,
    });
    assert.ok(
      shellCmd.includes(`--endpoint ${CREDS.endpoint}`),
      "falls back to the store's own endpoint",
    );
  });
});

describe("storeReachableFromSandbox", () => {
  it("public stores are reachable directly (no tunnel)", () => {
    // Omitted -> geesefs default (real AWS S3).
    assert.equal(storeReachableFromSandbox(undefined), true);
    assert.equal(
      storeReachableFromSandbox("https://s3.eu-central-1.amazonaws.com"),
      true,
    );
    assert.equal(storeReachableFromSandbox("https://minio.example.com"), true);
  });

  it("in-network stores need the tunnel", () => {
    // Compose service name (no dot), loopback, and RFC1918 literals are unreachable from a
    // cloud sandbox, so they must route through the tunnel.
    assert.equal(storeReachableFromSandbox("http://seaweedfs:8333"), false);
    assert.equal(storeReachableFromSandbox("seaweedfs:8333"), false);
    assert.equal(storeReachableFromSandbox("http://localhost:8333"), false);
    assert.equal(storeReachableFromSandbox("http://127.0.0.1:8333"), false);
    assert.equal(storeReachableFromSandbox("http://10.0.0.5:8333"), false);
    assert.equal(storeReachableFromSandbox("http://192.168.1.5:8333"), false);
  });
});
