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
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  signSessionMountCredentials,
  mountStorage,
  unmountStorage,
  mountpointFailureState,
  discoverTunnelEndpoint,
  mountStorageRemote,
  harnessSessionMounts,
  mountHarnessSessionDirs,
  storeReachableFromSandbox,
  shellQuote,
  waitForMountReady,
  remoteMountLogFile,
  remoteMountScript,
  REMOTE_MOUNT_NOT_ALIVE_EXIT,
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
    assert.deepEqual(
      harnessSessionMounts("unknown-harness", "/home/agent"),
      [],
    );
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

    await mountHarnessSessionDirs(
      sandbox,
      "sess-1",
      dirs,
      "https://tunnel.example",
      {
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
      },
    );

    assert.deepEqual(signedNames, ["claude-projects", "pi-sessions"]);
    // Only the successfully-signed dir got mounted; the failed one was skipped, not fatal.
    assert.deepEqual(mountedPaths, ["/home/agent/.claude/projects"]);
  });

  it("is a no-op for an empty dir list", async () => {
    let called = false;
    const sandbox = { runProcess: async () => ({ exitCode: 0 }) };
    await mountHarnessSessionDirs(
      sandbox,
      "sess-1",
      [],
      "https://tunnel.example",
      {
        apiBase: "http://api:8000",
        authorization: "ApiKey abc",
        log: SILENT,
        signSessionMountCredentials: async () => {
          called = true;
          return null;
        },
      },
    );
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
  it("cancels a slow local mount promptly and stops a geesefs handle that arrives late", async () => {
    const controller = new AbortController();
    let mountStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      mountStarted = resolve;
    });
    let finishMount!: (attempt: { stop: () => Promise<void> }) => void;
    const lateMount = new Promise<{ stop: () => Promise<void> }>((resolve) => {
      finishMount = resolve;
    });
    let stopped = 0;
    const mount = mountStorage("/work/cwd", CREDS, {
      signal: controller.signal,
      checkMounted: async () => false,
      runGeesefs: async () => {
        mountStarted();
        return lateMount;
      },
      unmountDeps: {
        runUnmount: async () => {},
        checkMountpoint: async () => "gone",
      },
      log: SILENT,
    });

    await started;
    controller.abort();
    await assert.rejects(
      () =>
        Promise.race([
          mount,
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("local mount did not cancel")),
              4_000,
            ),
          ),
        ]),
      /acquisition was aborted/,
    );

    finishMount({
      stop: async () => {
        stopped += 1;
      },
    });
    for (let i = 0; i < 10 && stopped === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.equal(stopped, 1, "the late geesefs process is stopped");
  });

  it("builds the geesefs command with creds in env, not argv", async () => {
    let seenArgs: string[] = [];
    let seenEnv: Record<string, string> = {};
    const ok = await mountStorage("/work/cwd", CREDS, {
      checkMounted: notMountedThenAlive(),
      runGeesefs: async (args, env) => {
        seenArgs = args;
        seenEnv = env;
      },
      unmountDeps: {
        runUnmount: async () => {},
        checkMountpoint: async () => "gone",
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
    assert.ok(seenArgs.includes("--no-expire-multipart"));
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
        unmountDeps: {
          runUnmount: async () => {},
          checkMountpoint: async () => "gone",
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

  it("falls back after stop when fusermount errors but the production probe confirms gone", async () => {
    const calls: string[] = [];
    const ok = await mountStorage("/work/cwd", CREDS, {
      checkMounted: async () => false,
      runGeesefs: async () => {
        calls.push("mount");
        return {
          stop: async () => {
            calls.push("stop");
          },
        };
      },
      unmountDeps: {
        runUnmount: async () => {
          calls.push("fusermount-error");
          throw new Error("not mounted");
        },
        checkMountpoint: async () => (calls.push("probe-gone"), "gone"),
      },
      log: SILENT,
    });
    assert.equal(ok, false);
    assert.deepEqual(calls, [
      "fusermount-error",
      "probe-gone",
      "mount",
      "stop",
      "fusermount-error",
      "probe-gone",
    ]);
  });

  it("refuses fallback when the failed geesefs process does not stop", async () => {
    const calls: string[] = [];
    await assert.rejects(
      mountStorage("/work/cwd", CREDS, {
        checkMounted: async () => false,
        runGeesefs: async () => ({
          stop: async () => {
            calls.push("stop-unconfirmed");
            throw new Error(
              "geesefs process did not exit after SIGTERM and SIGKILL",
            );
          },
        }),
        unmountDeps: {
          runUnmount: async () => {
            calls.push("unmount");
          },
          checkMountpoint: async () => (calls.push("probe"), "gone"),
        },
        log: SILENT,
      }),
      /geesefs process did not exit after SIGTERM and SIGKILL/,
    );
    assert.deepEqual(calls, ["unmount", "probe", "stop-unconfirmed"]);
  });

  for (const detachState of ["mounted", "inconclusive"] as const) {
    it(
      "fails clearly when the failed mount remains " + detachState,
      async () => {
        let probes = 0;
        await assert.rejects(
          mountStorage("/work/cwd", CREDS, {
            checkMounted: async () => false,
            runGeesefs: async () => {
              throw new Error("fuse: device not found");
            },
            unmountDeps: {
              runUnmount: async () => {},
              checkMountpoint: async () => {
                probes += 1;
                return probes === 1 ? "gone" : detachState;
              },
            },
            log: SILENT,
          }),
          /detach could not be confirmed.*refusing ephemeral cwd fallback.*fuse: device not found/,
        );
        assert.equal(probes, 2);
      },
    );
  }
});

describe("mountStorage readiness", () => {
  it("probes after the attempt and fails when the mount is not alive", async () => {
    let checks = 0;
    const calls: string[] = [];
    const ok = await mountStorage("/work/cwd", CREDS, {
      checkMounted: async () => {
        checks += 1;
        return false;
      },
      runGeesefs: async () => ({
        stop: async () => {
          calls.push("stop");
        },
      }),
      unmountDeps: {
        runUnmount: async () => {},
        checkMountpoint: async () => "gone",
      },
      log: SILENT,
    });
    assert.equal(ok, false);
    assert.equal(checks, 2);
    assert.deepEqual(calls, ["stop"]);
  });

  it("an abort during the attempt still stops it and throws", async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const mount = mountStorage("/work/cwd", CREDS, {
      signal: controller.signal,
      checkMounted: async () => false,
      runGeesefs: async () => {
        controller.abort();
        return {
          stop: async () => {
            calls.push("stop");
          },
        };
      },
      unmountDeps: {
        runUnmount: async () => {
          calls.push("unmount");
        },
        checkMountpoint: async () => "gone",
      },
      log: SILENT,
    });
    await assert.rejects(mount, /acquisition was aborted/);
    for (let i = 0; i < 10 && !calls.includes("stop"); i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.ok(calls.includes("stop"), "the alive attempt is stopped on abort");
  });
});

describe("mountStorage without FUSE", () => {
  it("returns false at once, without probing or starting geesefs, and warns once", async () => {
    const logs: string[] = [];
    let checks = 0;
    const deps = {
      fuseDevice: "/nonexistent/fuse-device",
      checkMounted: async () => {
        checks += 1;
        return false;
      },
      log: (m: string) => logs.push(m),
    };
    const started = Date.now();
    assert.equal(await mountStorage("/work/cwd", CREDS, deps), false);
    assert.equal(await mountStorage("/work/cwd-agent", CREDS, deps), false);
    assert.ok(Date.now() - started < 1_000);
    assert.equal(checks, 0);
    assert.equal(logs.filter((l) => l.includes("no /dev/fuse")).length, 1);
  });
});

describe("waitForMountReady", () => {
  const clock = () => {
    let t = 0;
    const sleeps: number[] = [];
    return {
      now: () => t,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        t += ms;
      },
      sleeps,
    };
  };

  it("returns at the first alive probe with no sleep", async () => {
    const c = clock();
    const ok = await waitForMountReady({
      check: async () => true,
      sleep: c.sleep,
      now: c.now,
    });
    assert.equal(ok, true);
    assert.deepEqual(c.sleeps, []);
  });

  it("starts at 50 ms and doubles to a 100 ms cap", async () => {
    const c = clock();
    let probes = 0;
    const ok = await waitForMountReady({
      check: async () => ++probes === 8,
      sleep: c.sleep,
      now: c.now,
    });
    assert.equal(ok, true);
    assert.deepEqual(c.sleeps, [50, 100, 100, 100, 100, 100, 100]);
  });

  it("gives up after the 15 s timeout", async () => {
    const c = clock();
    const ok = await waitForMountReady({
      check: async () => false,
      sleep: c.sleep,
      now: c.now,
    });
    assert.equal(ok, false);
    assert.equal(
      c.sleeps.reduce((a, b) => a + b, 0),
      15_000,
    );
  });

  it("stops at once when geesefs exited", async () => {
    const c = clock();
    let probes = 0;
    const ok = await waitForMountReady({
      check: async () => (probes++, false),
      sleep: c.sleep,
      now: c.now,
      exited: () => probes >= 2,
    });
    assert.equal(ok, false);
    assert.equal(probes, 2);
    assert.deepEqual(c.sleeps, [50]);
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
      checkMountpoint: async () => "inconclusive",
      log: SILENT,
    });
    // No throw == pass, but callers must not treat this as safe to delete the cwd.
    assert.equal(ok, false);
  });
});

describe("mountpointFailureState", () => {
  for (const code of [1, 32, "1", "32"]) {
    it("treats not-a-mountpoint exit code " + code + " as gone", () => {
      assert.equal(mountpointFailureState({ code }), "gone");
    });
  }

  for (const code of [0, 2, 127, "ENOENT", undefined]) {
    it("keeps unexpected exit code " + String(code) + " inconclusive", () => {
      assert.equal(mountpointFailureState({ code }), "inconclusive");
    });
  }
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
      ngrokApi: "http://ngrok-mounts:4040",
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

  it("picks the tunnel forwarding to the store, not the first one listed", async () => {
    const url = await discoverTunnelEndpoint({
      storeEndpoint: "http://seaweedfs:8333",
      fetchImpl: (async () =>
        okResponse({
          tunnels: [
            {
              proto: "https",
              public_url: "https://ingress.example",
              config: { addr: "http://traefik:80" },
            },
            {
              proto: "https",
              public_url: "https://store.example",
              config: { addr: "http://seaweedfs:8333" },
            },
          ],
        })) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(url, "https://store.example");
  });

  it("returns null when the store endpoint itself cannot be parsed", async () => {
    // Falling through to "first https tunnel wins" here would hand back the ingress
    // tunnel, which is the failure this matching exists to prevent.
    const url = await discoverTunnelEndpoint({
      storeEndpoint: "   ",
      fetchImpl: (async () =>
        okResponse({
          tunnels: [
            {
              proto: "https",
              public_url: "https://ingress.example",
              config: { addr: "http://traefik:80" },
            },
          ],
        })) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(url, null);
  });

  it("prefers the https listing when the store's upstream is listed twice", async () => {
    // One `ngrok http` can appear as both an http and an https entry over the same
    // upstream. geesefs would then reach the store unencrypted over the internet.
    const url = await discoverTunnelEndpoint({
      storeEndpoint: "http://seaweedfs:8333",
      fetchImpl: (async () =>
        okResponse({
          tunnels: [
            {
              proto: "http",
              public_url: "http://store.example",
              config: { addr: "http://seaweedfs:8333" },
            },
            {
              proto: "https",
              public_url: "https://store.example",
              config: { addr: "http://seaweedfs:8333" },
            },
          ],
        })) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(url, "https://store.example");
  });

  it("returns null rather than another tunnel's URL when none forwards to the store", async () => {
    // The development compose files point the agent at the platform ingress, so a
    // live tunnel is no longer evidence that the store is reachable. Handing back
    // the ingress URL would mount an HTTP API as an object store.
    const url = await discoverTunnelEndpoint({
      storeEndpoint: "http://seaweedfs:8333",
      fetchImpl: (async () =>
        okResponse({
          tunnels: [
            {
              proto: "https",
              public_url: "https://ingress.example",
              config: { addr: "http://traefik:80" },
            },
          ],
        })) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(url, null);
  });

  it("matches the upstream on host and port however the agent spells it", async () => {
    const url = await discoverTunnelEndpoint({
      storeEndpoint: "http://seaweedfs:8333",
      fetchImpl: (async () =>
        okResponse({
          tunnels: [
            {
              proto: "https",
              public_url: "https://store.example",
              config: { addr: "seaweedfs:8333" },
            },
          ],
        })) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(url, "https://store.example");
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
  const isMountScript = (opts: { args?: string[] }) =>
    (opts.args?.[1] ?? "").includes("geesefs --log-file");

  it("cancels a slow Daytona mount command promptly", async () => {
    const controller = new AbortController();
    let mountStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      mountStarted = resolve;
    });
    const sandbox = {
      runProcess: async (opts: { args?: string[] }) => {
        if (isMountScript(opts)) {
          mountStarted();
          return new Promise<{ exitCode: number }>(() => {});
        }
        return { exitCode: 0 };
      },
    };
    const mount = mountStorageRemote(sandbox, "/home/sandbox/work", CREDS, {
      endpoint: "https://abc.ngrok.io",
      signal: controller.signal,
      log: SILENT,
    });

    await started;
    controller.abort();
    await assert.rejects(
      () =>
        Promise.race([
          mount,
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("remote mount did not cancel")),
              4_000,
            ),
          ),
        ]),
      /acquisition was aborted/,
    );
  });

  it("detaches a remote mount that completes after cancellation", async () => {
    const controller = new AbortController();
    const unmountCalls: string[] = [];
    let finishMount!: (value: { exitCode: number }) => void;
    const mountFinished = new Promise<{ exitCode: number }>((resolve) => {
      finishMount = resolve;
    });
    let mountStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      mountStarted = resolve;
    });
    const sandbox = {
      runProcess: async (opts: { command: string; args?: string[] }) => {
        if (isMountScript(opts)) {
          mountStarted();
          return mountFinished;
        }
        unmountCalls.push(opts.args?.[1] ?? "");
        return { exitCode: 0 };
      },
    };
    const mount = mountStorageRemote(sandbox, "/home/sandbox/work", CREDS, {
      endpoint: "https://abc.ngrok.io",
      signal: controller.signal,
      log: SILENT,
    });

    await started;
    controller.abort();
    await assert.rejects(mount, /acquisition was aborted/);
    finishMount({ exitCode: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(
      unmountCalls.length,
      2,
      "detaches on cancellation and again after the late mount completes",
    );
  });

  it("mounts with ONE exec: detach, mkdir, start, and the alive poll in one script", async () => {
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
    assert.equal(calls.length, 1, "one round trip to the sandbox");
    const [call] = calls;
    assert.equal(call!.command, "sh");
    const script = call!.args![1]!;
    const order = [
      "fusermount -u",
      "mkdir -p",
      "geesefs --log-file",
      "mountpoint -q",
    ].map((needle) => script.indexOf(needle));
    assert.ok(order.every((i) => i >= 0));
    assert.deepEqual([...order].sort((x, y) => x - y), order, "detach, mkdir, start, poll");
    // Tunnel endpoint overrides the in-network one.
    assert.ok(script.includes("--endpoint' 'https://abc.ngrok.io"));
    assert.ok(script.includes("agenta-store:mounts/proj-1/mount-9"));
    // Backgrounded (no -f) so the script can go on to poll and then exit.
    assert.ok(!/\s'-f'(\s|$)/.test(script), "remote geesefs must not run foreground");
    assert.match(script, /geesefs --log-file [^\n]*2>&1 &$/m);
    // Scoped creds cross into the sandbox via env only, never the script text.
    assert.equal(call!.env!.AWS_ACCESS_KEY_ID, "SCOPED-AK");
    assert.equal(call!.env!.AWS_SESSION_TOKEN, "SCOPED-TOK");
    assert.ok(!script.includes("SCOPED-AK"));
  });

  it("returns false and detaches when the mount never comes alive", async () => {
    const execs: string[] = [];
    const logs: string[] = [];
    const sandbox = {
      runProcess: async (opts: { args?: string[] }) => {
        execs.push(opts.args?.[1] ?? "");
        return isMountScript(opts)
          ? {
              exitCode: REMOTE_MOUNT_NOT_ALIVE_EXIT,
              result: "geesefs: access denied",
            }
          : { exitCode: 0 };
      },
    };
    const ok = await mountStorageRemote(sandbox, "/home/sandbox/work", CREDS, {
      endpoint: "https://abc.ngrok.io",
      log: (m) => logs.push(m),
    });
    assert.equal(ok, false);
    assert.equal(execs.length, 2);
    assert.ok(execs[1]!.includes("fusermount -u '/home/sandbox/work'"));
    assert.ok(execs[1]!.includes("umount -l '/home/sandbox/work'"));
    assert.match(logs.join("\n"), /remote mount not alive.*access denied/);
  });

  it("returns false and detaches on any other non-zero exit (no throw)", async () => {
    const execs: string[] = [];
    const sandbox = {
      runProcess: async (opts: { args?: string[] }) => {
        execs.push(opts.args?.[1] ?? "");
        return isMountScript(opts)
          ? { exitCode: 1, stderr: "mount error" }
          : { exitCode: 0 };
      },
    };
    const ok = await mountStorageRemote(sandbox, "/home/sandbox/work", CREDS, {
      endpoint: "https://abc.ngrok.io",
      log: SILENT,
    });
    assert.equal(ok, false);
    assert.equal(execs.length, 2, "the mount, then the detach");
  });

  it("returns false and detaches when the exec throws", async () => {
    const execs: string[] = [];
    const sandbox = {
      runProcess: async (opts: { args?: string[] }) => {
        execs.push(opts.args?.[1] ?? "");
        if (isMountScript(opts)) throw new Error("exec timed out");
        return { exitCode: 0 };
      },
    };
    const ok = await mountStorageRemote(sandbox, "/home/sandbox/work", CREDS, {
      endpoint: "https://abc.ngrok.io",
      log: SILENT,
    });
    assert.equal(ok, false);
    assert.equal(execs.length, 2);
  });

  it("uses the store's own endpoint when no tunnel is passed", async () => {
    let script = "";
    const sandbox = {
      runProcess: async (opts: { command: string; args?: string[] }) => {
        if (isMountScript(opts)) script = opts.args![1]!;
        return { exitCode: 0 };
      },
    };
    await mountStorageRemote(sandbox, "/home/sandbox/work", CREDS, {
      log: SILENT,
    });
    assert.ok(
      script.includes(`--endpoint' '${CREDS.endpoint}`),
      "falls back to the store's own endpoint",
    );
  });
});

describe("remoteMountScript in a real shell", () => {
  // Stub geesefs/mountpoint/fusermount on PATH, run the script with sh, and check the outcome.
  const withStubs = (opts: {
    aliveAfterProbes?: number;
    lsHangs?: boolean;
    mountpointHangs?: boolean;
    aliveSeconds: number;
  }) => {
    const dir = mkdtempSync(join(tmpdir(), "agenta-remote-mount-"));
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const cwd = join(dir, "work");
    const stub = (name: string, body: string) => {
      writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
    };
    stub("geesefs", `echo started >> ${dir}/geesefs.calls; echo "geesefs log line"`);
    stub("fusermount", `echo "$@" >> ${dir}/unmount.calls; exit 0`);
    stub(
      "mountpoint",
      `n=$(cat ${dir}/probes 2>/dev/null || echo 0); n=$((n+1)); echo $n > ${dir}/probes; ` +
        (opts.mountpointHangs ? "sleep 30; " : "") +
        `[ $n -ge ${opts.aliveAfterProbes ?? 1_000_000} ]`,
    );
    if (opts.lsHangs) stub("ls", "sleep 30");
    const script = remoteMountScript(cwd, ["--endpoint", "http://x", "b:p", cwd], join(dir, "g.log"), opts.aliveSeconds);
    const started = Date.now();
    const r = spawnSync("sh", ["-c", script], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf-8",
      timeout: 30_000,
    });
    const elapsed = Date.now() - started;
    const read = (f: string) => {
      try {
        return readFileSync(join(dir, f), "utf-8");
      } catch {
        return "";
      }
    };
    const out = { status: r.status, stdout: r.stdout, elapsed, probes: Number(read("probes") || 0), geesefs: read("geesefs.calls"), unmount: read("unmount.calls"), cwdExists: existsSync(cwd) };
    rmSync(dir, { recursive: true, force: true });
    return out;
  };

  it("exits 0 as soon as the mount serves I/O, polling at about 50 ms", () => {
    const r = withStubs({ aliveAfterProbes: 3, aliveSeconds: 10 });
    assert.equal(r.status, 0);
    assert.equal(r.probes, 3);
    assert.equal(r.geesefs.trim(), "started");
    assert.ok(r.unmount.length > 0, "detached first");
    assert.ok(r.cwdExists, "created the mountpoint");
    assert.ok(r.elapsed < 2_000, `took ${r.elapsed} ms`);
  });

  it("exits not-alive with the log tail once the time budget passes", () => {
    // The clock has whole seconds, so a 2 s budget lasts between 1 and 2 s.
    const r = withStubs({ aliveSeconds: 2 });
    assert.equal(r.status, REMOTE_MOUNT_NOT_ALIVE_EXIT);
    assert.ok(r.probes >= 2, `probed ${r.probes} times`);
    assert.ok(r.elapsed < 5_000, `took ${r.elapsed} ms`);
    assert.match(r.stdout, /geesefs log line/);
  });

  it("stops after two hung ls probes in a row", { timeout: 20_000 }, () => {
    const r = withStubs({ aliveAfterProbes: 1, lsHangs: true, aliveSeconds: 60 });
    assert.equal(r.status, REMOTE_MOUNT_NOT_ALIVE_EXIT);
    assert.equal(r.probes, 2);
  });

  it("caps a hung mountpoint probe too, and stops after two", { timeout: 20_000 }, () => {
    const r = withStubs({ mountpointHangs: true, aliveSeconds: 60 });
    assert.equal(r.status, REMOTE_MOUNT_NOT_ALIVE_EXIT);
    assert.equal(r.probes, 2);
    assert.ok(r.elapsed < 15_000, `took ${r.elapsed} ms`);
  });

  it("gives each mountpoint its own geesefs log, since mounts run at the same time", () => {
    assert.notEqual(
      remoteMountLogFile("/home/sandbox/work"),
      remoteMountLogFile("/home/sandbox/work-agent"),
    );
    assert.match(remoteMountLogFile("/home/sandbox/work"), /^\/tmp\/geesefs-mount[^/]+\.log$/);
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

describe("shell injection hardening (RUN-SHELL-1)", () => {
  it("shellQuote neutralizes a single quote break-out", () => {
    const hostile = "x' ; rm -rf / #";
    const quoted = shellQuote(hostile);
    // Wrapped in single quotes with any embedded quote escaped — never a bare, unquoted `;`.
    assert.ok(quoted.startsWith("'") && quoted.endsWith("'"));
    assert.equal(quoted, `'x'"'"' ; rm -rf / #'`);
  });

  it("mountStorageRemote quotes a cwd containing shell metacharacters", async () => {
    const calls: string[] = [];
    const sandbox = {
      runProcess: async (opts: { command: string; args?: string[] }) => {
        if (opts.command === "sh") calls.push(opts.args?.[1] ?? "");
        return { exitCode: 0 };
      },
    };
    const hostileCwd = "/tmp/work'; touch /tmp/pwned; echo '";

    await mountStorageRemote(sandbox, hostileCwd, CREDS, {
      endpoint: "https://abc.ngrok.io",
      aliveTimeoutMs: 1_000,
      log: SILENT,
    });

    // Every shell string touching cwd must carry the exact shellQuote() escaping — proof the
    // embedded `'` never breaks out to run `touch /tmp/pwned` as a separate command.
    const touched = calls.filter((cmd) => cmd.includes("pwned"));
    assert.ok(touched.length > 0);
    for (const cmd of touched) {
      assert.ok(
        cmd.includes(shellQuote(hostileCwd)),
        `hostile cwd was not fully quoted: ${cmd}`,
      );
    }
  });

  it("mountStorageRemote quotes the geesefs argv (bucket:prefix and cwd)", async () => {
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
    assert.ok(shellCmd.includes("'agenta-store:mounts/proj-1/mount-9'"));
    assert.ok(shellCmd.includes("'/home/sandbox/work'"));
  });
});
