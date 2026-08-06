/**
 * Agenta SDK Tracing — Attribute mapper (backwards-compatible entry point).
 *
 * Delegates to the AI SDK mapper by default. For framework-specific mapping,
 * use the mapper registry directly:
 *
 *   import { createMapper } from "./mappers";
 *   const mapper = createMapper("mastra");
 */

import type {ReadableSpan} from "@opentelemetry/sdk-trace-base"

import {aiSdkMapper} from "./mappers/ai-sdk"

/**
 * Map span attributes to Agenta conventions using the AI SDK mapper.
 *
 * @deprecated Use `createMapper()` from `./mappers` for framework-agnostic mapping.
 */
export function mapAttributes(span: ReadableSpan): void {
    aiSdkMapper.mapAttributes(span)
}
