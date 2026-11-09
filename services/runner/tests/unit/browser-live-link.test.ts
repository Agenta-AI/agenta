/**
 * `/browser/live` finds the session sandbox whose `agenta-browser` answers, by label.
 *
 * Run: pnpm exec vitest run --project unit tests/unit/browser-live-link.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  BROWSER_PORT,
  BROWSER_TOKEN_PATH,
  cacheLiveLinks,
  findBrowserLiveLink,
  findLocalBrowserLiveLink,
  probeBrowserHealth,
  type BrowserLiveLink,
  type BrowserProbe,
  type LiveLinkClient,
  type LiveLinkSandbox,
} from "../../src/browser/live-link.ts";
import { sessionSandboxLabels } from "../../src/engines/sandbox_agent/sandbox-labels.ts";

const SCOPE = { projectId: "project-1", sessionId: "session-1" };
const LABELS = sessionSandboxLabels(SCOPE.projectId, SCOPE.sessionId);

function sandbox(
  id: string,
  state: string,
  token?: string,
  labels: Record<string, string> = LABELS,
): LiveLinkSandbox {
  return {
    id,
    state,
    labels,
    fs: {
      async downloadFile(path: string) {
        assert.equal(path, BROWSER_TOKEN_PATH);
        if (token === undefined) throw new Error("file not found");
        return Buffer.from(`${token}\n`);
      },
    },
    async getPreviewLink(port: number) {
      assert.equal(port, BROWSER_PORT);
      return { url: `https://${BROWSER_PORT}-${id}.proxy.example/`, token: `preview-${id}` };
    },
  };
}

function client(sandboxes: LiveLinkSandbox[], seen: Record<string, string>[] = []): LiveLinkClient {
  return {
    async *list({ labels }) {
      seen.push(labels);
      yield* sandboxes;
    },
  };
}

const PAGE = { wait_reason: "Sign in, then click I'm done.", url: "https://example.com/login" };
const alive: BrowserProbe = async () => PAGE;
const dead: BrowserProbe = async () => null;

const LINK_OF_COMMANDS = {
  url: `wss://${BROWSER_PORT}-commands.proxy.example/live`,
  headers: {
    "x-daytona-preview-token": "preview-commands",
    "X-Daytona-Skip-Preview-Warning": "true",
    "x-agenta-browser-token": "browser-token",
  },
  page: PAGE,
};

describe("findBrowserLiveLink", () => {
  it("asks only for the session's own sandboxes", async () => {
    const seen: Record<string, string>[] = [];
    await findBrowserLiveLink(client([], seen), SCOPE, alive);
    assert.deepEqual(seen, [LABELS]);
  });

  it("returns the WebSocket link and both tokens of the sandbox whose browser answers", async () => {
    const link = await findBrowserLiveLink(
      client([sandbox("harness", "started"), sandbox("commands", "started", "browser-token")]),
      SCOPE,
      alive,
    );
    assert.deepEqual(link, LINK_OF_COMMANDS);
  });

  it("probes /health through the preview link with the same headers it returns", async () => {
    const probes: [string, Record<string, string>][] = [];
    await findBrowserLiveLink(
      client([sandbox("commands", "started", "browser-token")]),
      SCOPE,
      async (url, headers) => {
        probes.push([url, headers]);
        return PAGE;
      },
    );
    assert.deepEqual(probes, [
      [`https://${BROWSER_PORT}-commands.proxy.example/health`, LINK_OF_COMMANDS.headers],
    ]);
  });

  it("skips a sandbox the list returned without both labels of this session", async () => {
    const link = await findBrowserLiveLink(
      client([
        sandbox("other-session", "started", "t", { ...LABELS, "agenta.conversation": "session-2" }),
        sandbox("other-project", "started", "t", { ...LABELS, "agenta.project": "project-2" }),
        sandbox("no-labels", "started", "t", {}),
      ]),
      SCOPE,
      alive,
    );
    assert.equal(link, undefined);
  });

  it("skips a sandbox whose token file outlived its browser", async () => {
    assert.equal(
      await findBrowserLiveLink(client([sandbox("commands", "started", "stale")]), SCOPE, dead),
      undefined,
    );
  });

  it("skips a stopped sandbox, even with a token file left on its disk", async () => {
    assert.equal(
      await findBrowserLiveLink(client([sandbox("parked", "stopped", "old")]), SCOPE, alive),
      undefined,
    );
  });

  it("returns nothing when no browser runs in the session", async () => {
    assert.equal(
      await findBrowserLiveLink(client([sandbox("harness", "started")]), SCOPE, alive),
      undefined,
    );
  });
});

describe("cacheLiveLinks", () => {
  it("stops starting lookups while too many are still running", async () => {
    let calls = 0;
    let finish: (link: undefined) => void = () => {};
    const lookup = () => {
      calls++;
      return new Promise<undefined>((resolve) => (finish = resolve));
    };
    const cached = cacheLiveLinks(lookup, { lookupMs: 5, maxActive: 1 });
    const scope = { projectId: "p", sessionId: "s" };
    await assert.rejects(cached(scope), /timed out/);
    await assert.rejects(cached({ projectId: "p", sessionId: "other" }), /too many/);
    assert.equal(calls, 1);
    finish(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    cached(scope).catch(() => {});
    assert.equal(calls, 2);
  });

  it("tries again once a session's lookup has hung past the stuck limit", async () => {
    let clock = 0;
    let calls = 0;
    const lookup = () => {
      calls++;
      return new Promise<undefined>(() => {});
    };
    const cached = cacheLiveLinks(lookup, { lookupMs: 5, stuckMs: 1_000, now: () => clock });
    const scope = { projectId: "p", sessionId: "s" };
    await assert.rejects(cached(scope), /timed out/);
    await assert.rejects(cached(scope), /still running/);
    clock = 1_000;
    cached(scope).catch(() => {});
    assert.equal(calls, 2);
  });

  it("starts no second lookup for a session while its first still runs", async () => {
    let calls = 0;
    let finish: (link: undefined) => void = () => {};
    const lookup = () => {
      calls++;
      return new Promise<undefined>((resolve) => (finish = resolve));
    };
    const cached = cacheLiveLinks(lookup, { lookupMs: 5 });
    const scope = { projectId: "p", sessionId: "s" };
    await assert.rejects(cached(scope), /timed out/);
    await assert.rejects(cached(scope), /still running/);
    assert.equal(calls, 1);
    finish(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    cached(scope).catch(() => {});
    assert.equal(calls, 2);
  });

  it("shares a lookup that outlasts the cache time", async () => {
    let clock = 0;
    let finish: (link: undefined) => void = () => {};
    let calls = 0;
    const lookup = () => {
      calls++;
      return new Promise<undefined>((resolve) => (finish = resolve));
    };
    const cached = cacheLiveLinks(lookup, { ttlMs: 5_000, now: () => clock });
    const scope = { projectId: "p", sessionId: "s" };
    const first = cached(scope);
    clock = 6_000;
    const second = cached(scope);
    finish(undefined);
    await Promise.all([first, second]);
    assert.equal(calls, 1);
  });

  function counted(sandboxes: LiveLinkSandbox[]) {
    const seen: Record<string, string>[] = [];
    const list = client(sandboxes, seen);
    return { seen, lookup: (scope: typeof SCOPE) => findBrowserLiveLink(list, scope, alive) };
  }

  it("answers a repeat inside the window without asking Daytona again", async () => {
    let clock = 1_000;
    const { seen, lookup } = counted([sandbox("commands", "started", "browser-token")]);
    const cached = cacheLiveLinks(lookup, { ttlMs: 5_000, now: () => clock });
    assert.deepEqual(await cached(SCOPE), LINK_OF_COMMANDS);
    clock += 4_999;
    assert.deepEqual(await cached(SCOPE), LINK_OF_COMMANDS);
    assert.equal(seen.length, 1);
  });

  it("keeps a not-found answer for the window too", async () => {
    let clock = 0;
    const { seen, lookup } = counted([]);
    const cached = cacheLiveLinks(lookup, { ttlMs: 5_000, now: () => clock });
    assert.equal(await cached(SCOPE), undefined);
    clock += 1_000;
    assert.equal(await cached(SCOPE), undefined);
    assert.equal(seen.length, 1);
  });

  it("asks Daytona again once the window has passed", async () => {
    let clock = 0;
    const { seen, lookup } = counted([sandbox("commands", "started", "browser-token")]);
    const cached = cacheLiveLinks(lookup, { ttlMs: 5_000, now: () => clock });
    await cached(SCOPE);
    clock += 5_000;
    await cached(SCOPE);
    assert.equal(seen.length, 2);
  });

  it("keeps each session apart", async () => {
    const { seen, lookup } = counted([]);
    const cached = cacheLiveLinks(lookup, { now: () => 0 });
    await cached(SCOPE);
    await cached({ ...SCOPE, sessionId: "session-2" });
    assert.equal(seen.length, 2);
  });

  it("shares one lookup between overlapping asks for a session", async () => {
    let calls = 0;
    let release: (link: BrowserLiveLink | undefined) => void = () => {};
    const cached = cacheLiveLinks(
      () => {
        calls += 1;
        return new Promise((resolve) => (release = resolve));
      },
      { now: () => 0 },
    );
    const first = cached(SCOPE);
    const second = cached(SCOPE);
    release(undefined);
    assert.deepEqual(await Promise.all([first, second]), [undefined, undefined]);
    assert.equal(calls, 1);
  });

  it("does not keep a failed lookup", async () => {
    let calls = 0;
    const cached = cacheLiveLinks(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("daytona down");
        return undefined;
      },
      { now: () => 0 },
    );
    await assert.rejects(cached(SCOPE), /daytona down/);
    assert.equal(await cached(SCOPE), undefined);
    assert.equal(calls, 2);
  });

  it("lets the oldest session go once it holds more than maxEntries", async () => {
    const asked: string[] = [];
    const cached = cacheLiveLinks(
      async (scope) => {
        asked.push(scope.sessionId);
        return undefined;
      },
      { maxEntries: 2, now: () => 0 },
    );
    for (const sessionId of ["a", "b", "c", "b", "a"]) {
      await cached({ projectId: "p", sessionId });
    }
    assert.deepEqual(asked, ["a", "b", "c", "a"]);
  });
});

describe("probeBrowserHealth", () => {
  async function serve(status: number, body: string, type: string): Promise<{ url: string; close: () => void }> {
    const { createServer } = await import("node:http");
    const server = createServer((_req, res) => {
      res.writeHead(status, { "content-type": type });
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    return { url: `http://127.0.0.1:${port}/health`, close: () => server.close() };
  }

  it("counts only the browser's own answer as live, and reads its page state", async () => {
    const empty = { wait_reason: "", url: "" };
    const cases: [number, string, string, unknown][] = [
      [200, '{"ok":true}', "application/json", empty],
      [
        200,
        '{"ok":true,"wait_reason":"Sign in","url":"https://example.com/","title":"Example","extra":1}',
        "application/json",
        { wait_reason: "Sign in", url: "https://example.com/" },
      ],
      [200, '{"ok":true,"wait_reason":7,"title":null}', "application/json", empty],
      [200, "<html>preview warning</html>", "text/html", null],
      [503, '{"ok":false}', "application/json", null],
    ];
    for (const [status, body, type, page] of cases) {
      const server = await serve(status, body, type);
      try {
        assert.deepEqual(await probeBrowserHealth(server.url, {}), page, `${status} ${body}`);
      } finally {
        server.close();
      }
    }
  });
});

describe("findLocalBrowserLiveLink", () => {
  const up: BrowserProbe = async () => PAGE;

  it("points the api at this container's name, with the browser token", async () => {
    const seen: Array<[string, Record<string, string>]> = [];
    const link = await findLocalBrowserLiveLink(
      async () => "tok",
      "runner-host",
      async (url, headers) => {
        seen.push([url, headers]);
        return PAGE;
      },
    );
    assert.deepEqual(link, {
      url: `ws://runner-host:${BROWSER_PORT}/live`,
      headers: { "x-agenta-browser-token": "tok" },
      page: PAGE,
    });
    assert.deepEqual(seen, [
      [`http://127.0.0.1:${BROWSER_PORT}/health`, { "x-agenta-browser-token": "tok" }],
    ]);
  });

  it("finds nothing without a token file", async () => {
    assert.equal(await findLocalBrowserLiveLink(async () => "", "h", up), undefined);
  });

  it("finds nothing when a stale token's browser does not answer", async () => {
    assert.equal(await findLocalBrowserLiveLink(async () => "tok", "h", dead), undefined);
  });
});
