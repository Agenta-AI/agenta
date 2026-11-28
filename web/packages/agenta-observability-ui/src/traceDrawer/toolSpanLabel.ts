/**
 * The tree label of a tool span, read from the call: the agent's own description of the step,
 * else its query, skill or name argument. Pure: no React.
 *
 * @packageDocumentation
 */

import {getAgDataInputs, type TraceSpanNode} from "@agenta/observability"
import {parseStructuredJson} from "@agenta/shared/utils"

/** The argument keys that name a tool call, in the order they win. */
const LABEL_KEYS = ["description", "query", "skill", "name"] as const

/** Keys a tool span's inputs may wrap its call arguments under. */
const ARGUMENT_KEYS = ["arguments", "args", "input", "tool_input"] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

/** An object as stored, or an object written as JSON text. */
const asRecord = (value: unknown): Record<string, unknown> | null => {
    if (isRecord(value)) return value
    if (typeof value !== "string") return null
    const parsed = parseStructuredJson(value)
    return isRecord(parsed) ? parsed : null
}

const labelIn = (args: Record<string, unknown> | null): string | null => {
    if (!args) return null
    for (const key of LABEL_KEYS) {
        const value = args[key]
        if (typeof value !== "string") continue
        const line = value.trim().split("\n")[0]?.trim()
        if (line) return line
    }
    return null
}

/**
 * The label of a tool span: "Run the tests" for `Bash` with
 * `{"command": "pytest -q", "description": "Run the tests"}`. Null for a span that is not a
 * tool, or a tool call with none of the label arguments: the row then shows the span name.
 */
export function toolSpanLabel(span: TraceSpanNode | null | undefined): string | null {
    if (span?.span_type !== "tool") return null
    const inputs = asRecord(getAgDataInputs(span))
    if (!inputs) return null
    for (const key of ARGUMENT_KEYS) {
        const label = labelIn(asRecord(inputs[key]))
        if (label) return label
    }
    return labelIn(inputs)
}
