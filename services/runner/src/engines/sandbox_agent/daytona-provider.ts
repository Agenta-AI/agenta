import { Daytona, DaytonaNotFoundError, type Sandbox } from "@daytonaio/sdk";
import { daytona, type DaytonaProviderOptions } from "sandbox-agent/daytona";

import type { RunnerDaytonaConfig } from "../../config/runner-config.ts";

type DaytonaClient = Pick<Daytona, "get">;

/**
 * Build a Daytona SDK client explicitly from the typed runner config, instead of relying on the
 * SDK reading ambient `DAYTONA_*` values (interface.md section 2). This client drives the
 * lifecycle operations the vendored provider does not implement (get/pause/reconnect/delete).
 */
export function buildDaytonaClient(config: RunnerDaytonaConfig): Daytona {
  return new Daytona({
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    ...(config.apiUrl ? { apiUrl: config.apiUrl } : {}),
    ...(config.target ? { target: config.target } : {}),
  });
}

/**
 * Bridge the typed Daytona config into the ambient `DAYTONA_*` variables the VENDORED
 * `sandbox-agent/daytona` provider constructs its own client from (it calls `new Daytona()` with
 * no arguments during sandbox creation, so it cannot be handed an explicit client). The operator
 * only ever sets `AGENTA_RUNNER_DAYTONA_*`; the runner derives the SDK's expected names from its
 * own typed config here. The daemon force-blanks these before any harness runs (`daemon.ts`
 * KNOWN_SANDBOX_ENV_VARS), so the bridged credential never reaches user code.
 */
export function applyDaytonaSdkEnv(config: RunnerDaytonaConfig): void {
  if (config.apiKey) process.env.DAYTONA_API_KEY = config.apiKey;
  if (config.apiUrl) process.env.DAYTONA_API_URL = config.apiUrl;
  if (config.target) process.env.DAYTONA_TARGET = config.target;
}
type BaseProvider = ReturnType<typeof daytona>;

interface DaytonaLifecycleDependencies {
  client?: DaytonaClient;
  buildBaseProvider?: (options: DaytonaProviderOptions) => BaseProvider;
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

/** Add lifecycle operations that the vendored Daytona provider does not implement. */
export function daytonaWithLifecycle(
  options: DaytonaProviderOptions = {},
  dependencies: DaytonaLifecycleDependencies = {},
) {
  const client = dependencies.client ?? new Daytona();
  const baseProvider = (dependencies.buildBaseProvider ?? daytona)(options);
  // The egress policy this run wants. `create` is always a resolved object on our call path
  // (buildSandboxProvider); the lazy-function form the vendored type allows is not used here, so
  // a function create degrades to "open" and skips convergence rather than guessing.
  const desiredPolicy = policyFromCreate(
    typeof options.create === "function" ? undefined : options.create,
  );

  /**
   * Converge a reconnected sandbox to the run's current network policy. Daytona's
   * `updateNetworkSettings` applies the same runner-side iptables mechanism as create, so a parked
   * sandbox picks up a policy change without a rebuild. Best-effort: a failed update leaves the
   * prior policy and logs, rather than aborting the reconnect.
   */
  const syncNetworkPolicy = async (sandbox: Sandbox, sandboxId: string): Promise<void> => {
    try {
      await sandbox.refreshData();
    } catch {
      // A stale handle still carries the fields fetched by `get`; compare against those.
    }
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
    ...baseProvider,
    async refreshActivity(sandboxId: string): Promise<void> {
      const id = sandboxId.startsWith("daytona/")
        ? sandboxId.slice("daytona/".length)
        : sandboxId;
      try {
        // Daytona counts API interactions as activity. This is believed to reset its idle-timer
        // clock; Slice 5 verifies that behavior against a live sandbox.
        await client.get(id);
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
      const state = await waitForStableState(sandbox, sandboxId, "reconnect");
      if (RUNNING_STATES.has(state)) {
        await syncNetworkPolicy(sandbox, sandboxId);
        return;
      }
      if (STOPPED_STATES.has(state)) {
        await sandbox.start();
        await syncNetworkPolicy(sandbox, sandboxId);
        return;
      }
      if (FAILED_STATES.has(state)) {
        throw new DaytonaReconnectTerminalError(sandboxId, state);
      }
      throw new DaytonaReconnectTerminalError(sandboxId, state);
    },
    async deleteSandbox(sandboxId: string): Promise<void> {
      try {
        const sandbox = await client.get(sandboxId);
        await sandbox.delete();
      } catch (error) {
        if (isNotFound(error)) return;
        throw error;
      }
    },
  };
}
