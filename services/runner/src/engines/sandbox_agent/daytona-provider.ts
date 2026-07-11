import { Daytona, DaytonaNotFoundError, type Sandbox } from "@daytonaio/sdk";
import { createHash } from "node:crypto";
import { daytona, type DaytonaProviderOptions } from "sandbox-agent/daytona";

type DaytonaClient = Pick<Daytona, "get">;
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
      else if (
        !STOPPED_STATES.has(state) &&
        !FAILED_STATES.has(state)
      ) {
        throw new Error(
          `Cannot pause Daytona sandbox '${sandboxId}' from unknown state '${state}'.`,
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
      if (RUNNING_STATES.has(state)) return;
      if (STOPPED_STATES.has(state)) {
        await sandbox.start();
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

/** Hash only resolved create fields that determine whether a Daytona sandbox is reusable. */
export function createSpecFingerprint(create: Record<string, unknown>): string {
  const envVars = create.envVars;
  const canonical = {
    snapshot: create.snapshot ?? null,
    image: create.image ?? null,
    target: create.target ?? null,
    envVarNames:
      typeof envVars === "object" && envVars !== null
        ? Object.keys(envVars).sort()
        : [],
    networkBlockAll: create.networkBlockAll ?? null,
    networkAllowList: create.networkAllowList ?? null,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
