/**
 * `/browser/live` finds the session sandbox whose `agenta-browser` is ready, by label.
 *
 * Run: pnpm exec vitest run --project unit tests/unit/browser-live-link.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  BROWSER_PORT,
  BROWSER_TOKEN_PATH,
  findBrowserLiveLink,
  type LiveLinkClient,
  type LiveLinkSandbox,
} from "../../src/browser/live-link.ts";
import { sessionSandboxLabels } from "../../src/engines/sandbox_agent/sandbox-labels.ts";

const SCOPE = { projectId: "project-1", sessionId: "session-1" };

function sandbox(id: string, state: string, token?: string): LiveLinkSandbox {
  return {
    id,
    state,
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

describe("findBrowserLiveLink", () => {
  it("asks only for the session's own sandboxes", async () => {
    const seen: Record<string, string>[] = [];
    await findBrowserLiveLink(client([], seen), SCOPE);
    assert.deepEqual(seen, [sessionSandboxLabels(SCOPE.projectId, SCOPE.sessionId)]);
  });

  it("returns the WebSocket link and both tokens of the sandbox that runs the browser", async () => {
    const link = await findBrowserLiveLink(
      client([sandbox("harness", "started"), sandbox("commands", "started", "browser-token")]),
      SCOPE,
    );
    assert.deepEqual(link, {
      url: `wss://${BROWSER_PORT}-commands.proxy.example/live`,
      headers: {
        "x-daytona-preview-token": "preview-commands",
        "X-Daytona-Skip-Preview-Warning": "true",
        "x-agenta-browser-token": "browser-token",
      },
    });
  });

  it("skips a stopped sandbox, even with a token file left on its disk", async () => {
    assert.equal(await findBrowserLiveLink(client([sandbox("parked", "stopped", "old")]), SCOPE), undefined);
  });

  it("returns nothing when no browser runs in the session", async () => {
    assert.equal(await findBrowserLiveLink(client([sandbox("harness", "started")]), SCOPE), undefined);
  });
});
