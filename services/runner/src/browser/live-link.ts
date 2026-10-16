/**
 * The live view of a session's browser.
 *
 * The agent runs `agenta-browser` (the `browser` skill) inside its own session sandbox. That
 * process serves the live view on `BROWSER_PORT` and writes its access token to
 * `BROWSER_TOKEN_PATH` once it is ready. The api asks this route for the sandbox's preview link
 * and relays the person's WebSocket to it. The session labels (`sandbox-labels.ts`) find the
 * sandbox from any pod, also an in-process command sandbox.
 */
import type { Daytona } from "@daytonaio/sdk";

import { buildDaytonaClient } from "../engines/sandbox_agent/daytona-provider.ts";
import { sessionSandboxLabels } from "../engines/sandbox_agent/sandbox-labels.ts";
import { loadRunnerConfig } from "../config/runner-config.ts";

export const BROWSER_PORT = 8790;
export const BROWSER_TOKEN_PATH = "/tmp/agenta-browser/token";

/** Where the api connects, and the headers the connection carries. */
export interface BrowserLiveLink {
  url: string;
  headers: Record<string, string>;
}

/** The part of a Daytona sandbox the lookup uses; a test hands in a fake. */
export interface LiveLinkSandbox {
  id: string;
  state?: string;
  fs: { downloadFile(path: string): Promise<Buffer> };
  getPreviewLink(port: number): Promise<{ url: string; token: string }>;
}

export interface LiveLinkClient {
  list(query: { labels: Record<string, string> }): AsyncIterable<LiveLinkSandbox>;
}

/** The running session sandbox whose browser is ready, or undefined. */
export async function findBrowserLiveLink(
  client: LiveLinkClient,
  scope: { projectId: string; sessionId: string },
): Promise<BrowserLiveLink | undefined> {
  const labels = sessionSandboxLabels(scope.projectId, scope.sessionId);
  for await (const sandbox of client.list({ labels })) {
    if (sandbox.state !== "started") continue;
    // No token file: this sandbox runs no browser (a session can hold a harness sandbox and a
    // command sandbox), or its browser has not finished starting.
    const token = await sandbox.fs
      .downloadFile(BROWSER_TOKEN_PATH)
      .then((b) => b.toString("utf8").trim(), () => "");
    if (!token) continue;
    const preview = await sandbox.getPreviewLink(BROWSER_PORT);
    return {
      url: `${preview.url.replace(/\/+$/, "").replace(/^http/, "ws")}/live`,
      headers: {
        "x-daytona-preview-token": preview.token,
        "X-Daytona-Skip-Preview-Warning": "true",
        "x-agenta-browser-token": token,
      },
    };
  }
  return undefined;
}

let client: Daytona | undefined;

/** The live link on this deployment's Daytona; undefined when Daytona is not configured. */
export async function browserLiveLink(scope: {
  projectId: string;
  sessionId: string;
}): Promise<BrowserLiveLink | undefined> {
  const config = loadRunnerConfig();
  if (!config.daytona.apiKey) return undefined;
  client ??= buildDaytonaClient(config.daytona);
  return findBrowserLiveLink(client as unknown as LiveLinkClient, scope);
}
