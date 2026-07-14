import { local } from "sandbox-agent/local";

import type { SandboxPermission } from "../../protocol.ts";
import {
  DEFAULT_DAYTONA_SNAPSHOT,
  KNOWN_SANDBOX_PROVIDER_IDS,
  loadRunnerConfig,
  type RunnerConfig,
  type RunnerDaytonaConfig,
  type SandboxProviderId,
} from "../../config/runner-config.ts";
import { daytonaEnvVars } from "./daytona.ts";
import {
  applyDaytonaSdkEnv,
  buildDaytonaClient,
  daytonaWithLifecycle,
} from "./daytona-provider.ts";

/**
 * Translate the Layer 2 network policy into Daytona create fields. Daytona enforces egress
 * at the sandbox boundary: `networkBlockAll` blocks all outbound, `networkAllowList` is a
 * COMMA-SEPARATED CIDR string (not an array). `mode: "on"` (or no policy) leaves both unset
 * so the sandbox stays default-open. The create object is cast `as any` at the call site, so
 * these pass through even though the daytona wrapper's create type does not surface them.
 *
 * `mode: "allowlist"` with an EMPTY list maps to `networkBlockAll` (block-all), not default-open:
 * "allow these zero ranges" is faithfully read as "allow nothing", and it keeps this mapping
 * consistent with `buildRunPlan`, which already treats any `mode !== "on"` as a restricted
 * boundary. Leaving it unset would silently grant full egress — the opposite of the author's
 * intent — so an empty allowlist locks down rather than opens up.
 */
export function daytonaNetworkFields(
  sandboxPermission: SandboxPermission | undefined,
): { networkBlockAll: true } | { networkAllowList: string } | {} {
  const network = sandboxPermission?.network;
  if (network?.mode === "off") return { networkBlockAll: true };
  if (network?.mode === "allowlist") {
    const allowlist = network.allowlist ?? [];
    if (allowlist.length > 0) return { networkAllowList: allowlist.join(",") };
    return { networkBlockAll: true };
  }
  return {};
}

/**
 * Build the Daytona `create` object from the typed runner config + the resolved run inputs.
 *
 * Pulled out as a pure function because the vendored `daytona()` provider closes over this object
 * and constructs a Daytona client, so the create fields cannot be inspected through
 * `buildSandboxProvider`. Testing this directly is the only way to pin that the create object
 * carries the auto-stop leak backstop (and `ephemeral`).
 *
 * The artifact is the configured snapshot, else the configured image (applied at the top-level
 * provider option, so no snapshot rides the create), else the runner's pinned default snapshot.
 * Snapshot and image are mutually exclusive — the config parser already rejects setting both.
 */
export function buildDaytonaCreate(
  daytona: RunnerDaytonaConfig,
  piExtEnv: Record<string, string>,
  secrets: Record<string, string>,
  sandboxPermission: SandboxPermission | undefined,
): Record<string, unknown> {
  const snapshot = daytona.image
    ? undefined
    : (daytona.snapshot ?? DEFAULT_DAYTONA_SNAPSHOT);
  const target = daytona.target;
  return {
    // The sandbox-agent provider always sets a default `image`, which Daytona turns into a
    // build entry that conflicts with `snapshot`. Spreading image:undefined last
    // suppresses that so the snapshot is used as-is.
    ...(snapshot ? { snapshot, image: undefined } : {}),
    ...(target ? { target } : {}),
    ...daytonaNetworkFields(sandboxPermission),
    envVars: daytonaEnvVars(piExtEnv, secrets),
    // `ephemeral: false` lets stop park the sandbox. Leave autoArchiveInterval unset so Daytona's
    // seven-day default sits beyond our 30-minute delete. The ladder is stop, then delete.
    // These intervals override the wrapper's hardcoded zeroes. A leaked sandbox self-reaps.
    autoStopInterval: daytona.autostopMinutes,
    autoDeleteInterval: daytona.autodeleteMinutes,
    ephemeral: false,
  };
}

/** Recognized ids that are planned but not yet provisionable (fail with a specific message). */
export const PLANNED_SANDBOX_IDS = ["e2b"] as const;

/**
 * Build the sandbox-agent provider for the requested axis.
 *
 * Daytona is provisioned from an explicit client and create object derived from the typed runner
 * config (snapshot/image/target/lifecycle). Provider keys come from the request secrets. The
 * Layer 2 network policy (S1b) is enforced on Daytona via `networkBlockAll` / `networkAllowList`;
 * `buildRunPlan` rejects restricted policies the local provider cannot enforce before this is
 * reached. A known-but-disabled provider is refused here too (defense-in-depth for callers that
 * bypass `buildRunPlan`).
 */
export function buildSandboxProvider(
  sandboxId: string,
  env: Record<string, string>,
  binaryPath: string | undefined,
  piExtEnv: Record<string, string>,
  secrets: Record<string, string>,
  sandboxPermission?: SandboxPermission,
  config: RunnerConfig = loadRunnerConfig(),
) {
  if (
    (KNOWN_SANDBOX_PROVIDER_IDS as readonly string[]).includes(sandboxId) &&
    !config.providers.enabled.includes(sandboxId as SandboxProviderId)
  ) {
    throw new Error(
      `Sandbox provider '${sandboxId}' is not enabled on this deployment ` +
        `(enabled: ${config.providers.enabled.join(", ")}).`,
    );
  }

  if (sandboxId === "daytona") {
    // Bridge the typed credential into the ambient names the vendored provider's own
    // `new Daytona()` reads during creation; hand the lifecycle wrapper an explicit client.
    applyDaytonaSdkEnv(config.daytona);
    const image = config.daytona.image;
    return daytonaWithLifecycle(
      {
        ...(image ? { image } : {}),
        create: buildDaytonaCreate(
          config.daytona,
          piExtEnv,
          secrets,
          sandboxPermission,
        ) as any,
      },
      { client: buildDaytonaClient(config.daytona) },
    );
  }

  if ((PLANNED_SANDBOX_IDS as readonly string[]).includes(sandboxId)) {
    throw new Error(
      `The '${sandboxId}' sandbox is not yet supported in this runner; please use 'daytona' or 'local'.`,
    );
  }

  if (sandboxId !== "local") {
    // Refuse loud: an unrecognized id must not fall through to host execution.
    throw new Error(
      `Unknown sandbox id '${sandboxId}'; expected one of ${KNOWN_SANDBOX_PROVIDER_IDS.join(", ")}`,
    );
  }

  // local: spawn `sandbox-agent server` on this host with the daemon env merged in.
  const logMode = config.server.logLevel as any;
  return local({ env, binaryPath, log: logMode });
}
