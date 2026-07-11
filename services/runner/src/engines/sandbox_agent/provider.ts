import { local } from "sandbox-agent/local";

import type { SandboxPermission } from "../../protocol.ts";
import { daytonaEnvVars } from "./daytona.ts";
import { daytonaWithLifecycle } from "./daytona-provider.ts";

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
 * Idle-minute thresholds for Daytona lifecycle transitions. Each is measured from last activity
 * and refreshed on every turn. Stop must exceed the 300-second maximum silent stretch of a live
 * turn. A stopped sandbox keeps its disk; a deleted one is gone and must be recreated.
 */
export const DEFAULT_DAYTONA_AUTOSTOP_MINUTES = 15;
export const DEFAULT_DAYTONA_AUTODELETE_MINUTES = 30;

function positiveMinutes(rawValue: string | undefined, fallback: number): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

/** Idle minutes before a warm (stopped) sandbox is reached. Override `DAYTONA_AUTOSTOP`. */
export function daytonaAutoStopMinutes(
  rawValue: string | undefined = process.env.DAYTONA_AUTOSTOP,
): number {
  return positiveMinutes(rawValue, DEFAULT_DAYTONA_AUTOSTOP_MINUTES);
}

/** Idle minutes before a stopped sandbox is deleted. Override `DAYTONA_AUTODELETE`. */
export function daytonaAutoDeleteMinutes(
  rawValue: string | undefined = process.env.DAYTONA_AUTODELETE,
): number {
  return positiveMinutes(rawValue, DEFAULT_DAYTONA_AUTODELETE_MINUTES);
}

/**
 * Build the Daytona `create` object from the runner's env + the resolved run inputs.
 *
 * Pulled out as a pure function because the real `daytona()` provider closes over this object
 * and constructs a Daytona client (needs API-key env), so the create fields cannot be inspected
 * through `buildSandboxProvider`. Testing this directly is the only way to pin that the create
 * object carries the auto-stop leak backstop (and `ephemeral`).
 */
export function buildDaytonaCreate(
  piExtEnv: Record<string, string>,
  secrets: Record<string, string>,
  sandboxPermission: SandboxPermission | undefined,
): Record<string, unknown> {
  const snapshot = process.env.DAYTONA_SNAPSHOT;
  const target = process.env.DAYTONA_TARGET;
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
    autoStopInterval: daytonaAutoStopMinutes(),
    autoDeleteInterval: daytonaAutoDeleteMinutes(),
    ephemeral: false,
  };
}

/** Resolve the create-time fields used to decide whether an existing sandbox is compatible. */
export function buildResolvedDaytonaCreate(
  piExtEnv: Record<string, string>,
  secrets: Record<string, string>,
  sandboxPermission: SandboxPermission | undefined,
): Record<string, unknown> {
  const create = buildDaytonaCreate(piExtEnv, secrets, sandboxPermission);
  const image = process.env.DAYTONA_IMAGE;
  return image && !create.snapshot ? { ...create, image } : create;
}

/** Sandbox ids this runner can actually provision (the "expected one of" set). */
export const KNOWN_SANDBOX_IDS = ["local", "daytona"] as const;

/** Recognized ids that are planned but not yet provisionable (fail with a specific message). */
export const PLANNED_SANDBOX_IDS = ["e2b"] as const;

/**
 * Build the sandbox-agent provider for the requested axis.
 *
 * Daytona needs an image or snapshot that carries the daemon and harness CLI. The
 * code-evaluator `DAYTONA_SNAPSHOT` is intentionally not reused because it has no daemon.
 * Provider keys come from the request secrets. Pi's self-managed login is only uploaded
 * when no key is available. The Layer 2 network policy (S1b) is enforced on Daytona via
 * `networkBlockAll` / `networkAllowList`; `buildRunPlan` rejects restricted policies the
 * local provider cannot enforce before this is reached.
 */
export function buildSandboxProvider(
  sandboxId: string,
  env: Record<string, string>,
  binaryPath: string | undefined,
  piExtEnv: Record<string, string>,
  secrets: Record<string, string>,
  sandboxPermission?: SandboxPermission,
) {
  if (sandboxId === "daytona") {
    const image = process.env.DAYTONA_IMAGE;
    return daytonaWithLifecycle({
      ...(image ? { image } : {}),
      create: buildDaytonaCreate(piExtEnv, secrets, sandboxPermission) as any,
    });
  }

  if ((PLANNED_SANDBOX_IDS as readonly string[]).includes(sandboxId)) {
    throw new Error(
      `The '${sandboxId}' sandbox is not yet supported in this runner; please use 'daytona' or 'local'.`,
    );
  }

  if (sandboxId !== "local") {
    // Refuse loud: an unrecognized id must not fall through to host execution.
    throw new Error(
      `Unknown sandbox id '${sandboxId}'; expected one of ${KNOWN_SANDBOX_IDS.join(", ")}`,
    );
  }

  // local: spawn `sandbox-agent server` on this host with the daemon env merged in.
  const logMode = (process.env.SANDBOX_AGENT_LOG_LEVEL ?? "silent") as any;
  return local({ env, binaryPath, log: logMode });
}
