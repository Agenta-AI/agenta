/**
 * Typed runner configuration: the single parse-and-validate boundary for every operator-facing
 * `AGENTA_RUNNER_*` environment variable. The runner reads `process.env` in exactly one place —
 * here — parses it once before the HTTP server listens, and every other module consumes the typed
 * object. This keeps the public configuration surface small, validated, and greppable.
 *
 * Design contract: docs/design/agent-workflows/projects/runner-selfhosting-cleanup/interface.md
 * (sections 2-4). Names describe what a value IS, not the feature that first needed it.
 */

import { clampTimerMs } from "../env.ts";

/**
 * Sandbox providers this runner can actually provision. `inprocess` runs Pi inside the runner
 * and uses a Daytona sandbox only for shell commands.
 */
export const KNOWN_SANDBOX_PROVIDER_IDS = ["local", "daytona", "inprocess"] as const;
export type SandboxProviderId = (typeof KNOWN_SANDBOX_PROVIDER_IDS)[number];

/**
 * What each provider IS, in the facts the rest of the runner branches on. Code asks these
 * questions instead of comparing provider ids, so a new provider answers them once here rather
 * than being missed at one of many id checks.
 */
export interface SandboxProviderTraits {
  /** The harness's own files (prompt files, tool relay, extension) are on the runner host. */
  filesOnRunner: boolean;
  /**
   * The runner host mounts the drive (the session and agent folders). False for `daytona`, whose
   * sandbox mounts it at acquire, and for `inprocess`, whose command sandbox mounts it when a tool
   * first needs it.
   */
  driveOnRunner: boolean;
  /** Shell commands run in a remote sandbox that is parked and reattached per conversation. */
  commandsInRemoteSandbox: boolean;
  /** The harness runs inside the runner process: no daemon binary, no ACP transport. */
  harnessInRunner: boolean;
  /** The harnesses this provider can run; undefined means every harness. */
  harnesses?: readonly string[];
}

export const SANDBOX_PROVIDER_TRAITS: Record<SandboxProviderId, SandboxProviderTraits> = {
  local: { filesOnRunner: true, driveOnRunner: true, commandsInRemoteSandbox: false, harnessInRunner: false },
  daytona: { filesOnRunner: false, driveOnRunner: false, commandsInRemoteSandbox: true, harnessInRunner: false },
  inprocess: { filesOnRunner: true, driveOnRunner: false, commandsInRemoteSandbox: true, harnessInRunner: true, harnesses: ["pi_core"] },
};

/**
 * Traits of `id`. An unknown provider gets the conservative answer: nothing on the runner (tool
 * delivery fails closed) and no parked remote sandbox to reattach or apply a network policy to.
 */
export function sandboxProviderTraits(id: string | undefined): SandboxProviderTraits {
  return (
    SANDBOX_PROVIDER_TRAITS[id as SandboxProviderId] ?? {
      filesOnRunner: false,
      driveOnRunner: false,
      commandsInRemoteSandbox: false,
      harnessInRunner: false,
    }
  );
}

/** The runner's pinned default Daytona artifact, used when neither snapshot nor image is set. */
export const DEFAULT_DAYTONA_SNAPSHOT = "agenta-agent-sandbox-v1";

/** Idle-minute thresholds for Daytona lifecycle transitions (see `provider.ts`). */
export const DEFAULT_DAYTONA_AUTOSTOP_MINUTES = 15;
export const DEFAULT_DAYTONA_AUTODELETE_MINUTES = 30;

export const DEFAULT_RUNNER_HOST = "127.0.0.1";
export const DEFAULT_RUNNER_PORT = 8765;
export const DEFAULT_CONCURRENCY_LIMIT = 1000;
export const DEFAULT_LOG_LEVEL = "silent";

/** Thrown when the operator's configuration is invalid. Fails startup before the server listens. */
export class RunnerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunnerConfigError";
  }
}

export interface RunnerServerConfig {
  host: string;
  port: number;
  concurrencyLimit: number;
  logLevel: string;
  replicaId: string | undefined;
  token: string | undefined;
}

export interface RunnerProvidersConfig {
  /** The effective list: the configured one plus `inprocess` when `daytona` is listed. */
  enabled: readonly SandboxProviderId[];
  default: SandboxProviderId;
  /** `inprocess` is enabled only because `daytona` is: the operator neither listed it nor made it the default. */
  inprocessImplied: boolean;
}

export interface RunnerDaytonaConfig {
  apiKey: string | undefined;
  apiUrl: string | undefined;
  target: string | undefined;
  snapshot: string | undefined;
  image: string | undefined;
  autostopMinutes: number;
  autodeleteMinutes: number;
}

export interface RunnerCallbackConfig {
  apiInternalUrl: string | undefined;
}

/**
 * The `inprocess` provider's operator settings: Pi in this process, a Daytona sandbox per
 * conversation for commands. Only what an operator has a reason to change; the rest are constants
 * of the provider (`engines/inprocess/index.ts`).
 */
export interface RunnerInProcessConfig {
  /** Labels added to every command sandbox (`k=v,...`), for cost attribution and audits. */
  sandboxLabels: Record<string, string>;
  /** Stop a running command sandbox after this long without a command: cost against warm starts. */
  sandboxIdleStopMs: number;
  /** The command sandbox's snapshot, when it should differ from the `daytona` provider's (a slimmer one). */
  sandboxSnapshot: string | undefined;
  /** Command sandboxes this runner keeps running at once; the rest wait for a slot. */
  maxRunningSandboxes: number;
  /** In-process sessions this runner hosts at once; a new one past this is refused with a sentence. */
  maxSessions: number;
  /** Accept provider keys in the runner environment (every in-process session would see them). */
  allowEnvironmentKeys: boolean;
}

export interface RunnerConfig {
  server: RunnerServerConfig;
  providers: RunnerProvidersConfig;
  daytona: RunnerDaytonaConfig;
  inprocess: RunnerInProcessConfig;
  callback: RunnerCallbackConfig;
}

type Env = Record<string, string | undefined>;

/**
 * Treat empty or whitespace-only values as absent. Compose renders an unset variable as
 * `${VAR:-}` -> "" inside the container, so "" must collapse to "no value" at this one boundary;
 * past it, the typed config carries either a real value or `undefined`.
 */
function nonEmpty(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  name: string,
): number {
  const value = nonEmpty(raw);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new RunnerConfigError(
      `${name} must be a positive integer, got '${value}'.`,
    );
  }
  return parsed;
}

/**
 * Assert the `/run` shared token is set. Called ONCE at the serving boundary (the HTTP entry
 * point), never from the per-request config reads — those only want provider config and must not
 * acquire a dependency on an auth secret they don't use.
 *
 * Required, not optional: the `/run` body carries plaintext provider keys and reusable bearer
 * tokens, and `/kill` tears down every in-flight sandbox. An unauthenticated runner is not a valid
 * deployment, so boot fails rather than serving one — the contract `AGENTA_AUTH_KEY` already has.
 */
export function assertRunnerToken(token: string | undefined): string {
  if (token === undefined) {
    throw new RunnerConfigError(
      "AGENTA_RUNNER_TOKEN is required. Generate a secret (e.g. `openssl rand -hex 32`) and set " +
        "the SAME value on the runner and on the service that calls it.",
    );
  }
  return token;
}

/**
 * Parse the enabled-provider registry. Rules (interface.md section 2):
 *  - unset means exactly `local`;
 *  - an explicitly empty list is invalid;
 *  - ids are normalized to lowercase and compared as a set;
 *  - unknown and duplicate ids are invalid.
 */
export function parseEnabledProviders(
  raw: string | undefined,
): SandboxProviderId[] {
  if (raw === undefined) return ["local"];
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new RunnerConfigError(
      "AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS is set but empty; " +
        "unset it for the default 'local', or list at least one provider.",
    );
  }
  const ids = trimmed.split(",").map((part) => part.trim().toLowerCase());
  const known = new Set<string>(KNOWN_SANDBOX_PROVIDER_IDS);
  const seen = new Set<string>();
  for (const id of ids) {
    if (id === "") {
      throw new RunnerConfigError(
        `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS has an empty entry in '${trimmed}'.`,
      );
    }
    if (!known.has(id)) {
      throw new RunnerConfigError(
        `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS lists unknown provider '${id}'; ` +
          `known providers: ${KNOWN_SANDBOX_PROVIDER_IDS.join(", ")}.`,
      );
    }
    if (seen.has(id)) {
      throw new RunnerConfigError(
        `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS lists provider '${id}' more than once.`,
      );
    }
    seen.add(id);
  }
  return ids as SandboxProviderId[];
}

/**
 * Parse the routing default. Unset means `local`; the default must be one of the enabled
 * providers (interface.md section 2, rule 5).
 */
export function parseDefaultProvider(
  raw: string | undefined,
  enabled: readonly SandboxProviderId[],
): SandboxProviderId {
  const value = (nonEmpty(raw) ?? "local").toLowerCase();
  if (!(KNOWN_SANDBOX_PROVIDER_IDS as readonly string[]).includes(value)) {
    throw new RunnerConfigError(
      `AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER is unknown provider '${value}'; ` +
        `known providers: ${KNOWN_SANDBOX_PROVIDER_IDS.join(", ")}.`,
    );
  }
  if (!enabled.includes(value as SandboxProviderId)) {
    throw new RunnerConfigError(
      `AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER '${value}' is not in the enabled set ` +
        `[${enabled.join(", ")}]. Add it to AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS ` +
        `or change the default.`,
    );
  }
  return value as SandboxProviderId;
}

/**
 * The effective enabled list: `inprocess` is on wherever `daytona` is, with no setting of its own
 * (its commands run in a Daytona sandbox, so it needs nothing `daytona` does not already have).
 * Who uses it is decided by the per-user preference in the web app, not by the deployment. The
 * added entry goes last, so a default taken from the head of the list stays `daytona`. The SDK
 * (`sandbox_providers.py`), the API mirror (`env.py`) and `web/entrypoint.sh` apply the same rule.
 */
export function withImpliedProviders(
  configured: readonly SandboxProviderId[],
): SandboxProviderId[] {
  const enabled = [...configured];
  if (enabled.includes("daytona") && !enabled.includes("inprocess")) enabled.push("inprocess");
  return enabled;
}

function parseProviders(env: Env): RunnerProvidersConfig {
  const configured = parseEnabledProviders(
    env.AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS,
  );
  const enabled = withImpliedProviders(configured);
  const defaultProvider = parseDefaultProvider(
    env.AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER,
    enabled,
  );
  const inprocessImplied =
    enabled.includes("inprocess") && !configured.includes("inprocess") && defaultProvider !== "inprocess";
  return { enabled, default: defaultProvider, inprocessImplied };
}

/** The refusal for a run that asks for a provider this deployment has not enabled. */
export function providerNotEnabledMessage(id: string, enabled: readonly string[]): string {
  const hint = id === "inprocess" ? " 'inprocess' is enabled together with 'daytona'." : "";
  return `Sandbox provider '${id}' is not enabled on this deployment (enabled: ${enabled.join(", ")}).${hint}`;
}

/**
 * The same configuration without an implied `inprocess`: boot uses it when the runner environment
 * holds provider keys, which an in-process session would share (`assertInProcessEnvironment`).
 */
export function withoutImpliedInProcess(config: RunnerConfig): RunnerConfig {
  if (!config.providers.inprocessImplied) {
    throw new RunnerConfigError("'inprocess' was enabled by the operator, not implied by 'daytona'.");
  }
  return {
    ...config,
    providers: {
      ...config.providers,
      enabled: config.providers.enabled.filter((id) => id !== "inprocess"),
      inprocessImplied: false,
    },
  };
}

function parseDaytona(
  env: Env,
  enabled: readonly SandboxProviderId[],
): RunnerDaytonaConfig {
  const apiKey = nonEmpty(env.AGENTA_RUNNER_DAYTONA_API_KEY);
  const snapshot = nonEmpty(env.AGENTA_RUNNER_DAYTONA_SNAPSHOT);
  const image = nonEmpty(env.AGENTA_RUNNER_DAYTONA_IMAGE);

  if (snapshot && image) {
    throw new RunnerConfigError(
      "AGENTA_RUNNER_DAYTONA_SNAPSHOT and AGENTA_RUNNER_DAYTONA_IMAGE are mutually " +
        "exclusive; set only one.",
    );
  }

  const autostopMinutes = parsePositiveInt(
    env.AGENTA_RUNNER_DAYTONA_AUTOSTOP_MINUTES,
    DEFAULT_DAYTONA_AUTOSTOP_MINUTES,
    "AGENTA_RUNNER_DAYTONA_AUTOSTOP_MINUTES",
  );
  const autodeleteMinutes = parsePositiveInt(
    env.AGENTA_RUNNER_DAYTONA_AUTODELETE_MINUTES,
    DEFAULT_DAYTONA_AUTODELETE_MINUTES,
    "AGENTA_RUNNER_DAYTONA_AUTODELETE_MINUTES",
  );

  if (enabled.includes("daytona") && !apiKey) {
    throw new RunnerConfigError(
      "AGENTA_RUNNER_DAYTONA_API_KEY is required when 'daytona' is in " +
        "AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS.",
    );
  }

  return {
    apiKey,
    apiUrl: nonEmpty(env.AGENTA_RUNNER_DAYTONA_API_URL),
    target: nonEmpty(env.AGENTA_RUNNER_DAYTONA_TARGET),
    snapshot,
    image,
    autostopMinutes,
    autodeleteMinutes,
  };
}

/** `k=v,k=v` into a label map. */
export function parseLabels(raw: string | undefined, name: string): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const entry of (nonEmpty(raw) ?? "").split(",")) {
    if (!entry.trim()) continue;
    const eq = entry.indexOf("=");
    if (eq <= 0) throw new RunnerConfigError(`${name} entry '${entry.trim()}' is not in the form key=value.`);
    labels[entry.slice(0, eq).trim()] = entry.slice(eq + 1).trim();
  }
  return labels;
}

function parseInProcess(env: Env, enabled: readonly SandboxProviderId[], daytona: RunnerDaytonaConfig): RunnerInProcessConfig {
  // A runner without the provider neither reads nor validates its settings.
  if (!enabled.includes("inprocess")) env = {};
  if (enabled.includes("inprocess") && !daytona.apiKey) {
    throw new RunnerConfigError(
      "AGENTA_RUNNER_DAYTONA_API_KEY is required when 'inprocess' is in " +
        "AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: its tool calls run in a Daytona sandbox.",
    );
  }
  const count = (name: string, fallback: number) => parsePositiveInt(env[name], fallback, name);
  return {
    sandboxLabels: parseLabels(env.AGENTA_RUNNER_INPROCESS_SANDBOX_LABELS, "AGENTA_RUNNER_INPROCESS_SANDBOX_LABELS"),
    sandboxIdleStopMs: clampTimerMs(count("AGENTA_RUNNER_INPROCESS_IDLE_STOP_MS", 5 * 60_000)),
    sandboxSnapshot: nonEmpty(env.AGENTA_RUNNER_INPROCESS_SANDBOX_SNAPSHOT),
    maxRunningSandboxes: count("AGENTA_RUNNER_INPROCESS_MAX_RUNNING_SANDBOXES", 40),
    maxSessions: count("AGENTA_RUNNER_INPROCESS_MAX_SESSIONS", 200),
    allowEnvironmentKeys: nonEmpty(env.AGENTA_RUNNER_INPROCESS_ALLOW_ENV_KEYS)?.toLowerCase() === "true",
  };
}

function parseServer(env: Env): RunnerServerConfig {
  return {
    host: nonEmpty(env.AGENTA_RUNNER_HOST) ?? DEFAULT_RUNNER_HOST,
    port: parsePositiveInt(
      env.AGENTA_RUNNER_PORT,
      DEFAULT_RUNNER_PORT,
      "AGENTA_RUNNER_PORT",
    ),
    concurrencyLimit: parsePositiveInt(
      env.AGENTA_RUNNER_CONCURRENCY_LIMIT,
      DEFAULT_CONCURRENCY_LIMIT,
      "AGENTA_RUNNER_CONCURRENCY_LIMIT",
    ),
    logLevel: nonEmpty(env.AGENTA_RUNNER_LOG_LEVEL) ?? DEFAULT_LOG_LEVEL,
    replicaId: nonEmpty(env.AGENTA_RUNNER_REPLICA_ID),
    token: nonEmpty(env.AGENTA_RUNNER_TOKEN),
  };
}

/**
 * Pure parse + validate. Takes an explicit environment map so tests can drive every branch
 * without touching `process.env`. Throws {@link RunnerConfigError} on the first invalid field.
 */
export function parseRunnerConfig(env: Env = process.env): RunnerConfig {
  const providers = parseProviders(env);
  const daytona = parseDaytona(env, providers.enabled);
  const inprocess = parseInProcess(env, providers.enabled, daytona);
  const server = parseServer(env);
  return {
    server,
    providers,
    daytona,
    inprocess,
    callback: {
      apiInternalUrl: nonEmpty(env.AGENTA_API_INTERNAL_URL),
    },
  };
}

let cached: RunnerConfig | undefined;

/**
 * The process-wide typed configuration, parsed and validated on first use and memoized. Boot
 * calls this once before the server listens so an invalid configuration fails startup; hot-path
 * callers then read the cached object.
 */
export function loadRunnerConfig(env: Env = process.env): RunnerConfig {
  if (!cached) cached = parseRunnerConfig(env);
  return cached;
}

/** Boot only: replace the memoized config with the one boot settled on (see {@link withoutImpliedInProcess}). */
export function replaceRunnerConfig(config: RunnerConfig): RunnerConfig {
  cached = config;
  return config;
}

/** Test-only: drop the memoized config so the next {@link loadRunnerConfig} re-parses. */
export function resetRunnerConfigCache(): void {
  cached = undefined;
}

/** The Daytona artifact reference for the startup summary: `snapshot:x`, `image:y`, or the pin. */
export function daytonaArtifactSummary(daytona: RunnerDaytonaConfig): string {
  if (daytona.image) return `image:${daytona.image}`;
  if (daytona.snapshot) return `snapshot:${daytona.snapshot}`;
  return `snapshot:${DEFAULT_DAYTONA_SNAPSHOT}`;
}

/**
 * One redacted resolved-configuration summary line set (interface.md section 3). No credential
 * value or local source path is ever logged.
 */
export function runnerConfigSummary(config: RunnerConfig): string {
  const lines = [
    `runner providers enabled=[${config.providers.enabled.join(",")}] ` +
      `default=${config.providers.default}`,
  ];
  if (config.providers.enabled.includes("daytona")) {
    lines.push(
      `runner daytona target=${config.daytona.target ?? "default"} ` +
        `artifact=${daytonaArtifactSummary(config.daytona)}`,
    );
  }
  if (config.providers.enabled.includes("inprocess")) {
    lines.push(
      `runner inprocess sandbox_start=on-first-tool-call ` +
        `artifact=${config.inprocess.sandboxSnapshot ? `snapshot:${config.inprocess.sandboxSnapshot}` : daytonaArtifactSummary(config.daytona)} ` +
        `max_running_sandboxes=${config.inprocess.maxRunningSandboxes} max_sessions=${config.inprocess.maxSessions}`,
    );
  }
  return lines.join("\n");
}
