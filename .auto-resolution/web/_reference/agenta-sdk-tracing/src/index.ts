/**
 * Agenta SDK Tracing — Public API.
 *
 * Two function calls replace ~500 lines of custom telemetry code:
 *
 * ```ts
 * // instrumentation.ts
 * import { initAgentaTracing } from "./lib/agenta-sdk/tracing";
 * export function register() {
 *   initAgentaTracing();
 * }
 *
 * // app/api/chat/route.ts (use the framework-specific adapter)
 * import { createAgentaTracedResponse } from "./lib/agenta-sdk/ai";
 * return createAgentaTracedResponse({ agent, messages, sessionId });
 * ```
 */

// ─── Primary API ────────────────────────────────────────────────────────────

export {initAgentaTracing, isTracingInitialized} from "./init"

// ─── Manual Instrumentation Helpers ─────────────────────────────────────────

export {
    withSpan,
    getTracer,
    flushTracing,
    // Shared adapter helpers — used by agenta-sdk-ai and agenta-sdk-mastra
    TRACER_NAME,
    TRACER_VERSION,
    getAgentaTracer,
    setAgentaSpanAttributes,
    createTracedContext,
} from "./helpers"

// ─── Types ──────────────────────────────────────────────────────────────────

export type {InitAgentaTracingOptions, SpanOptions} from "./types"

// ─── Framework Mappers ─────────────────────────────────────────────────────

export {createMapper, registerMapper} from "./mappers/index"
export type {FrameworkMapper} from "./mappers/types"
export {aiSdkMapper} from "./mappers/ai-sdk"
export {mastraMapper} from "./mappers/mastra"

// ─── Internals (for advanced usage / testing) ───────────────────────────────

export {AgentaExporter} from "./exporter"
export {TransformedSpan} from "./transformed-span"
export {isAgentSpan} from "./span-filter"
export {mapAttributes} from "./attribute-mapper"
export {repairHierarchy, propagateSessions} from "./hierarchy-repairer"
