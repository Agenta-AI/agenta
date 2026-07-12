/**
 * Public sandbox-agent engine facade.
 *
 * Runtime policy and lifecycle implementation live in the sibling
 * `sandbox_agent/` modules. Keeping this entrypoint small makes the engine's
 * supported surface obvious to the CLI, server, and tests.
 */
export {
  acquireEnvironment,
  destroyInFlightSandboxes,
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
