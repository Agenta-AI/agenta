/**
 * Agenta SDK Tracing — Type definitions.
 *
 * Core tracing types only — NO framework-specific types here.
 * Framework adapters define their own types in ai/types.ts, mastra/types.ts, etc.
 */

// ─── Init Options ────────────────────────────────────────────────────────────

export interface InitAgentaTracingOptions {
    /** Agenta API host. Default: process.env.AGENTA_HOST ?? "http://localhost" */
    host?: string
    /** Agenta API key. Default: process.env.AGENTA_API_KEY. Required to enable tracing. */
    apiKey?: string
    /** OTel service name. Default: "agenta-app" */
    serviceName?: string
    /** OTel service version. Default: "0.1.0" */
    serviceVersion?: string
    /** Batch processor delay in ms. Default: 2000 */
    batchDelayMs?: number
    /** Max spans per export batch. Default: 50 */
    maxBatchSize?: number
    /**
     * AI framework to map attributes for.
     * - "auto" (default): auto-detects per span
     * - "ai-sdk": Vercel AI SDK v6
     * - "mastra": Mastra framework
     */
    framework?: "auto" | "ai-sdk" | "mastra"
}

// ─── Span Options (for manual instrumentation) ──────────────────────────────

export interface SpanOptions {
    /** Span name (e.g., "chat:session-123", "tool:detectStore") */
    name: string
    /** Agenta span type */
    type?: "agent" | "tool" | "chat" | "workflow" | "task" | "embedding"
    /** Inputs to record on the span */
    inputs?: Record<string, unknown>
    /** Custom metadata attributes */
    metadata?: Record<string, string>
}
