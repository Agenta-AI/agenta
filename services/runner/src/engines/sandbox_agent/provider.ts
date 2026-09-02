import { createHash } from "node:crypto";

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
import { daytonaWithProcessLocalSecrets } from "./daytona-secret-provider.ts";
import type { DaytonaSecretLease } from "./daytona-secrets.ts";
import {
  assertDaytonaOpaqueSecretsEnabled,
  type DaytonaSecretPlan,
} from "./daytona-secret-plan.ts";

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
  environment: Record<string, string>,
  sandboxPermission: SandboxPermission | undefined,
  secretAttachments: Record<string, string> = {},
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
    envVars: daytonaEnvVars(piExtEnv, environment),
    ...(Object.keys(secretAttachments).length > 0
      ? { secrets: secretAttachments }
      : {}),
    // `ephemeral: false` lets stop park the sandbox. Leave autoArchiveInterval unset so Daytona's
    // seven-day default sits beyond our 30-minute delete. The ladder is stop, then delete.
    // These intervals override the wrapper's hardcoded zeroes. A leaked sandbox self-reaps.
    autoStopInterval: daytona.autostopMinutes,
    autoDeleteInterval: daytona.autodeleteMinutes,
    ephemeral: false,
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

/**
 * The sandbox's GENERATION id: the immutable topology a parked Daytona sandbox was built with.
 *
 * THE CREATION-IDENTITY SPLIT (lifecycle migration, step 9). This used to hash the Daytona secret
 * PLAN as well, values included, which had two consequences and both were wrong:
 *
 *  1. A rotated model key produced a different fingerprint, so a parked sandbox failed the
 *     reconnect comparison and was DELETED. A rotation read as a different sandbox. That is the
 *     precise reason Q5 could not be satisfied — the credential-delivery port would have been
 *     inert, because the sandbox it wanted to rotate was already gone.
 *  2. The fingerprint's input retained raw credential values for the sandbox's whole parked life,
 *     to answer a question the epoch already answers better.
 *
 * What stays is what a rebuild is the only repair for: the image, the create request (routing,
 * environment, network policy, lifecycle intervals), and through them the provider and target.
 * Credential VALUES move to the epoch, which rotates them in place; the credential SLOT SET is
 * reconciled on reconnect and fails closed (`daytona-secret-provider.ts`). Nothing lost the check
 * it had — each is now checked by the layer that can actually repair it.
 */
export function daytonaCreateFingerprint(input: {
  image?: string;
  create: Record<string, unknown>;
}): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
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
 *
 * `options.inheritedLease` carries the Secret lease of a sandbox the credential preflight convicted
 * as stuck. The rebuild is created against that same allocation, which is the case Daytona support
 * confirmed works. See `acquireEnvironment`.
 */
export interface BuildSandboxProviderOptions {
  /** A detached lease from a sandbox this run already convicted. See `acquireEnvironment`. */
  inheritedLease?: DaytonaSecretLease;
  config?: RunnerConfig;
}

export function buildSandboxProvider(
  sandboxId: string,
  env: Record<string, string>,
  binaryPath: string | undefined,
  piExtEnv: Record<string, string>,
  modelEnvironment: Record<string, string>,
  sandboxPermission?: SandboxPermission,
  daytonaSecretPlan?: DaytonaSecretPlan,
  options: BuildSandboxProviderOptions = {},
) {
  const config = options.config ?? loadRunnerConfig();
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
    const createFields = buildDaytonaCreate(
      config.daytona,
      piExtEnv,
      modelEnvironment,
      sandboxPermission,
    );
    const buildDaytona = (secretAttachments: Record<string, string>) =>
      daytonaWithLifecycle(
        {
          ...(image ? { image } : {}),
          create: {
            ...createFields,
            ...(Object.keys(secretAttachments).length > 0
              ? { secrets: secretAttachments }
              : {}),
          } as any,
        },
        { client: buildDaytonaClient(config.daytona) },
      );
    // The process-local Secret wrapper applies to EVERY plan-bearing Daytona run
    // (`buildRunPlan` builds a plan unless AGENTA_RUNNER_DAYTONA_OPAQUE_SECRETS switched hiding
    // off), INCLUDING a zero-candidate plan: the wrapper then allocates no Secrets and
    // attaches nothing, but its create-fingerprint check still governs reconnects, so a parked
    // sandbox holding plaintext local_use credentials (AWS/GCP) is rebuilt — never reconnected
    // with stale values — after those credentials rotate. A run with hiding switched off carries
    // no plan and takes the plain plaintext-env provider below, unchanged from the pre-feature
    // behavior. The assert is defense-in-depth against a direct caller handing a
    // candidate-bearing plan while hiding is off: that plan's environment already dropped the
    // opaque values, so proceeding unwrapped would silently run without credentials.
    //
    // Accepted design limit: Secret ownership is PROCESS-LOCAL. The wrapper's registry dies
    // with the runner process, so a hard crash can orphan a Daytona Secret until Daytona's own
    // auto-delete backstop fires. Durable reconciliation is an explicit follow-up (PR B of the
    // Daytona-Secrets design; see PR #5278) — do not add recovery machinery here.
    if (daytonaSecretPlan) {
      assertDaytonaOpaqueSecretsEnabled(daytonaSecretPlan);
      const client = buildDaytonaClient(config.daytona);
      const createFingerprint = daytonaCreateFingerprint({
        image,
        create: createFields,
      });
      return daytonaWithProcessLocalSecrets(
        buildDaytona,
        daytonaSecretPlan,
        client.secret,
        {
          createFingerprint,
          // Set only when the credential preflight convicted the previous sandbox of this run.
          // The rebuild then mounts the SAME Secret instead of allocating a new one.
          ...(options.inheritedLease
            ? { inheritedLease: options.inheritedLease }
            : {}),
          // Run slightly after Daytona's own auto-delete backstop. The timer first issues an
          // idempotent sandbox delete, then removes Secrets, preserving the hard deletion order.
          cleanupDelayMilliseconds:
            config.daytona.autodeleteMinutes * 60_000 + 5_000,
          log: (message) => process.stderr.write(`[daytona] ${message}\n`),
        },
      );
    }
    return buildDaytona({});
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
