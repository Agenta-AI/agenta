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
