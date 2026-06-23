import { local } from "sandbox-agent/local";
import { daytona } from "sandbox-agent/daytona";

import { applyDaytonaClientEnv, daytonaEnvVars } from "./daytona.ts";

/**
 * Build the sandbox-agent provider for the requested axis.
 *
 * Daytona needs an image or snapshot that carries the daemon and harness CLI. The
 * code-evaluator `DAYTONA_SNAPSHOT` is intentionally not reused because it has no daemon.
 * Provider keys come from the request secrets. Pi's self-managed login is only uploaded
 * when no key is available.
 */
export function buildSandboxProvider(
  sandboxId: string,
  env: Record<string, string>,
  binaryPath: string | undefined,
  piExtEnv: Record<string, string>,
  secrets: Record<string, string>,
) {
  if (sandboxId === "daytona") {
    applyDaytonaClientEnv();
    const snapshot = process.env.SANDBOX_AGENT_DAYTONA_SNAPSHOT;
    const image = process.env.SANDBOX_AGENT_DAYTONA_IMAGE;
    const target = process.env.SANDBOX_AGENT_DAYTONA_TARGET;
    return daytona({
      ...(image ? { image } : {}),
      create: {
        // The sandbox-agent provider always sets a default `image`, which Daytona turns into a
        // build entry that conflicts with `snapshot`. Spreading image:undefined last
        // suppresses that so the snapshot is used as-is.
        ...(snapshot ? { snapshot, image: undefined } : {}),
        ...(target ? { target } : {}),
        envVars: daytonaEnvVars(piExtEnv, secrets),
        ephemeral: true,
      } as any,
    });
  }

  // local: spawn `sandbox-agent server` on this host with the daemon env merged in.
  const logMode = (process.env.SANDBOX_AGENT_LOG_LEVEL ?? "silent") as any;
  return local({ env, binaryPath, log: logMode });
}
