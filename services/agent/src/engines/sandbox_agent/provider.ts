import { local } from "sandbox-agent/local";
import { daytona } from "sandbox-agent/daytona";

import type { SandboxPermission } from "../../protocol.ts";
import { daytonaEnvVars } from "./daytona.ts";

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
    const snapshot = process.env.DAYTONA_SNAPSHOT;
    const image = process.env.DAYTONA_IMAGE;
    const target = process.env.DAYTONA_TARGET;
    return daytona({
      ...(image ? { image } : {}),
      create: {
        // The sandbox-agent provider always sets a default `image`, which Daytona turns into a
        // build entry that conflicts with `snapshot`. Spreading image:undefined last
        // suppresses that so the snapshot is used as-is.
        ...(snapshot ? { snapshot, image: undefined } : {}),
        ...(target ? { target } : {}),
        ...daytonaNetworkFields(sandboxPermission),
        envVars: daytonaEnvVars(piExtEnv, secrets),
        ephemeral: true,
      } as any,
    });
  }

  // local: spawn `sandbox-agent server` on this host with the daemon env merged in.
  const logMode = (process.env.SANDBOX_AGENT_LOG_LEVEL ?? "silent") as any;
  return local({ env, binaryPath, log: logMode });
}
