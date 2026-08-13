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

// Mirrors web/oss/src/components/AgentChatSlice/assets/toolRow.ts, which stays authoritative for
// the desktop chat until the re-plumb PR deletes it. Port changes both ways.
// A tool has finished when it produced output, errored, or was denied. Everything else
// (preparing input, running, awaiting/just-answered an approval) is still in flight.
const SETTLED = new Set(["output-available", "output-error", "output-denied"])
export const isSettled = (state: string) => SETTLED.has(state)

// Mirrors web/oss/src/components/AgentChatSlice/assets/toolRow.ts, which stays authoritative for
// the desktop chat until the re-plumb PR deletes it. Port changes both ways.
export const isDeferredError = (errorText: string | undefined): boolean =>
    !!errorText && errorText.startsWith(DEFERRED_NOT_EXECUTED_PREFIX)
export const isUnknownResultError = (errorText: string | undefined): boolean =>
    !!errorText && errorText.startsWith(APPROVED_EXECUTION_RESULT_UNKNOWN_PREFIX)

// Mirrors web/oss/src/components/AgentChatSlice/assets/toolRow.ts, which stays authoritative for
// the desktop chat until the re-plumb PR deletes it. Port changes both ways.
export const isNotHandledOutput = (output: unknown): boolean =>
    !!output &&
    typeof output === "object" &&
    (output as {status?: unknown}).status === "not_handled"

// Mirrors web/oss/src/components/AgentChatSlice/assets/toolRow.ts, which stays authoritative for
// the desktop chat until the re-plumb PR deletes it. Port changes both ways.
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

/** Longest run of a tool's own text we put in a row. Counted in code points: cutting on UTF-16
 * units can split a surrogate pair and render a replacement character. */
export const OUTPUT_SUMMARY_MAX_LENGTH = 80

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
        const points = Array.from(s)
        return points.length > OUTPUT_SUMMARY_MAX_LENGTH
            ? `${points.slice(0, OUTPUT_SUMMARY_MAX_LENGTH).join("")}…`
            : s
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

// Mirrors `rowSummary` in web/oss/src/components/AgentChatSlice/assets/toolRow.ts, with two
// deliberate differences: the OSS row folds a failure into its sentence ("Testing the agent
// failed") and reports file/shell output by line count, and neither exists here — mobile renders no
// sentence and `ToolSummaryDisplay` carries no `kind`. Port anything else both ways.
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
