/**
 * Which sandbox provider a run executes on, when the agent chose Daytona.
 *
 * `daytona` and `inprocess` are one choice, and the harness picks between them. Pi runs in this
 * process (`inprocess`): no daemon to boot, and a Daytona sandbox only for its commands. Claude
 * Code and Codex run in a full Daytona sandbox, because `inprocess` runs only Pi. An agent saved
 * with either value gets the same routing, so an agent saved with `inprocess` and later switched
 * to Claude Code runs on Daytona instead of being refused.
 *
 * The routing applies only where this runner has both providers and
 * `AGENTA_RUNNER_INPROCESS_FOR_PI` is on (the default). `local` and unknown ids are never routed.
 * The saved agent is not changed: the routed provider is written into the request once, at the
 * HTTP ingress, so every reader after it (the run plan, the keep-alive pool, the session
 * record, sandbox metering and the run result) sees the provider that runs. The stdin CLI does not
 * route: it has no in-process runtime, so its runs use the provider they name.
 */

import type { AgentRunRequest } from "../../protocol.ts";
import {
  SANDBOX_PROVIDER_TRAITS,
  loadRunnerConfig,
  type RunnerConfig,
} from "../../config/runner-config.ts";
import { resolveSandboxProviderId } from "./run-plan.ts";
import { runCredential } from "./runtime-policy.ts";

type Log = (message: string) => void;

const ROUTED_PROVIDERS: readonly string[] = ["daytona", "inprocess"];

/**
 * The provider `request` runs on after harness routing. Pi runs `inprocess` only in a session
 * with a run credential: its files live on the session's drive, which the runner signs with that
 * credential. A Pi run without them (a sessionless invoke, an evaluation) runs on `daytona`.
 */
export function routeSandboxForHarness(
  request: Pick<AgentRunRequest, "sandbox" | "harness" | "sessionId" | "telemetry">,
  config: RunnerConfig = loadRunnerConfig(),
): string {
  // `resolveSandboxProviderId`'s precedence, against `config`.
  const chosen = request.sandbox || config.providers.default || "local";
  const enabled: readonly string[] = config.providers.enabled;
  if (
    !config.inprocess.forPi ||
    !ROUTED_PROVIDERS.includes(chosen) ||
    !ROUTED_PROVIDERS.every((id) => enabled.includes(id)) ||
    // A malformed harness is refused by `buildRunPlan`; it is not routed.
    (request.harness !== undefined && typeof request.harness !== "string")
  ) {
    return chosen;
  }
  const harness = request.harness || "pi_core";
  const inProcessHarness =
    SANDBOX_PROVIDER_TRAITS.inprocess.harnesses?.includes(harness) ?? false;
  const hasDrive =
    Boolean(request.sessionId?.trim()) &&
    Boolean(runCredential(request as AgentRunRequest));
  return inProcessHarness && hasDrive ? "inprocess" : "daytona";
}

/** Write the routed provider into `request.sandbox`. Called once, where a request enters the runner. */
export function applySandboxRouting(request: AgentRunRequest, log: Log = () => {}): void {
  const chosen = resolveSandboxProviderId(request);
  const routed = routeSandboxForHarness(request);
  if (routed === chosen) return;
  request.sandbox = routed;
  log(
    `[sandbox-routing] harness=${request.harness || "pi_core"} chosen=${chosen} runs=${routed}`,
  );
}
