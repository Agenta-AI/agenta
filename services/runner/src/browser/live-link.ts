/**
 * The live view of a session's browser.
 *
 * The agent runs `agenta-browser` (the `browser` skill) inside its own session sandbox. That
 * process serves the live view on `BROWSER_PORT` and writes its access token to
 * `BROWSER_TOKEN_PATH` once it is ready. The api asks this route for the sandbox's preview link
 * and relays the person's WebSocket to it. The session labels (`sandbox-labels.ts`) find the
 * sandbox from any pod, also an in-process command sandbox. The browser runs only in a Daytona
 * sandbox, so a runner without Daytona has no live view.
 */
import {
  buildDaytonaClient,
  daytonaLabelClient,
  RUNNING_STATES,
} from "../engines/sandbox_agent/daytona-provider.ts";
import {
  belongsToSession,
  sessionSandboxLabels,
} from "../engines/sandbox_agent/sandbox-labels.ts";
import { loadRunnerConfig } from "../config/runner-config.ts";

export const BROWSER_PORT = 8790;
export const BROWSER_TOKEN_PATH = "/tmp/agenta-browser/token";
export const BROWSER_PROBE_TIMEOUT_MS = 3_000;
/** The api polls once every 10 s per open session tab; this absorbs repeat and parallel tabs. */
export const LIVE_LINK_CACHE_MS = 5_000;
export const LIVE_LINK_CACHE_MAX_ENTRIES = 512;

/** Where the api connects, and the headers the connection carries. */
export interface BrowserLiveLink {
  url: string;
  headers: Record<string, string>;
}

export interface LiveLinkScope {
  projectId: string;
  sessionId: string;
}

/** The part of a Daytona sandbox the lookup uses; a test hands in a fake. */
export interface LiveLinkSandbox {
  id: string;
  state?: string;
  labels?: Readonly<Record<string, string>>;
  fs: { downloadFile(path: string): Promise<Buffer> };
  getPreviewLink(port: number): Promise<{ url: string; token: string }>;
}

export interface LiveLinkClient {
  list(query: { labels: Record<string, string> }): AsyncIterable<LiveLinkSandbox>;
}

/** Whether the browser behind `healthUrl` answers 200 with these headers. */
export type BrowserProbe = (
  healthUrl: string,
  headers: Record<string, string>,
) => Promise<boolean>;

export const probeBrowserHealth: BrowserProbe = async (healthUrl, headers) => {
  try {
    const res = await fetch(healthUrl, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(BROWSER_PROBE_TIMEOUT_MS),
    });
    if (res.status !== 200) {
      await res.body?.cancel();
      return false;
    }
    // A proxy page can answer 200 too; only the browser answers `{ok: true}`.
    const body = (await res.json().catch(() => null)) as { ok?: unknown } | null;
    return body?.ok === true;
  } catch {
    return false;
  }
};

/** The running session sandbox whose browser answers, or undefined. */
export async function findBrowserLiveLink(
  client: LiveLinkClient,
  scope: LiveLinkScope,
  probe: BrowserProbe = probeBrowserHealth,
): Promise<BrowserLiveLink | undefined> {
  const { projectId, sessionId } = scope;
  for await (const sandbox of client.list({
    labels: sessionSandboxLabels(projectId, sessionId),
  })) {
    if (!belongsToSession(sandbox.labels, projectId, sessionId)) continue;
    if (!RUNNING_STATES.has(String(sandbox.state ?? "").toLowerCase())) continue;
    // No token file: this sandbox runs no browser (a session can hold a harness sandbox and a
    // command sandbox), or its browser has not finished starting.
    const token = await sandbox.fs
      .downloadFile(BROWSER_TOKEN_PATH)
      .then((b) => b.toString("utf8").trim(), () => "");
    if (!token) continue;
    const preview = await sandbox.getPreviewLink(BROWSER_PORT);
    const base = preview.url.replace(/\/+$/, "");
    const headers = {
      "x-daytona-preview-token": preview.token,
      "X-Daytona-Skip-Preview-Warning": "true",
      "x-agenta-browser-token": token,
    };
    // The token file outlives its browser after a SIGKILL or a sandbox stop and start.
    if (!(await probe(`${base}/health`, headers))) continue;
    return { url: `${base.replace(/^http/, "ws")}/live`, headers };
  }
  return undefined;
}

export type LiveLinkLookup = (scope: LiveLinkScope) => Promise<BrowserLiveLink | undefined>;

/**
 * `lookup` with each answer, found or not, kept for `ttlMs` per session. Lookups for one session
 * that overlap share one call. A failed lookup is not kept. The oldest session leaves first once
 * more than `maxEntries` are held.
 */
export function cacheLiveLinks(
  lookup: LiveLinkLookup,
  {
    ttlMs = LIVE_LINK_CACHE_MS,
    maxEntries = LIVE_LINK_CACHE_MAX_ENTRIES,
    now = Date.now,
  }: { ttlMs?: number; maxEntries?: number; now?: () => number } = {},
): LiveLinkLookup {
  const entries = new Map<string, { at: number; link: Promise<BrowserLiveLink | undefined> }>();
  return (scope) => {
    const key = JSON.stringify([scope.projectId, scope.sessionId]);
    const hit = entries.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.link;
    entries.delete(key);
    const link = lookup(scope);
    const entry = { at: now(), link };
    entries.set(key, entry);
    link.then(
      () => {
        entry.at = now();
      },
      () => {
        if (entries.get(key) === entry) entries.delete(key);
      },
    );
    if (entries.size > maxEntries) {
      entries.delete(entries.keys().next().value as string);
    }
    return link;
  };
}

let client: LiveLinkClient | undefined;

/** The live link on this deployment's Daytona; undefined when this runner has no Daytona. */
export const browserLiveLink: LiveLinkLookup = cacheLiveLinks(async (scope) => {
  const config = loadRunnerConfig();
  client ??= daytonaLabelClient(config, () => buildDaytonaClient(config.daytona));
  return client ? findBrowserLiveLink(client, scope) : undefined;
});
