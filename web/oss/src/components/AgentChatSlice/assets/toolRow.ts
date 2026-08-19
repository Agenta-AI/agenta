/** What one tool row says, derived from the part alone. Pure and total; split out of
 * `components/ToolActivity.tsx` so it can be tested directly. */
import type {ToolUIPart} from "ai"

import type {ToolDisplay} from "./toolDisplay"
import {stripFence} from "./toolFormat"
import {
    APPROVED_EXECUTION_RESULT_UNKNOWN_PREFIX,
    DEFERRED_NOT_EXECUTED_PREFIX,
} from "./transcriptToMessages"

// Finished = produced output, errored, or denied. Everything else is still in flight.
const SETTLED = new Set(["output-available", "output-error", "output-denied"])
export const isSettled = (state: string): boolean => SETTLED.has(state)

export const isDeferredError = (errorText: string | undefined): boolean =>
    !!errorText && errorText.startsWith(DEFERRED_NOT_EXECUTED_PREFIX)
export const isUnknownResultError = (errorText: string | undefined): boolean =>
    !!errorText && errorText.startsWith(APPROVED_EXECUTION_RESULT_UNKNOWN_PREFIX)
/** A runner error that reports a call never ran, rather than a call that failed. */
export const isNonFinalRunnerError = (errorText: string | undefined): boolean =>
    isDeferredError(errorText) || isUnknownResultError(errorText)

const isRecord = (v: unknown): v is Record<string, unknown> =>
    Boolean(v && typeof v === "object" && !Array.isArray(v))

const errorTextOf = (part: ToolUIPart): string | undefined =>
    (part as {errorText?: string}).errorText

/** A genuine failure, as opposed to a call the runner reported as never executed. */
export const hasFailed = (part: ToolUIPart): boolean =>
    (part.state as string) === "output-error" && !isNonFinalRunnerError(errorTextOf(part))

/** Whether the call actually ran — a denial or deferral never did, so neither takes past tense. */
export const hasLanded = (part: ToolUIPart): boolean =>
    (part.state as string) === "output-available" || hasFailed(part)

/** The row's sentence. A failure reads as one thought ("Testing the agent failed") rather than
 * claiming the action completed and contradicting it a few words later. */
export const partSentence = (part: ToolUIPart, display: ToolDisplay): string => {
    if (hasFailed(part)) return `${display.activity.running} failed`
    return hasLanded(part) ? display.activity.done : display.activity.running
}

/** A cold replay can reach this with the call unsettled, so tense follows the part. */
export const groupLabelText = (part: ToolUIPart, display: ToolDisplay): string =>
    `${partSentence(part, display)}${display.source ? ` · ${display.source}` : ""}`

export const isNotHandledOutput = (output: unknown): boolean =>
    !!output &&
    typeof output === "object" &&
    (output as {status?: unknown}).status === "not_handled"

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

/** Longest run of a tool's own text we put in a row. */
export const OUTPUT_SUMMARY_MAX_LENGTH = 80

/** One human line from a tool's output. Output shape is arbitrary, so this recognises the common
 * shapes and otherwise returns null. Never throws — the full payload is in the trace drawer. */
export const summarizeOutput = (output: unknown): string | null => {
    if (output == null) return null
    if (Array.isArray(output)) {
        return `${output.length} result${output.length === 1 ? "" : "s"}`
    }
    if (typeof output === "string") {
        const s = stripFence(output).trim().replace(/\s+/g, " ")
        if (!s) return null
        // A serialised payload is data, not a sentence — read it as structure.
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

/** Text keys a shell or file result carries when it arrives as an envelope rather than a string. */
const PAYLOAD_TEXT_KEYS = ["stdout", "output", "content", "text"]

/** How much came back, for output that is a payload rather than a message. */
export const sizeOf = (output: unknown): string | null => {
    // A persisted shell result is often `{stdout: "..."}`, which has a line count like any other.
    const raw =
        typeof output === "string"
            ? output
            : isRecord(output)
              ? PAYLOAD_TEXT_KEYS.map((k) => output[k]).find((v) => typeof v === "string")
              : undefined
    if (typeof raw !== "string") return null
    const text = stripFence(raw).trim()
    if (!text) return null
    const lines = text.split("\n").length
    return `${lines} line${lines === 1 ? "" : "s"}`
}

/** The row's trailing status text: what came back, or why nothing did. */
export const rowSummary = (part: ToolUIPart, display?: ToolDisplay): string | null => {
    if (part.state === "output-available") {
        if (isNotHandledOutput(part.output)) return "not handled by this client"
        // A file's contents and a command's stdout are payloads, not messages.
        if (display?.kind === "file" || display?.kind === "shell") return sizeOf(part.output)
        // A registered summary wins, normalized for the same clamp; null falls back to shapes.
        const custom = display?.summary?.((part as {input?: unknown}).input, part.output)
        if (typeof custom === "string" && custom.trim()) {
            return summarizeOutput(custom) ?? summarizeOutput(part.output)
        }
        return summarizeOutput(part.output)
    }
    if (part.state === "output-error") {
        const errorText = errorTextOf(part)
        if (isDeferredError(errorText)) return "waiting on another approval"
        if (isUnknownResultError(errorText)) return "approved, result unknown"
        // The sentence already says it failed.
        return null
    }
    if (part.state === "output-denied") return "denied"
    return null
}
