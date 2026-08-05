/**
 * Agenta SDK Tracing — Framework Mapper Registry.
 *
 * Auto-detects which AI framework produced a span and applies
 * the correct attribute mapper.
 *
 * Supported frameworks:
 *   - "ai-sdk"  — Vercel AI SDK v6
 *   - "mastra"  — Mastra (stub — needs implementation)
 *   - "auto"    — auto-detect per span (default)
 *
 * To add a new framework:
 *   1. Create `mappers/my-framework.ts` implementing FrameworkMapper
 *   2. Import and add to MAPPERS array below
 */

import type {ReadableSpan} from "@opentelemetry/sdk-trace-base"

import {aiSdkMapper} from "./ai-sdk"
import {mastraMapper} from "./mastra"
import type {FrameworkMapper} from "./types"

// ─── Registry ────────────────────────────────────────────────────────────────

/** All registered framework mappers, in detection priority order */
const MAPPERS: FrameworkMapper[] = [aiSdkMapper, mastraMapper]

/** Supported framework identifiers */
export type FrameworkId = "auto" | "ai-sdk" | "mastra"

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Create a mapper function for the given framework.
 *
 * - `"auto"` (default): auto-detects per span by calling each mapper's `detect()`
 * - `"ai-sdk"`: always uses the AI SDK mapper
 * - `"mastra"`: always uses the Mastra mapper (once implemented)
 */
export function createMapper(
    framework: FrameworkId = "auto",
): (span: ReadableSpan) => Record<string, unknown> {
    if (framework !== "auto") {
        const mapper = MAPPERS.find((m) => m.id === framework)
        if (!mapper) {
            console.warn(
                `[Agenta Tracing] Unknown framework "${framework}", falling back to auto-detect`,
            )
            return autoDetectMapper
        }
        return (span) => mapper.mapAttributes(span)
    }
    return autoDetectMapper
}

/**
 * Register a custom framework mapper.
 * Call before `initAgentaTracing()` to add support for a new framework.
 */
export function registerMapper(mapper: FrameworkMapper): void {
    // Prepend so custom mappers take priority
    MAPPERS.unshift(mapper)
}

// ─── Internal ────────────────────────────────────────────────────────────────

function autoDetectMapper(span: ReadableSpan): Record<string, unknown> {
    for (const mapper of MAPPERS) {
        if (mapper.detect(span)) {
            return mapper.mapAttributes(span)
        }
    }
    // No mapper matched — no attribute overrides
    return {}
}

// Re-export types
export type {FrameworkMapper} from "./types"
