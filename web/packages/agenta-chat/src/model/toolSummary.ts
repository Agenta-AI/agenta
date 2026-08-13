import type {ToolUIPart} from "ai"

// The OSS original imports these rather than redefining them; the extraction introduced a
// second copy. They must match services/runner/src/tracing/otel.ts exactly, and a drift here
// turns every "skipped, not failed" tool row back into a plain error.
import {stripFence} from "../assets/toolFormat"
import {
    APPROVED_EXECUTION_RESULT_UNKNOWN_PREFIX,
    DEFERRED_NOT_EXECUTED_PREFIX,
} from "../assets/transcriptToMessages"

/** Minimal structural shape rowSummary needs off a registered tool display — a normalized human
 * summary hook, without pulling in the OSS ToolDisplay registry type. */
export interface ToolSummaryDisplay {
    summary?: (input: unknown, output: unknown) => string | null | undefined
}

// Adaptation (2026-07-25): stripFence now lives canonically in ../assets/toolFormat (copied from
// the OSS asset of the same name) — re-exported here so existing imports of it from this module
// keep working, without a second definition.
export {stripFence}

// Copied verbatim from web/oss/src/components/AgentChatSlice/components/ToolActivity.tsx
// (2026-07-25); the OSS original remains authoritative for the desktop chat until the re-plumb
// PR deletes it. Keep byte-parity if either side changes.
// A tool has finished when it produced output, errored, or was denied. Everything else
// (preparing input, running, awaiting/just-answered an approval) is still in flight.
const SETTLED = new Set(["output-available", "output-error", "output-denied"])
export const isSettled = (state: string) => SETTLED.has(state)

// Copied verbatim from web/oss/src/components/AgentChatSlice/components/ToolActivity.tsx
// (2026-07-25); the OSS original remains authoritative for the desktop chat until the re-plumb
// PR deletes it. Keep byte-parity if either side changes.
export const isDeferredError = (errorText: string | undefined): boolean =>
    !!errorText && errorText.startsWith(DEFERRED_NOT_EXECUTED_PREFIX)
export const isUnknownResultError = (errorText: string | undefined): boolean =>
    !!errorText && errorText.startsWith(APPROVED_EXECUTION_RESULT_UNKNOWN_PREFIX)

// Copied verbatim from web/oss/src/components/AgentChatSlice/components/ToolActivity.tsx
// (2026-07-25); the OSS original remains authoritative for the desktop chat until the re-plumb
// PR deletes it. Keep byte-parity if either side changes.
export const isNotHandledOutput = (output: unknown): boolean =>
    !!output &&
    typeof output === "object" &&
    (output as {status?: unknown}).status === "not_handled"

// Copied verbatim from web/oss/src/components/AgentChatSlice/components/ToolActivity.tsx
// (2026-07-25); the OSS original remains authoritative for the desktop chat until the re-plumb
// PR deletes it. Keep byte-parity if either side changes.
/** Parse a JSON object or array; undefined for anything else, so a sentence stays a sentence. */
const parseJsonish = (text: string): unknown => {
    if (!/^[[{]/.test(text)) return undefined
    try {
        const value = JSON.parse(text)
        return value && typeof value === "object" ? value : undefined
    } catch {
        return undefined
    }
}

/**
 * Derive a single human line from a tool's output. Output shape is arbitrary, so this stays
 * conservative: it recognises the common shapes and otherwise returns null (the row then shows
 * just the tool name + status). Never throws — the full payload lives in the trace drawer.
 */
export const summarizeOutput = (output: unknown): string | null => {
    if (output == null) return null
    if (Array.isArray(output)) {
        return `${output.length} result${output.length === 1 ? "" : "s"}`
    }
    if (typeof output === "string") {
        const s = stripFence(output).trim().replace(/\s+/g, " ")
        if (!s) return null
        // A serialised payload is data, not a sentence: read it as structure rather than spilling
        // 80 characters of braces into the row.
        const parsed = parseJsonish(s)
        if (parsed !== undefined) return summarizeOutput(parsed)
        return s.length > 80 ? `${s.slice(0, 80)}…` : s
    }
    if (typeof output === "object") {
        const o = output as Record<string, unknown>
        for (const k of ["summary", "result", "content", "text", "message", "title"]) {
            const v = o[k]
            if (typeof v === "string" && v.trim()) return summarizeOutput(v)
        }
        // Nothing readable in it. "3 fields" tells the reader nothing the checkmark hasn't.
        return null
    }
    return String(output)
}

// Copied verbatim from web/oss/src/components/AgentChatSlice/components/ToolActivity.tsx
// (2026-07-25); the OSS original remains authoritative for the desktop chat until the re-plumb
// PR deletes it. Keep byte-parity if either side changes.
export const rowSummary = (part: ToolUIPart, display?: ToolSummaryDisplay): string | null => {
    if (part.state === "output-available") {
        if (isNotHandledOutput(part.output)) return "not handled by this client"
        // A registered per-tool summary wins; run it through the generic normalizer for the
        // same whitespace/length clamp. Falls back to shape heuristics when it returns null.
        const custom = display?.summary?.((part as {input?: unknown}).input, part.output)
        if (typeof custom === "string" && custom.trim()) {
            return summarizeOutput(custom) ?? summarizeOutput(part.output)
        }
        return summarizeOutput(part.output)
    }
    if (part.state === "output-error") {
        const errorText = (part as {errorText?: string}).errorText
        if (isDeferredError(errorText)) return "waiting on another approval"
        if (isUnknownResultError(errorText)) return "approved, result unknown"
        return "failed"
    }
    if (part.state === "output-denied") return "denied"
    return null
}
