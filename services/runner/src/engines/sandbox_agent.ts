/**
 * sandbox-agent harness driver.
 *
 * Drives a coding harness (Pi, Claude Code, ...) over the Agent Client Protocol (ACP)
 * through the `sandbox-agent` daemon, instead of the bespoke Pi SDK calls in the pi
 * engine. It serves the same /run contract (AgentRunRequest -> AgentRunResult), so the
 * Python side stays thin and the choice of harness/sandbox is config, not new code.
 *
 * This file is the public facade. The implementation lives in the sibling `sandbox_agent/`
 * modules and is grouped by subsystem: `environment.ts` / `environment-setup.ts` acquire the
 * session-scoped sandbox, mount, session, and MCP wiring; `run-turn.ts` runs one per-turn
 * prompt (otel run, prompt, usage, trace); `engine.ts` composes them (`runSandboxAgent` =
 * acquire -> runTurn -> destroy) and decides whether a finished turn may be parked
 * (`shouldPark`); `runtime-contracts.ts` holds the shared interfaces and `runtime-policy.ts`
 * the small pure policy helpers. Keeping this entrypoint to re-exports makes the engine's
 * supported surface obvious to the CLI, the server, and the tests. Behavior is unchanged from
 * when all of this lived in one file.
 */

export {
  acquireEnvironment,
  destroyInFlightSandboxes,
  destroyInFlightSandboxesForSession,
  resolveKeepaliveMount,
} from "./sandbox_agent/environment.ts";
export {
  sendLastMessageOnly,
  type AcquireEnvironmentResult,
  type ParkedApproval,
  type ResumeApprovalInput,
  type RunTurnOptions,
  type SandboxAgentDeps,
  type SessionEnvironment,
} from "./sandbox_agent/runtime-contracts.ts";
export {
  runSandboxAgent,
  shouldPark,
} from "./sandbox_agent/engine.ts";
export { runTurn } from "./sandbox_agent/run-turn.ts";
export {
  buildTurnText,
  messageTranscript,
} from "./sandbox_agent/transcript.ts";
export { toAcpMcpServers } from "./sandbox_agent/mcp.ts";
