import { local } from "sandbox-agent/local";
import { daytona } from "sandbox-agent/daytona";
import { e2b } from "sandbox-agent/e2b";

import type { SandboxPermission } from "../../protocol.ts";
import { daytonaEnvVars } from "./daytona.ts";
import {
  E2B_CLAUDE_INSTALLED,
  E2B_CODEX_INSTALLED,
  E2B_OPENCODE_INSTALLED,
} from "./e2b.ts";

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
 * Default Daytona auto-stop backstop (minutes of idle before the runner stops the sandbox).
 *
 * 15 minutes is the Daytona SDK's own documented default and sits comfortably beyond a normal
 * run (an actively prompting sandbox is BUSY, not idle, so this measures leaked-and-idle time,
 * not total run time). Override with `DAYTONA_AUTOSTOP` if runs idle
 * longer (e.g. long parked HITL turns).
 */
export const DEFAULT_DAYTONA_AUTOSTOP_MINUTES = 15;

/**
 * The auto-stop backstop, in minutes, that self-reaps a LEAKED Daytona sandbox.
 *
 * THE LEAK: the per-run teardown (`finally` in `sandbox_agent.ts`) deletes the sandbox on every
 * normal / error / client-disconnect path, but a process KILL (docker stop / SIGTERM / SIGKILL
 * / OOM mid-run) skips the `finally`, so the sandbox leaks. The Daytona create object pairs
 * `ephemeral: true` (auto-DELETE on stop) with a non-zero auto-stop interval here: the upstream
 * sandbox-agent wrapper hardcodes `autoStopInterval: 0` (auto-stop OFF) BUT spreads our create
 * object AFTER it, so this value wins. With auto-stop > 0 an idle leaked sandbox stops on its
 * own, which then fires the ephemeral auto-delete — so it self-reaps instead of burning credit.
 *
 * Returns a positive integer minute count, clamped to >= 1 (0 would re-disable auto-stop and
 * reintroduce the leak). Invalid / non-positive env values fall back to the default.
 */
export function daytonaAutoStopMinutes(
  rawValue: string | undefined = process.env.DAYTONA_AUTOSTOP,
): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_DAYTONA_AUTOSTOP_MINUTES;
  }
  return Math.floor(parsed);
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
    // Server-side leak backstop: `ephemeral` only auto-DELETES a sandbox when it STOPS, and the
    // sandbox-agent wrapper hardcodes `autoStopInterval: 0` (auto-stop OFF) — the two cancel out,
    // so a sandbox the runner leaks (a process KILL skips the per-run teardown `finally`) never
    // self-reaps and burns credit forever. Setting a non-zero auto-stop here (our create object
    // is spread AFTER the wrapper's hardcode, so this wins) makes an idle leaked sandbox stop on
    // its own, which then triggers the ephemeral auto-delete.
    autoStopInterval: daytonaAutoStopMinutes(),
    ephemeral: true,
  };
}

/** Default E2B sandbox timeout (ms): self-reaps a leaked sandbox that process-KILL skips the `finally`. */
export const DEFAULT_E2B_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/** E2B sandbox timeout ms from env, clamped to >= 1 ms (0 would disable the backstop). */
export function e2bTimeoutMs(
  rawValue: string | undefined = process.env.E2B_TIMEOUT_MS,
): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_E2B_TIMEOUT_MS;
  return Math.floor(parsed);
}

export interface E2BCreateOptions {
  envs: Record<string, string>;
  timeoutMs: number;
  autoPause: boolean;
}

/**
 * Build the E2B provider options from the runner's env + the resolved run inputs.
 *
 * Pulled out as a pure function so the create options can be tested without constructing
 * a real E2B client (which needs E2B_API_KEY).
 *
 * The `AGENTA_AGENT_SANDBOX_{CODEX,OPENCODE,CLAUDE}_INSTALLED` flags are carried into the
 * sandbox env for visibility only (see the doc comment on `E2B_CODEX_INSTALLED` in e2b.ts):
 * unlike Pi's `AGENTA_AGENT_SANDBOX_PI_INSTALLED`, the daemon has no corresponding skip
 * mechanism for these three, so setting them to "false" does not change what the daemon does.
 */
export function buildE2BCreate(
  piExtEnv: Record<string, string>,
  secrets: Record<string, string>,
): E2BCreateOptions {
  return {
    envs: {
      AGENTA_AGENT_SANDBOX_CODEX_INSTALLED: String(E2B_CODEX_INSTALLED),
      AGENTA_AGENT_SANDBOX_OPENCODE_INSTALLED: String(E2B_OPENCODE_INSTALLED),
      AGENTA_AGENT_SANDBOX_CLAUDE_INSTALLED: String(E2B_CLAUDE_INSTALLED),
      ...piExtEnv,
      ...secrets,
    },
    timeoutMs: e2bTimeoutMs(),
    autoPause: true,
  };
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
    const image = process.env.DAYTONA_IMAGE;
    return daytona({
      ...(image ? { image } : {}),
      create: buildDaytonaCreate(piExtEnv, secrets, sandboxPermission) as any,
    });
  }

  if (sandboxId === "e2b") {
    const template = process.env.E2B_TEMPLATE ?? "agenta-sandbox-agent";
    const { envs, timeoutMs, autoPause } = buildE2BCreate(piExtEnv, secrets);
    return e2b({
      template,
      create: { envs } as any,
      timeoutMs,
      autoPause,
    });
  }

  // local: spawn `sandbox-agent server` on this host with the daemon env merged in.
  const logMode = (process.env.SANDBOX_AGENT_LOG_LEVEL ?? "silent") as any;
  return local({ env, binaryPath, log: logMode });
}
