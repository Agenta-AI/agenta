/**
 * Agenta SDK Tracing — Framework Mapper Interface.
 *
 * Each supported AI framework implements this interface to map
 * its OTel span attributes to Agenta's ag.* conventions.
 */

import type {ReadableSpan} from "@opentelemetry/sdk-trace-base"

/**
 * A framework-specific attribute mapper.
 *
 * Implementations read from a ReadableSpan and return new attributes
 * to merge. They do NOT mutate the original span.
 */
export interface FrameworkMapper {
    /** Unique identifier for this mapper (e.g., "ai-sdk", "mastra") */
    readonly id: string

    /**
     * Check if this mapper can handle the given span.
     * Used for auto-detection when framework is set to "auto".
     */
    detect(span: ReadableSpan): boolean

    /**
     * Map the span's attributes to Agenta conventions.
     * Returns a record of new/overridden attributes to merge.
     * Must NOT mutate the original span.
     */
    mapAttributes(span: ReadableSpan): Record<string, unknown>
}
