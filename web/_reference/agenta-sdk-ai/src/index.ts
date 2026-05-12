/**
 * Agenta SDK — Vercel AI SDK Adapter.
 *
 * Entry point for AI SDK users:
 *   import { createAgentaTracedResponse } from "@agenta/sdk/ai";
 *
 * This adapter wraps AI SDK's streaming response with Agenta tracing.
 * It is the ONLY module that imports from the `ai` package.
 */

export {createAgentaTracedResponse} from "./traced-response"
export type {AgentaTracedResponseOptions} from "./types"

export {createAgentWithPrompts} from "./create-agent"
export type {CreateAgentWithPromptsOptions} from "./create-agent"

export {syncToolDefinitions} from "./sync-tools"
export {setAgentaContext, getAgentaContext} from "./agent-context"
export type {AgentaContext} from "./agent-context"

// Re-export core tracing for convenience (no need for separate import)
export {initAgentaTracing, withSpan, getTracer, flushTracing} from "@agenta/sdk-tracing"
export type {InitAgentaTracingOptions, SpanOptions} from "@agenta/sdk-tracing"
