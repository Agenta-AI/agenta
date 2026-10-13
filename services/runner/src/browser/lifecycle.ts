// Cloud browser lifecycle (ensure / find / delete); the API alone talks to each `sandbox/controller.cjs`.
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Daytona,
  DaytonaNotFoundError,
  Image,
  type Sandbox,
} from "@daytonaio/sdk";

import {
  loadRunnerConfig,
  type RunnerConfig,
} from "../config/runner-config.ts";
import { buildDaytonaClient } from "../engines/sandbox_agent/daytona-provider.ts";
import { shellQuote } from "../engines/sandbox_agent/mount.ts";
import { bounded } from "../engines/inprocess/sandbox/daytona-api.ts";
import { sleep } from "../engines/inprocess/sandbox/serial-queue.ts";

export type BrowserScope = "session" | "login";

/**
 * One browser: a session's browser (`ref` = session id) or a profile's login browser (`ref` = profile id).
 * `profileId` is the owner label; two users in one session get two browsers.
 */
export interface BrowserKey {
  projectId: string;
  scope: BrowserScope;
  ref: string;
  profileId: string;
}

/** Delete one browser (its key; the profile narrows it to one owner), or every browser of a profile. */
export type BrowserDeleteTarget =
  | { projectId: string; scope: BrowserScope; ref: string; profileId?: string }
  | { projectId: string; profileId: string };

/** How the API reaches the controller: its base URL, the headers every request carries, and the profile it runs. */
export interface BrowserEndpoint {
  sandboxId: string;
  url: string;
  headers: Record<string, string>;
  profileId?: string;
}

export interface BrowserLifecycle {
  ensure(key: BrowserKey): Promise<BrowserEndpoint>;
  /** A running browser, or undefined. Never creates or starts one. */
  find(key: BrowserKey): Promise<BrowserEndpoint | undefined>;
  remove(target: BrowserDeleteTarget): Promise<void>;
}

export const BROWSER_LABELS = {
  project: "agenta-browser-project",
  scope: "agenta-browser-scope",
  ref: "agenta-browser-ref",
  profile: "agenta-browser-profile",
} as const;

/** The labels that find a browser: all four for a key, the given subset for a delete target. */
export function browserLabels(
  target: BrowserKey | BrowserDeleteTarget,
): Record<string, string> {
  const labels: Record<string, string> = {
    [BROWSER_LABELS.project]: target.projectId,
  };
  if ("scope" in target) {
    labels[BROWSER_LABELS.scope] = target.scope;
    labels[BROWSER_LABELS.ref] = target.ref;
  }
  if ("profileId" in target && target.profileId)
    labels[BROWSER_LABELS.profile] = target.profileId;
  return labels;
}

const MAX_ID_LENGTH = 200;

function id(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAX_ID_LENGTH ? trimmed : undefined;
}

function scope(value: unknown): BrowserScope | undefined {
  return value === "session" || value === "login" ? value : undefined;
}

/** The `/browser/ensure` and `/browser/find` body, or undefined when a field is missing or wrong. */
export function parseBrowserKey(body: unknown): BrowserKey | undefined {
  const raw = (body ?? {}) as Record<string, unknown>;
  const key = {
    projectId: id(raw.projectId),
    scope: scope(raw.scope),
    ref: id(raw.ref),
    profileId: id(raw.profileId),
  };
  return key.projectId && key.scope && key.ref && key.profileId
    ? (key as BrowserKey)
    : undefined;
}

/** The `/browser/delete` body: `{projectId, scope, ref, profileId?}` or `{projectId, profileId}`. */
export function parseBrowserDeleteTarget(
  body: unknown,
): BrowserDeleteTarget | undefined {
  const raw = (body ?? {}) as Record<string, unknown>;
  const projectId = id(raw.projectId);
  if (!projectId) return undefined;
  const profileId = id(raw.profileId);
  if (raw.profileId !== undefined && !profileId) return undefined;
  const target = { scope: scope(raw.scope), ref: id(raw.ref) };
  if (target.scope && target.ref)
    return {
      projectId,
      scope: target.scope,
      ref: target.ref,
      ...(profileId ? { profileId } : {}),
    };
  if (raw.scope !== undefined || raw.ref !== undefined) return undefined;
  return profileId ? { projectId, profileId } : undefined;
}

/** Concurrent calls for one key share one run, so two ensures of one browser create one sandbox. */
export function oncePerKey<T>(
  run: (key: BrowserKey) => Promise<T>,
): (key: BrowserKey) => Promise<T> {
  const running = new Map<string, Promise<T>>();
  return (key) => {
    const slot = JSON.stringify(browserLabels(key));
    const pending = running.get(slot);
    if (pending) return pending;
    const started = run(key).finally(() => running.delete(slot));
    running.set(slot, started);
    return started;
  };
}

const CONTROLLER_PORT = 8790;
const CONTROLLER_DIR = "/tmp/agenta-browser";
const CONTROLLER_SOURCE = new URL("./sandbox/controller.cjs", import.meta.url);

const CONTROL_MS = 30_000;
const START_MS = 180_000;
// The first create from the declarative image also builds it.
const CREATE_MS = 600_000;
const HEALTH_MS = 45_000;
const HEALTH_PROBE_MS = 5_000;

// The same Playwright as the agent sandbox (`images/sandbox/install-agent-tools.sh`).
const DEFAULT_BROWSER_IMAGE = Image.base(
  "mcr.microsoft.com/playwright:v1.62.0-noble",
).runCommands("npm i -g playwright-core@1.62.0");

const STOPPED_STATES = new Set(["stopped", "archived"]);
// A sandbox in one of these will not serve again; with auto-delete on stop, Daytona removes it.
const DEAD_STATES = new Set([
  "error",
  "build_failed",
  "destroyed",
  "destroying",
  "stopping",
  "archiving",
]);

// Checks the recorded pid's cmdline, not `kill -0`: a restarted sandbox can reuse the old pid.
const launchCommand = (token: string) =>
  [
    `cd ${CONTROLLER_DIR}`,
    `if [ -f controller.pid ] && grep -qs controller.cjs "/proc/$(cat controller.pid)/cmdline"; then exit 0; fi`,
    `{ AGENTA_BROWSER_TOKEN=${shellQuote(token)} NODE_PATH=$(npm root -g) setsid nohup node controller.cjs > controller.log 2>&1 < /dev/null & }`,
    `echo $! > controller.pid`,
  ].join("\n");

class DaytonaBrowserLifecycle implements BrowserLifecycle {
  readonly ensure: (key: BrowserKey) => Promise<BrowserEndpoint>;

  constructor(
    private readonly client: Daytona,
    private readonly image: string | Image,
    private readonly secret: string,
  ) {
    this.ensure = oncePerKey((key) => this.ensureOne(key));
  }

  async find(key: BrowserKey): Promise<BrowserEndpoint | undefined> {
    const sandbox = (await this.list(browserLabels(key))).find(
      (s) => s.state === "started",
    );
    // The list can still name a sandbox a delete just removed.
    return sandbox ? this.endpoint(sandbox).catch(absentWhenGone) : undefined;
  }

  async remove(target: BrowserDeleteTarget): Promise<void> {
    const live = (await this.list(browserLabels(target))).filter(
      (sandbox) =>
        sandbox.state !== "destroyed" && sandbox.state !== "destroying",
    );
    await Promise.all(
      live.map((sandbox) =>
        bounded(`delete ${sandbox.id}`, CONTROL_MS, undefined, () =>
          sandbox.delete(),
        ).catch((err) => {
          if (!(err instanceof DaytonaNotFoundError)) throw err;
        }),
      ),
    );
    // Daytona keeps listing a deleted sandbox as started for a while; a later find or ensure must not reuse it.
    const deleted = new Set(live.map((sandbox) => sandbox.id));
    const deadline = Date.now() + CONTROL_MS;
    while (deleted.size && Date.now() < deadline) {
      const listed = await this.list(browserLabels(target));
      if (!listed.some((s) => deleted.has(s.id) && s.state !== "destroyed"))
        return;
      await sleep(1_000);
    }
  }

  private async ensureOne(key: BrowserKey): Promise<BrowserEndpoint> {
    const labels = browserLabels(key);
    const found = (await this.list(labels)).find(
      (s) => !DEAD_STATES.has(s.state ?? ""),
    );
    const reachable =
      found && (await this.endpoint(found).then(() => found, absentWhenGone));
    const sandbox = reachable || (await this.create(labels));
    const state = sandbox.state ?? "";
    if (STOPPED_STATES.has(state)) {
      await bounded(`start ${sandbox.id}`, START_MS, undefined, () =>
        sandbox.start(START_MS / 1000),
      );
    } else if (state !== "started") {
      await bounded(`wait for ${sandbox.id}`, START_MS, undefined, () =>
        sandbox.waitUntilStarted(START_MS / 1000),
      );
    }
    const endpoint = await this.endpoint(sandbox);
    if (!(await controllerAnswers(endpoint))) {
      await this.launchController(sandbox);
      await waitForController(endpoint);
    }
    return endpoint;
  }

  private create(labels: Record<string, string>): Promise<Sandbox> {
    return bounded("create browser sandbox", CREATE_MS, undefined, () =>
      this.client.create(
        {
          image: this.image,
          labels,
          public: false,
          autoStopInterval: 5,
          autoDeleteInterval: 0,
        },
        { timeout: CREATE_MS / 1000 },
      ),
    );
  }

  private list(labels: Record<string, string>): Promise<Sandbox[]> {
    return bounded(
      "list browser sandboxes",
      CONTROL_MS,
      undefined,
      async () => {
        const sandboxes: Sandbox[] = [];
        for await (const sandbox of this.client.list({ labels }))
          sandboxes.push(sandbox);
        return sandboxes;
      },
    );
  }

  private async endpoint(sandbox: Sandbox): Promise<BrowserEndpoint> {
    const preview = await bounded(
      `preview ${sandbox.id}`,
      CONTROL_MS,
      undefined,
      () => sandbox.getPreviewLink(CONTROLLER_PORT),
    );
    return {
      sandboxId: sandbox.id,
      url: preview.url.replace(/\/+$/, ""),
      headers: {
        "x-daytona-preview-token": preview.token,
        "X-Daytona-Skip-Preview-Warning": "true",
        "x-agenta-browser-token": this.controllerToken(sandbox.id),
      },
      profileId: sandbox.labels?.[BROWSER_LABELS.profile],
    };
  }

  /** The controller's own token, derived so every replica computes it without storing it. */
  private controllerToken(sandboxId: string): string {
    return createHmac("sha256", this.secret)
      .update(`agenta-browser:${sandboxId}`)
      .digest("hex");
  }

  private async launchController(sandbox: Sandbox): Promise<void> {
    const source = await readFile(CONTROLLER_SOURCE);
    const run = (command: string) =>
      bounded(`command ${sandbox.id}`, CONTROL_MS, undefined, () =>
        sandbox.process.executeCommand(
          `bash -c ${shellQuote(command)}`,
          undefined,
          undefined,
          20,
        ),
      );
    await run(`mkdir -p ${CONTROLLER_DIR}`);
    await bounded(`upload ${sandbox.id}`, CONTROL_MS, undefined, () =>
      sandbox.fs.uploadFile(source, `${CONTROLLER_DIR}/controller.cjs`),
    );
    const launched = await run(launchCommand(this.controllerToken(sandbox.id)));
    if (launched.exitCode !== 0) {
      throw new Error(
        `could not start the browser controller: ${(launched.result ?? "").slice(0, 200)}`,
      );
    }
  }
}

function absentWhenGone(err: unknown): undefined {
  if (err instanceof DaytonaNotFoundError) return undefined;
  throw err;
}

async function controllerAnswers(endpoint: BrowserEndpoint): Promise<boolean> {
  try {
    const res = await fetch(`${endpoint.url}/health`, {
      headers: endpoint.headers,
      signal: AbortSignal.timeout(HEALTH_PROBE_MS),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: unknown };
    return body.ok === true;
  } catch {
    return false;
  }
}

async function waitForController(endpoint: BrowserEndpoint): Promise<void> {
  const deadline = Date.now() + HEALTH_MS;
  while (Date.now() < deadline) {
    if (await controllerAnswers(endpoint)) return;
    await sleep(1_000);
  }
  throw new Error(
    `the browser controller in sandbox ${endpoint.sandboxId} did not answer within ${HEALTH_MS / 1000} s`,
  );
}

const LOCAL_START_MS = 45_000;
// Matches Daytona's auto-stop: a browser nobody used for 5 minutes goes away.
const LOCAL_IDLE_EXIT_MS = 300_000;

interface LocalBrowser {
  labels: Record<string, string>;
  child: ChildProcess;
  token: string;
  ready: Promise<number>;
}

/** The address the API reaches this runner's local browsers on: its first external IPv4. */
function advertisedHost(): string {
  for (const addresses of Object.values(networkInterfaces())) {
    const external = addresses?.find((a) => a.family === "IPv4" && !a.internal);
    if (external) return external.address;
  }
  return "127.0.0.1";
}

/** Global node modules next to this node binary, plus the nested `playwright-core` of `playwright`. */
function playwrightNodePath(): string {
  const globalRoot = join(
    dirname(dirname(process.execPath)),
    "lib",
    "node_modules",
  );
  return [globalRoot, join(globalRoot, "playwright", "node_modules")].join(
    delimiter,
  );
}

/** One controller child process per key; each exits with this runner or after 5 idle minutes. */
export class LocalBrowserLifecycle implements BrowserLifecycle {
  readonly ensure: (key: BrowserKey) => Promise<BrowserEndpoint>;
  private readonly browsers = new Map<string, LocalBrowser>();

  constructor(
    private readonly host: string = advertisedHost(),
    private readonly script: string = fileURLToPath(CONTROLLER_SOURCE),
  ) {
    this.ensure = oncePerKey(async (key) => {
      const labels = browserLabels(key);
      const browser = this.live(labels)[0] ?? this.start(labels);
      return this.endpoint(browser, await browser.ready);
    });
  }

  async find(key: BrowserKey): Promise<BrowserEndpoint | undefined> {
    for (const browser of this.live(browserLabels(key))) {
      const port = await browser.ready.catch(() => undefined);
      if (port !== undefined) return this.endpoint(browser, port);
    }
    return undefined;
  }

  async remove(target: BrowserDeleteTarget): Promise<void> {
    await Promise.all(
      this.live(browserLabels(target)).map((browser) => {
        this.browsers.delete(browser.token);
        if (
          browser.child.exitCode !== null ||
          browser.child.signalCode !== null
        )
          return undefined;
        const exited = new Promise((resolve) =>
          browser.child.once("exit", resolve),
        );
        browser.child.kill("SIGTERM");
        return exited;
      }),
    );
  }

  private live(query: Record<string, string>): LocalBrowser[] {
    return [...this.browsers.values()].filter((b) =>
      Object.entries(query).every(([k, v]) => b.labels[k] === v),
    );
  }

  private endpoint(browser: LocalBrowser, port: number): BrowserEndpoint {
    return {
      sandboxId: `local-${browser.child.pid}`,
      url: `http://${this.host}:${port}`,
      headers: { "x-agenta-browser-token": browser.token },
      profileId: browser.labels[BROWSER_LABELS.profile],
    };
  }

  private start(labels: Record<string, string>): LocalBrowser {
    const token = randomBytes(32).toString("hex");
    // Only what the controller needs: none of the runner's own credentials.
    const child = spawn(process.execPath, [this.script], {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "/tmp",
        NODE_PATH: playwrightNodePath(),
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? "",
        AGENTA_BROWSER_PORT: "0",
        AGENTA_BROWSER_PROXY_PORT: "0",
        AGENTA_BROWSER_TOKEN: token,
        AGENTA_BROWSER_IDLE_EXIT_MS: String(LOCAL_IDLE_EXIT_MS),
      },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    const ready = new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("the local browser did not start in time")),
        LOCAL_START_MS,
      );
      child.once("message", (message: { port?: unknown }) => {
        clearTimeout(timer);
        if (typeof message?.port === "number") resolve(message.port);
        else reject(new Error("the local browser reported no port"));
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`the local browser exited with ${code}`));
      });
    });
    const browser: LocalBrowser = { labels, child, token, ready };
    this.browsers.set(token, browser);
    child.once("exit", () => this.browsers.delete(token));
    ready.catch(() => child.kill("SIGKILL"));
    return browser;
  }
}

/** `local` enabled means this deployment runs code on the runner host, so browsers run there too. */
export function createBrowserLifecycle(config: RunnerConfig): BrowserLifecycle {
  if (config.providers.enabled.includes("local"))
    return new LocalBrowserLifecycle();
  if (!config.daytona.apiKey) {
    throw new Error(
      "cloud browsers need Daytona: set AGENTA_RUNNER_DAYTONA_API_KEY on the runner",
    );
  }
  if (!config.server.token)
    throw new Error(
      "cloud browsers need AGENTA_RUNNER_TOKEN to derive controller tokens",
    );
  return new DaytonaBrowserLifecycle(
    buildDaytonaClient(config.daytona),
    config.browser.image ?? DEFAULT_BROWSER_IMAGE,
    config.server.token,
  );
}

let current: BrowserLifecycle | undefined;

export function browserLifecycle(): BrowserLifecycle {
  current ??= createBrowserLifecycle(loadRunnerConfig());
  return current;
}

/** Test seam: replace the lifecycle the routes use; undefined restores the configured one. */
export function setBrowserLifecycle(
  lifecycle: BrowserLifecycle | undefined,
): void {
  current = lifecycle;
}
