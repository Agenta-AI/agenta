/**
 * The live view of a session's browser.
 *
 * The agent runs `agenta-browser` (the `browser` skill) inside its own session sandbox. That
 * process serves the live view on `BROWSER_PORT` and writes its access token to
 * `BROWSER_TOKEN_PATH` once it is ready. The api asks this route for the sandbox's preview link
 * and relays the person's WebSocket to it. The session labels (`sandbox-labels.ts`) find the
 * sandbox from any pod, also an in-process command sandbox. The browser runs only in a Daytona
 * sandbox, except on a single-person dev stack that sets `AGENTA_BROWSER_ALLOW_SHARED_HOST=1`:
 * there a local run starts it on this host, and every session sees that one browser.
 */
import { readFile } from "node:fs/promises";
import { hostname } from "node:os";

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
export const BROWSER_TOKEN_TIMEOUT_S = 10;
/** The app polls every 4 to 10 s per open session tab; this absorbs repeat and parallel tabs. */
export const LIVE_LINK_CACHE_MS = 5_000;
export const LIVE_LINK_CACHE_MAX_ENTRIES = 512;
/** A lookup that never settles must not hold its session's entry, and every caller, forever. */
export const LIVE_LINK_LOOKUP_MS = 30_000;
/** The deadline frees the caller, not the SDK request, whose own timeout is 24 h. */
export const LIVE_LINK_MAX_ACTIVE_LOOKUPS = 64;
/** A session's lookup hung this long is given up on, so the session can try again. */
export const LIVE_LINK_STUCK_MS = 5 * 60_000;

/** What the browser's `/health` reports: the open page, and the reason the agent gave `wait`. */
export interface BrowserPage {
  wait_reason: string;
  url: string;
}

/** Where the api connects, the headers the connection carries, and the page it shows. */
export interface BrowserLiveLink {
  url: string;
  headers: Record<string, string>;
  page: BrowserPage;
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
  fs: { downloadFile(path: string, timeoutSeconds?: number): Promise<Buffer> };
  getPreviewLink(port: number): Promise<{ url: string; token: string }>;
}

export interface LiveLinkClient {
  list(query: {
    labels: Record<string, string>;
  }): AsyncIterable<LiveLinkSandbox>;
}

/** The page state of the browser behind `healthUrl`, or null when it does not answer. */
export type BrowserProbe = (
  healthUrl: string,
  headers: Record<string, string>,
) => Promise<BrowserPage | null>;

const MAX_PAGE_TEXT = 2_048;
const pageText = (value: unknown) =>
  typeof value === "string" ? value.slice(0, MAX_PAGE_TEXT) : "";

export const probeBrowserHealth: BrowserProbe = async (healthUrl, headers) => {
  try {
    const res = await fetch(healthUrl, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(BROWSER_PROBE_TIMEOUT_MS),
    });
    if (res.status !== 200) {
      await res.body?.cancel();
      return null;
    }
    // A proxy page can answer 200 too; only the browser answers `{ok: true}`.
    const body = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (body?.ok !== true) return null;
    return { wait_reason: pageText(body.wait_reason), url: pageText(body.url) };
  } catch {
    return null;
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
    if (!RUNNING_STATES.has(String(sandbox.state ?? "").toLowerCase()))
      continue;
    // No token file: this sandbox runs no browser (a session can hold a harness sandbox and a
    // command sandbox), or its browser has not finished starting.
    const token = await sandbox.fs
      .downloadFile(BROWSER_TOKEN_PATH, BROWSER_TOKEN_TIMEOUT_S)
      .then(
        (b) => b.toString("utf8").trim(),
        () => "",
      );
    if (!token) continue;
    const preview = await sandbox.getPreviewLink(BROWSER_PORT);
    const base = preview.url.replace(/\/+$/, "");
    const headers = {
      "x-daytona-preview-token": preview.token,
      "X-Daytona-Skip-Preview-Warning": "true",
      "x-agenta-browser-token": token,
    };
    // The token file outlives its browser after a SIGKILL or a sandbox stop and start.
    const page = await probe(`${base}/health`, headers);
    if (!page) continue;
    return { url: `${base.replace(/^http/, "ws")}/live`, headers, page };
  }
  return undefined;
}

/** The browser a local run started on this host; the API reaches it by this container's name. */
export async function findLocalBrowserLiveLink(
  readToken: () => Promise<string> = () =>
    readFile(BROWSER_TOKEN_PATH, "utf8").then(
      (t) => t.trim(),
      () => "",
    ),
  host: string = hostname(),
  probe: BrowserProbe = probeBrowserHealth,
): Promise<BrowserLiveLink | undefined> {
  const token = await readToken();
  if (!token) return undefined;
  const headers = { "x-agenta-browser-token": token };
  const page = await probe(`http://127.0.0.1:${BROWSER_PORT}/health`, headers);
  if (!page) return undefined;
  return { url: `ws://${host}:${BROWSER_PORT}/live`, headers, page };
}

export type LiveLinkLookup = (
  scope: LiveLinkScope,
) => Promise<BrowserLiveLink | undefined>;

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
    lookupMs = LIVE_LINK_LOOKUP_MS,
    maxActive = LIVE_LINK_MAX_ACTIVE_LOOKUPS,
    stuckMs = LIVE_LINK_STUCK_MS,
    now = Date.now,
  }: {
    ttlMs?: number;
    maxEntries?: number;
    lookupMs?: number;
    maxActive?: number;
    stuckMs?: number;
    now?: () => number;
  } = {},
): LiveLinkLookup {
  const entries = new Map<
    string,
    { at: number; link: Promise<BrowserLiveLink | undefined> }
  >();
  // One entry per session with a lookup running, so the cap counts sessions: a session whose
  // lookup outlived its deadline waits for it, until `stuckMs` (the SDK's own timeout is 24 h),
  // and a replacement takes over the session's one slot.
  const running = new Map<string, { at: number }>();
  return (scope) => {
    const key = JSON.stringify([scope.projectId, scope.sessionId]);
    const hit = entries.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.link;
    entries.delete(key);
    const previous = running.get(key);
    if (previous && now() - previous.at < stuckMs)
      return Promise.reject(new Error("browser lookup still running"));
    if (!previous && running.size >= maxActive)
      return Promise.reject(new Error("too many browser lookups"));
    const mine = { at: now() };
    running.set(key, mine);
    const started = lookup(scope).finally(() => {
      if (running.get(key) === mine) running.delete(key);
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("browser lookup timed out")),
        lookupMs,
      );
    });
    const link = Promise.race([started, late]).finally(() =>
      clearTimeout(timer),
    );
    // Pending lookups do not expire by the cache time: a slow Daytona is when sharing matters most.
    const entry = { at: Number.POSITIVE_INFINITY, link };
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

/** The live link on this deployment's Daytona, else the shared-host browser when allowed. */
export const browserLiveLink: LiveLinkLookup = cacheLiveLinks(async (scope) => {
  const config = loadRunnerConfig();
  client ??= daytonaLabelClient(config, () =>
    buildDaytonaClient(config.daytona),
  );
  const link = client ? await findBrowserLiveLink(client, scope) : undefined;
  if (link || process.env.AGENTA_BROWSER_ALLOW_SHARED_HOST !== "1") return link;
  return findLocalBrowserLiveLink();
});
