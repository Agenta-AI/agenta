/**
 * The `inprocess` sandbox provider: Pi runs inside the runner process through the Pi SDK, and a
 * Daytona sandbox per conversation runs only its shell commands. The design and its findings are
 * in `openspec/changes/spike-pi-inprocess-runner/`.
 */
import { DEFAULT_DAYTONA_SNAPSHOT, RunnerConfigError, withoutImpliedInProcess, type RunnerConfig } from "../../config/runner-config.ts";
import type { SandboxAgentDeps } from "../sandbox_agent/runtime-contracts.ts";
import { ConversationRegistry } from "./conversation-registry.ts";
import { INPROCESS_LIMITS, InProcessHarnessHost } from "./harness-host.ts";
import { SessionLedger } from "./session-ledger.ts";
import { providerKeysInEnvironment } from "./pi/credentials.ts";
import { apiBase } from "../../apiBase.ts";
import { REPLICA_ID } from "../../sessions/alive.ts";
import { createDaytonaApi } from "./sandbox/daytona-api.ts";
import { sandboxOwner } from "./sandbox/sandbox-owner.ts";
import { geesefsMounter } from "./sandbox/sandbox-drive.ts";
import { sandboxSlots } from "./sandbox/sandbox-slots.ts";

export const INPROCESS_PROVIDER_ID = "inprocess";

type Log = (message: string) => void;

/**
 * Provider keys in the runner environment: Pi falls back to them, so every in-process session
 * would use them. Called once at boot when the provider is enabled; returns the configuration to
 * run with.
 * - Without `local`, nothing on the runner uses them (`daytona` and `inprocess` runs carry their
 *   own keys), so they are removed from `env` (the process environment at boot) with a warning.
 *   A cloud runner that receives the whole stage env file keeps `inprocess` with no setting.
 * - With `local`, whose harness processes inherit the runner environment, they stay: an
 *   `inprocess` that only follows `daytona` is dropped with a warning, and one the operator
 *   listed refuses the boot.
 */
export function assertInProcessEnvironment(
  config: RunnerConfig,
  env: Record<string, string | undefined>,
  warn: Log = () => {},
): RunnerConfig {
  if (!config.providers.enabled.includes("inprocess") || config.inprocess.allowEnvironmentKeys) return config;
  const leaked = providerKeysInEnvironment(env);
  if (leaked.length === 0) return config;
  const names = leaked.join(", ");
  if (!config.providers.enabled.includes("local")) {
    for (const name of leaked) delete env[name];
    warn(
      `removed credential variable(s) ${names} from the runner environment: every in-process session would use them, ` +
        "and no enabled provider reads them from here. Set AGENTA_RUNNER_INPROCESS_ALLOW_ENV_KEYS=true to keep them.",
    );
    return config;
  }
  if (config.providers.inprocessImplied) {
    warn(
      `'inprocess' (enabled with 'daytona') is off: the runner environment holds credential variable(s) ${names}, ` +
        "which every in-process session would use and 'local' may need. Remove them, or set AGENTA_RUNNER_INPROCESS_ALLOW_ENV_KEYS=true.",
    );
    return withoutImpliedInProcess(config);
  }
  throw new RunnerConfigError(
    `The 'inprocess' provider is enabled but the runner environment holds credential variable(s) ${names}; ` +
      "Pi would use them for every in-process session. Remove them, or set AGENTA_RUNNER_INPROCESS_ALLOW_ENV_KEYS=true.",
  );
}

/** The command sandbox's own snapshot when set, else the `daytona` provider's image or snapshot. */
function commandSandboxArtifact(config: RunnerConfig): { image: string } | { snapshot: string } {
  if (config.inprocess.sandboxSnapshot) return { snapshot: config.inprocess.sandboxSnapshot };
  return config.daytona.image ? { image: config.daytona.image } : { snapshot: config.daytona.snapshot ?? DEFAULT_DAYTONA_SNAPSHOT };
}

export interface InProcessProvider {
  deps: SandboxAgentDeps;
  /** Shutdown: wait (bounded) for command sandboxes still parking or being deleted. */
  settle(timeoutMs: number): Promise<void>;
}

/** Command sandboxes this runner creates at once, and how long a tool call waits for a slot before it is refused. */
const MAX_CONCURRENT_SANDBOX_CREATES = 8;
const SANDBOX_SLOT_WAIT_MS = 20_000;
/** Refuse new sessions while the V8 heap is above this share of its limit. */
const HEAP_PRESSURE_RATIO = 0.85;

export function createInProcessProvider(config: RunnerConfig, log: Log): InProcessProvider {
  const apiKey = config.daytona.apiKey ?? "";
  const api = createDaytonaApi({
    apiKey,
    ...(config.daytona.apiUrl ? { apiUrl: config.daytona.apiUrl } : {}),
    ...(config.daytona.target ? { target: config.daytona.target } : {}),
  });
  const owner = sandboxOwner(REPLICA_ID, apiBase());
  const slots = sandboxSlots(MAX_CONCURRENT_SANDBOX_CREATES, config.inprocess.maxRunningSandboxes, SANDBOX_SLOT_WAIT_MS, { log });
  const registry = new ConversationRegistry(
    {
      ...commandSandboxArtifact(config),
      labels: { ...config.inprocess.sandboxLabels, "agenta.provider": INPROCESS_PROVIDER_ID },
      idleStopMs: config.inprocess.sandboxIdleStopMs,
      // Daytona's own lifecycle, as `daytona` sets it: the only cleanup of a sandbox whose runner
      // died, which holds nothing durable.
      autoStopMinutes: config.daytona.autostopMinutes,
      autoDeleteMinutes: config.daytona.autodeleteMinutes,
      slots,
      fingerprintKey: apiKey,
    },
    api,
    owner,
    log,
    { mounter: geesefsMounter(log) },
  );
  const ledger = new SessionLedger({ maxSessions: config.inprocess.maxSessions, heapPressureRatio: HEAP_PRESSURE_RATIO });
  const runtime = { registry, config: INPROCESS_LIMITS, ledger, log };
  // One line a minute while anything is held: sandboxes, retirements, slots kept
  // for sandboxes not yet confirmed stopped or gone, sessions, memory.
  const statsTimer = setInterval(() => {
    const sandboxes = registry.counters();
    const sessions = ledger.snapshot();
    const unresolvedSlots = slots.running.unresolved;
    if (sandboxes.conversations === 0 && sessions.sessions === 0 && unresolvedSlots === 0) return;
    log(`[inprocess] stats ${JSON.stringify({ ...sandboxes, unresolvedSlots, ...sessions })}`);
  }, 60_000);
  statsTimer.unref();
  return {
    deps: {
      inRunnerHarness: {
        start: async ({ facts, persist }) => new InProcessHarnessHost(runtime, facts, persist),
      },
    },
    settle: (timeoutMs) => registry.settle(timeoutMs),
  };
}
