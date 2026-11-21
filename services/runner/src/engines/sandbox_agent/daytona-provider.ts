import { Daytona, DaytonaNotFoundError, type Sandbox } from "@daytonaio/sdk";
import type { DaytonaProviderOptions } from "sandbox-agent/daytona";

import {
  DEFAULT_DAYTONA_SNAPSHOT,
  type RunnerDaytonaConfig,
} from "../../config/runner-config.ts";
import {
  markSandboxCreated,
  rawSandboxId,
  recordSandboxSnapshot,
} from "./created-sandboxes.ts";

type DaytonaClient = Pick<Daytona, "get">;
type DaytonaLifecycleClient = Pick<Daytona, "get" | "create">;
type DaytonaCreateObjectWithSnapshot = {
  snapshot?: string;
};

function getConfiguredSnapshot(
  create: DaytonaProviderOptions["create"],
): string | undefined {
  if (typeof create === "function" || !create) {
    return undefined;
  }

  return (create as DaytonaCreateObjectWithSnapshot).snapshot;
}
/**
 * Build a Daytona SDK client explicitly from the typed runner config, instead of relying on the
 * SDK reading ambient `DAYTONA_*` values (interface.md section 2). Every Daytona call of the
 * runner runs on a client built here.
 */
export function buildDaytonaClient(config: RunnerDaytonaConfig): Daytona {
  return new Daytona({
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    ...(config.apiUrl ? { apiUrl: config.apiUrl } : {}),
    ...(config.target ? { target: config.target } : {}),
  });
}

/** The header Daytona's preview link reads the sandbox's preview token from. */
export const PREVIEW_TOKEN_HEADER = "x-daytona-preview-token";

/**
 * The preview token of one daemon host. The runner reaches the daemon through the sandbox's
 * preview link with this token in a request header, not through the signed preview URL, whose
 * proxy adds about 95 ms to every request. The token stays in the runner: Daytona's proxy does
 * not forward the header into the sandbox.
 */
export interface PreviewToken {
  readonly value: string;
  /**
   * A new token after `stale` was refused (a start issues a new one). Concurrent calls share one
   * fetch, and a call whose token was already replaced gets the new one without a fetch.
   */
  refresh(stale: string): Promise<string>;
}

/** The preview token for a daemon URL host, or undefined when the provider issued none. */
export type PreviewTokenSource = (host: string) => PreviewToken | undefined;

interface DaytonaLifecycleDependencies {
  client: DaytonaLifecycleClient;
  target?: string;
}

/** The daemon port inside the sandbox, as the vendored provider defaults it. */
const DEFAULT_AGENT_PORT = 3000;
/** The cwd the vendored provider reports for a Daytona sandbox. */
const DEFAULT_CWD = "/home/sandbox";

/**
 * The daemon start command. A copy of sandbox-agent's `buildServerStartCommand`, which the package
 * does not export; `daytona-provider.test.ts` pins this copy to the package's own function.
 */
export function daemonStartCommand(port: number): string {
  return `nohup sandbox-agent server --no-token --host 0.0.0.0 --port ${port} >/tmp/sandbox-agent.log 2>&1 &`;
}

const RECONNECT_POLL_INTERVAL_MILLISECONDS = 250;
const RECONNECT_DEADLINE_MILLISECONDS = 10_000;

const RUNNING_STATES = new Set(["started", "running"]);
const STOPPED_STATES = new Set(["stopped", "archived"]);
const TRANSITIONAL_STATES = new Set([
  "starting",
  "stopping",
  "restoring",
  "archiving",
  "destroying",
]);
const FAILED_STATES = new Set(["error", "destroyed"]);

export class DaytonaReconnectTerminalError extends Error {
  constructor(
    readonly sandboxId: string,
    readonly state: string,
  ) {
    super(`Cannot reconnect Daytona sandbox '${sandboxId}' from state '${state}'.`);
    this.name = "DaytonaReconnectTerminalError";
  }
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof DaytonaNotFoundError ||
    (typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      error.statusCode === 404)
  );
}

function stateOf(sandbox: Sandbox): string {
  return String(sandbox.state ?? "unknown").toLowerCase();
}

/**
 * The egress policy a sandbox should be running under, in a form both the create spec and the
 * live sandbox map onto so the two can be compared. `block` is block-all, `allow` is a
 * comma-separated CIDR allow list, `open` is unrestricted.
 */
type NetworkPolicy =
  | { mode: "block" }
  | { mode: "allow"; list: string }
  | { mode: "open" };

/** Normalize a comma-separated CIDR list so order and spacing do not read as a difference. */
function normalizeAllowList(raw: string): string {
  return raw
    .split(",")
    .map((cidr) => cidr.trim())
    .filter((cidr) => cidr.length > 0)
    .sort()
    .join(",");
}

/** Read the desired policy off the resolved create fields (`daytonaNetworkFields` writes these). */
function policyFromCreate(create: unknown): NetworkPolicy {
  const fields = (create ?? {}) as {
    networkBlockAll?: unknown;
    networkAllowList?: unknown;
  };
  if (fields.networkBlockAll === true) return { mode: "block" };
  if (typeof fields.networkAllowList === "string" && fields.networkAllowList.length > 0) {
    return { mode: "allow", list: normalizeAllowList(fields.networkAllowList) };
  }
  return { mode: "open" };
}

/** Read the policy a live sandbox is currently enforcing from the fields Daytona populates. */
function policyFromSandbox(sandbox: Sandbox): NetworkPolicy {
  if (sandbox.networkBlockAll === true) return { mode: "block" };
  if (typeof sandbox.networkAllowList === "string" && sandbox.networkAllowList.length > 0) {
    return { mode: "allow", list: normalizeAllowList(sandbox.networkAllowList) };
  }
  return { mode: "open" };
}

function policiesMatch(a: NetworkPolicy, b: NetworkPolicy): boolean {
  if (a.mode !== b.mode) return false;
  if (a.mode === "allow" && b.mode === "allow") return a.list === b.list;
  return true;
}

/** Translate a desired policy into the `updateNetworkSettings` payload that produces it. */
function updatePayloadFor(policy: NetworkPolicy): {
  networkBlockAll?: boolean;
  networkAllowList?: string;
} {
  if (policy.mode === "block") return { networkBlockAll: true };
  if (policy.mode === "allow") {
    // `networkBlockAll: false` clears a prior block; `networkAllowList` sets the ranges.
    return { networkBlockAll: false, networkAllowList: policy.list };
  }
  // open: clear both the block and any stored allow list.
  return { networkBlockAll: false };
}

async function waitForStableState(
  sandbox: Sandbox,
  sandboxId: string,
  operation: "pause" | "reconnect",
): Promise<string> {
  const deadline = Date.now() + RECONNECT_DEADLINE_MILLISECONDS;
  let state = stateOf(sandbox);
  while (TRANSITIONAL_STATES.has(state)) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting to ${operation} Daytona sandbox '${sandboxId}' from state '${state}'.`,
      );
    }
    await wait(RECONNECT_POLL_INTERVAL_MILLISECONDS);
    try {
      await sandbox.refreshData();
    } catch (error) {
      if (isNotFound(error)) return "destroyed";
      throw error;
    }
    state = stateOf(sandbox);
  }
  return state;
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * The Daytona sandbox provider: create, daemon URL and start, reconnect, and delete, all on one
 * injected client. It replaces the vendored `sandbox-agent/daytona` provider and keeps its option
 * type.
 */
export function daytonaWithLifecycle(
  options: DaytonaProviderOptions = {},
  dependencies: DaytonaLifecycleDependencies,
) {
  const { client } = dependencies;
  const agentPort = options.agentPort ?? DEFAULT_AGENT_PORT;
  const startDaemon = daemonStartCommand(agentPort);
  // The egress policy this run wants. `create` is always a resolved object on our call path
  // (buildSandboxProvider); the lazy-function form the vendored type allows is not used here, so
  // a function create degrades to "open" and skips convergence rather than guessing.
  const desiredPolicy = policyFromCreate(
    typeof options.create === "function" ? undefined : options.create,
  );

  // The preview token of each daemon host this provider handed out, with its sandbox.
  const previewTokens = new Map<string, { sandboxId: string; token: PreviewToken }>();
  // The preview URL of a sandbox this provider just created or started; `getUrl` hands it out once.
  const issuedUrls = new Map<string, Promise<string>>();
  // The sandbox object the reconnect just fetched, so the daemon start does not fetch it again.
  const reconnected = new Map<string, Sandbox>();

  /** Fetch the sandbox's preview link and record its token; returns the daemon base URL. */
  const issuePreviewLink = async (sandboxId: string, sandbox: Sandbox): Promise<string> => {
    const link = await sandbox.getPreviewLink(agentPort);
    let value = link.token;
    let pending: Promise<string> | undefined;
    const token: PreviewToken = {
      get value() {
        return value;
      },
      refresh(stale) {
        if (stale !== value) return Promise.resolve(value);
        pending ??= sandbox
          .getPreviewLink(agentPort)
          .then((fresh) => (value = fresh.token))
          .finally(() => {
            pending = undefined;
          });
        return pending;
      },
    };
    previewTokens.set(new URL(link.url).host, { sandboxId, token });
    return link.url;
  };

  const forget = (sandboxId: string): void => {
    issuedUrls.delete(sandboxId);
    reconnected.delete(sandboxId);
    for (const [host, entry] of previewTokens) {
      if (entry.sandboxId === sandboxId) previewTokens.delete(host);
    }
  };

  /** Delete the sandbox and drop what this provider kept for it. A gone sandbox is success. */
  const remove = (sandboxId: string): Promise<void> => {
    forget(sandboxId);
    return deleteDaytonaSandbox(client, sandboxId);
  };

  /**
   * Start fetching the preview link for the next `getUrl`. A failed fetch surfaces there, after
   * the SDK has the sandbox id, so its cleanup still deletes the sandbox.
   */
  const startPreviewLink = (sandboxId: string, sandbox: Sandbox): void => {
    const url = issuePreviewLink(sandboxId, sandbox);
    url.catch(() => {});
    issuedUrls.set(sandboxId, url);
  };

  /**
   * Create the sandbox, then start the daemon while the preview link is fetched. The options
   * merge as the vendored provider's `create` did, without its default image: an image build
   * passes `options.image`, and a snapshot create passes no image.
   */
  const createSandbox = async (): Promise<string> => {
    const createOpts =
      typeof options.create === "function" ? await options.create() : options.create;
    const sandbox = await client.create({
      ...(options.image ? { image: options.image } : {}),
      autoStopInterval: 0,
      ...createOpts,
    } as Parameters<Daytona["create"]>[0]);
    startPreviewLink(sandbox.id, sandbox);
    try {
      await sandbox.process.executeCommand(startDaemon);
    } catch (error) {
      forget(sandbox.id);
      throw error;
    }
    return sandbox.id;
  };

  /**
   * Converge a reconnected sandbox to the run's current network policy. Daytona's
   * `updateNetworkSettings` applies the same runner-side iptables mechanism as create, so a parked
   * sandbox picks up a policy change without a rebuild. Best-effort: a failed update leaves the
   * prior policy and logs, rather than aborting the reconnect.
   */
  const syncNetworkPolicy = async (sandbox: Sandbox, sandboxId: string): Promise<void> => {
    // `sandbox` was just fetched (`get`) or started, and both leave its fields current.
    const live = policyFromSandbox(sandbox);
    if (policiesMatch(live, desiredPolicy)) return;
    try {
      await sandbox.updateNetworkSettings(updatePayloadFor(desiredPolicy));
      process.stderr.write(
        `[daytona] network policy converged sandbox=${sandboxId} ` +
          `from=${live.mode} to=${desiredPolicy.mode}\n`,
      );
    } catch (error) {
      process.stderr.write(
        `[daytona] network policy convergence failed sandbox=${sandboxId} ` +
          `to=${desiredPolicy.mode}: ${String(
            error instanceof Error ? error.message : error,
          ).slice(0, 200)}\n`,
      );
    }
  };

  return {
    name: "daytona",
    defaultCwd: options.cwd ?? DEFAULT_CWD,
    /** The token source for the daemon fetch (`createDaytonaFetch`). */
    previewToken(host: string): PreviewToken | undefined {
      return previewTokens.get(host)?.token;
    },
    async create(): Promise<string> {
      try {
        // Every Daytona-path create passes through here, with or without the Secrets wrapper,
        // so this is where the process learns which sandboxes it may reconnect to and delete.
        const sandboxId = await createSandbox();
        markSandboxCreated(sandboxId);
        // A fresh create is built from the configured snapshot (undefined for an image build).
        recordSandboxSnapshot(sandboxId, getConfiguredSnapshot(options.create));
        return sandboxId;
      } catch (error) {
        if (!isNotFound(error)) throw error;

        const snapshot = getConfiguredSnapshot(options.create);

        if (typeof snapshot !== "string" || snapshot.length === 0) {
          throw error;
        }

        const target = dependencies.target;

        const buildCommand =
          snapshot === DEFAULT_DAYTONA_SNAPSHOT
            ? `DAYTONA_API_KEY=...${target ? ` DAYTONA_TARGET=${target}` : ""} uv run build_snapshot.py`
            : `DAYTONA_API_KEY=...${target ? ` DAYTONA_TARGET=${target}` : ""} uv run build_snapshot.py --name ${snapshot}`;

        throw new Error(
          `Daytona snapshot '${snapshot}' was not found. Build it with: ${buildCommand}`,
          { cause: error },
        );
      }
    },
    /** The daemon base URL: the preview link, whose token the daemon fetch sends. */
    async getUrl(sandboxId: string): Promise<string> {
      const issued = issuedUrls.get(sandboxId);
      if (issued) {
        issuedUrls.delete(sandboxId);
        return issued;
      }
      return issuePreviewLink(sandboxId, await client.get(sandboxId));
    },
    /** Start the daemon; after a reconnect, on the sandbox object the reconnect fetched. */
    async ensureServer(sandboxId: string): Promise<void> {
      const sandbox = reconnected.get(sandboxId) ?? (await client.get(sandboxId));
      reconnected.delete(sandboxId);
      await sandbox.process.executeCommand(startDaemon);
    },
    async refreshActivity(sandboxId: string): Promise<void> {
      const id = rawSandboxId(sandboxId);

      try {
        const sandbox = await client.get(id);
        await sandbox.refreshActivity();
      } catch (error) {
        process.stderr.write(
          `[daytona] activity refresh failed sandbox=${id}: ${String(
            error instanceof Error ? error.message : error,
          ).slice(0, 200)}\n`,
        );
      }
    },
    async pause(sandboxId: string): Promise<void> {
      let sandbox: Sandbox;
      try {
        sandbox = await client.get(sandboxId);
      } catch (error) {
        if (isNotFound(error)) return;
        throw error;
      }

      const state = await waitForStableState(sandbox, sandboxId, "pause");
      if (RUNNING_STATES.has(state)) await sandbox.stop();
      // "destroyed" (including a refresh 404) is an idempotent success: nothing left to park.
      // "error" and unknown states throw so the caller's delete fallback reclaims the sandbox
      // instead of reporting it parked with a stale pointer.
      else if (!STOPPED_STATES.has(state) && state !== "destroyed") {
        throw new Error(
          `Cannot pause Daytona sandbox '${sandboxId}' from state '${state}'.`,
        );
      }
    },
    async reconnect(sandboxId: string): Promise<void> {
      let sandbox: Sandbox;
      try {
        sandbox = await client.get(sandboxId);
      } catch (error) {
        if (isNotFound(error)) {
          throw new DaytonaReconnectTerminalError(sandboxId, "not-found");
        }
        throw error;
      }
      // A parked sandbox may come from an older snapshot than the configured one; record the one
      // Daytona reports, which this `get` already returned.
      recordSandboxSnapshot(sandboxId, sandbox.snapshot);
      const state = await waitForStableState(sandbox, sandboxId, "reconnect");
      // Running or just started: keep the object for the daemon start, and fetch the preview link
      // (a start issues a new token) while the daemon starts.
      const ready = async (): Promise<void> => {
        reconnected.set(sandboxId, sandbox);
        startPreviewLink(sandboxId, sandbox);
        await syncNetworkPolicy(sandbox, sandboxId);
      };
      if (RUNNING_STATES.has(state)) {
        await ready();
        return;
      }
      if (STOPPED_STATES.has(state)) {
        await sandbox.start();
        await ready();
        return;
      }
      if (FAILED_STATES.has(state)) {
        throw new DaytonaReconnectTerminalError(sandboxId, state);
      }
      throw new DaytonaReconnectTerminalError(sandboxId, state);
    },
    destroy: remove,
    deleteSandbox: remove,
  };
}

/** Delete a sandbox by its raw id. A sandbox that is already gone is success. */
export async function deleteDaytonaSandbox(
  client: DaytonaClient,
  sandboxId: string,
): Promise<void> {
  try {
    const sandbox = await client.get(sandboxId);
    await sandbox.delete();
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
}

/** The vCPUs and GiB of memory Daytona reports for a sandbox, for metering what it really has. */
export async function readDaytonaSandboxResources(
  config: RunnerDaytonaConfig,
  sandboxId: string,
  client: DaytonaClient = buildDaytonaClient(config),
): Promise<{ vcpu: number; memoryGib: number }> {
  const sandbox = await client.get(rawSandboxId(sandboxId));
  return { vcpu: Number(sandbox.cpu), memoryGib: Number(sandbox.memory) };
}
