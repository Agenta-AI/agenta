import deepEqual from "fast-deep-equal"
import {dump as dumpYaml, load as loadYaml} from "js-yaml"

export type RootDrawerViewMode = "form" | "json" | "yaml"

export type CodeFormat = "json" | "yaml"

export function toCodeString(value: unknown, format: CodeFormat): string {
    if (format === "yaml") return dumpYaml(value ?? null)
    return JSON.stringify(value ?? null, null, 2) ?? ""
}

export function parseCodeString<T = unknown>(value: string, format: CodeFormat, fallback: T): T {
    try {
        return (format === "yaml" ? loadYaml(value) : JSON.parse(value)) as T
    } catch {
        return fallback
    }
}

/** Why the text does not parse, or null when it does. */
export function codeParseError(value: string, format: CodeFormat): string | null {
    try {
        if (format === "yaml") loadYaml(value)
        else JSON.parse(value)
        return null
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return message.split("\n")[0] || "the text does not parse"
    }
}

/** Whether the typed text already says `value`, so a resync would only reformat it. */
export function textMatchesValue(text: string, format: CodeFormat, value: unknown): boolean {
    const typed = parseCodeString<unknown>(text, format, undefined)
    if (typed === undefined) return false
    const record = typed && typeof typed === "object" && !Array.isArray(typed) ? typed : {}
    return deepEqual(record, value)
}
