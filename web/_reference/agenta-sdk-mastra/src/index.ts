/**
 * Agenta SDK — Mastra Adapter.
 *
 * Entry point for Mastra users:
 *   import { createMastraTracedResponse } from "@agenta/sdk/mastra";
 *
 * This adapter wraps Mastra's agent response with Agenta tracing.
 * It does NOT import from the `ai` package — only Mastra + OTel.
 */

export {createMastraTracedStream, createMastraTracedGenerate} from "./traced-response"
export type {MastraTracedStreamResult, MastraTracedGenerateResult} from "./traced-response"
export type {MastraTracedResponseOptions} from "./types"

export {getMastraPromptConfig} from "./prompt-config"
export type {MastraPromptConfigOptions, MastraPromptConfig} from "./prompt-config"

// Re-export core tracing for convenience
export {initAgentaTracing, withSpan, getTracer, flushTracing} from "@agenta/sdk-tracing"
export type {InitAgentaTracingOptions, SpanOptions} from "@agenta/sdk-tracing"
